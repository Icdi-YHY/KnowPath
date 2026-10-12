/**
 * 文件解析层：把各种格式的资料提取成纯文本，供知识库使用。
 *
 * 两条路线：
 *  1) 结构化解析（准确、离线）：pptx / docx / xlsx 本质是 ZIP+XML，pdf 有文字层
 *  2) 视觉兜底（需要 AI）：图片、扫描件 PDF，交给支持视觉的模型「认字」
 *
 * jszip 与 pdfjs 都是动态 import，只在真正用到时才加载，不会拖大主包。
 */

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** 可直接作为文件选择器 accept 属性 */
export const ACCEPT_ATTR = [
  // 文本
  '.txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.xml,.html,.htm,.ini,.conf,.toml',
  'text/*',
  // Office（Open XML）
  '.pptx,.docx,.xlsx',
  // Office（97-2003 老二进制，尽力提取）
  '.ppt,.doc',
  // PDF
  '.pdf',
  // 图片（需视觉模型）
  '.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif',
].join(',');

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface ParseOutcome {
  /** 提取出的纯文本 */
  text: string;
  /** 需要提醒用户的注意事项 */
  warning?: string;
}

export interface ParseOptions {
  /** 把一张图片交给视觉模型识别文字；未提供时图片类文件无法解析 */
  vision?: (dataUrl: string, hint?: string) => Promise<string>;
  /** 扫描件 PDF 最多识别多少页 */
  scanPageLimit?: number;
  onProgress?: (message: string) => void;
}

/* ------------------------------ 常量表 ------------------------------ */

