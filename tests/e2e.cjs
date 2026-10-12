/* 知径 KnowPath · 端到端回归测试
 *
 * 覆盖：生成主线 / 支线与跨线关联 / 重新生成主线保留劳动成果 / 删除子树 /
 *       增量合并 / 对话 / 刷新持久化 / 面板布局 / 多知识库 / 窄屏 / 嵌套支线 /
 *       状态切换 / 删除知识库，共 47 项断言。
 *
 * 需要两个前置条件：
 *   1) 应用已构建并正在提供服务：npm run build && PORT=8081 npm run serve
 *   2) 模拟 AI 服务在跑：node tests/mock-ai.cjs
 * 另需安装 playwright（仅测试用，未放进 package.json 以免拖累正常安装）：
 *   npm i -D @playwright/cli
 *
 * 用法：BASE=http://localhost:8081/ MOCK_URL=http://127.0.0.1:4599/v1 npm run test:e2e
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8081/';
const MOCK_URL = process.env.MOCK_URL || 'http://127.0.0.1:4599/v1';
let pass = 0;
let fail = 0;
const failures = [];
const consoleErrors = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail += 1;
    failures.push(detail ? `${name} — ${detail}` : name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dbState(page) {
  return page.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open('knowpath');
      q.onsuccess = () => r(q.result);
    });
    const g = (t) =>
      new Promise((r) => {
        const q = db.transaction(t, 'readonly').objectStore(t).getAll();
        q.onsuccess = () => r(q.result);
      });
    const nodes = await g('nodes');
    const links = await g('crossLinks');
    const kbs = await g('kbs');
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    return {
      kbs: kbs.map((k) => ({ id: k.id, name: k.name, docs: k.docs.length })),
      nodes: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        kind: n.kind,
        parent: n.parentId ? (byId[n.parentId] || {}).title || '?' : null,
      })),
      links: links.map((l) => ({
        from: (byId[l.sourceId] || {}).title || '丢失',
        to: (byId[l.targetId] || {}).title || '丢失',
        reason: l.reason,
      })),
    };
  });
}

const dom = (page) =>
  page.evaluate(() => ({
    flowNodes: document.querySelectorAll('.react-flow__node').length,
    edges: document.querySelectorAll('.react-flow__edge').length,
    sidebarRows: document.querySelectorAll('div[style*=padding-left]').length,
    sidebarText: [...document.querySelectorAll('div[style*=padding-left]')].map((r) =>
      r.innerText.replace(/\n/g, ' ').trim(),
    ),
    toasts: [...document.querySelectorAll('.fixed.bottom-4 div')].map((d) => d.textContent.slice(0, 100)),
  }));

async function ensureSettings(page) {
  const opened = await page
    .locator('input[type=password]')
    .isVisible()
    .catch(() => false);
  if (!opened) {
    await page.getByTitle('设置').click();
    await sleep(900);
  }
  await page.getByPlaceholder('https://api.deepseek.com/v1').fill(MOCK_URL);
  await page.getByPlaceholder('sk-...').fill('test-key');
  await page.getByPlaceholder('deepseek-chat').fill('mock-model');
  await sleep(700);
  await page.getByRole('button', { name: '关闭' }).first().click();
  await sleep(600);
}

async function addDoc(page, title, body) {
  await page.getByPlaceholder('材料标题，例如：第三章 函数与闭包').fill(title);
  await page.getByPlaceholder('把内容粘贴到这里…（Markdown / 纯文本均可）').fill(body);
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await sleep(1200);
}

async function gotoView(page, name) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await sleep(1000);
}

async function makeBranch(page, question) {
  await gotoView(page, '对话');
  await page.getByTitle('开一条支线').click();
  await sleep(600);
  await page.getByPlaceholder('描述你卡住的地方…').fill(question);
  await page.getByTitle('发送').click();
  await sleep(9000);
}

const setMode = (m) =>
  fetch(`${MOCK_URL.replace(/\/v1\/?$/, '')}/set?mode=${m}`).then((r) => r.json());

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => {
    // [knowpath] 开头是应用自己的诊断日志（S13 故意模拟解析失败来触发），不算缺陷
    if (m.type() === 'error' && !m.text().includes('[knowpath]')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('dialog', (dlg) => dlg.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(2500);
  // 干净起点
  await page.evaluate(() => indexedDB.deleteDatabase('knowpath'));
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(2500);

  /* ---------------- S1 初始化 + 生成主线 ---------------- */
  console.log('\n[S1] 初始化与生成主线');
  await ensureSettings(page);
  await page.getByRole('button', { name: '新建知识库' }).first().click();
  await sleep(1300);
  await addDoc(page, 'HTTP 基础', 'HTTP 是浏览器和服务器通信的协议。');
  await page.getByRole('button', { name: /生成学习主线/ }).click();
  await sleep(7000);
  let st = await dbState(page);
  let d = await dom(page);
  check('生成 7 条主线', st.nodes.filter((n) => n.kind === 'main').length === 7, `实际 ${st.nodes.length}`);
  check('图谱渲染 7 节点', d.flowNodes === 7, `实际 ${d.flowNodes}`);
  check('图谱渲染 6 条结构线', d.edges === 6, `实际 ${d.edges}`);
  check('侧栏 7 行', d.sidebarRows === 7, `实际 ${d.sidebarRows}`);
  check('无报错提示条', d.toasts.length === 0, JSON.stringify(d.toasts));

  /* ---------------- S2 支线 + 跨线关联 ---------------- */
  console.log('\n[S2] 开支线（含跨线关联）');
  await page.getByText('1.什么是 Web 与浏览器').first().click();
  await sleep(900);
  await gotoView(page, '对话');
  await page.getByTitle('开一条支线').click();
  await sleep(500);
  await page.getByPlaceholder('描述你卡住的地方…').fill('为什么要区分请求方法？');
  await page.getByTitle('发送').click();
  await sleep(8000);
  st = await dbState(page);
  const branch = st.nodes.find((n) => n.kind === 'branch');
  check('支线已创建', !!branch, JSON.stringify(st.nodes.map((n) => n.kind)));
  check('支线挂在选中节点下', branch && branch.parent === '什么是 Web 与浏览器', branch && branch.parent);
  check('生成 1 条跨线关联', st.links.length === 1, JSON.stringify(st.links));
  check(
    '关联指向正确节点（非归属）',
    st.links[0] && st.links[0].from === 'GET 与 POST 的本质区别' && st.links[0].to === 'HTTP 方法与状态码',
    JSON.stringify(st.links[0]),
  );
  await gotoView(page, '图谱');
  await sleep(2500);
  d = await dom(page);
  check('图谱含支线节点', d.flowNodes === 8, `实际 ${d.flowNodes}`);
  check('图谱含跨线虚线', d.edges === 8, `实际 ${d.edges}`);

  /* ---------------- S3 重新生成主线必须保住支线与关联 ---------------- */
  console.log('\n[S3] 重新生成主线（关键：不能丢支线与连接线）');
  await page.getByRole('button', { name: /重新生成主线/ }).click();
  await sleep(8000);
  st = await dbState(page);
  d = await dom(page);
  const branchAfter = st.nodes.find((n) => n.kind === 'branch');
  check('支线仍在', !!branchAfter, JSON.stringify(st.nodes.map((n) => n.kind)));
  check('连接线仍在', st.links.length === 1, JSON.stringify(st.links));
  check(
    '连接线目标未变（目标知识点仍在）',
    st.links[0] && st.links[0].to === 'HTTP 方法与状态码',
    JSON.stringify(st.links[0]),
  );
  const mainsAfter = st.nodes.filter((n) => n.kind === 'main').length;
  check('主线已换成新一轮（5 条）', mainsAfter === 5, `实际 ${mainsAfter}`);
  check(
    '支线重挂到新主线开头（原归属已不存在）',
    branchAfter && branchAfter.parent === 'URL 的组成',
    branchAfter && branchAfter.parent,
  );
  check('图谱节点数 = 主线5 + 支线1', d.flowNodes === 6, `实际 ${d.flowNodes}`);
  check('给出保留提示', d.toasts.some((t) => /保留/.test(t)), JSON.stringify(d.toasts));

  /* ---------------- S4 删除节点（含子树） ---------------- */
  console.log('\n[S4] 删除节点与子树');
  const before = (await dbState(page)).nodes.length;
  await page.locator('.react-flow__node').filter({ hasText: 'HTTP 请求与响应' }).first().click();
  await sleep(1200);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await sleep(1800);
  st = await dbState(page);
  // 「HTTP 请求与响应」带着 3 个子孙（HTTP 方法与状态码 / 状态码的五大类 / 无状态与 Cookie）
  check('子树一并删除', st.nodes.length === before - 4, `${before} → ${st.nodes.length}`);
  check(
    '跨线关联未指向已删除节点',
    st.links.every((l) => l.from !== '丢失' && l.to !== '丢失'),
    JSON.stringify(st.links),
  );
  check(
    '关联线已随目标删除而清理',
    st.links.length === 0,
    JSON.stringify(st.links),
  );

  /* ---------------- S5 增量导入 → 合并 ---------------- */
  console.log('\n[S5] 增量导入与合并');
  await gotoView(page, '知识库');
  await addDoc(page, 'HTTP 版本演进', 'HTTP/1.1 到 HTTP/3 的演进。');
  await sleep(7000);
  const panelShown = await page
    .getByRole('button', { name: '合并', exact: true })
    .isVisible()
    .catch(() => false);
  check('弹出待合并面板', panelShown);
  if (panelShown) {
    await page.getByRole('button', { name: '合并', exact: true }).click();
    await sleep(5000);
    st = await dbState(page);
    d = await dom(page);
    check('新增资料节点', st.nodes.some((n) => n.kind === 'source'), JSON.stringify(st.nodes.map((n) => n.kind)));
    check('新增知识点 HTTP/2 多路复用', st.nodes.some((n) => n.title === 'HTTP/2 多路复用'));
    check('合并后无报错提示条', !d.toasts.some((t) => /失败|错误/.test(t)), JSON.stringify(d.toasts));
  }

  /* ---------------- S6 对话 ---------------- */
  console.log('\n[S6] 沉浸对话');
  await gotoView(page, '对话');
  const hasInput = await page
    .getByPlaceholder('问点什么，例如：这里为什么要这样做？')
    .isVisible()
    .catch(() => false);
  check('对话输入框存在', hasInput);
  if (hasInput) {
    const bubbleBefore = await page.locator('[class*=rounded-2xl]').count();
    await page.getByPlaceholder('问点什么，例如：这里为什么要这样做？').fill('这里为什么要这样设计？');
    await page.getByTitle('发送').click();
    await sleep(6000);
    const bubbleAfter = await page.locator('[class*=rounded-2xl]').count();
    check('产生新的对话气泡', bubbleAfter > bubbleBefore, `${bubbleBefore} → ${bubbleAfter}`);
  }

  /* ---------------- S7 刷新持久化 ---------------- */
  console.log('\n[S7] 刷新后数据持久化');
  const beforeReload = await dbState(page);
  await page.reload({ waitUntil: 'load' });
  await sleep(4000);
  const afterReload = await dbState(page);
  d = await dom(page);
  check('节点数一致', afterReload.nodes.length === beforeReload.nodes.length, `${beforeReload.nodes.length} → ${afterReload.nodes.length}`);
  check('关联线一致', afterReload.links.length === beforeReload.links.length);
  check('刷新后图谱有渲染或被正确切换视图', d.flowNodes > 0 || d.sidebarRows > 0, JSON.stringify({ flowNodes: d.flowNodes, rows: d.sidebarRows }));

  /* ---------------- S8 面板不遮挡画布 ---------------- */
  console.log('\n[S8] 详情面板不与画布重叠');
  await gotoView(page, '图谱');
  await sleep(2500);
  await page.locator('.react-flow__node').first().click();
  await sleep(1500);
  const geo = await page.evaluate(() => {
    const canvas = document.querySelector('.react-flow').getBoundingClientRect();
    const panelEl = document.querySelector('div[class*="w-[420px]"]');
    const panel = panelEl ? panelEl.getBoundingClientRect() : null;
    const outside = [...document.querySelectorAll('.react-flow__node')].filter(
      (n) => n.getBoundingClientRect().right > canvas.right + 1,
    ).length;
    return { canvasRight: Math.round(canvas.right), panelLeft: panel ? Math.round(panel.left) : null, outside };
  });
  check('面板在画布右侧之外', geo.panelLeft !== null && geo.panelLeft >= geo.canvasRight - 1, JSON.stringify(geo));
  check('没有节点被挤出画布', geo.outside === 0, JSON.stringify(geo));

  /* ---------------- S9 多知识库切换 ---------------- */
  console.log('\n[S9] 多知识库切换');
  await gotoView(page, '知识库');
  // 记下当前知识库的状态，供 S11 切回来后比对
  const kb1State = await dbState(page);
  const kb1Id = (await page.evaluate(() => document.querySelector('select')?.value)) || null;
  const kbBefore = kb1State.kbs.length;
  await page.getByTitle('新建知识库').first().click();
  await sleep(1800);
  st = await dbState(page);
  check('新建知识库成功', st.kbs.length === kbBefore + 1, `${kbBefore} → ${st.kbs.length}`);
  d = await dom(page);
  check('新库没有节点（图谱为空态）', d.flowNodes === 0, `实际 ${d.flowNodes}`);

  /* ---------------- S10 窄屏布局 ---------------- */
  console.log('\n[S10] 窄屏（手机）布局');
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1500);
  const mobile = await page.evaluate(() => {
    const p = document.querySelector('div[class*="w-[420px]"]');
    const rect = p ? p.getBoundingClientRect() : null;
    return {
      hasPanel: !!p,
      panelCoversFullWidth: rect ? rect.width >= window.innerWidth - 1 : null,
      panelAtBottom: rect ? rect.bottom >= window.innerHeight - 1 : null,
      docScrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
    };
  });
  check('窄屏无横向溢出', mobile.docScrollW <= mobile.winW + 1, JSON.stringify(mobile));
  await page.setViewportSize({ width: 1280, height: 800 });
  await sleep(800);

  /* ---------------- S11 切回已有知识库 ---------------- */
  console.log('\n[S11] 切回已有知识库');
  await page.locator('select').first().selectOption(kb1Id);
  await sleep(3500);
  st = await dbState(page);
  d = await dom(page);
  check('切回后节点已恢复', st.nodes.length === kb1State.nodes.length, `${kb1State.nodes.length} → ${st.nodes.length}`);
  check('切回后关联线一致', st.links.length === kb1State.links.length, `${kb1State.links.length} → ${st.links.length}`);
  check('切回后侧栏有节点行', d.sidebarRows === kb1State.nodes.length, `实际 ${d.sidebarRows}`);

  const linksBefore = st.links.length;
  const branchesBefore = st.nodes.filter((n) => n.kind === 'branch').length;

  /* ---------------- S12 关联只命中归属节点 → 不该画重复虚线 ---------------- */
  console.log('\n[S12] 关联只命中归属知识点时应剔除');
  await setMode('parent');
  await gotoView(page, '图谱');
  await sleep(2500);
  await page.locator('.react-flow__node').first().click();
  await sleep(1300);
  await makeBranch(page, '归属节点测试');
  st = await dbState(page);
  d = await dom(page);
  check('支线仍创建成功', st.nodes.filter((n) => n.kind === 'branch').length === branchesBefore + 1);
  check('未新增重复虚线', st.links.length === linksBefore, `${linksBefore} → ${st.links.length}`);
  check(
    '给出「没有关联」的说明',
    d.toasts.some((t) => /未发现|没有虚线/.test(t)),
    JSON.stringify(d.toasts),
  );

  /* ---------------- S13 解析失败 → 明确提示 ---------------- */
  console.log('\n[S13] 关联分析解析失败时给出提示');
  await setMode('badjson');
  await gotoView(page, '图谱');
  await sleep(2500);
  await page.locator('.react-flow__node').first().click();
  await sleep(1300);
  await makeBranch(page, '解析失败测试');
  st = await dbState(page);
  d = await dom(page);
  check('支线仍创建成功', st.nodes.filter((n) => n.kind === 'branch').length === branchesBefore + 2);
  check(
    '提示了关联分析失败原因',
    d.toasts.some((t) => /关联分析失败/.test(t)),
    JSON.stringify(d.toasts),
  );

  /* ---------------- S14 嵌套支线 ---------------- */
  console.log('\n[S14] 在支线下面再开支线');
  await setMode('ok');
  await gotoView(page, '图谱');
  await sleep(2200);
  const aBranch = st.nodes.find((n) => n.kind === 'branch');
  await page.locator('.react-flow__node').filter({ hasText: aBranch.title }).first().click();
  await sleep(1200);
  await makeBranch(page, '嵌套支线测试');
  st = await dbState(page);
  const branchParents = st.nodes
    .filter((n) => n.kind === 'branch')
    .map((n) => ({ self: n.title, parent: n.parent }));
  check(
    '嵌套支线的归属是支线',
    branchParents.some((b) => branchParents.some((x) => x.self === b.parent)),
    JSON.stringify(branchParents),
  );

  /* ---------------- S15 节点学习状态切换 ---------------- */
  console.log('\n[S15] 节点学习状态切换');
  await gotoView(page, '图谱');
  await sleep(2200);
  await page.locator('.react-flow__node').first().click();
  await sleep(1300);
  await page.getByRole('button', { name: '未开始' }).click();
  await sleep(1300);
  check('状态切到「学习中」', await page.evaluate(() => document.body.innerText.includes('学习中')));

  /* ---------------- S16 删除知识库 ---------------- */
  console.log('\n[S16] 删除知识库');
  const kbCount = (await dbState(page)).kbs.length;
  await page.getByRole('button', { name: '删除当前知识库' }).click();
  await sleep(1800);
  st = await dbState(page);
  check('知识库已删除', st.kbs.length < kbCount, `${kbCount} → ${st.kbs.length}`);
  check('删除后无报错', !(await dom(page)).toasts.some((t) => /失败|错误/.test(t)));

  /* ---------------- 收尾 ---------------- */
  console.log('\n[控制台]');
  if (consoleErrors.length) {
    console.log(`  \x1b[31m✗ 控制台错误 ${consoleErrors.length} 条\x1b[0m`);
    consoleErrors.slice(0, 8).forEach((e) => console.log('    · ' + e.slice(0, 150)));
    fail += 1;
    failures.push(`控制台错误 ${consoleErrors.length} 条`);
  } else {
    console.log('  \x1b[32m✓ 控制台无错误\x1b[0m');
  }

  await browser.close();

  console.log(`\n================ 结果 ================`);
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error('\n测试脚本异常：', e);
  process.exit(2);
});
