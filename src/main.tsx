import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 注册离线 Service Worker（仅 Web 生产构建；开发环境与 Electron 内不注册）
// 用相对路径，才能同时适配根路径与 GitHub Pages 那样的子路径部署
const isElectron = /electron/i.test(navigator.userAgent);
if (import.meta.env.PROD && !isElectron && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 离线能力不可用时静默降级（例如通过非 localhost 的 http 访问） */
    });
  });
}
