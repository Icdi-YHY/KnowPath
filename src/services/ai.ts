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
  explainUser,
  mainlineSystem,
  mainlineUser,
} from './prompts';

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIError';
  }
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

/** 流式对话，逐段回调增量文本 */
export async function chatStream(
  settings: Settings,
  messages: ChatMsg[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await request(settings, messages, true, false, signal);
  const reader = res.body?.getReader();
  if (!reader) throw new AIError('响应没有数据流');
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
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
        const delta: string = json.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        /* 忽略不完整片段 */
      }
    }
  }
  return full;
}

/** 非流式一次性补全 */
export async function complete(
  settings: Settings,
  messages: ChatMsg[],
  signal?: AbortSignal,
  json = false,
): Promise<string> {
  const res = await request(settings, messages, false, json, signal);
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';
  if (!content) {
    const reason = data.choices?.[0]?.finish_reason;
    throw new AIError(
      reason === 'length'
        ? 'AI 输出被长度上限截断且没有返回内容，请在「设置」里调大最大 token。'
        : 'AI 没有返回内容',
    );
  }
  return content;
}

/* ------------------------------------------------------------------ */
/* 业务能力                                                            */
/* ------------------------------------------------------------------ */

/**
 * 请求 JSON 结果；若解析失败，自动用更精简的要求重试一次。
 * 这是应对「输出被截断」的最后一道保险。
 */
async function completeJson<T>(
  settings: Settings,
  system: string,
  user: string,
  retryNote: string,
  signal?: AbortSignal,
): Promise<T> {
  const first = await complete(
    settings,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    signal,
    true,
  );
  try {
    return extractJson<T>(first);
  } catch {
    console.warn('[knowpath] JSON 解析失败，正在自动重试一次…');
    const second = await complete(
      settings,
      [
        { role: 'system', content: system },
        { role: 'user', content: `${user}\n\n【重要】你上一次的输出无法被解析为 JSON。${retryNote}` },
      ],
      signal,
      true,
    );
    return extractJson<T>(second);
  }
}

export interface MainlineResult {
  title: string;
  nodes: {
    parentId: null;
    kind: 'main';
    title: string;
    summary: string;
    content: string;
    status: 'todo';
  }[];
}

/** 生成主线：知识点序列 */
export async function generateMainline(
  settings: Settings,
  kb: KnowledgeBase,
  signal?: AbortSignal,
): Promise<MainlineResult> {
  const parsed = await completeJson<{
    title?: string;
    nodes?: { title?: string; summary?: string; content?: string }[];
  }>(
    settings,
    mainlineSystem(),
    mainlineUser(kb, settings.contextChars),
    '请更精简：知识点不超过 8 个，每个 content 不超过 250 字，必须保证 JSON 完整闭合。',
    signal,
  );

  // 容错：模型直接返回数组的情况
  const rawNodes = Array.isArray(parsed) ? parsed : parsed?.nodes ?? [];
  const nodes = rawNodes.filter((n) => n && typeof n.title === 'string' && n.title.trim());
  if (!nodes.length) {
    console.error('[knowpath] 主线 JSON 结构不符合预期：\n', JSON.stringify(parsed).slice(0, 500));
    throw new AIError('AI 返回的 JSON 里没有找到有效的知识点列表，可重试一次或换用更强的模型。');
  }

  return {
    title: (!Array.isArray(parsed) && parsed?.title) || `${kb.name} · 学习主线`,
    nodes: nodes.map((n) => ({
      parentId: null,
      kind: 'main',
      title: n.title!.trim(),
      summary: (n.summary ?? '').trim(),
      content: (n.content ?? '').trim(),
      status: 'todo',
    })),
  };
}

/** 为某个知识点生成讲解正文 */
export async function explainNode(
  settings: Settings,
  kb: KnowledgeBase,
  node: ThreadNode,
  signal?: AbortSignal,
): Promise<string> {
  return complete(
    settings,
    [
      { role: 'system', content: mainlineSystem().split('\n\n')[0] },
      { role: 'user', content: explainUser(kb, node, settings.contextChars) },
    ],
    signal,
  );
}

/** 根据疑问生成一条支线 */
export async function generateBranch(
  settings: Settings,
  node: ThreadNode,
  question: string,
  signal?: AbortSignal,
): Promise<{ title: string; summary: string; content: string }> {
  const text = await complete(
    settings,
    [
      { role: 'system', content: branchSystem() },
      { role: 'user', content: branchUser(node, question) },
    ],
    signal,
    true,
  );
  const json = extractJson<{ title?: string; summary?: string; content?: string }>(text);
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
  const json = await completeJson<{ links?: { index: number; reason: string }[] }>(
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

export function newId(): string {
  return nanoid(10);
}
