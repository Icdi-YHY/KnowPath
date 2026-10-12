import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  db,
  getActiveKbId,
  getSettings,
  saveSettings as dbSaveSettings,
  setActiveKbId as dbSetActiveKbId,
} from '@/db/db';
import { DEFAULT_SETTINGS, type ChatMessage, type CrossLink, type Doc, type KnowledgeBase, type Settings, type ThreadNode } from '@/types';
import { layoutGraph } from '@/services/layout';
import * as ai from '@/services/ai';

export type ViewMode = 'kb' | 'graph' | 'chat';

const now = () => Date.now();

let abort: AbortController | null = null;

interface StreamingState {
  nodeId: string;
  content: string;
  kind: 'chat' | 'explain';
}

interface State {
  ready: boolean;
  settings: Settings;
  kbs: KnowledgeBase[];
  activeKbId: string | null;
  nodes: ThreadNode[];
  crossLinks: CrossLink[];
  messages: ChatMessage[];
  activeNodeId: string | null;
  view: ViewMode;
  streaming: StreamingState | null;
  busy: string | null;
  error: string | null;

  init: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  setError: (e: string | null) => void;

  createKb: (name: string, docs?: Doc[]) => Promise<string>;
  deleteKb: (id: string) => Promise<void>;
  renameKb: (id: string, name: string) => Promise<void>;
  setActiveKb: (id: string, silent?: boolean) => Promise<void>;
  loadDemo: () => Promise<void>;

  addDoc: (name: string, content: string) => Promise<void>;
  updateDoc: (docId: string, patch: Partial<Doc>) => Promise<void>;
  removeDoc: (docId: string) => Promise<void>;

  setView: (v: ViewMode) => void;
  selectNode: (id: string | null) => void;
  setNodeStatus: (id: string, status: ThreadNode['status']) => Promise<void>;
  renameNode: (id: string, title: string) => Promise<void>;

  generateMainline: () => Promise<void>;
  regenerateNode: (nodeId: string) => Promise<void>;
  addBranch: (parentId: string, question: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;

  sendMessage: (nodeId: string, text: string) => Promise<void>;
  stop: () => void;

  moveNode: (id: string, x: number, y: number) => Promise<void>;
  applyLayout: () => Promise<void>;
  exportKb: () => void;
  importKb: (json: string) => Promise<void>;
}

function makeNode(
  kbId: string,
  order: number,
  partial: Partial<ThreadNode> & { title: string },
): ThreadNode {
  const base: ThreadNode = {
    id: nanoid(10),
    kbId,
    parentId: null,
    kind: 'main',
    order,
    title: partial.title,
    summary: '',
    content: '',
    status: 'todo',
    x: 0,
    y: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  const clean = Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v !== undefined),
  ) as Partial<ThreadNode>;
  return { ...base, ...clean };
}

