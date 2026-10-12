import { nanoid } from 'nanoid';
import type {
  CrossLink,
  KnowledgeBase,
  Settings,
  ThreadNode,
} from '@/types';
import {
  branchSystem,
  branchUser,
  chatSystem,
  crossLinkSystem,
  crossLinkUser,
  explainSystem,
  explainUser,
  mainlineSystem,
  mainlineUser,
  mergeSystem,
  mergeUser,
} from './prompts';

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIError';
  }
}

/** OpenAI 兼容的多模态内容片段 */
export type VisionPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string | VisionPart[];
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

/* ------------------------------------------------------------------ */
/* JSON 解析（含容错与截断修复）                                        */
/* ------------------------------------------------------------------ */

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** 去掉思考块、控制符等噪音 */
function stripNoise(text: string): string {
  let s = text.trim();
  // 配对的思考标签
  s = s.replace(/<(think|thinking|reasoning|analysis|scratchpad)>[\s\S]*?<\/\1>/gi, '');
  // 只有闭合标签的情况（推理过程直接混在正文里）
  s = s.replace(/^[\s\S]*?<\/(think|thinking|reasoning)>/i, '');
  // 特殊控制符（兼容半角与全角竖线，如 DeepSeek 的 <｜end▁of▁thinking｜>）
  s = s.replace(/<[|\uFF5C][^|\uFF5C]*[|\uFF5C]>/g, '');
  // 去掉 BOM / 零宽字符
  s = s.replace(/[\uFEFF\u200B]/g, '');
  return s.trim();
}

/** 从 start 处按括号配平截取一段完整 JSON */
function takeBalanced(s: string, start: number): string | null {
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** 把一段被截断的 JSON 补全成合法 JSON */
function closeBrackets(text: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  let s = text;
  if (inStr) s += '"';
  s = s.replace(/[,\s]+$/, '');
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i] === '{' ? '}' : ']';
  return s;
}

/**
 * 修复被 max_tokens 截断的 JSON：
 * 先尝试直接在末尾补全，不行就逐步回退到最后一个分隔符再补全。
 */
function repairTruncated<T>(text: string): T | null {
  let s = text;
  for (let attempt = 0; attempt < 300; attempt++) {
    const parsed = tryParse<T>(closeBrackets(s));
    if (parsed !== null) return parsed;
    const idx = Math.max(s.lastIndexOf(','), s.lastIndexOf('{'), s.lastIndexOf('['));
    if (idx <= 0) break;
    const next = s.slice(0, idx);
    if (next === s) break;
    s = next;
  }
  return null;
}

