import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, CornerDownLeft, Network, RefreshCw, Send, Sparkles, Square } from 'lucide-react';
import { mainlineNumbers, nodePath } from '@/services/layout';
import { useStore } from '@/store/useStore';
import { Markdown, Spinner } from './ui';

export function ChatView() {
  const nodes = useStore((s) => s.nodes);
  const messages = useStore((s) => s.messages);
  const activeNodeId = useStore((s) => s.activeNodeId);
  const streaming = useStore((s) => s.streaming);
  const selectNode = useStore((s) => s.selectNode);
  const sendMessage = useStore((s) => s.sendMessage);
  const stop = useStore((s) => s.stop);
  const regenerateNode = useStore((s) => s.regenerateNode);
  const addBranch = useStore((s) => s.addBranch);
  const promoteToBranch = useStore((s) => s.promoteToBranch);
  const setView = useStore((s) => s.setView);
  const busy = useStore((s) => s.busy);

  const [input, setInput] = useState('');
  const [branchMode, setBranchMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const node = nodes.find((n) => n.id === activeNodeId) ?? null;
  const nodeMessages = useMemo(
    () => messages.filter((m) => m.nodeId === activeNodeId).sort((a, b) => a.createdAt - b.createdAt),
    [messages, activeNodeId],
  );
  const isStreaming = streaming?.nodeId === activeNodeId;

  const numbers = useMemo(() => mainlineNumbers(nodes), [nodes]);
  /** 从根到当前节点的路径，替代原来的线性进度条 */
  const path = useMemo(() => (activeNodeId ? nodePath(nodes, activeNodeId) : []), [nodes, activeNodeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [nodeMessages.length, streaming?.content]);

  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-ink-400 text-sm">
        请先在左侧或图谱中选择一个知识点
      </div>
    );
  }

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    if (branchMode) {
      addBranch(node.id, text);
      setBranchMode(false);
    } else {
      sendMessage(node.id, text);
    }
    setInput('');
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-ink-700/70 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {node.kind === 'main' ? (
                <span className="chip bg-brand-500/15 text-brand-400">
                  主线 {numbers.get(node.id) ?? node.order + 1}
                </span>
              ) : (
                <span className="chip bg-emerald-500/15 text-emerald-300">支线</span>
              )}
              <h2 className="font-semibold text-white truncate">{node.title}</h2>
            </div>
            {node.summary && <div className="text-xs text-ink-400 mt-1 truncate">{node.summary}</div>}
          </div>
          <button className="btn-ghost !py-1.5 !text-xs shrink-0" onClick={() => setView('graph')}>
            <Network size={14} /> 图谱
          </button>
          <button
            className="btn-ghost !py-1.5 !text-xs shrink-0"
            onClick={() => regenerateNode(node.id)}
            disabled={busy === `explain:${node.id}`}
          >
            {busy === `explain:${node.id}` ? <Spinner /> : <RefreshCw size={14} />} 重新讲解
          </button>
        </div>

        {/* 所处脉络位置：从根节点到当前节点的路径（树形结构下比线性进度条更有意义） */}
        {path.length > 1 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[11.5px] leading-5">
            {path.map((p, i) => (
              <span key={p.id} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight size={11} className="shrink-0 text-ink-600" />}
                <button
                  onClick={() => selectNode(p.id)}
                  title={p.title}
                  className={clsx(
                    'max-w-[150px] truncate rounded px-1 transition-colors',
                    p.id === node.id ? 'font-medium text-brand-400' : 'text-ink-400 hover:text-white',
                  )}
                >
                  {p.kind === 'main' ? `${numbers.get(p.id) ?? ''}. ` : '└ '}
                  {p.title}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!nodeMessages.length && !isStreaming && (
          <div className="max-w-2xl mx-auto text-center py-6">
            {node.content ? (
              <div className="text-left card p-4">
                <div className="text-xs text-ink-400 mb-2 flex items-center gap-1">
                  <Sparkles size={12} /> 知识点讲解
                </div>
                <Markdown>{node.content}</Markdown>
              </div>
            ) : (
              <div className="text-sm text-ink-400 py-8">
                还没有讲解内容，点右上角「重新讲解」，或直接在下面提问。
              </div>
            )}
          </div>
        )}

        {nodeMessages.map((m, i) => {
          // 这条回答对应的提问（往前找最近的一条用户消息），存为支线时用作标题
          const ask =
            m.role === 'assistant'
              ? ([...nodeMessages.slice(0, i)].reverse().find((x) => x.role === 'user')?.content ?? '')
              : '';
          return (
            <div
              key={m.id}
              className={clsx('max-w-2xl mx-auto flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {m.role === 'user' ? (
                <div className="rounded-2xl rounded-br-md bg-brand-600 text-white px-3.5 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap">
                  {m.content}
                </div>
              ) : (
                <div className="w-full">
                  <Markdown>{m.content}</Markdown>
                  {/* 一键把这次回答变成支线：不用再去找那个小图标，也不用等 AI 再跑一遍 */}
                  <button
                    className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-ink-400 hover:text-emerald-300 transition-colors"
                    title="把这次回答单独存成一条支线，挂在当前知识点下面（支线下面还能继续开支线）"
                    onClick={() => promoteToBranch(node.id, ask || node.title, m.content)}
                  >
                    <Sparkles size={12} /> 存为支线
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {isStreaming && (
          <div className="max-w-2xl mx-auto">
            <Markdown>{streaming!.content || ''}</Markdown>
            {!streaming!.content && (
              <div className="flex items-center gap-2 text-ink-400 text-sm">
                <Spinner /> 思考中…
              </div>
            )}
            {streaming!.content && (
              <span className="inline-block w-2 h-4 bg-brand-500 animate-blink align-text-bottom" />
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="px-4 py-3 border-t border-ink-700/70 shrink-0">
        {branchMode && (
          <div className="mb-2 flex items-center gap-2 text-xs text-emerald-300">
            <Sparkles size={13} /> 支线模式：描述你的疑问，会以「{node.title.slice(0, 14)}」为父节点新建一条支线
            <button className="text-ink-400 hover:text-white ml-auto" onClick={() => setBranchMode(false)}>
              取消
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            className={clsx(
              'btn shrink-0 !py-2.5 !px-3 !text-xs',
              branchMode ? 'bg-emerald-500/20 text-emerald-300' : 'btn-ghost',
            )}
            title="进入支线模式：输入的疑问会生成一条新支线"
            onClick={() => setBranchMode((v) => !v)}
          >
            <Sparkles size={15} />
            {/* 原来只有一个小图标，不好发现；现在带文字，一眼能看出这是干什么的 */}
            {branchMode ? '支线模式' : '开支线'}
          </button>
          <textarea
            className="input resize-none max-h-40 min-h-[42px] py-2.5"
            rows={1}
            placeholder={branchMode ? '描述你卡住的地方…' : '问点什么，例如：这里为什么要这样做？'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {isStreaming ? (
            <button className="btn-ghost !p-2.5 shrink-0" onClick={stop} title="停止">
              <Square size={16} />
            </button>
          ) : (
            <button className="btn-primary !p-2.5 shrink-0" onClick={submit} disabled={!input.trim()} title="发送">
              {branchMode ? <CornerDownLeft size={17} /> : <Send size={17} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
