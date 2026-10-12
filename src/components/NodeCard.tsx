import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import type { ThreadNode } from '@/types';
import { StatusDot } from './ui';

export interface ThreadNodeData extends Record<string, unknown> {
  node: ThreadNode;
  active: boolean;
  /** 主线上的显示序号（前序遍历），由 GraphView 计算后传入 */
  index?: number;
}

function NodeCardImpl({ data }: NodeProps) {
  const { node, active, index } = data as ThreadNodeData;
  const kind = node.kind;
  return (
    <div
      className={clsx(
        'w-[208px] rounded-xl border px-3 py-2.5 transition-all cursor-pointer select-none',
        'bg-ink-850 hover:bg-ink-800',
        active
          ? 'border-brand-500 shadow-[0_0_0_3px_rgba(91,140,255,0.18)]'
          : kind === 'main'
            ? 'border-ink-600'
            : kind === 'branch'
              ? 'border-teal-600/40'
              : 'border-amber-500/40 border-dashed',
      )}
    >
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />

      <div className="flex items-center gap-1.5 mb-1">
        {kind === 'main' ? (
          <span className="chip bg-brand-500/15 text-brand-400 shrink-0">
            主线 {index ?? node.order + 1}
          </span>
        ) : kind === 'branch' ? (
          <span className="chip bg-emerald-500/15 text-emerald-300 shrink-0">支线</span>
        ) : (
          <span className="chip bg-amber-500/15 text-amber-300 shrink-0">资料</span>
        )}
        <div className="flex-1" />
        {kind !== 'source' && <StatusDot status={node.status} />}
      </div>
      <div className="text-[13.5px] font-semibold text-white leading-snug line-clamp-2">
        {node.title}
      </div>
      {node.summary && (
        <div className="mt-1 text-[11.5px] leading-snug text-ink-400 line-clamp-2">{node.summary}</div>
      )}
    </div>
  );
}

export const NodeCard = memo(NodeCardImpl);
