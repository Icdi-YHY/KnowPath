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
const isElectron = /electron/i.test(navigator.userAgent);
if (import.meta.env.PROD && !isElectron && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 离线能力不可用时静默降级 */
    });
  });
}