const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WORDPROCESSING_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml',
  'xml', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'java',
  'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'sql', 'sh', 'ini', 'conf', 'toml',
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);
const OLE_EXTS = new Set(['ppt', 'doc']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/* ------------------------------ 工具 ------------------------------ */

/** 文本解码：UTF-8 为主，出现大量替换符时回退 GB18030（中文 Windows 常见） */
function decodeTextBuffer(buf: ArrayBuffer): { text: string; note?: string } {
  const bytes = new Uint8Array(buf);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad > 0) {
    try {
      const gbk = new TextDecoder('gb18030').decode(bytes);
      if ((gbk.match(/\uFFFD/g) || []).length < bad) {
        return { text: gbk, note: '检测为 GB18030 编码，已自动转换' };
      }
    } catch {
      /* 浏览器不支持该编码，忽略 */
    }
  }
  return { text: utf8 };
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function xmlTexts(doc: Document, ns: string, localName: string): string[] {
  return Array.from(doc.getElementsByTagNameNS(ns, localName)).map((n) => n.textContent ?? '');
}

function slideNumber(path: string): number {
  const m = path.match(/(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

/** 把图片压到合适尺寸再转 dataURL，省 token 也更快 */
async function toOcrDataUrl(source: Blob, maxDim = 1600): Promise<string> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ParseError('浏览器不支持 Canvas，无法处理图片');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function loadZip(file: Blob) {
  const JSZip = (await import('jszip')).default;
  return JSZip.loadAsync(await file.arrayBuffer());
}

/* ------------------------------ 各格式解析 ------------------------------ */

async function parsePptx(file: Blob, opts: ParseOptions): Promise<ParseOutcome> {
  const zip = await loadZip(file);
  const names = Object.keys(zip.files);
  const slides = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (!slides.length) throw new ParseError('这个 .pptx 里没有找到幻灯片内容');

  const notes = new Map<number, string>();
  for (const n of names.filter((x) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x))) {
    const xml = await zip.file(n)!.async('string');
    const doc = parseXml(xml);
    const body = Array.from(doc.getElementsByTagNameNS(DRAWINGML_NS, 'p'))
      .map((p) => Array.from(p.getElementsByTagNameNS(DRAWINGML_NS, 't')).map((t) => t.textContent ?? '').join(''))
      .join('\n')
      .trim();
    if (body) notes.set(slideNumber(n), body);
  }

  const blocks: string[] = [];
  let dropped = 0;
  for (const path of slides) {
    opts.onProgress?.(`正在解析第 ${slideNumber(path)} 页`);
    const xml = await zip.file(path)!.async('string');
    const doc = parseXml(xml);
    // 每页按段落取文本，保留行结构
    const lines = Array.from(doc.getElementsByTagNameNS(DRAWINGML_NS, 'p'))
      .map((p) => Array.from(p.getElementsByTagNameNS(DRAWINGML_NS, 't')).map((t) => t.textContent ?? '').join('').trim())
      .filter(Boolean);
    if (!lines.length) {
      dropped += 1;
      continue;
    }
    const num = slideNumber(path);
    let block = `## 第 ${num} 页\n\n${lines.join('\n')}`;
    const note = notes.get(num);
    if (note) block += `\n\n> 演讲者备注：${note.replace(/\n/g, ' ')}`;
    blocks.push(block);
  }

  if (!blocks.length) {
    throw new ParseError('这个 .pptx 的幻灯片里没有任何文字（可能全是图片，请导出为图片后按图片导入）');
  }
  return {
    text: blocks.join('\n\n'),
    warning: dropped ? `有 ${dropped} 页没有任何文字（多为纯图片页），已跳过` : undefined,
  };
}

function docxParagraphs(xml: string): string {
  const doc = parseXml(xml);
  const W = WORDPROCESSING_NS;

  /** 取一个段落里的全部文字（含多个 run 的拼接、制表符与换行） */
  const paragraphText = (p: Element): string => {
    const parts: string[] = [];
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        const local = child.localName;
        if (local === 't') parts.push(child.textContent ?? '');
        else if (local === 'tab') parts.push('\t');
        else if (local === 'br' || local === 'cr') parts.push(' ');
        else walk(child);
      }
    };
    walk(p);
    return parts.join('').replace(/\s+/g, ' ').trim();
  };

  const lines: string[] = [];
  const emit = (el: Element) => {
    const local = el.localName;
    if (local === 'p') {
      lines.push(paragraphText(el));
      return;
    }
    if (local === 'tbl') {
      // 表格：一行一行还原，单元格之间用 | 分隔，尽量保留原貌
      lines.push('');
      for (const tr of Array.from(el.getElementsByTagNameNS(W, 'tr'))) {
        const cells = Array.from(tr.children)
          .filter((c) => c.localName === 'tc')
          .map((tc) =>
            Array.from(tc.getElementsByTagNameNS(W, 'p'))
              .map(paragraphText)
              .filter(Boolean)
              .join(' ')
              .trim(),
          );
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
      }
      lines.push('');
      return;
    }
    for (const child of Array.from(el.children)) emit(child);
  };

  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  for (const child of Array.from((body ?? doc.documentElement).children)) emit(child);

  return lines
    .filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

async function parseDocx(file: Blob): Promise<ParseOutcome> {
  const zip = await loadZip(file);
  const main = zip.file('word/document.xml');
  if (!main) throw new ParseError('这个 .docx 结构不正确，找不到正文');
  const body = docxParagraphs(await main.async('string')).trim();
  if (!body) throw new ParseError('这个 .docx 里没有找到文字内容');
  return { text: body };
}

async function parseXlsx(file: Blob, opts: ParseOptions): Promise<ParseOutcome> {
  const zip = await loadZip(file);

  // 共享字符串表
  const shared: string[] = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    const doc = parseXml(await ss.async('string'));
    for (const si of Array.from(doc.getElementsByTagNameNS(SPREADSHEET_NS, 'si'))) {
      shared.push(Array.from(si.getElementsByTagNameNS(SPREADSHEET_NS, 't')).map((t) => t.textContent ?? '').join(''));
    }
  }

  const sheets = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (!sheets.length) throw new ParseError('这个 .xlsx 里没有找到工作表');

  const blocks: string[] = [];
  for (const path of sheets) {
    opts.onProgress?.(`正在解析工作表 ${slideNumber(path)}`);
    const doc = parseXml(await zip.file(path)!.async('string'));
    const rows: string[] = [];
    for (const row of Array.from(doc.getElementsByTagNameNS(SPREADSHEET_NS, 'row'))) {
      const cells: string[] = [];
      for (const c of Array.from(row.getElementsByTagNameNS(SPREADSHEET_NS, 'c'))) {
        const type = c.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          value = Array.from(c.getElementsByTagNameNS(SPREADSHEET_NS, 't')).map((t) => t.textContent ?? '').join('');
        } else {
          const v = c.getElementsByTagNameNS(SPREADSHEET_NS, 'v')[0];
          const raw = v?.textContent ?? '';
          value = type === 's' ? shared[Number(raw)] ?? '' : raw;
        }
        cells.push(value.replace(/\s+/g, ' ').trim());
      }
      if (cells.some(Boolean)) rows.push(cells.join('\t'));
    }
    if (rows.length) blocks.push(`## 工作表 ${slideNumber(path)}\n\n${rows.join('\n')}`);
  }

  if (!blocks.length) throw new ParseError('这个 .xlsx 里没有任何单元格数据');
  return { text: blocks.join('\n\n') };
}

