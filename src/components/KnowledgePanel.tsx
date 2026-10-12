import { useRef, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
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
import { ocrImage } from '@/services/ai';
import { ACCEPT_ATTR, extractText, MAX_FILE_BYTES } from '@/services/parse';
import { EmptyState, Spinner } from './ui';

interface ImportItem {
  id: string;
  name: string;
  status: 'pending' | 'parsing' | 'ok' | 'error';
  message?: string;
}

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
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const runImport = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    const items: ImportItem[] = list.map((f, i) => ({
      id: `${i}-${f.name}-${f.size}`,
      name: f.name,
      status: 'pending',
    }));
    setImports(items);
    setImporting(true);

    // 图片 / 扫描件需要视觉模型；没配 Key 或模型不支持会给出明确提示
    const settings = useStore.getState().settings;
    const vision = settings.apiKey
      ? (dataUrl: string, hint?: string) => ocrImage(settings, dataUrl, hint)
      : undefined;

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const id = items[i].id;
      const patch = (p: Partial<ImportItem>) =>
        setImports((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

      if (file.size > MAX_FILE_BYTES) {
        patch({
          status: 'error',
          message: `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 ${Math.round(
            MAX_FILE_BYTES / 1024 / 1024,
          )}MB 上限，已跳过`,
        });
        continue;
      }

      patch({ status: 'parsing', message: '正在解析…' });
      try {
        const { text, warning } = await extractText(file, {
          vision,
          onProgress: (m) => patch({ message: m }),
        });
        await addDoc(file.name, text);
        patch({
          status: 'ok',
          message: warning ?? `已导入 ${text.length.toLocaleString()} 字`,
        });
      } catch (e) {
        patch({ status: 'error', message: (e as Error).message });
      }
    }
    setImporting(false);
  };

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
        <div
          className={clsx(
            'card p-4 mt-5 transition-colors',
            dragOver && 'border-brand-500 bg-brand-500/5',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            runImport(e.dataTransfer.files);
          }}
        >
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
            <button
              className="btn-ghost"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? <Spinner /> : <Upload size={15} />} 上传文件（可多选 / 可拖入）
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_ATTR}
              multiple
              hidden
              onChange={(e) => {
                runImport(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <div className="mt-2 text-[11.5px] leading-relaxed text-ink-500">
            支持 <b className="text-ink-300">PPTX / DOCX / XLSX / PDF / 图片 / txt·md</b> 等，
            单文件 ≤ {Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB。
            <br />
            图片与扫描件 PDF 需要「认字」，会调用<b className="text-ink-300">支持视觉的模型</b>
            （gpt-4o / qwen-vl-max / glm-4v 等）；DeepSeek 不支持图片。
            <br />
            <span className="text-amber-400/80">.ppt / .doc 是 97-2003 老格式，只能尽力提取，建议另存为新格式。</span>
          </div>
        </div>

        {/* 导入结果 */}
        {imports.length > 0 && (
          <div className="card mt-4 overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-ink-700/60">
              <span className="text-sm font-medium text-ink-100">导入结果</span>
              <span className="text-xs text-ink-500">
                {imports.filter((i) => i.status === 'ok').length}/{imports.length} 成功
              </span>
              <div className="flex-1" />
              {importing ? (
                <Spinner className="text-brand-400" />
              ) : (
                <button className="text-xs text-ink-400 hover:text-white" onClick={() => setImports([])}>
                  清空
                </button>
              )}
            </div>
            <div className="divide-y divide-ink-700/40">
              {imports.map((it) => (
                <div key={it.id} className="flex items-start gap-2 px-3.5 py-2">
                  {it.status === 'ok' ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-accent-500" />
                  ) : it.status === 'error' ? (
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
                  ) : (
                    <Spinner className="mt-0.5 shrink-0 text-ink-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink-100">{it.name}</div>
                    {it.message && (
                      <div
                        className={clsx(
                          'mt-0.5 text-[11.5px] leading-relaxed',
                          it.status === 'error' ? 'text-red-300' : 'text-ink-400',
                        )}
                      >
                        {it.message}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