/** 计算整齐布局，但保留用户手动拖动过（pinned）的节点位置 */
function mergeLayout(nodes: ThreadNode[]): ThreadNode[] {
  const laid = layoutGraph(nodes).nodes;
  const map = new Map(laid.map((n) => [n.id, n]));
  return nodes.map((n) => {
    if (n.pinned) return n;
    const l = map.get(n.id);
    if (!l) return n;
    return l.x === n.x && l.y === n.y ? n : { ...n, x: l.x, y: l.y };
  });
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  kbs: [],
  activeKbId: null,
  nodes: [],
  crossLinks: [],
  messages: [],
  activeNodeId: null,
  view: 'kb',
  streaming: null,
  busy: null,
  error: null,

  init: async () => {
    const [settings, kbs, activeKbId] = await Promise.all([
      getSettings(),
      db.kbs.orderBy('updatedAt').reverse().toArray(),
      getActiveKbId(),
    ]);
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const id = activeKbId && kbs.some((k) => k.id === activeKbId) ? activeKbId : kbs[0]?.id ?? null;
    set({ settings: merged, kbs, activeKbId: id });
    if (id) await get().setActiveKb(id, true);
    // 有主线内容时默认进入图谱，否则进知识库
    if (get().nodes.length) set({ view: 'graph' });
    set({ ready: true });
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await dbSaveSettings(settings);
  },

  setError: (error) => set({ error }),

  createKb: async (name, docs = []) => {
    const kb: KnowledgeBase = {
      id: nanoid(10),
      name: name.trim() || '未命名知识库',
      docs,
      createdAt: now(),
      updatedAt: now(),
    };
    await db.kbs.add(kb);
    set((s) => ({ kbs: [kb, ...s.kbs] }));
    await get().setActiveKb(kb.id);
    return kb.id;
  },

  deleteKb: async (id) => {
    await db.transaction('rw', db.kbs, db.nodes, db.crossLinks, db.messages, async () => {
      await db.kbs.delete(id);
      await db.nodes.where('kbId').equals(id).delete();
      await db.crossLinks.where('kbId').equals(id).delete();
      await db.messages.where('kbId').equals(id).delete();
    });
    const kbs = get().kbs.filter((k) => k.id !== id);
    set({ kbs });
    if (get().activeKbId === id) {
      const next = kbs[0]?.id ?? null;
      if (next) await get().setActiveKb(next);
      else set({ activeKbId: null, nodes: [], crossLinks: [], messages: [], activeNodeId: null, view: 'kb' });
    }
  },

  renameKb: async (id, name) => {
    await db.kbs.update(id, { name, updatedAt: now() });
    set((s) => ({
      kbs: s.kbs.map((k) => (k.id === id ? { ...k, name } : k)),
    }));
  },

  setActiveKb: async (id, silent = false) => {
    const [nodes, crossLinks, messages] = await Promise.all([
      db.nodes.where('kbId').equals(id).toArray(),
      db.crossLinks.where('kbId').equals(id).toArray(),
      db.messages.where('kbId').equals(id).toArray(),
    ]);
    const laid = mergeLayout(nodes);
    set({
      activeKbId: id,
      nodes: laid,
      crossLinks,
      messages,
      activeNodeId: nodes.find((n) => n.kind === 'main')?.id ?? null,
      view: silent && get().view !== 'kb' ? get().view : 'kb',
    });
    await dbSetActiveKbId(id);
  },

  loadDemo: async () => {
    const doc: Doc = {
      id: nanoid(10),
      name: 'HTTP 与 Web 基础（示例材料）',
      content: `HTTP 是浏览器和服务器之间通信的协议。请求由方法、路径、头部、可选正文组成；响应由状态码、头部、正文组成。
常见方法有 GET、POST、PUT、DELETE。状态码 2xx 成功、3xx 重定向、4xx 客户端错误、5xx 服务端错误。
URL 结构包含协议、主机、端口、路径、查询参数、片段。
HTTP 是无状态协议，因此引入 Cookie 与 Session 来维持登录状态；现代还常用 Token（如 JWT）。
HTTPS 在 HTTP 之下加了 TLS 加密，保证传输的机密性与完整性。
缓存通过 Cache-Control、ETag、Last-Modified 等首部实现，减少重复请求。
跨域由同源策略约束，通过 CORS 首部协商是否允许跨域请求。`,
      createdAt: now(),
    };
    const kbId = await get().createKb('HTTP 与 Web 基础', [doc]);
    const items: [string, string][] = [
      ['什么是 Web 与浏览器', '理解浏览器如何获取并渲染网页，建立最基础的直觉'],
      ['URL 的组成', '看懂一个网址的每个部分分别代表什么'],
      ['HTTP 请求与响应', '掌握请求和响应的结构与一次完整交互过程'],
      ['HTTP 方法与状态码', '分清 GET/POST 等方法的用途与各类状态码含义'],
      ['无状态与 Cookie/Session', '理解为什么需要 Cookie，登录状态如何维持'],
      ['Token 与 JWT 入门', '了解现代无状态认证方案的原理'],
      ['HTTPS 与 TLS 加密', '明白 HTTPS 到底加密了什么、如何保证安全'],
      ['HTTP 缓存机制', '掌握强缓存与协商缓存，知道何时会命中缓存'],
      ['同源策略与跨域 CORS', '理解浏览器的安全边界与跨域是怎么被允许的'],
    ];
    const nodes: ThreadNode[] = items.map(([title, summary], i) => {
      const n = makeNode(kbId, i, { title, summary });
      n.content = `## ${title}\n\n这是「${summary}」的示例讲解占位内容。\n\n配置 AI 后点击节点右上角的 **重新生成** 即可让 AI 从零讲透这个知识点。\n\n- 要点一：先建立直觉类比\n- 要点二：再看精确定义\n- 要点三：最后动手验证\n\n> 自检：你能否用自己的话把它讲给一个完全不懂的人听？`;
      return n;
    });
    await db.nodes.bulkAdd(nodes);
    // 造一条示例支线
    const main3 = nodes[3];
    const branch = makeNode(kbId, 0, {
      title: 'GET 与 POST 的本质区别',
      summary: '为什么说 GET 幂等而 POST 不幂等',
      kind: 'branch',
      parentId: main3.id,
    });
    branch.content =
      '## GET 与 POST 的本质区别\n\n示例支线内容。\n\n- GET 用于获取资源，参数放在 URL，可被缓存与收藏\n- POST 用于提交数据，参数在正文，会改变服务端状态\n- 幂等指多次执行结果一致，GET 幂等，POST 通常不幂等';
    await db.nodes.add(branch);
    const cl: CrossLink = {
      id: nanoid(10),
      kbId,
      sourceId: branch.id,
      targetId: nodes[7].id,
      reason: '缓存策略与请求方法相关',
      createdAt: now(),
    };
    await db.crossLinks.add(cl);
    const msg: ChatMessage = {
      id: nanoid(10),
      kbId,
      nodeId: main3.id,
      role: 'assistant',
      content: '你好！我是你的学习导师。这里会展示你和 AI 的沉浸对话。配置 API Key 后，直接提问即可。',
      createdAt: now(),
    };
    await db.messages.add(msg);
    await get().setActiveKb(kbId);
    set({ view: 'graph' });
  },

  addDoc: async (name, content) => {
    const kbId = get().activeKbId;
    if (!kbId) return;
    const kb = get().kbs.find((k) => k.id === kbId);
    if (!kb) return;
    const doc: Doc = { id: nanoid(10), name, content, createdAt: now() };
    const updated = { ...kb, docs: [...kb.docs, doc], updatedAt: now() };
    await db.kbs.put(updated);
    set((s) => ({ kbs: s.kbs.map((k) => (k.id === kbId ? updated : k)) }));
  },

  updateDoc: async (docId, patch) => {
    const kbId = get().activeKbId;
    if (!kbId) return;
    const kb = get().kbs.find((k) => k.id === kbId);
    if (!kb) return;
    const updated = {
      ...kb,
      docs: kb.docs.map((d) => (d.id === docId ? { ...d, ...patch } : d)),
      updatedAt: now(),
    };
    await db.kbs.put(updated);
    set((s) => ({ kbs: s.kbs.map((k) => (k.id === kbId ? updated : k)) }));
  },

  removeDoc: async (docId) => {
    const kbId = get().activeKbId;
    if (!kbId) return;
    const kb = get().kbs.find((k) => k.id === kbId);
    if (!kb) return;
    const updated = { ...kb, docs: kb.docs.filter((d) => d.id !== docId), updatedAt: now() };
    await db.kbs.put(updated);
    set((s) => ({ kbs: s.kbs.map((k) => (k.id === kbId ? updated : k)) }));
  },

  setView: (view) => set({ view }),
  selectNode: (activeNodeId) => set({ activeNodeId }),

  setNodeStatus: async (id, status) => {
    await db.nodes.update(id, { status, updatedAt: now() });
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, status } : n)) }));
  },

  renameNode: async (id, title) => {
    await db.nodes.update(id, { title, updatedAt: now() });
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, title } : n)) }));
  },

  generateMainline: async () => {
    const { activeKbId, kbs, settings } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    if (!kb) return;
    if (!kb.docs.length) {
      set({ error: '请先往知识库里添加内容，再生成主线' });
      return;
    }
    set({ busy: 'mainline', error: null });
    abort = new AbortController();
    try {
      const result = await ai.generateMainline(settings, kb, abort.signal);
      await db.nodes.where('kbId').equals(kb.id).delete();
      await db.crossLinks.where('kbId').equals(kb.id).delete();
      const nodes = result.nodes.map((n, i) => makeNode(kb.id, i, { ...n, kind: 'main' }));
      await db.nodes.bulkAdd(nodes);
      const laid = layoutGraph(nodes).nodes;
      await Promise.all(laid.map((n) => db.nodes.update(n.id, { x: n.x, y: n.y })));
      set({
        nodes: laid,
        crossLinks: [],
        activeNodeId: nodes[0]?.id ?? null,
        view: 'graph',
        busy: null,
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message, busy: null });
      else set({ busy: null });
    }
  },

  regenerateNode: async (nodeId) => {
    const { activeKbId, kbs, settings, nodes } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!kb || !node) return;
    set({ busy: `explain:${nodeId}`, error: null, streaming: { nodeId, content: '', kind: 'explain' } });
    abort = new AbortController();
    try {
      const text = await ai.chatStream(
        settings,
        [
          { role: 'system', content: '你是一位从零讲起的私人导师，中文回答，Markdown 排版。' },
          { role: 'user', content: `请从零完整讲解知识点：${node.title}。说明：${node.summary}。要求包含核心结论、前置概念、类比与例子、常见误区、一个自检问题，共 300~700 字。` },
        ],
        (delta) => set({ streaming: { nodeId, content: (get().streaming?.content ?? '') + delta, kind: 'explain' } }),
        abort.signal,
      );
      await db.nodes.update(nodeId, { content: text, updatedAt: now() });
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, content: text } : n)),
        streaming: null,
        busy: null,
      }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message });
      set({ streaming: null, busy: null });
    }
  },

  addBranch: async (parentId, question) => {
    const { activeKbId, kbs, settings, nodes } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    const parent = nodes.find((n) => n.id === parentId);
    if (!kb || !parent) return;
    set({ busy: `branch:${parentId}`, error: null });
    abort = new AbortController();
    try {
      const result = await ai.generateBranch(settings, parent, question, abort.signal);
      const branch = makeNode(kb.id, 0, {
        title: result.title,
        summary: result.summary,
        content: result.content,
        kind: 'branch',
        parentId,
      });
      await db.nodes.add(branch);

      // 关联分析
      let links: CrossLink[] = [];
      try {
        const mainline = nodes.filter((n) => n.kind === 'main').sort((a, b) => a.order - b.order);
        const suggestions = await ai.suggestCrossLinks(settings, branch, mainline, abort.signal);
        links = suggestions.map((s) => ({
          id: nanoid(10),
          kbId: kb.id,
          sourceId: branch.id,
          targetId: s.targetId,
          reason: s.reason,
          createdAt: now(),
        }));
        if (links.length) await db.crossLinks.bulkAdd(links);
      } catch {
        /* 关联失败不影响支线生成 */
      }

      const all = [...nodes, branch];
      const laid = layoutGraph(all).nodes;
      await Promise.all(
        laid
          .filter((n) => n.id === branch.id || all.some((m) => m.id === n.id && (m.x !== n.x || m.y !== n.y)))
          .map((n) => db.nodes.update(n.id, { x: n.x, y: n.y })),
      );
      set((s) => ({
        nodes: laid,
        crossLinks: [...s.crossLinks, ...links],
        activeNodeId: branch.id,
        view: 'chat',
        busy: null,
      }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message });
      set({ busy: null });
    }
  },

  deleteNode: async (id) => {
    const { nodes, activeKbId } = get();
    // 递归收集子树
    const toDelete = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
          toDelete.add(n.id);
          changed = true;
        }
      }
    }
    const ids = [...toDelete];
    await db.nodes.bulkDelete(ids);
    await db.messages.where('kbId').equals(activeKbId!).filter((m) => toDelete.has(m.nodeId)).delete();
    await db.crossLinks.filter((c) => toDelete.has(c.sourceId) || toDelete.has(c.targetId)).delete();
    const remaining = nodes.filter((n) => !toDelete.has(n.id));
    const laid = mergeLayout(remaining);
    await Promise.all(laid.map((n) => db.nodes.update(n.id, { x: n.x, y: n.y })));
    set({
      nodes: laid,
      crossLinks: get().crossLinks.filter((c) => !toDelete.has(c.sourceId) && !toDelete.has(c.targetId)),
      messages: get().messages.filter((m) => !toDelete.has(m.nodeId)),
      activeNodeId: toDelete.has(get().activeNodeId ?? '') ? remaining[0]?.id ?? null : get().activeNodeId,
    });
  },

  sendMessage: async (nodeId, text) => {
    const { activeKbId, kbs, settings, nodes, messages } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!kb || !node || !text.trim()) return;
    if (!settings.apiKey) {
      set({ error: '请先在「设置」中填写 AI 的 API Key' });
      return;
    }
    const userMsg: ChatMessage = {
      id: nanoid(10),
      kbId: kb.id,
      nodeId,
      role: 'user',
      content: text.trim(),
      createdAt: now(),
    };
    await db.messages.add(userMsg);
    set({ messages: [...messages, userMsg], streaming: { nodeId, content: '', kind: 'chat' }, error: null });

    const mainline = nodes.filter((n) => n.kind === 'main').sort((a, b) => a.order - b.order);
    const history = [...messages.filter((m) => m.nodeId === nodeId), userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const payload = ai.buildChatMessages(settings, kb, node, mainline, history);

    abort = new AbortController();
    try {
      const full = await ai.chatStream(
        settings,
        payload,
        (delta) => set({ streaming: { nodeId, content: (get().streaming?.content ?? '') + delta, kind: 'chat' } }),
        abort.signal,
      );
      const aiMsg: ChatMessage = {
        id: nanoid(10),
        kbId: kb.id,
        nodeId,
        role: 'assistant',
        content: full,
        createdAt: now(),
      };
      await db.messages.add(aiMsg);
      set((s) => ({ messages: [...s.messages, aiMsg], streaming: null }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message });
      set({ streaming: null });
    }
  },

  stop: () => {
    abort?.abort();
    abort = null;
    set({ streaming: null, busy: null });
  },

  moveNode: async (id, x, y) => {
    await db.nodes.update(id, { x, y, pinned: true });
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, x, y, pinned: true } : n)) }));
  },

  applyLayout: async () => {
    const laid = layoutGraph(get().nodes).nodes.map((n) => ({ ...n, pinned: false }));
    await Promise.all(laid.map((n) => db.nodes.update(n.id, { x: n.x, y: n.y, pinned: false })));
    set({ nodes: laid });
  },

  exportKb: () => {
    const { activeKbId, kbs, nodes, crossLinks, messages } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    if (!kb) return;
    const data = {
      version: 1,
      kb,
      nodes: nodes.map(({ kbId: _k, ...n }) => n),
      crossLinks: crossLinks.map(({ kbId: _k, ...c }) => c),
      messages,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kb.name}.knowpath.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importKb: async (json) => {
    try {
      const data = JSON.parse(json);
      const kb: KnowledgeBase = { ...data.kb, id: nanoid(10), updatedAt: now() };
      const nodes: ThreadNode[] = (data.nodes ?? []).map((n: ThreadNode) => ({ ...n, kbId: kb.id }));
      const crossLinks: CrossLink[] = (data.crossLinks ?? []).map((c: CrossLink) => ({ ...c, kbId: kb.id }));
      const messages: ChatMessage[] = (data.messages ?? []).map((m: ChatMessage) => ({ ...m, kbId: kb.id }));
      await db.transaction('rw', db.kbs, db.nodes, db.crossLinks, db.messages, async () => {
        await db.kbs.add(kb);
        if (nodes.length) await db.nodes.bulkAdd(nodes);
        if (crossLinks.length) await db.crossLinks.bulkAdd(crossLinks);
        if (messages.length) await db.messages.bulkAdd(messages);
      });
      set((s) => ({ kbs: [kb, ...s.kbs] }));
      await get().setActiveKb(kb.id);
    } catch (e) {
      set({ error: `导入失败：${(e as Error).message}` });
    }
  },
}));

export const selectMainline = (nodes: ThreadNode[]) =>
  nodes.filter((n) => n.kind === 'main').sort((a, b) => a.order - b.order);