interface PdfPageText {
  index: number;
  text: string;
}

async function parsePdf(file: Blob, opts: ParseOptions): Promise<ParseOutcome> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pageCount = pdf.numPages;

  const pages: PdfPageText[] = [];
  for (let i = 1; i <= pageCount; i++) {
    opts.onProgress?.(`正在读取第 ${i}/${pageCount} 页`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ index: i, text });
  }

  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  const looksScanned = totalChars < pageCount * 30;

  if (!looksScanned) {
    return {
      text: pages.map((p) => `## 第 ${p.index} 页\n\n${p.text}`).join('\n\n'),
    };
  }

  // 扫描件：没有文字层，只能走视觉识别
  if (!opts.vision) {
    throw new ParseError(
      '这是一个扫描件 PDF（没有文字层），需要配置支持视觉的模型才能识别。可在「设置」里换成 gpt-4o / qwen-vl-max / glm-4v 等。',
    );
  }
  const limit = Math.min(pageCount, opts.scanPageLimit ?? 30);
  const blocks: string[] = [];
  for (let i = 1; i <= limit; i++) {
    opts.onProgress?.(`正在识别第 ${i}/${limit} 页（视觉模型）`);
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, 1600 / base.width);
    const viewport = page.getViewport({ scale: Math.max(1, scale) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ParseError('浏览器不支持 Canvas，无法处理扫描件 PDF');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport } as never).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const text = (await opts.vision(dataUrl, `第 ${i} 页`)).trim();
    blocks.push(`## 第 ${i} 页\n\n${text || '（本页未识别出文字）'}`);
  }

  return {
    text: blocks.join('\n\n'),
    warning:
      pageCount > limit
        ? `这是扫描件，仅识别了前 ${limit} 页（共 ${pageCount} 页），可在设置里调大上限或拆分成多个文件`
        : '这是扫描件 PDF，内容由视觉模型识别生成，建议核对关键信息',
  };
}

/**
 * 97-2003 老二进制格式（.doc / .ppt）：没有可靠的开源纯前端解析器。
 * 这里做「尽力提取」——扫描文本片段，可能是 UTF-16LE，也可能是 GBK。
 */
