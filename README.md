# 知径 KnowPath

> AI 知识主线学习工具：把一堆材料变成一条「从零到掌握」的主线，在任意卡点开枝散叶，并用知识图谱把一切连起来。

Windows / Ubuntu / Android 三端通用（同一套代码）。

---

## 核心概念

| 概念 | 说明 |
| --- | --- |
| **知识库** | 一个「知识文件夹」。把你所有学习材料（笔记 / 教程 / 文章）以文本形式放进去。 |
| **主线脉络** | AI 通读全部材料后规划的**树形**学习脉络。多数节点只有一个后继（呈现为一条推进的直线），在需要往并列方向展开的地方会自然分叉。 |
| **支线** | 学到某处不懂时，针对这个具体疑问单独开一条支线，AI 从零讲透。支线还能再开支线，无限嵌套。 |
| **资料节点** | 增量导入的材料在图谱中的落点，用虚线关联到它支撑的知识点。 |
| **跨线连接** | AI 自动判断节点之间的知识关联，画一条虚线连过去。 |
| **沉浸对话** | 每个知识点都有独立对话上下文，AI 知道整库、知道你正处在脉络的哪一步。 |

## 三个视图

1. **知识库**：添加 / 上传 / 编辑材料，生成主线脉络；往已有主线的库里加材料会走**增量合并**（见下）。
2. **图谱**：思维导图式全局视图。主线从左到右推进、需要分叉处向下展开，支线挂在所属节点下，关联以虚线呈现。节点可拖动、自动排版、点击查看详情。顶部的面包屑显示当前节点在脉络中的位置。
3. **对话**：沉浸式学习。输入框左侧的 ✨ 按钮切换「支线模式」，把你的疑问变成一条永久支线。

## 增量导入与合并

**已经有主线的知识库再导入新材料时，不会重建主线。**

导入完成后 AI 会做一次增量分析，然后在图谱顶部弹出待确认面板，列出：

- **关联到的已有知识点**（最多 4 个，带关联原因）
- **建议新增的知识点**（最多 3 个，并指明挂在哪个知识点下面）

点 **合并** 之后才会真正生效：

- 建立一个**资料节点**，用虚线连到相关的知识点
- 把建议的新知识点插入脉络（编号会自动重排）
- 材料本身继续作为 AI 上下文，一直都在起作用

点 **忽略** 则丢弃建议，材料仍保留在知识库里。想整体重排脉络，再手动点「重新规划主线脉络」（会清空现有脉络与支线）。

---

## 支持的资料格式

| 格式 | 处理方式 | 可靠性 |
| --- | --- | --- |
| `.txt` `.md` `.json` `.csv` `.log` 等文本 | 直接读取，自动识别 UTF-8 / GB18030 | ✅ 完全准确 |
| `.pptx` | 解包读每页文字 + 演讲者备注 | ✅ 完全准确 |
| `.docx` | 解包读段落与表格（单元格用 `\|` 分隔） | ✅ 完全准确 |
| `.xlsx` | 解析共享字符串与单元格 | ✅ 完全准确 |
| `.pdf`（有文字层） | pdf.js 逐页提取 | ✅ 完全准确 |
| `.png` `.jpg` `.webp` 等图片 | **调用视觉模型 OCR** | ⚠️ 取决于模型 |
| `.pdf`（扫描件，无文字层） | 渲染成图后 **调用视觉模型 OCR** | ⚠️ 取决于模型 |
| `.ppt` `.doc`（97-2003 老格式） | 尽力提取文本 | ⚠️ 可能夹杂乱码，建议另存为新格式 |

**图片与扫描件必须用支持视觉的模型**：`gpt-4o` / `qwen-vl-max` / `glm-4v` / `moonshot-v1-8k-vision-preview` 等。
**DeepSeek 系列不支持图片输入**，用它导入图片会直接给出明确报错。

其他说明：

- 单文件上限 **50MB**，超出会在「导入结果」里明确提示，不会静默忽略。
- 支持多选与**拖拽导入**，每个文件单独显示解析进度与结果。
- 解析在**导入时完成**，知识库里只存纯文本 —— 因此体积小、后续组装上下文快。
- `.xls`（老式 Excel）不支持，请另存为 `.xlsx` 后导入。
- 内容仍受「知识库注入上限」限制（默认 12000 字符），大文件可在设置里调大，或按章节拆成多个知识库。

