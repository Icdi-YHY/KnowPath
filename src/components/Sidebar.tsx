import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  BookOpen,
  FolderOpen,
  MessageSquare,
  Network,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  X,
} from 'lucide-react';
import { mainlineNumbers } from '@/services/layout';
import { useStore } from '@/store/useStore';
import type { ThreadNode } from '@/types';
import { StatusDot } from './ui';

export function Sidebar({
  onClose,
  onOpenSettings,
}: {
  onClose?: () => void;
  onOpenSettings: () => void;
}) {
  const kbs = useStore((s) => s.kbs);
  const activeKbId = useStore((s) => s.activeKbId);
  const nodes = useStore((s) => s.nodes);
  const view = useStore((s) => s.view);
  const activeNodeId = useStore((s) => s.activeNodeId);
  const setActiveKb = useStore((s) => s.setActiveKb);
  const createKb = useStore((s) => s.createKb);
  const deleteKb = useStore((s) => s.deleteKb);
  const setView = useStore((s) => s.setView);
  const selectNode = useStore((s) => s.selectNode);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const mains = nodes.filter((n) => n.kind === 'main');
  const numbers = useMemo(() => mainlineNumbers(nodes), [nodes]);

  /**
   * 侧栏是「阅读顺序列表」，不是空间布局，所以缩进规则和画布上不一样：
   *  - 支线：紧跟所属节点，缩进一级
   *  - 主线：只有当父节点真的分叉（有多个主线子节点）时才缩进一级；
   *          单子链保持同级 —— 否则线性主线会逐级缩进到看不下去，
   *          而且会把支线挤到整条链的末尾
   */
  const kindRank = (k: ThreadNode['kind']) => (k === 'branch' ? 0 : k === 'main' ? 1 : 2);

  const renderTree = (parentId: string | null, depth: number) => {
    const children = nodes
      .filter((n) => (n.parentId ?? null) === parentId)
      .sort((a, b) => {
        const ra = kindRank(a.kind);
        const rb = kindRank(b.kind);
        if (ra !== rb) return ra - rb;
        return a.kind === 'main' ? a.order - b.order : a.createdAt - b.createdAt;
      });

    const mainChildCount = children.filter((c) => c.kind === 'main').length;

    return children.map((n) => {
      const kids = nodes.filter((c) => c.parentId === n.id);
      const isOpen = expanded[n.id] ?? true;
      // 注意：这是「该节点自己」的缩进层级，不是给子节点用的。
      // 支线固定缩进一级；主线只有当父节点真的分叉（≥2 个主线子节点）时才缩进。
      const ownDepth = n.kind === 'branch' ? depth + 1 : mainChildCount > 1 ? depth + 1 : depth;
      return (
        <div key={n.id}>
          <div
            className={clsx(
              'group flex items-center gap-1.5 rounded-md pr-1 py-1.5 cursor-pointer transition-colors',
              n.id === activeNodeId ? 'bg-brand-500/15' : 'hover:bg-ink-800',
            )}
            style={{ paddingLeft: 8 + ownDepth * 14 }}
            onClick={() => {
              selectNode(n.id);
              if (view === 'kb') setView('graph');
              onClose?.();
            }}
          >
            {kids.length ? (
              <button
                className="text-ink-400 hover:text-white shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((s) => ({ ...s, [n.id]: !isOpen }));
                }}
              >
                <span className="text-[10px]">{isOpen ? '▾' : '▸'}</span>
              </button>
            ) : (
              <span className="w-2.5 shrink-0" />
            )}
            <StatusDot status={n.status} />
            <span
              className={clsx(
                'text-[13px] truncate flex-1',
                n.kind === 'main' ? 'text-ink-100' : 'text-emerald-200/90',
                n.id === activeNodeId && 'font-medium',
              )}
              title={n.title}
            >
              {n.kind === 'main' && <span className="text-brand-400/80 mr-1">{numbers.get(n.id)}.</span>}
              {n.kind === 'branch' && <span className="text-emerald-400/70 mr-1">└</span>}
              {n.title}
            </span>
          </div>
          {/* 必须用 kids.length > 0：直接写 kids.length 时，无子节点会计算出 0，
              React 会把数字 0 当作内容渲染出来（就是那个多余的「0」） */}
          {kids.length > 0 && isOpen && renderTree(n.id, ownDepth)}
        </div>
      );
    });
  };

  const tabs = [
    { key: 'kb' as const, label: '知识库', icon: BookOpen },
    { key: 'graph' as const, label: '图谱', icon: Network },
    { key: 'chat' as const, label: '对话', icon: MessageSquare },
  ];

  return (
    <div className="h-full w-[272px] shrink-0 bg-ink-900 border-r border-ink-700/70 flex flex-col">
      {/* 顶部 */}
      <div className="px-3.5 py-3 border-b border-ink-700/70 flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center shrink-0">
          <Network size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white leading-tight">知径 KnowPath</div>
          <div className="text-[10.5px] text-ink-500">AI 知识主线学习</div>
        </div>
        <button className="btn-ghost !p-1.5 shrink-0" onClick={onOpenSettings} title="设置">
          <SettingsIcon size={15} />
        </button>
        {onClose && (
          <button className="btn-ghost !p-1.5 shrink-0 md:hidden" onClick={onClose}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* 知识库切换 */}
      <div className="px-3.5 py-3 border-b border-ink-700/70">
        <div className="flex gap-1.5">
          <div className="relative flex-1 min-w-0">
            <FolderOpen size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <select
              className="input !pl-8 !pr-6 appearance-none cursor-pointer truncate"
              value={activeKbId ?? ''}
              onChange={(e) => setActiveKb(e.target.value)}
            >
              {!kbs.length && <option value="">（暂无知识库）</option>}
              {kbs.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn-ghost !px-2.5 shrink-0"
            title="新建知识库"
            onClick={() => createKb(`知识库 ${kbs.length + 1}`)}
          >
            <Plus size={15} />
          </button>
          {activeKbId && (
            <button
              className="btn-danger !px-2.5 shrink-0"
              title="删除当前知识库"
              onClick={() => {
                if (confirm('确定删除这个知识库及其全部主线、支线、对话记录吗？此操作不可恢复。')) {
                  deleteKb(activeKbId);
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 视图切换 */}
      <div className="px-3.5 py-3 border-b border-ink-700/70">
        <div className="flex gap-1 rounded-lg bg-ink-950 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-md transition-colors',
                view === t.key ? 'bg-ink-700 text-white font-medium' : 'text-ink-400 hover:text-ink-100',
              )}
              onClick={() => setView(t.key)}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 主线树 */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {mains.length ? (
          <>
            <div className="px-2 pb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-500">
              学习主线 · {mains.length} 个知识点
            </div>
            {renderTree(null, 0)}
          </>
        ) : (
          <div className="px-3 py-6 text-center text-xs text-ink-500 leading-relaxed">
            还没有主线。
            <br />
            先在「知识库」添加材料，然后生成主线。
          </div>
        )}
      </div>

      <div className="px-3.5 py-2.5 border-t border-ink-700/70 text-[10.5px] text-ink-600 text-center">
        数据保存在本机 · 支持离线使用
      </div>
    </div>
  );
}

export type { ThreadNode };
