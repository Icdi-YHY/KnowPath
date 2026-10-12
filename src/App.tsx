import { useEffect, useState } from 'react';
import { AlertCircle, Menu, X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Sidebar } from '@/components/Sidebar';
import { KnowledgePanel } from '@/components/KnowledgePanel';
import { GraphView } from '@/components/GraphView';
import { ChatView } from '@/components/ChatView';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Spinner } from '@/components/ui';

export default function App() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const view = useStore((s) => s.view);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  // 首次进入若无 API Key，自动弹出设置
  useEffect(() => {
    if (ready && !useStore.getState().settings.apiKey && !useStore.getState().kbs.length) {
      setSettingsOpen(true);
    }
  }, [ready]);

  if (!ready) {
    return (
      <div className="h-full grid place-items-center text-ink-400">
        <div className="flex items-center gap-2 text-sm">
          <Spinner /> 正在加载…
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-ink-950">
      {/* 桌面侧边栏 */}
      <div className="hidden md:flex">
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      {/* 移动端抽屉 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="absolute left-0 top-0 bottom-0 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <Sidebar onClose={() => setSidebarOpen(false)} onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* 移动端顶栏 */}
        <div className="md:hidden flex items-center gap-3 px-3 py-2.5 border-b border-ink-700/70 shrink-0">
          <button className="btn-ghost !p-2" onClick={() => setSidebarOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="font-semibold text-white text-sm flex-1 truncate">
            知径 · {view === 'kb' ? '知识库' : view === 'graph' ? '知识图谱' : '沉浸对话'}
          </div>
        </div>

        <main className="flex-1 min-h-0 relative">
          {view === 'kb' && <KnowledgePanel />}
          {view === 'graph' && <GraphView />}
          {view === 'chat' && <ChatView />}
        </main>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] sm:max-w-lg animate-fade-in">
          <div className="flex items-start gap-2.5 rounded-xl bg-red-500/15 border border-red-500/40 backdrop-blur px-4 py-3 shadow-xl">
            <AlertCircle size={17} className="text-red-300 shrink-0 mt-0.5" />
            <div className="text-[13px] text-red-100 leading-relaxed flex-1 break-words">{error}</div>
            <button className="text-red-300 hover:text-white shrink-0" onClick={() => setError(null)}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
