import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CornerDownLeft, Network, RefreshCw, Send, Sparkles, Square } from 'lucide-react';
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

  const mains = useMemo(() => nodes.filter((n) => n.kind === 'main').sort((a, b) => a.order - b.order), [nodes]);

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

  const currentNodeIndex = mains.findIndex((m) => m.id === node.id);

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-ink-700/70 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {node.kind === 'main' ? (
                <span className="chip bg-brand-500/15 text-brand-400">主线 {node.order + 1}</span>
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

        {/* 主线进度条 */}
        {mains.length > 0 && (
          <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-0.5">
            {mains.map((m, i) => (
              <button
                key={m.id}
                title={m.title}
                onClick={() => selectNode(m.id)}
                className={clsx(
                  'shrink-0 h-1.5 rounded-full transition-all',
                  m.id === node.id
                    ? 'w-8 bg-brand-500'
                    : currentNodeIndex >= 0 && i < currentNodeIndex
                      ? 'w-4 bg-brand-600/60'
                      : 'w-4 bg-ink-700 hover:bg-ink-600',
                )}
              />
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

        {nodeMessages.map((m) => (
          <div key={m.id} className={clsx('max-w-2xl mx-auto flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'user' ? (
              <div className="rounded-2xl rounded-br-md bg-brand-600 text-white px-3.5 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap">
                {m.content}
              </div>
            ) : (
              <div className="w-full">
                <Markdown>{m.content}</Markdown>
              </div>
            )}
          </div>
        ))}

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
            <Sparkles size={13} /> 支线模式：描述你的疑问，将生成一条独立支线并自动连回主线
            <button className="text-ink-400 hover:text-white ml-auto" onClick={() => setBranchMode(false)}>
              取消
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            className={clsx('btn !p-2.5 shrink-0', branchMode ? 'bg-emerald-500/20 text-emerald-300' : 'btn-ghost')}
            title="开一条支线"
            onClick={() => setBranchMode((v) => !v)}
          >
            <Sparkles size={17} />
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
