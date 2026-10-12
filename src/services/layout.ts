import type { ThreadNode } from '@/types';

export const NODE_W = 208;
export const NODE_H = 96;
/** 相邻层级之间的水平间距 */
export const LEVEL_GAP = 64;
/** 同级节点之间的垂直间距 */
export const SIBLING_GAP = 22;
/** 多个根节点之间的垂直间距 */
export const ROOT_GAP = 60;

/** 同级节点的排列优先级：主线在最上，资料在最下 */
export const KIND_RANK: Record<ThreadNode['kind'], number> = { main: 0, branch: 1, source: 2 };

export interface LayoutResult {
  nodes: ThreadNode[];
  /** 根节点数量（主线起点，可以有多个） */
  rootCount: number;
}

/**
 * 左到右的树形布局（tidy tree）。
 *
 * 主线与支线统一当成一棵树来排：
 *  - 一个节点只有一个子节点时 → 排成一条水平直线（就是原来的「一条线」观感）
 *  - 一个节点有多个子节点时 → 向下分叉，展示并列的后续脉络
 *
 * 因此「线性」和「树形」是同一种布局，不必切换模式。
 */
export function layoutGraph(all: ThreadNode[]): LayoutResult {
  const ids = new Set(all.map((n) => n.id));

  // 父节点不存在（被删掉）的节点按根节点处理，避免整棵子树丢失
  const byParent = new Map<string | null, ThreadNode[]>();
  for (const n of all) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }

  // 同级排序：主线 → 支线 → 资料（资料节点统一排在下方）
  for (const [, list] of byParent) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
      return a.kind === 'main' ? a.order - b.order : a.createdAt - b.createdAt;
    });
  }

  const heightCache = new Map<string, number>();

  /** 整棵子树需要的垂直高度 */
  function subtreeHeight(node: ThreadNode): number {
    const cached = heightCache.get(node.id);
    if (cached != null) return cached;
    const children = byParent.get(node.id) ?? [];
    let h = NODE_H;
    if (children.length) {
      const sum = children.reduce(
        (acc, c, i) => acc + subtreeHeight(c) + (i > 0 ? SIBLING_GAP : 0),
        0,
      );
      h = Math.max(NODE_H, sum);
    }
    heightCache.set(node.id, h);
    return h;
  }

  const childrenTotal = (children: ThreadNode[]) =>
    children.reduce((acc, c, i) => acc + subtreeHeight(c) + (i > 0 ? SIBLING_GAP : 0), 0);

  const positions = new Map<string, { x: number; y: number }>();

  /** 把 node 放在水平 x、垂直 top 起的区域内，并居中 */
  function place(node: ThreadNode, x: number, top: number) {
    const h = subtreeHeight(node);
    positions.set(node.id, { x, y: top + h / 2 - NODE_H / 2 });

    const children = byParent.get(node.id) ?? [];
    if (!children.length) return;

    const childX = x + NODE_W + LEVEL_GAP;
    let cursor = top + (h - childrenTotal(children)) / 2;
    for (const c of children) {
      place(c, childX, cursor);
      cursor += subtreeHeight(c) + SIBLING_GAP;
    }
  }

  const roots = byParent.get(null) ?? [];
  let cursor = 0;
  for (const root of roots) {
    place(root, 0, cursor);
    cursor += subtreeHeight(root) + ROOT_GAP;
  }

  // 理论上不会发生（所有节点都会被归到某个根下），兜底避免位置缺失
  for (const n of all) {
    if (!positions.has(n.id)) positions.set(n.id, { x: cursor, y: 0 });
  }

  return {
    nodes: all.map((n) => {
      const p = positions.get(n.id)!;
      return n.x === p.x && n.y === p.y ? n : { ...n, x: p.x, y: p.y };
    }),
    rootCount: roots.length,
  };
}

/**
 * 主线的显示序号：按前序遍历（先根后子）编号。
 * 线性时会得到 1,2,3…，分叉时子分支继续往后排，保证阅读顺序自然。
 */
export function mainlineNumbers(all: ThreadNode[]): Map<string, number> {
  const ids = new Set(all.map((n) => n.id));
  const byParent = new Map<string | null, ThreadNode[]>();
  for (const n of all) {
    if (n.kind !== 'main') continue;
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }

  const out = new Map<string, number>();
  let counter = 0;
  const walk = (parentId: string | null) => {
    const children = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.order - b.order);
    for (const child of children) {
      counter += 1;
      out.set(child.id, counter);
      walk(child.id);
    }
  };
  walk(null);
  return out;
}

/** 按显示顺序（前序）排列的主线节点，序号与界面上看到的一致 */
export function orderedMainline(all: ThreadNode[]): ThreadNode[] {
  const nums = mainlineNumbers(all);
  return all
    .filter((n) => n.kind === 'main')
    .sort((a, b) => (nums.get(a.id) ?? 0) - (nums.get(b.id) ?? 0));
}

/** 从根到该节点的路径（用于面包屑导航） */
export function nodePath(all: ThreadNode[], nodeId: string): ThreadNode[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  const path: ThreadNode[] = [];
  let cur = byId.get(nodeId);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}
