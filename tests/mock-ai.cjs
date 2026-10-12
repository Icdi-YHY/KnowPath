/* 本地模拟 OpenAI 兼容服务（临时测试用） */
const http = require('node:http');

let mode = 'ok';
const stats = { requests: 0, byKind: {} };
const PORT = Number(process.env.MOCK_PORT || 4599);

/** 第二轮生成主线时换一套标题，用来验证「重新生成」是否会保住支线 */
let mainlineRound = 0;

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

const allText = (body, role) =>
  (body.messages || [])
    .filter((m) => m.role === role)
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join(' ');

function classify(body) {
  const sys = allText(body, 'system');
  const user = allText(body, 'user');
  if (sys.includes('知识脉络整合助手')) return 'merge';
  if (sys.includes('为学生设计一条')) return 'mainline';
  if (sys.includes('单独展开一条支线')) return 'branch';
  if (sys.includes('知识关联分析器')) return 'crosslink';
  if (user.includes('从零开始完整讲解')) return 'explain';
  return 'chat';
}

const n = (title, summary, children = []) => ({
  title,
  summary,
  content: `## ${title}\n\n${summary}。这是一段足够长的正文，用于通过内容长度校验，避免被判定为输出截断。`,
  children,
});

/** 第一轮主线 */
const ROUND_1 = {
  title: 'HTTP 与 Web 基础 · 学习脉络',
  nodes: [
    n('什么是 Web 与浏览器', '理解浏览器如何渲染网页', [
      n('URL 的组成', '看懂一个网址的每个部分', [
        n('HTTP 请求与响应', '掌握一次完整交互的结构', [
          n('HTTP 方法与状态码', '分清各类方法的用途', [
            n('状态码的五大类', '理解 2xx 到 5xx'),
            n('请求头与响应头', '看懂首部字段的作用'),
          ]),
          n('无状态与 Cookie', '登录状态如何维持'),
        ]),
      ]),
    ]),
  ],
};

/**
 * 第二轮主线：标题全部换过（原来的「什么是 Web 与浏览器」没了），
 * 但保留「HTTP 方法与状态码」—— 用来验证跨线关联的目标还在时能被保住。
 */
const ROUND_2 = {
  title: 'HTTP 与 Web 基础（重排）· 学习脉络',
  nodes: [
    n('URL 的组成', '看懂一个网址的每个部分', [
      n('HTTP 请求与响应', '掌握一次完整交互的结构', [
        n('HTTP 方法与状态码', '分清各类方法的用途', [
          n('状态码的五大类', '理解 2xx 到 5xx'),
          n('无状态与 Cookie', '登录状态如何维持'),
        ]),
      ]),
    ]),
  ],
};

const BRANCH = {
  title: 'GET 与 POST 的本质区别',
  summary: '为什么 GET 幂等而 POST 不幂等',
  content:
    '## GET 与 POST\n\nGET 用来「取」，幂等；POST 用来「交」，不幂等。这段正文足够长，可以通过内容长度校验，不会被误判为输出被截断。',
};

function crossLinkPayload() {
  switch (mode) {
    case 'empty':
      return JSON.stringify({ links: [] });
    case 'badjson':
      return '抱歉，我无法完成这个关联分析任务。';
    case 'parent':
      // 只返回支线的归属节点 → 应被剔除（会与实线重复），最终没有虚线
      return JSON.stringify({ links: [{ title: '什么是 Web 与浏览器', reason: '归属节点' }] });
    default:
      // 返回一个「非归属」的知识点 → 应生成虚线
      return JSON.stringify({ links: [{ title: 'HTTP 方法与状态码', reason: '同属 HTTP 协议基础' }] });
  }
}

function handle(body, res) {
  const kind = classify(body);
  stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;

  let content;
  if (kind === 'mainline') {
    mainlineRound += 1;
    content = JSON.stringify(mainlineRound % 2 === 1 ? ROUND_1 : ROUND_2);
  } else if (kind === 'branch') content = JSON.stringify(BRANCH);
  else if (kind === 'crosslink') content = crossLinkPayload();
  else if (kind === 'merge') {
    content = JSON.stringify({
      source: { title: 'HTTP 版本演进补充材料', summary: 'HTTP/1.1 到 HTTP/3 的演进' },
      links: [{ index: 1, reason: '同属 HTTP 协议基础' }],
      newNodes: [
        {
          title: 'HTTP/2 多路复用',
          summary: '一个连接并发多个请求',
          parentIndex: 1,
          content: '## HTTP/2 多路复用\n\nHTTP/1.1 一个连接同时只能跑一个请求。这段正文足够长，可以通过内容长度校验。',
        },
      ],
    });
  } else if (kind === 'explain') content = '## 讲解\n\n**核心结论**：浏览器是你与互联网之间的翻译官。这段正文足够长。';
  else content = '好问题。**HTTP 之所以无状态，是为了让服务器可以水平扩展。**';

  if (!body.stream) {
    return json(res, 200, {
      id: 'mock',
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const chunks = content.match(/[\s\S]{1,16}/g) || [];
  let i = 0;
  const timer = setInterval(() => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: chunks[i++] } }] })}\n\n`);
      return;
    }
    clearInterval(timer);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }, 5);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      });
      return res.end();
    }
    if (url.pathname === '/set') {
      mode = url.searchParams.get('mode') || 'ok';
      if (url.searchParams.get('reset')) {
        mainlineRound = 0;
        stats.requests = 0;
        stats.byKind = {};
      }
      return json(res, 200, { mode, mainlineRound });
    }
    if (url.pathname === '/control') return json(res, 200, { mode, mainlineRound, stats });
    if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        stats.requests += 1;
        handle(body, res);
      });
      return;
    }
    json(res, 404, { error: { message: 'not found' } });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[mock] http://127.0.0.1:${PORT}/v1`));