/** 从可能带有代码围栏 / 思考块 / 前后缀的文字中提取 JSON */
export function extractJson<T>(text: string): T {
  const cleaned = stripNoise(text);
  const fenced = [...cleaned.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim());

  // 候选顺序即优先级：代码围栏内容 > 括号配平片段 > 从首个括号到结尾 > 原文
  const candidates: string[] = [];
  for (const src of [...fenced, cleaned]) {
    const start = src.search(/[[{]/);
    if (start >= 0) {
      const balanced = takeBalanced(src, start);
      if (balanced) candidates.push(balanced);
      candidates.push(src.slice(start));
    }
    candidates.push(src);
  }

  const seen = new Set<string>();
  const ordered = candidates
    .map((s) => s.trim())
    .filter((s) => {
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    });

  // 第一轮：只要有一处能直接解析就用它（避免被"修复"出的空壳结果抢先）
  for (const s of ordered) {
    const direct = tryParse<T>(s);
    if (direct !== null) return direct;
  }

  // 第二轮：再尝试修复被截断的内容
  for (const s of ordered) {
    const repaired = repairTruncated<T>(s);
    if (repaired !== null) return repaired;
  }

  console.error('[knowpath] 无法解析为 JSON 的 AI 原始返回：\n', text);
  const preview = text.replace(/\s+/g, ' ').slice(0, 160);
  throw new AIError(
    `AI 返回的内容无法解析为 JSON。通常是被输出长度上限截断了，可在「设置」里调大最大 token；` +
      `原始返回开头：${preview}`,
  );
}

/* ------------------------------------------------------------------ */
/* 请求                                                                */
/* ------------------------------------------------------------------ */

interface Combo {
  json: boolean;
  maxTokens: boolean;
}

async function post(
  settings: Settings,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(endpoint(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AIError(
      `网络请求失败：${(e as Error).message}。请检查网络，或确认该接口地址是否可直连。`,
    );
  }
}

/** 参数不被支持时的 400 提示关键词 */
const UNSUPPORTED = /response_format|json_object|max_tokens|max_completion_tokens|unsupported|not supported|invalid.*parameter|unknown.*parameter/i;

async function request(
  settings: Settings,
  messages: ChatMsg[],
  stream: boolean,
  json: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  if (!settings.apiKey) throw new AIError('尚未配置 API Key，请先在设置中填写');
  if (!settings.baseUrl) throw new AIError('尚未配置 API 地址');

  const combos: Combo[] = json
    ? [
        { json: true, maxTokens: true },
        { json: false, maxTokens: true },
        { json: true, maxTokens: false },
        { json: false, maxTokens: false },
      ]
    : [
        { json: false, maxTokens: true },
        { json: false, maxTokens: false },
      ];

  let lastDetail = '';
  for (const combo of combos) {
    const body: Record<string, unknown> = {
      model: settings.model,
      messages,
      temperature: settings.temperature,
      stream,
    };
    if (combo.maxTokens && settings.maxTokens > 0) body.max_tokens = settings.maxTokens;
    if (combo.json) body.response_format = { type: 'json_object' };

    const res = await post(settings, body, signal);
    if (res.ok) return res;

    lastDetail = await res.text().catch(() => '');

    // 只在「参数不被支持」时才降级重试，其它 4xx 直接报错
    if (res.status === 400 && UNSUPPORTED.test(lastDetail)) continue;
    throw new AIError(formatHttpError(res.status, lastDetail));
  }
  throw new AIError(formatHttpError(400, lastDetail));
}

function formatHttpError(status: number, detail: string): string {
  const d = detail.slice(0, 400);
  if (status === 401 || status === 403) return `鉴权失败（${status}），请检查 API Key 是否正确：${d}`;
  if (status === 404) return `接口地址不存在（404），请检查 Base URL 是否填写正确：${d}`;
  if (status === 429) return `请求过于频繁或额度不足（429）：${d}`;
  return `AI 接口返回 ${status}：${d}`;
}

/** 流式对话，逐段回调增量文本；返回值带截断标记 */
export async function chatStream(
  settings: Settings,
  messages: ChatMsg[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<Completion> {
  const res = await request(settings, messages, true, false, signal);
  const reader = res.body?.getReader();
  if (!reader) throw new AIError('响应没有数据流');
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let finishReason: string | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta: string = choice?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        /* 忽略不完整片段 */
      }
    }
  }
  return { content: full, truncated: finishReason === 'length' };
}

export interface Completion {
  content: string;
  /** 服务端明确告知「因长度上限被截断」（finish_reason === 'length'） */
  truncated: boolean;
}

/** 非流式补全，额外返回截断标记 —— 判断内容是否完整的最可靠依据 */
export async function completeDetailed(
  settings: Settings,
  messages: ChatMsg[],
  signal?: AbortSignal,
  json = false,
): Promise<Completion> {
  const res = await request(settings, messages, false, json, signal);
  const data = await res.json();
  const choice = data.choices?.[0];
  const content: string = choice?.message?.content ?? '';
  const truncated = choice?.finish_reason === 'length';
  if (!content) {
    throw new AIError(
      truncated
        ? 'AI 输出被长度上限截断且没有返回内容，请在「设置」里调大最大 token。'
        : 'AI 没有返回内容',
    );
  }
  return { content, truncated };
}

/** 非流式一次性补全 */
export async function complete(
  settings: Settings,
  messages: ChatMsg[],
  signal?: AbortSignal,
  json = false,
): Promise<string> {
  return (await completeDetailed(settings, messages, signal, json)).content;
}

/* ------------------------------------------------------------------ */
/* 业务能力                                                            */
/* ------------------------------------------------------------------ */

/**
 * 请求 JSON 结果，做两层保护：
 *  1) 解析失败、被截断、或结果明显退化（由 validate 判定）→ 自动重试一次
 *  2) 重试后仍不理想 → 返回可用的部分结果，并附带 warning 让用户知情
 *
 * 注意：不能只看「是否解析成功」。被截断的 JSON 常能被补全成合法 JSON，
 * 但内容只剩一小截 —— 所以必须额外用 finish_reason 与 validate 兜住。
 */
async function completeJson<T>(
  settings: Settings,
  system: string,
  user: string,
  retryNote: string,
  signal?: AbortSignal,
  validate?: (value: T) => string | null,
): Promise<{ value: T; warning?: string }> {
  const attempt = async (extra?: string) => {
    const { content, truncated } = await completeDetailed(
      settings,
      [
        { role: 'system', content: system },
        { role: 'user', content: extra ? `${user}\n\n${extra}` : user },
      ],
      signal,
      true,
    );
    let value: T | null = null;
    let parseError = '';
    try {
      value = extractJson<T>(content);
    } catch (e) {
      parseError = (e as Error).message;
    }
    const issue = value === null ? parseError || '解析失败' : validate?.(value) ?? null;
    return { value, truncated, issue };
  };

  const first = await attempt();
  if (first.value !== null && !first.issue) {
    return {
      value: first.value,
      warning: first.truncated ? '输出被长度上限截断，内容可能不完整' : undefined,
    };
  }

  const reason = first.truncated ? '输出被长度上限截断' : first.issue || '解析失败';
  console.warn(`[knowpath] ${reason}，正在自动重试一次…`);

  const second = await attempt(`【重要】上一次失败原因：${reason}。${retryNote}`);
  if (second.value !== null) {
    return {
      value: second.value,
      warning: second.issue ? `重试后仍可能不完整（${reason}）` : `已自动重试：${reason}`,
    };
  }

  throw new AIError(`AI 连续两次返回的内容都无法使用（${reason}），请重试或换用更强的模型。`);
}

/** 主线至少要有这么多个知识点，否则视为「被截断/退化」 */
const MIN_MAINLINE_NODES = 4;

/** 还没有分配 id 的主线节点草稿（树形） */
export interface MainlineDraftNode {
  title: string;
  summary: string;
  content: string;
  children: MainlineDraftNode[];
}

export interface MainlineResult {
  title: string;
  /** 非致命的问题提示（例如输出被截断、自动重试过） */
  warning?: string;
  nodes: MainlineDraftNode[];
}

interface RawNode {
  title?: string;
  summary?: string;
  content?: string;
  children?: RawNode[];
}

/** 递归统计知识点总数 */
function countNodes(list: RawNode[]): number {
  return list.reduce((sum, n) => sum + 1 + countNodes(Array.isArray(n?.children) ? n.children : []), 0);
}

/** 清理并递归标准化树结构 */
function normalizeTree(list: RawNode[]): MainlineDraftNode[] {
  const out: MainlineDraftNode[] = [];
  for (const n of list) {
    if (!n || typeof n.title !== 'string' || !n.title.trim()) continue;
    out.push({
      title: n.title.trim(),
      summary: (n.summary ?? '').trim(),
      content: (n.content ?? '').trim(),
      children: normalizeTree(Array.isArray(n.children) ? n.children : []),
    });
  }
  return out;
}

/** 生成主线脉络（树形：单子节点成线，多子节点分叉） */
export async function generateMainline(
  settings: Settings,
  kb: KnowledgeBase,
  signal?: AbortSignal,
): Promise<MainlineResult> {
  const { value: parsed, warning } = await completeJson<
    { title?: string; nodes?: RawNode[] } | RawNode[]
  >(
    settings,
    mainlineSystem(),
    mainlineUser(kb, settings.contextChars),
    '请更精简并确保 JSON 完整闭合：知识点总数 8~14 个，每个 content 不超过 200 字。' +
      '如果担心写不下，可以**直接省略 content 字段**，只保留 title 和 summary —— 之后我会逐个补充讲解。',
    signal,
    (v) => {
      const list = Array.isArray(v) ? v : v.nodes ?? [];
      const total = countNodes(list);
      return total >= MIN_MAINLINE_NODES
        ? null
        : `只生成了 ${total} 个知识点，远少于要求的 8~14 个`;
    },
  );

  const rawNodes = Array.isArray(parsed) ? parsed : parsed.nodes ?? [];
  const nodes = normalizeTree(rawNodes);
  const total = countNodes(rawNodes);

  if (!nodes.length) {
    console.error('[knowpath] 主线 JSON 结构不符合预期：\n', JSON.stringify(parsed).slice(0, 500));
    throw new AIError('AI 返回的 JSON 里没有找到有效的知识点列表，可重试一次或换用更强的模型。');
  }

  return {
    title: (!Array.isArray(parsed) && parsed.title) || `${kb.name} · 学习主线`,
    warning:
      warning ??
      (total < MIN_MAINLINE_NODES
        ? `只生成了 ${total} 个知识点，建议点「重新生成主线」再试一次`
        : undefined),
    nodes,
  };
}

/**
 * 生成某个知识点的讲解消息（带完整知识库上下文）。
 * 之前「重新讲解」只把标题丢给模型、完全没用上传的材料，这里统一修正。
 */
export function explainMessages(
  settings: Settings,
  kb: KnowledgeBase,
  node: ThreadNode,
  mainline: ThreadNode[] = [],
): ChatMsg[] {
  const path = mainline.length
    ? `\n\n该知识点在这条主线中的位置：\n${mainline
        .map((n, i) => `${i + 1}. ${n.title}${n.id === node.id ? '  ← 当前' : ''}`)
        .join('\n')}`
    : '';
  return [
    { role: 'system', content: explainSystem() },
    { role: 'user', content: explainUser(kb, node, settings.contextChars) + path },
  ];
}

/** 根据疑问生成一条支线 */
export async function generateBranch(
  settings: Settings,
  node: ThreadNode,
  question: string,
  signal?: AbortSignal,
): Promise<{ title: string; summary: string; content: string }> {
  const { value: json } = await completeJson<{ title?: string; summary?: string; content?: string }>(
    settings,
    branchSystem(),
    branchUser(node, question),
    '请只输出一个 JSON 对象，字段为 title / summary / content，content 200~400 字。',
    signal,
    // content 太短通常意味着输出被截断了
    (v) => ((v.content ?? '').trim().length >= 60 ? null : '讲解内容过短，可能是输出被截断'),
  );
  return {
    title: json.title?.trim() || question.slice(0, 16),
    summary: json.summary?.trim() || '',
    content: json.content?.trim() || '',
  };
}

export function buildChatMessages(
  settings: Settings,
  kb: KnowledgeBase,
  node: ThreadNode,
  mainline: ThreadNode[],
  history: { role: 'user' | 'assistant'; content: string }[],
): ChatMsg[] {
  return [
    { role: 'system', content: chatSystem(kb, node, mainline, settings.contextChars) },
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
  ];
}

/** 分析支线同主线的跨线关联 */
export async function suggestCrossLinks(
  settings: Settings,
  node: ThreadNode,
  mainline: ThreadNode[],
  signal?: AbortSignal,
): Promise<Omit<CrossLink, 'id' | 'kbId' | 'createdAt' | 'sourceId'>[]> {
  if (!mainline.length) return [];
  const { value: json } = await completeJson<{ links?: { index: number; reason: string }[] }>(
    settings,
    crossLinkSystem(),
    crossLinkUser({ title: node.title, summary: node.summary, content: node.content }, mainline),
    '请只输出 {"links":[{"index":数字,"reason":"原因"}]}，links 最多 3 项。',
    signal,
  );
  const out: Omit<CrossLink, 'id' | 'kbId' | 'createdAt' | 'sourceId'>[] = [];
  for (const l of json.links ?? []) {
    const target = mainline[l.index];
    if (target && target.id !== node.id) {
      out.push({ targetId: target.id, reason: l.reason || '相关知识点' });
    }
  }
  return out.slice(0, 3);
}

export interface MergeAnalysis {
  /** 建议创建的资料节点 */
  source: { title: string; summary: string };
  /** 与哪些已有知识点相关 */
  links: { nodeId: string; reason: string }[];
  /** 建议新增的知识点 */
  newNodes: { title: string; summary: string; content: string; parentId: string | null }[];
}

/**
 * 增量分析：判断新导入的材料与已有主线的关联，以及建议新增的知识点。
 * 只做分析、不碰任何数据，等用户点「合并」才应用。
 *
 * @param mainline 已按前序遍历排好序的主线节点（序号与界面显示一致）
 */
export async function analyzeMerge(
  settings: Settings,
  docNames: string[],
  newDocsText: string,
  mainline: ThreadNode[],
  signal?: AbortSignal,
): Promise<MergeAnalysis> {
  const { value } = await completeJson<{
    source?: { title?: string; summary?: string };
    links?: { index: number; reason?: string }[];
    newNodes?: {
      title?: string;
      summary?: string;
      content?: string;
      parentIndex?: number | null;
    }[];
  }>(
    settings,
    mergeSystem(),
    mergeUser(docNames, newDocsText, mainline),
    '请只输出一个 JSON 对象，字段为 source / links / newNodes，必须完整闭合。',
    signal,
  );

  const links: MergeAnalysis['links'] = [];
  for (const l of value.links ?? []) {
    const target = mainline[l.index];
    if (target && !links.some((x) => x.nodeId === target.id)) {
      links.push({ nodeId: target.id, reason: (l.reason ?? '').trim() || '相关内容' });
    }
  }

  const newNodes: MergeAnalysis['newNodes'] = [];
  for (const n of value.newNodes ?? []) {
    if (!n || typeof n.title !== 'string' || !n.title.trim()) continue;
    const parent = n.parentIndex == null ? null : mainline[n.parentIndex] ?? null;
    newNodes.push({
      title: n.title.trim(),
      summary: (n.summary ?? '').trim(),
      content: (n.content ?? '').trim(),
      parentId: parent ? parent.id : null,
    });
  }

  return {
    source: {
      title: value.source?.title?.trim() || docNames[0] || '新导入的材料',
      summary: value.source?.summary?.trim() || `本次导入 ${docNames.length} 份材料`,
    },
    links,
    newNodes,
  };
}

/**
 * 用视觉模型把图片里的文字提取出来（图片 / 扫描件 PDF 的「认字」）。
 * 需要服务端模型支持多模态输入。
 */
export async function ocrImage(
  settings: Settings,
  dataUrl: string,
  hint?: string,
  signal?: AbortSignal,
): Promise<string> {
  const prompt =
    '请把这张图片中的全部文字逐字准确提取出来，保持原有段落、换行与顺序。' +
    '不要翻译、不要总结、不要添加任何解释或评论。' +
    '如果图片里有表格，请用 Markdown 表格还原；如果有图表 / 流程图，请用文字描述其结构与关键信息。' +
    (hint ? `\n（来源：${hint}）` : '');

  const messages: ChatMsg[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];

  try {
    const res = await request(settings, messages, false, false, signal);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AIError('视觉模型没有返回识别结果');
    }
    return content.trim();
  } catch (e) {
    if (e instanceof AIError && /image|vision|multimodal|modalit|图片/i.test(e.message)) {
      throw new AIError(
        `当前模型「${settings.model}」似乎不支持图片输入，请改用支持视觉的模型` +
          `（如 gpt-4o / qwen-vl-max / glm-4v / moonshot-v1-8k-vision-preview）。原始错误：${e.message}`,
      );
    }
    throw e;
  }
}

export function newId(): string {
  return nanoid(10);
}
