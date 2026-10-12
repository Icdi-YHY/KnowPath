import { GitMerge, Link2, Plus } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Spinner } from './ui';

/**
 * 增量导入的待确认面板。
 * 往已有主线的知识库导入新文件后出现，**不会自动改动主线**，
 * 用户点「合并」才真正建立关联并插入新知识点。
 */
export function MergePanel() {
  const pending = useStore((s) => s.pendingMerge);
  const applyMerge = useStore((s) => s.applyMerge);
  const discardMerge = useStore((s) => s.discardMerge);
  const busy = useStore((s) => s.busy);

  if (!pending) return null;

  const nothingToDo = !pending.links.length && !pending.newNodes.length;

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <GitMerge size={17} className="hidden shrink-0 text-amber-300 sm:mt-0.5 sm:block" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-amber-100">新材料待合并</span>
            <span className="min-w-0 truncate text-xs text-amber-200/70">
              《{pending.docNames.join('、')}》 → {pending.source.title}
            </span>
          </div>

          {nothingToDo ? (
            <div className="mt-1.5 text-xs leading-relaxed text-ink-400">
              这批材料没有发现新的关联或内容缺口。它已作为 AI 上下文生效，可以不合并。
            </div>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              {pending.links.length > 0 && (
                <div className="text-xs leading-relaxed text-ink-300">
                  <span className="text-ink-400">关联到 {pending.links.length} 个已有知识点：</span>
                  <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                    {pending.links.map((l) => (
                      <span key={l.nodeId} className="chip bg-ink-800 text-ink-200">
                        <Link2 size={11} className="text-amber-300/80" />
                        {l.title}
                        <span className="text-ink-500">· {l.reason}</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}

              {pending.newNodes.length > 0 && (
                <div className="text-xs leading-relaxed text-ink-300">
                  <span className="text-ink-400">建议新增 {pending.newNodes.length} 个知识点：</span>
                  <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                    {pending.newNodes.map((n, i) => (
                      <span key={`${n.title}-${i}`} className="chip bg-ink-800 text-ink-200">
                        <Plus size={11} className="text-accent-500" />
                        {n.title}
                        {n.parentTitle && <span className="text-ink-500">· 挂在「{n.parentTitle}」下</span>}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="btn-primary !py-1.5 !text-xs"
            onClick={applyMerge}
            disabled={busy === 'merge-apply'}
            title="建立关联并插入建议的新知识点"
          >
            {busy === 'merge-apply' ? <Spinner /> : <GitMerge size={13} />} 合并
          </button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={discardMerge} title="忽略建议（材料仍保留）">
            忽略
          </button>
        </div>
      </div>
    </div>
  );
}
