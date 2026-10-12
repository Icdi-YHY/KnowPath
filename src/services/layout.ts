import type { ThreadNode } from '@/types';

export const NODE_W = 208;
export const NODE_H = 96;
export const LEVEL_H = 210;
export const SIBLING_GAP = 34;
export const MAIN_GAP = 130;

export interface LayoutResult {
  nodes: ThreadNode[];
  /** 每列（主线下标）的 x 起止，便于画主线连接 */
  mainCount: number;
}

/**
 * 布局：主线水平排列在顶层，支线从所属节点向下生长（类似思维导图）。
 * 用简化的 tidy-tree 算法，保证子树互不重叠。
 */
export function layoutGraph(all: ThreadNode[]): LayoutResult {
  const byParent = new Map<string | null, ThreadNode[]>();
  for (const n of all) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }

  const mains = (byParent.get(null) ?? [])
    .filter((n) => n.kind === 'main')
    .sort((a, b) => a.order - b.order);

  // 支线按创建时间排序，保持稳定
  for (const [, list] of byParent) {
    list.sort((a, b) => a.createdAt - b.createdAt);
  }

  const widthCache = new Map<string, number>();

  function subtreeWidth(node: ThreadNode): number {
    const cached = widthCache.get(node.id);
    if (cached != null) return cached;
    const children = byParent.get(node.id) ?? [];
    let w = NODE_W;
    if (children.length) {
      let sum = 0;
      children.forEach((c, i) => {
        sum += subtreeWidth(c) + (i > 0 ? SIBLING_GAP : 0);
      });
      w = Math.max(NODE_W, sum);
    }
    widthCache.set(node.id, w);
    return w;
  }

  const positions = new Map<string, { x: number; y: number }>();

  function place(node: ThreadNode, left: number, depth: number) {
    const w = subtreeWidth(node);
    const x = left + w / 2 - NODE_W / 2;
    const y = depth * LEVEL_H;
    positions.set(node.id, { x, y });
    const children = byParent.get(node.id) ?? [];
    if (!children.length) return;
    let cursor = left + (w - children.reduce((s, c, i) => s + subtreeWidth(c) + (i > 0 ? SIBLING_GAP : 0), 0)) / 2;
    for (const c of children) {
      place(c, cursor, depth + 1);
      cursor += subtreeWidth(c) + SIBLING_GAP;
    }
  }

  let cursor = 0;
  for (const m of mains) {
    place(m, cursor, 0);
    cursor += subtreeWidth(m) + MAIN_GAP;
  }

  // 孤立节点（没有父、又不是 main）兜底放在最右
  for (const n of all) {
    if (!positions.has(n.id)) {
      positions.set(n.id, { x: cursor, y: 0 });
      cursor += NODE_W + SIBLING_GAP;
    }
  }

  return {
    nodes: all.map((n) => {
      const p = positions.get(n.id)!;
      return n.x === p.x && n.y === p.y ? n : { ...n, x: p.x, y: p.y };
    }),
    mainCount: mains.length,
  };
}
