import { useRef, useState } from 'react';
import { Download, Upload, ExternalLink, KeyRound } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Modal } from './ui';

const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const exportKb = useStore((s) => s.exportKb);
  const importKb = useStore((s) => s.importKb);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'ai' | 'data'>('ai');

  return (
    <Modal open={open} title="设置" onClose={onClose}>
      <div className="flex gap-1 mb-4 rounded-lg bg-ink-900 p-1 w-fit">
        {(
          [
            ['ai', 'AI 模型'],
            ['data', '数据'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              tab === k ? 'bg-ink-700 text-white' : 'text-ink-300 hover:text-ink-100'
            }`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ai' ? (
        <div className="space-y-4">
          <p className="text-xs text-ink-400 leading-relaxed">
            支持任意 <b className="text-ink-200">OpenAI 兼容</b> 接口（DeepSeek / OpenAI / 通义 / Kimi /
            本地 Ollama 等）。密钥仅保存在你本机浏览器，不会上传到任何服务器。
          </p>

          <div>
            <label className="block text-xs text-ink-300 mb-1.5">快速预设</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  className="btn-ghost !py-1 !px-2.5 !text-xs"
                  onClick={() => updateSettings({ baseUrl: p.baseUrl, model: p.model })}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-ink-300 mb-1.5">API 地址 (Base URL)</label>
            <input
              className="input"
              value={settings.baseUrl}
              onChange={(e) => updateSettings({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-300 mb-1.5 flex items-center gap-1">
              <KeyRound size={12} /> API Key
            </label>
            <input
              className="input font-mono"
              type="password"
              value={settings.apiKey}
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-300 mb-1.5">模型名称</label>
              <input
                className="input"
                value={settings.model}
                onChange={(e) => updateSettings({ model: e.target.value })}
                placeholder="deepseek-chat"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-300 mb-1.5">
                温度 {settings.temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.temperature}
                onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
                className="w-full accent-brand-500 mt-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-300 mb-1.5">
                知识库注入上限（字符）
              </label>
              <input
                type="number"
                className="input"
                value={settings.contextChars}
                min={2000}
                max={200000}
                step={1000}
                onChange={(e) => updateSettings({ contextChars: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-300 mb-1.5">
                最大输出 token（0 = 不传）
              </label>
              <input
                type="number"
                className="input"
                value={settings.maxTokens}
                min={0}
                max={65536}
                step={512}
                onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="text-[11px] text-ink-500 leading-relaxed">
            生成主线要一次性输出多个知识点，建议最大输出 token 设为 <b className="text-ink-300">8192</b>。
            若出现「无法解析为 JSON」，多半就是输出被截断了。
          </p>

          <a
            className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline"
            href="https://platform.deepseek.com/api_keys"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={12} /> 去获取 DeepSeek API Key
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-ink-400 leading-relaxed">
            所有数据保存在本机浏览器的 IndexedDB 中。可导出为 JSON 备份，在其它设备导入。
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={exportKb}>
              <Download size={15} /> 导出当前知识库
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> 导入知识库
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                await importKb(await f.text());
                e.target.value = '';
                onClose();
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
