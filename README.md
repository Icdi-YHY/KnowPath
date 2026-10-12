# 知径 KnowPath

> AI 知识主线学习工具：把一堆材料变成一条「从零到掌握」的主线，在任意卡点开枝散叶，并用知识图谱把一切连起来。

Windows / Ubuntu / Android 三端通用（同一套代码）。

---

## 核心概念

| 概念 | 说明 |
| --- | --- |
| **知识库** | 一个「知识文件夹」。把你所有学习材料（笔记 / 教程 / 文章）以文本形式放进去。 |
| **主线** | AI 通读全部材料后，规划出的**有严格先后顺序**的知识点序列，第一个一定是最基础的入门概念。 |
| **支线** | 学到某处不懂时，针对这个具体疑问单独开一条支线，AI 从零讲透。支线还能再开支线，无限嵌套。 |
| **跨线连接** | 支线生成后，AI 会自动判断它与主线上哪些知识点存在关联，画一条虚线连过去。 |
| **沉浸对话** | 每个知识点都有独立对话上下文，AI 知道整库、知道你正处在主线的哪一步。 |

## 三个视图

1. **知识库**：添加 / 上传 / 编辑材料，一键生成主线。
2. **图谱**：思维导图式全局视图。主线横向排列，支线向下生长，跨线关联以青色虚线呈现。节点可拖动、自动排版、点击查看详情。
3. **对话**：沉浸式学习。输入框左侧的 ✨ 按钮切换「支线模式」，把你的疑问变成一条永久支线。

---

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发模式，默认 http://localhost:5173
npm run build      # 生产构建，产物在 dist/
npm run preview    # 本地预览构建产物
```

> 首次打开会自动弹出设置，填入 AI 接口信息即可。**没有 Key 也能先用「先看示例」体验完整交互。**

## 配置 AI

支持任意 **OpenAI 兼容** 接口，在「设置 → AI 模型」中填写：

| 服务 | Base URL | 模型示例 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` |

密钥只保存在你本机浏览器的 IndexedDB，不会上传到任何第三方服务器。

---

## 三端使用与打包

### 方式一：PWA（零成本，推荐先这样用）

已内置 Service Worker 与 Web App Manifest。

- **Windows / Ubuntu**：用 Chrome / Edge 打开 → 地址栏右侧「安装」图标，即可变成独立桌面应用、可离线。
- **Android**：用 Chrome 打开 → 菜单「添加到主屏幕」，即可像原生 App 一样全屏运行、可离线。

> 局域网内让手机访问：`npm run dev` 已开启 `--host`，手机浏览器打开终端里显示的 `Network` 地址即可。

### 方式二：套壳成原生安装包（后续进阶）

核心 UI 代码完全复用，只需加壳：

**桌面（Windows / Ubuntu）—— Tauri**
```bash
# 前置：安装 Rust，Windows 需 WebView2（Win11 自带），Ubuntu 需 webkit2gtk
npm i -D @tauri-apps/cli
npx tauri init      # 前端产物目录填 ../dist，开发地址填 http://localhost:5173
npx tauri build     # 产出 .msi/.exe 与 .deb/.AppImage
```

**Android —— Capacitor**
```bash
# 前置：安装 Android Studio / SDK
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init "知径" com.knowpath.app --web-dir=dist
npm run build && npx cap add android && npx cap sync
npx cap open android   # 在 Android Studio 中打包 APK
```

---

## 数据与备份

- 全部数据存于本机 IndexedDB（知识库、节点、连线、对话记录）。
- 「设置 → 数据」可把当前知识库导出为 `.knowpath.json`，在另一台设备的同一入口导入，实现跨设备迁移。

## 技术栈

React 18 · TypeScript · Vite · Tailwind CSS · Zustand · Dexie(IndexedDB) · React Flow(@xyflow/react) · react-markdown

PWA 部分为手写实现（`public/sw.js` + `public/manifest.webmanifest`），不依赖 workbox，构建更可靠。

## 目录结构

```
electron/
  main.cjs          # 桌面主进程（窗口、单实例、外链外开）
  static-server.cjs # 本地静态服务器（可独立测试，含防目录穿越与 SPA 回退）
scripts/
  gen-icons.mjs     # 离线生成 PWA 图标与 Windows .ico（无第三方依赖）
src/
  components/      # UI：侧栏 / 知识库 / 图谱 / 对话 / 设置
  services/
    ai.ts          # OpenAI 兼容调用、SSE 流式、主线生成、关联分析
    prompts.ts     # 所有提示词
    layout.ts      # 主线 + 支线的思维导图自动布局算法
  store/useStore.ts# 全局状态与所有业务动作
  db/db.ts         # IndexedDB 持久化
  types.ts         # 数据模型
```
