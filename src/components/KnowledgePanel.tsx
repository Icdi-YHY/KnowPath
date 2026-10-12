import { useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { EmptyState, Spinner } from './ui';

export function KnowledgePanel() {
  const kbs = useStore((s) => s.kbs);
  const activeKbId = useStore((s) => s.activeKbId);
  const addDoc = useStore((s) => s.addDoc);
  const updateDoc = useStore((s) => s.updateDoc);
  const removeDoc = useStore((s) => s.removeDoc);
  const renameKb = useStore((s) => s.renameKb);
  const createKb = useStore((s) => s.createKb);
  const loadDemo = useStore((s) => s.loadDemo);
  const generateMainline = useStore((s) => s.generateMainline);
  const busy = useStore((s) => s.busy);
  const setView = useStore((s) => s.setView);

  const kb = kbs.find((k) => k.id === activeKbId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  if (!kb) {
    return (
      <EmptyState
        icon={<FileText size={34} />}
        title="还没有知识库"
        desc="创建一个知识库，把你的学习材料（笔记、教程、文章）放进去，AI 会读完它们并为你规划主线。"
        action={
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <button className="btn-primary" onClick={() => createKb('我的知识库')}>
              <Plus size={15} /> 新建知识库
            </button>
            <button className="btn-ghost" onClick={loadDemo}>
              先看示例
            </button>
          </div>
        }
      />
    );
  }

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.size > 2 * 1024 * 1024) continue;
      const text = await f.text();
      await addDoc(f.name, text);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-5 sm:py-8">
        <input
          className="w-full bg-transparent text-2xl font-bold text-white outline-none border-b border-transparent focus:border-ink-600 pb-1"
          value={kb.name}
          onChange={(e) => renameKb(kb.id, e.target.value)}
        />
        <div className="mt-1.5 text-xs text-ink-400">
          {kb.docs.length} 篇材料 · 共 {kb.docs.reduce((s, d) => s + d.content.length, 0).toLocaleString()} 字
        </div>

        {/* 添加区 */}
        <div className="card p-4 mt-5">
          <div className="text-sm font-medium text-ink-100 mb-3 flex items-center gap-1.5">
            <Plus size={15} /> 添加材料
          </div>
          <input
            className="input mb-2"
            placeholder="材料标题，例如：第三章 函数与闭包"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="input resize-y min-h-[120px] font-mono text-[13px] leading-6"
            placeholder="把内容粘贴到这里…（Markdown / 纯文本均可）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              className="btn-primary"
              disabled={!content.trim()}
              onClick={async () => {
                await addDoc(name.trim() || `材料 ${kb.docs.length + 1}`, content.trim());
                setName('');
                setContent('');
              }}
            >
              添加
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> 上传文件（可多选）
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.json,.csv,.log,text/*"
              multiple
              hidden
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <span className="text-xs text-ink-500">支持拖入 .txt / .md 等文本文件，单文件 ≤ 2MB</span>
          </div>
        </div>

        {/* 材料列表 */}
        <div className="mt-5 space-y-2">
          {kb.docs.map((d) => {
            const open = openDocs[d.id];
            return (
              <div key={d.id} className="card overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5">
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    onClick={() => setOpenDocs((s) => ({ ...s, [d.id]: !s[d.id] }))}
                  >
                    {open ? <ChevronDown size={15} className="text-ink-400 shrink-0" /> : <ChevronRight size={15} className="text-ink-400 shrink-0" />}
                    <FileText size={15} className="text-brand-400 shrink-0" />
                    <span className="text-sm text-ink-100 truncate">{d.name}</span>
                    <span className="text-xs text-ink-500 shrink-0">{d.content.length} 字</span>
                  </button>
                  <button
                    className="btn-ghost !p-1.5"
                    onClick={() => {
                      setEditing(editing === d.id ? null : d.id);
                      setEditText(d.content);
                      setOpenDocs((s) => ({ ...s, [d.id]: true }));
                    }}
                    title="编辑"
                  >
                    <Pencil size={14} />
                  </button>
                  <button className="btn-danger !p-1.5" onClick={() => removeDoc(d.id)} title="删除">
                    <Trash2 size={14} />
                  </button>
                </div>
                {open && (
                  <div className="px-3.5 pb-3.5">
                    {editing === d.id ? (
                      <>
                        <textarea
                          className="input resize-y min-h-[220px] font-mono text-[13px] leading-6"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            className="btn-primary !py-1.5 !text-xs"
                            onClick={() => {
                              updateDoc(d.id, { content: editText });
                              setEditing(null);
                            }}
                          >
                            保存
                          </button>
                          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setEditing(null)}>
                            取消
                          </button>
                        </div>
                      </>
                    ) : (
                      <pre className="text-[12.5px] leading-6 text-ink-300 whitespace-pre-wrap max-h-64 overflow-y-auto bg-ink-900 rounded-lg p-3">
                        {d.content}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!kb.docs.length && (
            <div className="text-sm text-ink-500 text-center py-6">还没有材料，先在上方添加或上传吧</div>
          )}
        </div>

        {/* 生成主线 */}
        <div className="sticky bottom-0 mt-6 py-4 bg-gradient-to-t from-ink-950 via-ink-950/90 to-transparent">
          <button
            className="btn-primary w-full !py-3"
            disabled={!kb.docs.length || busy === 'mainline'}
            onClick={async () => {
              await generateMainline();
              setView('graph');
            }}
          >
            {busy === 'mainline' ? <Spinner /> : <Wand2 size={17} />}
            {busy === 'mainline' ? 'AI 正在通读材料并规划主线…' : '让 AI 基于全部材料生成学习主线'}
          </button>
          <div className="text-[11px] text-ink-500 text-center mt-2">
            会先删除当前知识库中已有的主线与支线，重新规划
          </div>
        </div>
      </div>
    </div>
  );
}
