/** 全局数据模型 */

/**
 * 节点类型：
 * - main   主线知识点（互相构成树形脉络）
 * - branch 支线（针对某个疑问展开，可无限嵌套）
 * - source 资料节点（一份导入的材料，虚线关联到它支撑的知识点）
 */
export type NodeKind = 'main' | 'branch' | 'source';
export type NodeStatus = 'todo' | 'learning' | 'done';

/** 知识库中的一篇文档（来自文件或粘贴） */
export interface Doc {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

/** 知识库 = 一个「知识文件夹」 */
export interface KnowledgeBase {
  id: string;
  name: string;
  docs: Doc[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 知识节点。
 * - main：主线上的知识点（线性顺序）
 * - branch：支线（由某个节点派生出的疑问），可无限嵌套
 */
export interface ThreadNode {
  id: string;
  kbId: string;
  parentId: string | null;
  kind: NodeKind;
  /** 主线排序，仅 main 有意义 */
  order: number;
  title: string;
  /** 一句话说明「这个知识点要学什么」 */
  summary: string;
  /** AI 生成的讲解内容（Markdown） */
  content: string;
  status: NodeStatus;
  /** 画布坐标 */
  x: number;
  y: number;
  /** 用户是否手动拖动过（为 true 时自动排版不再覆盖它的位置） */
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 跨线关联：支线内容指向主线其它知识点时生成的连接 */
export interface CrossLink {
  id: string;
  kbId: string;
  sourceId: string;
  targetId: string;
  reason: string;
  createdAt: number;
}

/**
 * 待确认的增量合并：往已有主线的知识库导入新文件后产生。
 * 不会自动改动主线，等用户点「合并」才应用。
 */
export interface PendingMerge {
  id: string;
  kbId: string;
  /** 本次新增的材料文件名 */
  docNames: string[];
  /** 建议创建的资料节点 */
  source: { title: string; summary: string };
  /** 建议关联的已有知识点 */
  links: { nodeId: string; title: string; reason: string }[];
  /** 建议新增的知识点 */
  newNodes: {
    title: string;
    summary: string;
    content: string;
    parentId: string | null;
    parentTitle: string | null;
  }[];
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  kbId: string;
  nodeId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface Settings {
  /** OpenAI 兼容的 API 地址，例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** 注入知识库的最大字符数，防止超出上下文 */
  contextChars: number;
  /** 单次回复的最大 token 数；生成主线时输出较长，太小会被截断。设为 0 表示不传该参数 */
  maxTokens: number;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.4,
  contextChars: 12000,
  maxTokens: 8192,
};
