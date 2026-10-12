import type { KnowledgeBase, ThreadNode } from '@/types';

/** 把知识库正文截断成一个可注入的上下文块 */
export function buildKbContext(kb: KnowledgeBase, maxChars: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const doc of kb.docs) {
    const text = doc.content.trim();
    if (!text) continue;
    const head = `\n\n## 文档：${doc.name}\n`;
    const remain = maxChars - used - head.length;
    if (remain <= 200) break;
    const slice = text.length > remain ? text.slice(0, remain) + '\n…（已截断）' : text;
    parts.push(head + slice);
    used += head.length + slice.length;
  }
  return parts.join('') || '（知识库暂无内容）';
}

const TUTOR_PERSONA = `你是一位极其擅长「从零讲清楚」的私人导师。你的教学对象是完全的初学者。
原则：
1. 永远从最基础的前置概念讲起，不假设对方已知任何专业名词；出现新名词必须先解释。
2. 用「类比 + 具体例子」讲抽象概念，例子要贴近生活。
3. 结构清晰：先给一句话结论，再分层展开，最后给一个「自检问题」帮助确认是否真的懂了。
4. 中文回答，Markdown 排版，善用标题、列表、代码块、表格。
5. 不要空泛，要具体、可验证、可操作。`;

/** 生成主线的系统提示 */
export function mainlineSystem(): string {
  return `${TUTOR_PERSONA}

你的任务：阅读用户提供的全部知识材料，为学生设计一条「从零到掌握」的**主线学习脉络**。

关于结构（很重要）：
- 这是一棵**树**，不是一条死板的直线。每个知识点通过 children 挂载它的后续知识点。
- 绝大多数知识点只有 **1 个** children，这样呈现出来就是一条自然推进的直线。
- 只有当材料里确实存在「先学完某个基础后，需要往几个**并列方向**分别展开」时，
  才给这个知识点挂 2~3 个 children 形成分叉。
- 分叉要克制：整棵脉络的分叉点不超过 2~3 处。**不要为了分叉而分叉**。
- 每个知识点都必须是它 children 的前置；同级 children 之间是并列关系。
- 第一个（数组第一个）必须是最基础、最没有门槛的入门概念。
- 知识点总数（含所有层级）控制在 8~14 个之间。

【输出格式（极其重要）】
- 只输出**一个 JSON 对象**，第一个字符必须是 {，最后一个字符必须是 }。
- 不要输出任何解释、开场白、结语，不要使用 Markdown 代码围栏。
- 必须保证 JSON 完整闭合，宁可少写几个知识点，也不要让输出被截断。`;
}

export function mainlineUser(kb: KnowledgeBase, maxChars: number): string {
  return `以下是我的知识材料：
${buildKbContext(kb, maxChars)}

请输出 JSON，结构严格如下（children 可以继续嵌套，没有后续知识点则为空数组）：
{
  "title": "整条脉络的一句话主题（不超过20字）",
  "nodes": [
    {
      "title": "知识点标题（不超过16字）",
      "summary": "一句话说明这个知识点要解决什么（40字以内）",
      "content": "该知识点的讲解（Markdown，200~400字，从零讲起，含例子）",
      "children": [
        {
          "title": "后续知识点",
          "summary": "……",
          "content": "……",
          "children": []
        }
      ]
    }
  ]
}

注意：大多数节点的 children 只有一个元素（保持线性推进）；
只有当确实需要往并列方向展开时，才让某个节点的 children 有 2~3 个元素。`;
}

/** 知识点讲解的系统提示（只要导师人设，材料走 user 消息） */
export function explainSystem(): string {
  return TUTOR_PERSONA;
}

/** 单个知识点讲解的提示 */
export function explainUser(kb: KnowledgeBase, node: ThreadNode, maxChars: number): string {
  return `知识材料：
${buildKbContext(kb, maxChars)}

当前知识点标题：${node.title}
知识点说明：${node.summary}

请针对这个知识点，从零开始完整讲解（Markdown，300~700字），包含：核心结论、前置概念解释、类比与例子、常见误区、一个自检问题。`;
}

/** 沉浸对话的系统提示：AI 知道整条主线与当前所在位置 */
export function chatSystem(
  kb: KnowledgeBase,
  node: ThreadNode,
  mainline: ThreadNode[],
  maxChars: number,
): string {
  const path = mainline.map((n, i) => `${i + 1}. ${n.title}`).join('\n');
  return `${TUTOR_PERSONA}

当前学习材料库「${kb.name}」：
${buildKbContext(kb, maxChars)}

整条主线学习路径为：
${path || '（尚未生成主线）'}

学生当前正处在知识点【${node.title}】（${node.summary}）。
请始终结合当前知识点作答；如果学生问到主线上的其它知识点，可以联系前后关系解释。回答要简短聚焦，除非学生要求深入展开。`;
}

