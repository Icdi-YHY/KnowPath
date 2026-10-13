import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  db,
  getActiveKbId,
  getSettings,
  saveSettings as dbSaveSettings,
  setActiveKbId as dbSetActiveKbId,
  getTreeMigratedKbs,
  setTreeMigratedKbs,
} from '@/db/db';
import {
  DEFAULT_SETTINGS,
  type ChatMessage,
  type CrossLink,
  type Doc,
  type KnowledgeBase,
  type PendingMerge,
  type Settings,
  type ThreadNode,
} from '@/types';
import { layoutGraph, orderedMainline } from '@/services/layout';
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
  /** 非致命提醒（如输出被截断、已自动重试），用黄色提示条展示 */
  notice: string | null;
  /** 增量导入后待用户确认的合并建议 */
  pendingMerge: PendingMerge | null;

  init: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  setError: (e: string | null) => void;
  setNotice: (n: string | null) => void;

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

  generateMainline: () => Promise<boolean>;
  regenerateNode: (nodeId: string) => Promise<void>;
  addBranch: (parentId: string, question: string) => Promise<void>;
  /** 把一次对话回答直接存成支线（本地生成，不调用 AI） */
  promoteToBranch: (parentId: string, title: string, content: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;

  analyzeNewDocs: (docNames: string[]) => Promise<void>;
  applyMerge: () => Promise<void>;
  discardMerge: () => Promise<void>;

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

/**
 * 把 AI 返回的树形主线草稿展平成带 parentId / order 的节点数组。
 * order 是「同级中的顺序」，不再是全局线性序号。
 */
function flattenMainline(
  kbId: string,
  drafts: ai.MainlineDraftNode[],
  parentId: string | null = null,
): ThreadNode[] {
  const out: ThreadNode[] = [];
  drafts.forEach((draft, index) => {
    const node = makeNode(kbId, index, {
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      kind: 'main',
      parentId,
    });
    out.push(node);
    out.push(...flattenMainline(kbId, draft.children, node.id));
  });
  return out;
}

/**
 * 旧数据迁移：v0.1 的主线是「一条线性链」—— 所有主线节点的 parentId 都是 null，
 * 靠全局 order 排序。新版是树形结构，若不迁移，这些节点会变成互不相连的散点。
 *
 * 判定条件：主线节点 ≥2 个，且**全部**都是根节点（没有任何层级）。
 * 迁移方式：按 order 把它们依次串成一条链（第 1 个为根，其余挂在前面一个下面）。
 */
function migrateLinearMainline(nodes: ThreadNode[]): ThreadNode[] | null {
  const mains = nodes.filter((n) => n.kind === 'main');
  if (mains.length < 2) return null;
  if (mains.some((n) => n.parentId)) return null; // 已经有层级，无需迁移

  const ordered = mains.slice().sort((a, b) => a.order - b.order);
  const parentOf = new Map<string, string>();
  for (let i = 1; i < ordered.length; i++) parentOf.set(ordered[i].id, ordered[i - 1].id);

  return nodes.map((n) => {
    const parentId = parentOf.get(n.id);
    if (parentId === undefined) return n;
    return { ...n, parentId, order: 0, pinned: false };
  });
}

/** 某个父节点下已有的主线子节点数量，用作新增节点的同级序号 */
function siblingOrder(all: ThreadNode[], parentId: string | null): number {
  return all.filter((n) => n.kind === 'main' && (n.parentId ?? null) === parentId).length;
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

/**
 * 重新生成主线时保住用户已有的劳动成果。
 *
 * 只替换主线节点，支线与资料节点**原样保留**（id 不变）：
 *  - 归属是旧主线节点 → 按「标题相同」重挂到新主线；
 *    新主线里找不到同名知识点时，挂到新主线的第一个节点，绝不静默丢弃
 *  - 归属是别的保留节点（嵌套支线）→ 直接沿用
 * 跨线关联同样按这个规则改指到新节点，两端都还在才保留。
 */
function reattachUserNodes(
  newMain: ThreadNode[],
  oldNodes: ThreadNode[],
): {
  kept: ThreadNode[];
  remapForLink: (id: string) => string | null;
  /** 原归属知识点在新主线里已不存在、只能挂到开头的支线数 */
  orphaned: number;
} {
  const oldById = new Map(oldNodes.map((n) => [n.id, n]));
  const byTitle = new Map<string, ThreadNode>();
  for (const n of newMain) {
    const k = ai.normTitle(n.title);
    if (k && !byTitle.has(k)) byTitle.set(k, n);
  }
  const fallback = newMain[0]?.id ?? null;

  /**
   * 关联线端点：支线/资料保留原 id；主线节点在新主线里找不到同名就返回 null
   * —— 关联的那个知识点已经不存在了，这条线也就失去意义，应当丢弃而不是乱指一个
   */
  const remapForLink = (id: string): string | null => {
    const old = oldById.get(id);
    if (!old) return null;
    if (old.kind !== 'main') return id;
    return byTitle.get(ai.normTitle(old.title))?.id ?? null;
  };

  let orphaned = 0;
  const kept = oldNodes
    .filter((n) => n.kind !== 'main')
    .map((n) => {
      // 主线换了，位置需要重新排，所以清掉 pinned
      if (!n.parentId) return { ...n, parentId: fallback, pinned: false };
      const oldParent = oldById.get(n.parentId);
      if (oldParent?.kind === 'main' && !byTitle.has(ai.normTitle(oldParent.title))) orphaned += 1;
      // 支线本身绝不能丢，找不到原归属就挂到新主线开头
      return { ...n, parentId: remapForLink(n.parentId) ?? fallback, pinned: false };
    });

  return { kept, remapForLink, orphaned };
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
  notice: null,
  pendingMerge: null,

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

  setNotice: (notice) => set({ notice }),

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
    await db.transaction('rw', db.kbs, db.nodes, db.crossLinks, db.messages, db.pendingMerges, async () => {
      await db.kbs.delete(id);
      await db.nodes.where('kbId').equals(id).delete();
      await db.crossLinks.where('kbId').equals(id).delete();
      await db.messages.where('kbId').equals(id).delete();
      await db.pendingMerges.where('kbId').equals(id).delete();
    });
    const kbs = get().kbs.filter((k) => k.id !== id);
    set({ kbs });
    if (get().activeKbId === id) {
      const next = kbs[0]?.id ?? null;
      if (next) await get().setActiveKb(next);
      else
        set({
          activeKbId: null,
          nodes: [],
          crossLinks: [],
          messages: [],
          pendingMerge: null,
          activeNodeId: null,
          view: 'kb',
        });
    }
  },

  renameKb: async (id, name) => {
    await db.kbs.update(id, { name, updatedAt: now() });
    set((s) => ({
      kbs: s.kbs.map((k) => (k.id === id ? { ...k, name } : k)),
    }));
  },

  setActiveKb: async (id, silent = false) => {
    const [loaded, crossLinks, messages, pending] = await Promise.all([
      db.nodes.where('kbId').equals(id).toArray(),
      db.crossLinks.where('kbId').equals(id).toArray(),
      db.messages.where('kbId').equals(id).toArray(),
      db.pendingMerges.where('kbId').equals(id).first(),
    ]);

    // 每个知识库只做一次「线性主线 → 树形脉络」迁移
    let nodes = loaded;
    const migrated = await getTreeMigratedKbs();
    if (!migrated.includes(id)) {
      const next = migrateLinearMainline(nodes);
      if (next) {
        await db.nodes.bulkPut(next);
        nodes = next;
        console.info('[knowpath] 已把旧版线性主线迁移为树形脉络');
      }
      await setTreeMigratedKbs([...migrated, id]);
    }

    const laid = mergeLayout(nodes);
    set({
      activeKbId: id,
      nodes: laid,
      crossLinks,
      messages,
      pendingMerge: pending ?? null,
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
    // 示例数据也按树形生成：默认串成一条链（与旧版观感一致）
    const nodes: ThreadNode[] = [];
    items.forEach(([title, summary], i) => {
      const n = makeNode(kbId, 0, {
        title,
        summary,
        kind: 'main',
        parentId: nodes[i - 1]?.id ?? null,
      });
      n.content = `## ${title}\n\n这是「${summary}」的示例讲解占位内容。\n\n配置 AI 后点击节点右上角的 **重新生成** 即可让 AI 从零讲透这个知识点。\n\n- 要点一：先建立直觉类比\n- 要点二：再看精确定义\n- 要点三：最后动手验证\n\n> 自检：你能否用自己的话把它讲给一个完全不懂的人听？`;
      nodes.push(n);
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

  /* ------------------------- 增量导入与合并 ------------------------- */

  /**
   * 往「已有主线」的知识库导入新文件后调用：
   * 只做关联分析，**不改动主线**，结果放进 pendingMerge 等用户确认。
   */
  analyzeNewDocs: async (docNames) => {
    const { activeKbId, kbs, settings, nodes } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    if (!kb || !docNames.length) return;

    const mainline = orderedMainline(nodes);
    // 还没有主线就谈不上「增量」，直接返回（用户会走「生成主线」）
    if (!mainline.length) return;

    const text = docNames
      .map((name) => kb.docs.find((d) => d.name === name))
      .filter((d): d is Doc => Boolean(d))
      .map((d) => `## 文档：${d.name}\n${d.content}`)
      .join('\n\n');

    set({ busy: 'merge', error: null, notice: null });
    abort = new AbortController();
    try {
      const analysis = await ai.analyzeMerge(settings, docNames, text, mainline, abort.signal);
      const pending: PendingMerge = {
        id: nanoid(10),
        kbId: kb.id,
        docNames,
        source: analysis.source,
        links: analysis.links.map((l) => ({
          nodeId: l.nodeId,
          title: nodes.find((n) => n.id === l.nodeId)?.title ?? '',
          reason: l.reason,
        })),
        newNodes: analysis.newNodes.map((n) => ({
          ...n,
          parentTitle: n.parentId ? nodes.find((x) => x.id === n.parentId)?.title ?? null : null,
        })),
        createdAt: now(),
      };
      await db.pendingMerges.where('kbId').equals(kb.id).delete();
      await db.pendingMerges.add(pending);
      set({ pendingMerge: pending, busy: null, view: 'graph' });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message, busy: null });
      else set({ busy: null });
    }
  },

  /** 确认合并：建立资料节点与关联线，并把建议的新知识点插入主线 */
  applyMerge: async () => {
    const { pendingMerge, activeKbId, nodes, crossLinks } = get();
    if (!pendingMerge || !activeKbId) return;
    const kbId = activeKbId;
    set({ busy: 'merge-apply', error: null });
    try {
      const created: ThreadNode[] = [];

      // 1) 资料节点（独立根节点，虚线连到它支撑的知识点）
      const source = makeNode(kbId, 0, {
        title: pendingMerge.source.title,
        summary: pendingMerge.source.summary,
        content: `> 代表导入的材料：${pendingMerge.docNames.join('、')}\n\n${pendingMerge.source.summary}`,
        kind: 'source',
        parentId: null,
      });
      created.push(source);

      // 2) 建议新增的知识点，挂到各自指定的父节点下
      for (const n of pendingMerge.newNodes) {
        created.push(
          makeNode(kbId, siblingOrder([...nodes, ...created], n.parentId), {
            title: n.title,
            summary: n.summary,
            content: n.content,
            kind: 'main',
            parentId: n.parentId,
          }),
        );
      }

      // 3) 关联线：资料节点 → 相关知识点
      const links: CrossLink[] = pendingMerge.links
        .filter((l) => nodes.some((n) => n.id === l.nodeId))
        .map((l) => ({
          id: nanoid(10),
          kbId,
          sourceId: source.id,
          targetId: l.nodeId,
          reason: l.reason,
          createdAt: now(),
        }));

      await db.nodes.bulkAdd(created);
      if (links.length) await db.crossLinks.bulkAdd(links);

      const laid = mergeLayout([...nodes, ...created]);
      await Promise.all(laid.map((n) => db.nodes.update(n.id, { x: n.x, y: n.y })));
      await db.pendingMerges.delete(pendingMerge.id);

      const parts = [
        pendingMerge.newNodes.length ? `新增 ${pendingMerge.newNodes.length} 个知识点` : '',
        links.length ? `${links.length} 条关联` : '',
      ].filter(Boolean);

      set({
        nodes: laid,
        crossLinks: [...crossLinks, ...links],
        pendingMerge: null,
        busy: null,
        activeNodeId: source.id,
        notice: parts.length ? `已合并：${parts.join('、')}` : '已合并（本次没有需要新增的内容）',
      });
    } catch (e) {
      set({ error: (e as Error).message, busy: null });
    }
  },

  /** 忽略本次合并建议（材料仍留在知识库里，继续作为 AI 的上下文） */
  discardMerge: async () => {
    const pending = get().pendingMerge;
    if (!pending) return;
    await db.pendingMerges.delete(pending.id);
    set({ pendingMerge: null, notice: '已忽略本次合并建议，材料仍保留在知识库中' });
  },

  generateMainline: async () => {
    const { activeKbId, kbs, settings, nodes: oldNodes, crossLinks: oldLinks } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    if (!kb) return false;
    if (!kb.docs.length) {
      set({ error: '请先往知识库里添加内容，再生成主线' });
      return false;
    }
    set({ busy: 'mainline', error: null, notice: null });
    abort = new AbortController();
    try {
      const result = await ai.generateMainline(settings, kb, abort.signal);

      const generated = flattenMainline(kb.id, result.nodes);
      // 主线整体替换，但支线 / 资料节点 / 跨线关联必须保住（否则重新生成等于清空劳动成果）
      const { kept, remapForLink, orphaned } = reattachUserNodes(generated, oldNodes);
      const all = [...generated, ...kept];

      const ids = new Set(all.map((n) => n.id));
      const parentOf = new Map(all.map((n) => [n.id, n.parentId]));
      let dropped = 0;
      const links = oldLinks
        .map((l) => {
          const sourceId = remapForLink(l.sourceId);
          const targetId = remapForLink(l.targetId);
          if (!sourceId || !targetId || !ids.has(sourceId) || !ids.has(targetId)) {
            dropped += 1;
            return null;
          }
          if (sourceId === targetId) return null;
          // 与结构线（父 → 子）完全重复的虚线纯属冗余，去掉
          if (parentOf.get(sourceId) === targetId || parentOf.get(targetId) === sourceId) {
            dropped += 1;
            return null;
          }
          return { ...l, sourceId, targetId };
        })
        .filter((l): l is CrossLink => l !== null);

      await db.nodes.where('kbId').equals(kb.id).delete();
      await db.crossLinks.where('kbId').equals(kb.id).delete();
      await db.nodes.bulkAdd(all);
      if (links.length) await db.crossLinks.bulkAdd(links);

      const laid = mergeLayout(all);
      await Promise.all(laid.map((n) => db.nodes.update(n.id, { x: n.x, y: n.y, pinned: false })));

      const notes = [
        // 只生成了很少的知识点 / 输出曾被截断 → 明确告诉用户，而不是静默接受
        result.warning,
        kept.length ? `已保留 ${kept.length} 个支线/资料节点、${links.length} 条关联线` : null,
        dropped ? `${dropped} 条关联线因目标知识点已不存在而被移除` : null,
        orphaned ? `其中 ${orphaned} 条支线的原知识点在新主线里已不存在，已改挂在开头` : null,
      ].filter(Boolean) as string[];

      set({
        nodes: laid,
        crossLinks: links,
        activeNodeId: generated[0]?.id ?? null,
        view: 'graph',
        busy: null,
        notice: notes.length ? notes.join('；') : null,
      });
      return true;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message, busy: null });
      else set({ busy: null });
      return false;
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
      // 必须是前序顺序，否则 AI 看到的「第 N 个知识点」和界面对不上
      const mainline = orderedMainline(nodes);
      const { content: text, truncated } = await ai.chatStream(
        settings,
        ai.explainMessages(settings, kb, node, mainline),
        (delta) => set({ streaming: { nodeId, content: (get().streaming?.content ?? '') + delta, kind: 'explain' } }),
        abort.signal,
      );
      await db.nodes.update(nodeId, { content: text, updatedAt: now() });
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, content: text } : n)),
        streaming: null,
        busy: null,
        notice: truncated ? '讲解被输出长度上限截断，可在「设置」里调大最大 token 后重新讲解' : null,
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
    // 以前这里静默 return：父节点找不到时什么都不会发生，用户只看到"没反应"
    if (!kb || !parent) {
      set({ error: '找不到要展开的知识点，请重新选择一个节点后再试' });
      return;
    }
    if (!question.trim()) {
      set({ error: '请先描述你卡住的地方' });
      return;
    }
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
      let linkMsg: string | null = null;
      try {
        // 必须用前序遍历（orderedMainline）而不是按 order 排序：
        // 树形结构下 order 只是「同级序号」，按它排会得到 [0,0,0,1,2…] 这种乱序，
        // AI 看到的「第 N 个知识点」和界面上显示的完全对不上，关联会指错节点
        const mainline = orderedMainline(nodes);
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
        else linkMsg = '这条支线暂未发现与其它主线知识点的关联，因此没有虚线';
      } catch (e) {
        // 以前这里静默吞掉异常：AI 返回解析失败 / 网络错误时什么都不画，
        // 用户只看到「没有虚线」，完全查不出原因
        if ((e as Error).name === 'AbortError') throw e;
        console.error('[knowpath] 跨线关联分析失败：', e);
        linkMsg = `支线已生成，但跨线关联分析失败：${(e as Error).message}`;
      }

      const all = [...nodes, branch];
      // 用 mergeLayout 才能保住用户手动拖动过（pinned）的节点位置
      const prev = new Map(all.map((n) => [n.id, n]));
      const laid = mergeLayout(all);
      await Promise.all(
        laid
          .map((n) => {
            const p = prev.get(n.id);
            return !p || p.x !== n.x || p.y !== n.y ? n : null;
          })
          .filter((n): n is ThreadNode => n !== null)
          .map((n) => db.nodes.update(n.id, { x: n.x, y: n.y })),
      );
      set((s) => ({
        nodes: laid,
        crossLinks: [...s.crossLinks, ...links],
        activeNodeId: branch.id,
        // 保持当前视图：在图谱里开支线就留在图谱（能立刻看见新节点长出来），
        // 在对话里开支线就留在对话（直接读新支线的讲解）。
        // 之前强制跳到对话，用户在图谱里开的支线会"瞬间消失"，看起来像没生成。
        view: s.view,
        busy: null,
        notice: linkMsg,
      }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message });
      set({ busy: null });
    }
  },

  /**
   * 把一次对话回答直接存成支线。
   *
   * 这条路径**不调用 AI**：直接用「提问」当标题、回答当正文，点一下就出现在图谱里。
   * 之所以需要它：原来开支线必须先点那个没有文字的 ✨ 小图标（而且用完就自动复位），
   * 用户在支线里追问时拿到的只是普通对话回答，于是以为"支线不能再生支线"。
   */
  promoteToBranch: async (parentId, title, content) => {
    const { activeKbId, kbs, nodes } = get();
    const kb = kbs.find((k) => k.id === activeKbId);
    const parent = nodes.find((n) => n.id === parentId);
    if (!kb || !parent) {
      set({ error: '找不到所属知识点，请重新选择一个节点后再试' });
      return;
    }
    set({ error: null });
    const clean = content.replace(/\s+/g, ' ').trim();
    const branch = makeNode(kb.id, 0, {
      title: title.trim().slice(0, 24) || '未命名支线',
      summary: clean.replace(/^#+\s*/, '').slice(0, 44),
      content: content.trim(),
      kind: 'branch',
      parentId,
    });
    await db.nodes.add(branch);

    const all = [...nodes, branch];
    const laid = mergeLayout(all);
    await Promise.all(laid.map((n) => db.nodes.update(n.id, { x: n.x, y: n.y, pinned: false })));

    set({
      nodes: laid,
      activeNodeId: branch.id,
      notice: `已存为支线，挂在「${parent.title}」下面（支线下面可以继续开支线）`,
    });

    // 关联分析失败不影响支线本身，只提示一下
    try {
      const settings = get().settings;
      const suggestions = await ai.suggestCrossLinks(settings, branch, orderedMainline(all));
      const links: CrossLink[] = suggestions.map((s) => ({
        id: nanoid(10),
        kbId: kb.id,
        sourceId: branch.id,
        targetId: s.targetId,
        reason: s.reason,
        createdAt: now(),
      }));
      if (links.length) {
        await db.crossLinks.bulkAdd(links);
        set((s) => ({ crossLinks: [...s.crossLinks, ...links] }));
      }
    } catch (e) {
      console.error('[knowpath] 存为支线后的关联分析失败：', e);
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
      const { content: full, truncated } = await ai.chatStream(
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
      set((s) => ({
        messages: [...s.messages, aiMsg],
        streaming: null,
        notice: truncated ? '回答被输出长度上限截断（可在「设置」里调大最大 token，或回复「继续」让我接着写）' : null,
      }));
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