async function parseOleDocument(file: Blob, ext: string): Promise<ParseOutcome> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const isPrintable = (code: number) =>
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    code === 0x0a ||
    code === 0x0d;

  // UTF-16LE 扫描
  const utf16: string[] = [];
  let run = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (isPrintable(code)) {
      run += String.fromCharCode(code);
    } else {
      if (run.trim().length >= 4) utf16.push(run.trim());
      run = '';
    }
  }
  if (run.trim().length >= 4) utf16.push(run.trim());

  // 整块按 UTF-8 / GBK 解码后取可读片段
  const decodeRuns = (text: string): string[] => {
    const out: string[] = [];
    let acc = '';
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      if (isPrintable(code) || code === 0x09) acc += ch;
      else {
        if (acc.trim().length >= 8) out.push(acc.trim());
        acc = '';
      }
    }
    if (acc.trim().length >= 8) out.push(acc.trim());
    return out;
  };

  const candidates: string[][] = [utf16];
  for (const enc of ['utf-8', 'gb18030']) {
    try {
      candidates.push(decodeRuns(new TextDecoder(enc).decode(bytes)));
    } catch {
      /* 不支持该编码 */
    }
  }

  // 选「有效字符占比」最高的那一路
  const score = (lines: string[]) => {
    const joined = lines.join('');
    if (!joined) return 0;
    const meaningful = (joined.match(/[\u4e00-\u9fff a-zA-Z0-9，。！？、；：""''（）]/g) || []).length;
    return meaningful / joined.length;
  };
  let best: string[] = [];
  let bestScore = -1;
  for (const c of candidates) {
    const s = score(c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  const text = best.join('\n').slice(0, 200_000).trim();
  if (!text) {
    throw new ParseError(`无法从这个 .${ext} 里提取文字内容`);
  }

  return {
    text,
    warning: `.${
      ext === 'ppt' ? 'ppt' : 'doc'
    } 是 97-2003 老格式，无法保证提取准确（可能夹杂乱码）。建议用 Office / WPS 另存为 .${
      ext === 'ppt' ? 'pptx' : 'docx'
    } 后重新导入。`,
  };
}

/* ------------------------------ 对外入口 ------------------------------ */

export async function extractText(file: File, opts: ParseOptions = {}): Promise<ParseOutcome> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ParseError(`文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限，请拆分后再导入`);
  }

  const ext = extOf(file.name);

  // 图片 → 视觉识别
  if (IMAGE_EXTS.has(ext)) {
    if (!opts.vision) {
      throw new ParseError(
        '图片需要「认字」，请先在「设置」里配置支持视觉的模型（如 gpt-4o / qwen-vl-max / glm-4v / moonshot-v1-8k-vision-preview）',
      );
    }
    opts.onProgress?.('正在用视觉模型识别图片文字');
    const dataUrl = await toOcrDataUrl(file);
    const text = (await opts.vision(dataUrl, file.name)).trim();
    if (!text) throw new ParseError('视觉模型没有从这张图片里识别出文字');
    return { text: `## ${baseName(file.name)}\n\n${text}`, warning: '内容由视觉模型识别生成，建议核对关键信息' };
  }

  if (ext === 'pdf') return parsePdf(file, opts);
  if (ext === 'pptx') return parsePptx(file, opts);
  if (ext === 'docx') return parseDocx(file);
  if (ext === 'xlsx') return parseXlsx(file, opts);
  if (OLE_EXTS.has(ext)) return parseOleDocument(file, ext);

  // 文本类：显式扩展名，或浏览器识别为 text/*
  const isText = TEXT_EXTS.has(ext) || file.type.startsWith('text/') || !ext;
  if (isText) {
    const { text, note } = decodeTextBuffer(await file.arrayBuffer());
    if (!text.trim()) throw new ParseError('文件内容为空');
    return { text, warning: note };
  }

  if (ext === 'xls') {
    throw new ParseError('.xls 是 97-2003 老格式，无法直接读取。请另存为 .xlsx 后导入');
  }
  throw new ParseError(
    `暂不支持 .${ext || '未知'} 格式。支持：txt/md/json/csv 等文本、pptx/docx/xlsx、pdf、常见图片，以及 ppt/doc（尽力提取）`,
  );
}