/** 支线生成的系统提示 */
export function branchSystem(): string {
  return `${TUTOR_PERSONA}

学生正在学习某个知识点，遇到了一处不理解的地方，需要针对这个「疑问点」单独展开一条支线讲解。
请聚焦这个疑问，不要泛泛而谈。
只输出**一个 JSON 对象**（第一个字符是 {，最后一个是 }），不要任何解释文字，不要 Markdown 代码围栏，必须完整闭合。`;
}

export function branchUser(node: ThreadNode, question: string): string {
  return `所在知识点：${node.title}
知识点说明：${node.summary}
学生的疑问：${question}

请输出 JSON：
{
  "title": "支线标题（针对该疑问，不超过16字）",
  "summary": "一句话概括这条支线要回答什么",
  "content": "针对该疑问的详尽讲解（Markdown，300~700字，从零讲起，含类比与例子）"
}`;
}

/** 跨线关联分析：找出该支线与主线上其它知识点的联系 */
export function crossLinkSystem(): string {
  return `你是一个知识关联分析器。给定一条支线的内容，以及主线上所有知识点的标题与说明，找出这条支线与主线上的哪些**其它**知识点存在实质性的知识关联。

重点考虑这三类关联：
- 概念互通：两者讲的是同一类东西的不同侧面
- 前置依赖：不先理解对方，就很难理解这条支线
- 实际应用：这条支线的知识被用在那里的场景中

注意：
- 支线已经挂在「它的归属知识点」下面了，**不要再关联归属知识点本身**（列表里已标注出来）。
- 宁缺毋滥，只保留真正相关的（最多 3 个）。确实一个都没有，就返回空数组。

只输出**一个 JSON 对象**（第一个字符是 {，最后一个是 }），不要代码围栏，不要解释文字。`;
}

export function crossLinkUser(
  source: { title: string; summary: string; content: string },
  mainline: ThreadNode[],
  parentTitle?: string,
): string {
  const list = mainline
    .map((n, i) => `${i}｜${n.title}｜${n.summary}${n.title === parentTitle ? '｜【该支线的归属知识点，无需关联】' : ''}`)
    .join('\n');
  return `支线内容：
标题：${source.title}
说明：${source.summary}
正文：${source.content.slice(0, 1200)}

主线知识点列表（序号｜标题｜说明）：
${list}

请输出 JSON：
{
  "links": [
    {
      "title": "关联到的知识点标题（必须与上面列表中的标题完全一致）",
      "index": 该知识点的序号,
      "reason": "关联原因（20字以内）"
    }
  ]
}`;
}

/* ------------------------- 增量合并（新增材料） ------------------------- */

/**
 * 把主线节点整理成带层级缩进的编号清单。
 * 编号与前序遍历一致，和界面上看到的序号完全对应。
 */
export function numberedMainline(mainline: ThreadNode[]): string {
  const byId = new Map(mainline.map((n) => [n.id, n]));
  return mainline
    .map((n, index) => {
      // 计算层级缩进
      let depth = 0;
      let cur = n.parentId ? byId.get(n.parentId) : undefined;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        depth += 1;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      const indent = depth > 0 ? `${'　'.repeat(depth)}└ ` : '';
      return `${index}｜${indent}${n.title}｜${n.summary}`;
    })
    .join('\n');
}

export function mergeSystem(): string {
  return `你是一位知识脉络整合助手。

用户的学习资料库**已经有一条主线脉络**，现在**新增了一批材料**。
你的任务不是重建主线，而是判断这批新材料该如何归位：

1. 【关联】新材料与已有主线上的哪些知识点实质相关？最多挑 4 个，按相关度排序。
   判断标准：讲的是同一个主题、或互为前置/延伸/应用。宁缺毋滥，不相关就不要写。
2. 【新增】新材料里有没有**现有主线完全没覆盖的重要内容**？
   如果有，建议新增为知识点，并指明挂在哪个已有知识点下面（parentIndex）。
   最多 3 个。如果新材料只是已有内容的补充说明，就返回空数组 —— **不要硬凑**。

只输出**一个 JSON 对象**（第一个字符是 {，最后一个是 }），
不要任何解释文字，不要 Markdown 代码围栏，必须完整闭合。`;
}

export function mergeUser(
  docNames: string[],
  newDocsText: string,
  mainline: ThreadNode[],
): string {
  return `【现有主线脉络】（编号｜标题｜说明，缩进表示层级）：
${numberedMainline(mainline) || '（暂无）'}

【本次新增材料】
${newDocsText.slice(0, 6000)}

请输出 JSON：
{
  "source": {
    "title": "给这批材料的总称（不超过16字）",
    "summary": "一句话概括这批材料讲了什么（50字以内）"
  },
  "links": [
    { "index": 相关的主线知识点编号, "reason": "关联原因（20字以内）" }
  ],
  "newNodes": [
    {
      "title": "建议新增的知识点标题（不超过16字）",
      "summary": "一句话说明（40字以内）",
      "parentIndex": 挂到哪个已有知识点下面（用上面的编号；若是全新方向则填 null）,
      "content": "该知识点的讲解（Markdown，200~400字）"
    }
  ]
}

注意：links 和 newNodes 都可以是空数组，但必须给出 source 字段。`;
}