---

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发模式，默认 http://localhost:5173
npm run web        # 部署到自己主机：构建 + 启动，默认 http://localhost:8080
npm run build      # 只做生产构建，产物在 dist/
npm run serve      # 启动静态服务器托管 dist/（默认 8080）
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

### 方式一：部署到自己主机（网页版，推荐）

```bash
npm install
npm run web          # = 构建 + 启动服务器，默认 http://localhost:8080
```

也可分开执行：

```bash
npm run build        # 构建到 dist/
npm run serve        # 托管 dist/，默认 8080
PORT=9000 npm run serve      # 换端口
HOST=127.0.0.1 npm run serve # 只允许本机访问
```

启动后终端会列出可访问地址：

- **本机**：`http://localhost:8080/`
- **局域网**（手机同一 WiFi 可直接打开）：`http://192.168.x.x:8080/`

> 注意：只有 `localhost` 属于浏览器认可的「安全上下文」，Service Worker 才会生效，可**安装为 PWA 并离线使用**。
> 用局域网 IP 访问时 SW 不会注册 —— **功能完全正常，只是没有离线与安装能力**。

### 方式二：安装成 PWA

在 Chrome / Edge 打开上面的地址：

- **Windows / Ubuntu**：地址栏右侧「安装」图标 → 变成独立桌面应用，可离线。
- **Android**：菜单「添加到主屏幕」→ 全屏运行，可离线。

### 方式三：桌面原生程序（Electron）

`electron/main.cjs` 为主进程，生产环境用内置的本地静态服务器托管 `dist/`，
让渲染进程处于正常的 `http://127.0.0.1` 源，与网页版的网络 / CORS 行为完全一致。

```bash
npm run dist:win             # Windows 便携包 → release/KnowPath-0.1.0-win-x64.zip
npm run dist:win:installer   # Windows NSIS 安装包（需在 Windows 上执行）
npm run electron:dev         # 本地调试桌面端（需先 npm run dev）
```

### 方式四：Android（Capacitor，后续进阶）

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

## 回归测试

项目自带一套端到端回归测试，用一个本地模拟 AI 服务把全部流程跑一遍（47 项断言），
不需要真实 API Key，也不会产生任何费用。

```bash
npm i -D @playwright/cli          # 仅测试需要，未写进 package.json 以免拖累正常安装
npm run build
PORT=8081 npm run serve           # 终端 A
npm run test:mock                 # 终端 B：模拟 AI 服务（127.0.0.1:4599）
npm run test:e2e                  # 终端 C：跑测试，输出逐项结果
```

覆盖范围：生成主线 / 支线与跨线关联 / **重新生成主线时保留支线与连接线** /
删除节点与子树 / 增量导入合并 / 沉浸对话 / 刷新后持久化 / 详情面板布局 /
多知识库切换 / 窄屏布局 / 嵌套支线 / 学习状态切换 / 删除知识库。

模拟服务支持切换关联分析的各种返回形态（正常 / 空结果 / 解析失败 / 只返回归属节点），
用来验证分支逻辑；测试脚本会顺带收集浏览器控制台错误并在有错误时判定失败。

## 技术栈

React 18 · TypeScript · Vite · Tailwind CSS · Zustand · Dexie(IndexedDB) · React Flow(@xyflow/react) · react-markdown

PWA 部分为手写实现（`public/sw.js` + `public/manifest.webmanifest`），不依赖 workbox，构建更可靠。

## 目录结构

```
electron/
  main.cjs          # 桌面主进程（窗口、单实例、外链外开）
  static-server.cjs # 静态服务器（可独立测试，含防目录穿越与 SPA 回退）
scripts/
  serve.cjs         # 自建部署入口：托管 dist/，默认 0.0.0.0:8080
  gen-icons.mjs     # 离线生成 PWA 图标与 Windows .ico（无第三方依赖）
tests/
  mock-ai.cjs       # 本地模拟 OpenAI 兼容服务（无需真实 Key）
  e2e.cjs           # 端到端回归测试
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
