import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import clsx from 'clsx';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-2xl',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className={clsx(
          'w-full card shadow-2xl animate-fade-in max-h-[92vh] flex flex-col rounded-b-none sm:rounded-b-xl',
          width,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700/70 shrink-0">
          <h3 className="font-semibold text-white">{title}</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-center px-6 py-12 gap-2">
      {icon && <div className="text-ink-500 mb-1">{icon}</div>}
      <div className="text-ink-200 font-medium">{title}</div>
      {desc && <div className="text-sm text-ink-400 max-w-sm leading-relaxed">{desc}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function StatusDot({ status }: { status: 'todo' | 'learning' | 'done' }) {
  const map = {
    todo: 'bg-ink-500',
    learning: 'bg-amber-400',
    done: 'bg-accent-500',
  } as const;
  return <span className={clsx('inline-block h-2 w-2 rounded-full', map[status])} />;
}
