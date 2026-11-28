'use strict';
/**
 * 课件知识助手 · 本地服务
 * 零第三方依赖，只用 Node 内置模块；Node 18+ 即可运行。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SYMBOL_DEFS, SYMBOL_PINS, snapSvg } = require('../public/symbols.js');

/** 把元件库 defs 注入到模型生成的 SVG（只有用到 <use> 时才需要） */
function injectSymbols(svg) {
  let s = String(svg || '');
  if (!s) return s;
  s = s.replace(/<defs>[\s\S]*?id="sym-[\s\S]*?<\/defs>/g, '');
  if (!s.includes('<use') || s.includes('id="sym-')) return s;
  const i = s.indexOf('>');
  if (i < 0) return s;
  return s.slice(0, i + 1) + SYMBOL_DEFS + s.slice(i + 1);
}

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const store = require('./store');
const ds = require('./deepseek');
const { zip, unzip } = require('./zip');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 80 * 1024 * 1024;
const EMBEDDED = process.env.APP_EMBEDDED === '1';
const HOST = process.env.HOST || (EMBEDDED ? '127.0.0.1' : '0.0.0.0');
const PID_FILE = path.join(store.DATA_DIR, 'server.pid');
let activePort = Number(process.env.PORT) || 8713;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fail(res, code, message) {
  send(res, code, { error: message });
}

/* ------------------------------------------------------------------ */
/* 局域网访问控制                                                      */
/* ------------------------------------------------------------------ */

function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return '';
}

function lanAddress() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const arr of Object.values(nets)) {
    for (const n of arr || []) {
      if (n.family === 'IPv4' && !n.internal) list.push(n.address);
    }
  }
  return (
    list.find((a) => a.startsWith('192.168.')) ||
    list.find((a) => a.startsWith('10.')) ||
    list.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ||
    list[0] ||
    '127.0.0.1'
  );
}

function denyPage(res, title, detail) {
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>无法访问</title>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f1ea;font-family:'Microsoft YaHei',system-ui,sans-serif;color:#211e19">
    <div style="max-width:340px;padding:32px 26px;background:#fffdf8;border:1px solid #e5ddcc;border-radius:18px;text-align:center">
      <div style="font-size:38px;line-height:1">🔒</div>
      <h2 style="margin:12px 0 8px;font-size:17px">${title}</h2>
      <p style="margin:0;font-size:13px;line-height:1.8;color:#6b655a">${detail}</p>
    </div>
  </body></html>`);
}

/* 返回 true 表示放行 */
function allowRequest(req, res, url) {
  if (isLoopback(req)) return true;
  const db = store.get();
  if (!db.settings.allowLan) {
    denyPage(res, '未开启局域网访问', '请在电脑上打开 设置 → 允许手机访问，然后重新扫码。');
    return false;
  }
  const token = db.settings.shareToken || '';
  if (!token) return true;

  const q = url.searchParams.get('k');
  if (q && q === token) {
    const clean = new URL(url);
    clean.searchParams.delete('k');
    res.writeHead(302, {
      'Set-Cookie': `cn_key=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
      Location: clean.pathname + (clean.search || ''),
    });
    res.end();
    return false;
  }
  if (getCookie(req, 'cn_key') === token) return true;

  denyPage(res, '需要访问链接', '请扫描电脑上「手机访问」里的二维码，直接用链接打开。');
  return false;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('上传内容过大（单张图片请控制在 10MB 内）'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求内容不是合法的 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** 简单清洗模型生成的 SVG：去掉脚本、外链与事件属性 */
/** 画板数据：只接受合法的 JSON 字符串，限制大小 */
function cleanDraw(raw) {
  if (raw == null || raw === '') return '';
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (s.length > 400000) return '';
  try {
    const obj = JSON.parse(s);
    if (!obj || !Array.isArray(obj.items)) return '';
    return JSON.stringify({ items: obj.items.slice(0, 4000), electro: !!obj.electro });
  } catch {
    return '';
  }
}

function cleanSvg(raw) {
  let s = String(raw || '').trim();
  if (!s || s.length > 300000 || !s.startsWith('<svg')) return '';
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/xlink:href\s*=\s*("|')\s*(?!#)/gi, 'xlink:href=$1');
  if (!s.endsWith('</svg>')) return '';
  return snapSvg(s);
}

function readBuffer(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('备份文件太大（上限 80MB）'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function publicState() {
  const db = store.get();
  const key = store.getApiKey();
  const masked = key ? key.slice(0, 3) + '••••••' + key.slice(-4) : '';
  return {
    settings: {
      provider: db.settings.provider || 'deepseek',
      baseUrl: db.settings.baseUrl,
      model: db.settings.model,
      textModel: db.settings.textModel || db.settings.model,
      reasoning: db.settings.reasoning || 'off',
      strictVerify: !!db.settings.strictVerify,
      keepFormula: !!db.settings.keepFormula,
      uiScale: Number(db.settings.uiScale) || 1,
      cardLines: Number.isFinite(db.settings.cardLines) ? db.settings.cardLines : 4,
      deckRows: Number(db.settings.deckRows) || 3,
      showQuote: db.settings.showQuote !== false,
      allowSelect: !!db.settings.allowSelect,
      boardSettings: db.settings.boardSettings || { autoRewire: true, grid: true, snap: true, snapDrag: true, avoid: true },
      concurrency: db.settings.concurrency,
      autoExtract: db.settings.autoExtract,
      autoOrganize: !!db.settings.autoOrganize,
      mock: !!db.settings.mock,
      allowLan: !!db.settings.allowLan,
      hasKey: !!key,
      maskedKey: masked,
      keyProtected: store.hasStrongKey(),
    },
    share: {
      embedded: EMBEDDED,
      allowLan: !EMBEDDED && !!db.settings.allowLan,
      token: db.settings.shareToken || '',
      lanIp: lanAddress(),
      port: activePort,
      lanUrl: `http://${lanAddress()}:${activePort}/?k=${db.settings.shareToken || ''}`,
    },
    processing: {
      active: work.active,
      queued: work.queue.length,
      total: work.total,
      done: work.done,
      failed: work.failed,
    },
    subjects: db.subjects,
    decks: db.decks,
    slides: db.slides.map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      deckId: s.deckId,
      index: s.index,
      title: s.title,
      thumb: s.thumb,
      image: s.image,
      status: s.status,
      error: s.error || '',
      summary: s.summary || '',
      ocrText: s.ocrText || '',
      formulas: s.formulas || [],
      uncertain: s.uncertain || [],
      verify: s.verify || null,
      digest: s.digest || '',
      usage: s.usage || null,
      createdAt: s.createdAt,
    })),
    items: db.items,
    categories: db.categories,
    usage: db.usage,
    usageDaily: db.usageDaily || {},
    dataDir: store.DATA_DIR,
  };
}

function splitDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('图片格式无法识别（支持 JPEG / PNG / WebP）'), { status: 400 });
  const mime = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 12 * 1024 * 1024) {
    throw Object.assign(new Error('单张图片超过 12MB，请压缩后重试'), { status: 413 });
  }
  const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  return { buf, mime, ext };
}

function slideDataUrl(slide) {
  const p = path.join(store.IMAGES_DIR, path.basename(slide.image));
  const buf = fs.readFileSync(p);
  const mime = p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}


/** 裸 LaTeX 补 $：模型偶尔把 x_0、\frac{a}{b} 直接写进正文，没有 $ 时 KaTeX 不接管 */
const MATH_KEEP = /```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]{1,300}\$/g;
const MATH_CMD = /\\[a-zA-Z]{2,}(?:\s*\{[^{}\n]{0,40}\}){0,3}/g;
const MATH_TERM = '[A-Za-z0-9]+(?:(?:[_^])(?:\\{[^{}\\n]{1,24}\\}|[A-Za-z0-9]{1,6}))*';
const MATH_REL = '\\s*(?:=|≈|≤|≥|<|>|\\+|-|×|·|→)\\s*';
const MATH_SUBSUP = new RegExp('\\b[A-Za-z](?:[_^](?:\\{[^{}\\n]{1,24}\\}|[A-Za-z0-9]{1,6}))+(?:' + MATH_REL + MATH_TERM + '){0,6}', 'g');

function wrapBareMath(text) {
  let s = String(text == null ? '' : text);
  if (!s) return s;
  if (s.indexOf('_') < 0 && s.indexOf('^') < 0 && s.indexOf('\\') < 0) return s;
  const keep = [];
  s = s.replace(MATH_KEEP, (m) => {
    keep.push(m);
    return '\u0000' + (keep.length - 1) + '\u0000';
  });
  s = s.replace(MATH_CMD, (m) => '$' + m + '$');
  s = s.replace(MATH_SUBSUP, (m) => '$' + m + '$');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
  return s;
}

/** 把 a/b 显示成上下分式：\frac{a}{b}；实在拆不开的退化为 \div */
const OPCH = new Set(['+', '-', '=', '<', '>', '≈', '≤', '≥', '−', '×', '·']);

function skipBrace(s, i) {
  let d = 0;
  for (; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') d++;
    else if (s[i] === '}') { d--; if (d === 0) return i + 1; }
  }
  return -1;
}
function skipParen(s, i) {
  const open = s[i], close = open === '(' ? ')' : ']';
  let d = 0;
  for (; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === open) d++;
    else if (s[i] === close) { d--; if (d === 0) return i + 1; }
  }
  return -1;
}

// 读一个原子（含上下标与相邻括号组）
function readAtom(s, i) {
  const start = i;
  if (s[i] === '{') { const e = skipBrace(s, i); if (e < 0) return -1; i = e; }
  else if (s[i] === '\\') {
    i++;
    while (i < s.length && /[a-zA-Z]/.test(s[i])) i++;
    while (s[i] === '{') { const e = skipBrace(s, i); if (e < 0) return -1; i = e; }
    while (s[i] === '[') { const e = skipParen(s, i); if (e < 0) return -1; i = e; }
  } else if (s[i] === '(' || s[i] === '[') {
    const e = skipParen(s, i); if (e < 0) return -1; i = e;
  } else if (/[0-9A-Za-z]/.test(s[i])) {
    while (i < s.length && /[0-9A-Za-z.]/.test(s[i])) i++;
  } else return -1;

  // 后缀：上下标、阶乘，以及紧邻的括号组（f^{(k)}(x_0)）
  let moved = true;
  while (moved) {
    moved = false;
    if (s[i] === '_' || s[i] === '^') {
      i++;
      if (s[i] === '{') { const e = skipBrace(s, i); if (e < 0) return -1; i = e; }
      else if (/[0-9A-Za-z+\-]/.test(s[i] || '')) i++;
      else return -1;
      moved = true;
    } else if (s[i] === '!') { i++; moved = true; }
    else if (s[i] === '(') { const e = skipParen(s, i); if (e < 0) return -1; i = e; moved = true; }
  }
  return i > start ? i : -1;
}

// 反向读：返回 {start, atom}
function readAtomBack(s, i) {
  let end = i;
  const strip = () => { while (end > 0 && s[end - 1] === ' ') end--; };
  strip();
  let guard = 0;
  let moved = true;
  while (moved && guard++ < 12) {
    moved = false;
    const ch = s[end - 1];
    if (ch === undefined) break;
    if (ch === '!') { end--; moved = true; strip(); continue; }
    if (ch === ')') {
      let d = 0, j = end - 1;
      for (; j >= 0; j--) {
        if (s[j] === '\\') { j--; continue; }
        if (s[j] === ')') d++;
        else if (s[j] === '(') { d--; if (d === 0) break; }
      }
      if (j < 0) return null;
      end = j; moved = true; strip(); continue;
    }
    if (ch === '}') {
      let d = 0, j = end - 1;
      for (; j >= 0; j--) {
        if (s[j] === '\\') { j--; continue; }
        if (s[j] === '}') d++;
        else if (s[j] === '{') { d--; if (d === 0) break; }
      }
      if (j < 0) return null;
      if (j > 0 && (s[j - 1] === '^' || s[j - 1] === '_')) { end = j - 1; moved = true; strip(); continue; }
      end = j; moved = true; strip(); continue;
    }
    if (/[0-9A-Za-z.]/.test(ch)) {
      let j = end;
      while (j > 0 && /[0-9A-Za-z.]/.test(s[j - 1])) j--;
      end = j;
      if (end > 0 && (s[end - 1] === '^' || s[end - 1] === '_')) { end--; moved = true; strip(); continue; }
      if (end > 0 && s[end - 1] === '\\') {
        let k = end - 1;
        while (k > 0 && /[a-zA-Z]/.test(s[k - 1])) k--;
        end = k - 1 < 0 ? k : k - 1;
        end = k - 1; moved = true; strip(); continue;
      }
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = end;
      while (j > 0 && /[a-zA-Z]/.test(s[j - 1])) j--;
      if (j > 0 && s[j - 1] === '\\') { end = j - 1; moved = true; strip(); continue; }
      continue;
    }
    break;
  }
  strip();
  if (end >= i || end < 0) return null;
  let atom = s.slice(end, i);
  let start = end;
  while (atom.startsWith(' ')) { atom = atom.slice(1); start++; }
  atom = atom.replace(/\s+$/, '');
  return { start, atom };
}

// 顶层按 / 切分
function splitTop(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { cur += ch + (s[i + 1] || ''); i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (ch === '/' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function unwrapParens(s) {
  const t = s.trim();
  if (t.length > 2 && t[0] === '(' && t[t.length - 1] === ')') {
    if (skipParen(t, 0) === t.length) return t.slice(1, -1);
  }
  return t;
}

function slashToFrac(expr) {
  const s = String(expr == null ? '' : expr);
  if (!s.includes('/')) return s;
  const parts = splitTop(s);
  if (parts.length === 1) {
    return s.replace(/\{([^{}]*)\}/g, (m, inner) => '{' + slashToFrac(inner) + '}');
  }
  for (let i = 1; i < parts.length; i++) {
    if (i === 1) {
      const back = readAtomBack(parts[0], parts[0].length);
      if (back) {
        parts[0] = parts[0].slice(0, back.start) + '\u0001' + back.atom + '\u0001';
      } else {
        parts[0] = '\u0001' + parts[0] + '\u0001';
      }
    }
    const lead = (parts[i].match(/^\s*/) || [''])[0];
    const e = readAtom(parts[i], lead.length);
    if (e < 0) {
      parts[i] = lead + '\u0002' + parts[i].slice(lead.length) + '\u0002';
    } else {
      parts[i] = lead + '\u0001' + parts[i].slice(lead.length, e) + '\u0001' + parts[i].slice(e);
    }
  }
  // 左折叠
  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    let seg = parts[i];
    if (seg.includes('\u0002')) {
      const pre = seg.slice(0, seg.indexOf('\u0002'));
      const inner = seg.slice(seg.indexOf('\u0002') + 1).replace('\u0002', '');
      const numMatch = /\u0001([^\u0001]*)\u0001$/.exec(acc);
      const numerator = numMatch ? numMatch[1] : acc;
      const head = numMatch ? acc.slice(0, numMatch.index) : '';
      acc = head + '\\frac{' + slashToFrac(numerator) + '}{' + slashToFrac(inner) + '}' + pre;
      continue;
    }
    const mm = /^([^\u0001]*)\u0001([^\u0001]*)\u0001([^]*)$/.exec(seg);
    const lead = ''; // 分母前导空格丢弃，避免分式前多一个空格
    const denRaw = mm ? mm[2] : '';
    const post = mm ? mm[3] : seg;
    const numMatch = /\u0001([^\u0001]*)\u0001$/.exec(acc);
    const numerator = numMatch ? numMatch[1] : acc;
    const head = numMatch ? acc.slice(0, numMatch.index) : '';
    acc = head + lead + '\\frac{' + slashToFrac(unwrapParens(numerator)) + '}{' + slashToFrac(unwrapParens(denRaw)) + '}' + slashToFrac(post);
  }
  return acc.replace(/[\u0001\u0002]/g, '');
}


/** 只处理 $…$ / $$…$$ 里的内容 */
function fracifyMath(text) {
  const s = String(text == null ? '' : text);
  if (!s || s.indexOf('/') < 0) return s;
  return s.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]{1,400})\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g,
    (m, d, i, dd, ii) => {
      try {
        if (d !== undefined) return '$$' + slashToFrac(d) + '$$';
        if (i !== undefined) return '$' + slashToFrac(i) + '$';
        if (dd !== undefined) return '\\[' + slashToFrac(dd) + '\\]';
        return '\\(' + slashToFrac(ii) + '\\)';
      } catch (e) {
        return m;
      }
    });
}

function cleanFormulaText(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\$\$?/, '').replace(/\$\$?$/, '').trim();
  return s.slice(0, 400);
}

function makeItem(slide, data, order) {
  const kind = data.kind === 'extension' ? 'extension' : 'point';
  return {
    id: store.newId('it'),
    slideId: slide.id,
    deckId: slide.deckId,
    subjectId: slide.subjectId,
    kind,
    name: String(data.name || '').slice(0, 120),
    content: String(data.content ?? data.explanation ?? '').slice(0, 2000),
    quote: String(data.quote || '').slice(0, 600),
    importance: kind === 'point' ? Math.max(1, Math.min(5, Number(data.importance) || 3)) : 0,
    tags: Array.isArray(data.tags) ? data.tags.map((t) => String(t).slice(0, 20)).slice(0, 6) : [],
    formula: cleanFormulaText(data.formula),
    categoryId: null,
    order,
    createdAt: store.now(),
    svg: cleanSvg(data.svg),
    versions: [],
  };
}

function nextOrder(db, slideId) {
  const orders = db.items.filter((i) => i.slideId === slideId).map((i) => i.order || 0);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

/* ------------------------------------------------------------------ */
/* 业务处理                                                            */
/* ------------------------------------------------------------------ */

async function handleSettings(req, res) {
  const body = await readJson(req);
  const db = store.get();

  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
    db.settings.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
  }
  if (body.provider === 'deepseek' || body.provider === 'zhipu') db.settings.provider = body.provider;
  if (typeof body.model === 'string' && body.model.trim()) db.settings.model = body.model.trim();
  if (typeof body.textModel === 'string' && body.textModel.trim()) {
    db.settings.textModel = body.textModel.trim();
  }
  if (typeof body.reasoning === 'string' && ['off', 'low', 'high', 'max'].includes(body.reasoning)) {
    db.settings.reasoning = body.reasoning;
  } else if (typeof body.thinking === 'boolean') {
    // 兼容旧前端
    db.settings.reasoning = body.thinking ? 'high' : 'off';
  }
  if (typeof body.strictVerify === 'boolean') {
    db.settings.strictVerify = body.strictVerify;
  }
  if (typeof body.keepFormula === 'boolean') {
    db.settings.keepFormula = body.keepFormula;
  }
  if (typeof body.showQuote === 'boolean') db.settings.showQuote = body.showQuote;
  if (typeof body.allowSelect === 'boolean') db.settings.allowSelect = body.allowSelect;
  if (body.boardSettings && typeof body.boardSettings === 'object') {
    const cur = db.settings.boardSettings || {};
    for (const k of ['autoRewire', 'grid', 'snap', 'snapDrag', 'avoid']) {
      if (typeof body.boardSettings[k] === 'boolean') cur[k] = body.boardSettings[k];
    }
    db.settings.boardSettings = cur;
  }
  if (Number.isFinite(body.cardLines)) {
    db.settings.cardLines = Math.max(-1, Math.min(10, Math.round(body.cardLines)));
  }
  if (Number.isFinite(body.deckRows)) {
    db.settings.deckRows = Math.max(1, Math.min(6, Math.round(body.deckRows)));
  }
  if (Number.isFinite(body.uiScale)) {
    db.settings.uiScale = Math.min(1.3, Math.max(0.8, body.uiScale));
  }
  if (typeof body.autoExtract === 'boolean') db.settings.autoExtract = body.autoExtract;
  if (typeof body.autoOrganize === 'boolean') db.settings.autoOrganize = body.autoOrganize;
  if (typeof body.mock === 'boolean') db.settings.mock = body.mock;
  if (typeof body.allowLan === 'boolean') db.settings.allowLan = body.allowLan;
  if (Number.isFinite(body.concurrency)) {
    db.settings.concurrency = Math.max(1, Math.min(6, Math.round(body.concurrency)));
  }
  if (body.clearKey) store.setApiKey('');
  else if (typeof body.apiKey === 'string' && body.apiKey.trim()) store.setApiKey(body.apiKey.trim());

  store.save();
  send(res, 200, publicState());
}

async function handleTest(req, res) {
  const body = await readJson(req);
  const db = store.get();
  const key = body.apiKey?.trim() || store.getApiKey();
  if (!key) return fail(res, 400, '还没有填写 API Key');
  const base = (body.baseUrl || db.settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');

  try {
    const r = await fetch(base + '/models', {
      headers: { Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) {
      const data = await r.json().catch(() => null);
      const names = (data?.data || []).map((m) => m.id).slice(0, 6);
      return send(res, 200, { ok: true, message: '连接正常' + (names.length ? '：' + names.join('、') : '') });
    }
    if (r.status === 401) return fail(res, 401, 'API Key 无效或已过期');
    // 部分网关不提供 /models，退化为一次最小对话请求
    const r2 = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: db.settings.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (r2.ok) return send(res, 200, { ok: true, message: '连接正常' });
    const err = await r2.text();
    return fail(res, 400, '连接失败：' + err.slice(0, 200));
  } catch (e) {
    return fail(res, 500, '无法连接：' + (e.cause?.code || e.message));
  }
}

/** 科目名不允许重复：去空格、忽略首尾空白后比较 */
function subjectNameTaken(db, name, exceptId) {
  const key = String(name || '').trim();
  return db.subjects.some((s) => s.id !== exceptId && s.name.trim() === key);
}

async function handleCreateSubject(req, res) {
  const body = await readJson(req);
  const name = String(body.name || '').trim();
  if (!name) return fail(res, 400, '科目名称不能为空');
  const db = store.get();
  const finalName = name.slice(0, 40);
  if (subjectNameTaken(db, finalName)) {
    return fail(res, 409, `已经有叫「${finalName}」的科目了，换个名字吧`);
  }
  const palette = ['#2b5d4b', '#8a5a2b', '#3f5a8a', '#7a3f5d', '#4a6b30', '#6b4a8a'];
  const subject = {
    id: store.newId('sub'),
    name: finalName,
    color: body.color || palette[db.subjects.length % palette.length],
    organizePrompt: typeof body.organizePrompt === 'string' ? body.organizePrompt.slice(0, 2000) : '',
    usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedCost: 0, calls: 0 },
    createdAt: store.now(),
  };
  db.subjects.push(subject);
  store.save();
  send(res, 200, { subject, state: publicState() });
}

async function handleUpdateSubject(req, res, id) {
  const body = await readJson(req);
  const db = store.get();
  const s = db.subjects.find((x) => x.id === id);
  if (!s) return fail(res, 404, '科目不存在');
  if (typeof body.name === 'string' && body.name.trim()) {
    const name = body.name.trim().slice(0, 40);
    if (subjectNameTaken(db, name, id)) {
      return fail(res, 409, `已经有叫「${name}」的科目了，换个名字吧`);
    }
    s.name = name;
  }
  if (typeof body.color === 'string' && body.color.trim()) s.color = body.color.trim();
  if (typeof body.organizePrompt === 'string') s.organizePrompt = body.organizePrompt.slice(0, 2000);
  store.save();
  send(res, 200, publicState());
}

async function handleDeleteSubject(req, res, id) {
  const db = store.get();
  if (!db.subjects.some((x) => x.id === id)) return fail(res, 404, '科目不存在');
  store.deleteSubject(id);
  send(res, 200, publicState());
}

async function handleUpdateDeck(req, res, id) {
  const body = await readJson(req);
  const db = store.get();
  const d = db.decks.find((x) => x.id === id);
  if (!d) return fail(res, 404, '课件不存在');
  if (typeof body.title === 'string' && body.title.trim()) d.title = body.title.trim().slice(0, 80);
  store.save();
  send(res, 200, publicState());
}

async function handleDeleteDeck(req, res, id) {
  const db = store.get();
  if (!db.decks.some((x) => x.id === id)) return fail(res, 404, '课件不存在');
  store.deleteDeck(id);
  send(res, 200, publicState());
}

async function handleAddSlide(req, res) {
  const body = await readJson(req);
  const db = store.get();
  const subject = db.subjects.find((x) => x.id === body.subjectId);
  if (!subject) return fail(res, 400, '请先选择一个科目');

  let deck = body.deckId ? db.decks.find((x) => x.id === body.deckId) : null;
  if (!deck) {
    const d = new Date();
    const stamp = `${d.getMonth() + 1}月${d.getDate()}日`;
    deck = {
      id: store.newId('deck'),
      subjectId: subject.id,
      title: String(body.deckTitle || '').trim() || `${stamp} 上传的课件`,
      createdAt: store.now(),
    };
    db.decks.push(deck);
  }

  const img = splitDataUrl(body.image);
  const slideId = store.newId('sl');
  const imageName = slideId + img.ext;
  fs.writeFileSync(path.join(store.IMAGES_DIR, imageName), img.buf);

  let thumbName = imageName;
  if (typeof body.thumb === 'string' && body.thumb.startsWith('data:image/')) {
    try {
      const th = splitDataUrl(body.thumb);
      thumbName = slideId + '_t' + th.ext;
      fs.writeFileSync(path.join(store.IMAGES_DIR, thumbName), th.buf);
    } catch {}
  }

  const siblings = db.slides.filter((s) => s.deckId === deck.id);
  const slide = {
    id: slideId,
    subjectId: subject.id,
    deckId: deck.id,
    index: siblings.length + 1,
    title: '',
    image: imageName,
    thumb: thumbName,
    status: 'pending',
    error: '',
    summary: '',
    ocrText: '',
    formulas: [],
    uncertain: [],
    usage: null,
    createdAt: store.now(),
  };
  db.slides.push(slide);
  store.save();
  send(res, 200, { deck, slide, state: publicState() });
}

async function handleDeleteSlide(req, res, id) {
  if (!store.get().slides.some((s) => s.id === id)) return fail(res, 404, '页面不存在');
  store.deleteSlide(id);
  send(res, 200, publicState());
}

/** 本课件前面页面出现过的符号，用来保持同一写法 */
function buildGlossary(db, slide) {
  const prior = db.slides
    .filter((s) => s.deckId === slide.deckId && s.id !== slide.id && s.status === 'done')
    .sort((a, b) => (a.index || 0) - (b.index || 0));
  if (!prior.length) return '';
  const text = prior.map((s) => (s.ocrText || '') + ' ' + (s.formulas || []).join(' ')).join(' ');
  const set = new Set();
  for (const m of text.matchAll(/[α-ωΑ-Ω∑∏∫√∂∇∞≤≥≠≈±×÷∈∉⊂⊆∪∩→⇒⇔ℝℕℤℚ]/g)) set.add(m[0]);
  return [...set].slice(0, 30).join(' ');
}

/** 把校对结果应用到抽取结果（只做字符级替换） */
function applyCorrections(result, corrections) {
  const fix = (s) => {
    let out = String(s || '');
    for (const c of corrections) out = out.split(c.find).join(c.replace);
    return out;
  };
  result.ocrText = fix(result.ocrText);
  result.title = fix(result.title);
  result.summary = fix(result.summary);
  result.formulas = (result.formulas || []).map(fix);
  result.points = (result.points || []).map((p) => ({
    ...p,
    name: fix(p.name),
    explanation: fix(p.explanation),
    quote: fix(p.quote),
  }));
  result.extensions = (result.extensions || []).map((e) => ({ ...e, content: fix(e.content) }));
  result.uncertain = (result.uncertain || []).map((u) => ({
    ...u,
    seen: fix(u.seen),
    why: fix(u.why),
    candidates: (u.candidates || []).map(fix),
  }));
}

async function performExtraction(slideId) {
  const db = store.get();
  const slide = db.slides.find((s) => s.id === slideId);
  if (!slide) throw Object.assign(new Error('页面不存在'), { status: 404 });
  if (slide.status === 'running') throw new Error('这一页正在识别中');

  const deck = db.decks.find((d) => d.id === slide.deckId) || { title: '课件' };
  const subject = db.subjects.find((s) => s.id === slide.subjectId) || { name: '课程' };
  const apiKey = store.getApiKey();

  if (!db.settings.mock && !apiKey) {
    throw Object.assign(
      new Error('还没有配置 API Key，请先在设置中填写，或打开「演示模式」体验'),
      { status: 400 }
    );
  }

  slide.status = 'running';
  slide.error = '';
  store.save();

  try {
    const imageDataUrl = slideDataUrl(slide);
    const { result, usage } = await ds.extractSlide({
      settings: db.settings,
      apiKey,
      subject: subject.name,
      deck: deck.title,
      page: slide.index,
      imageDataUrl,
      glossary: buildGlossary(db, slide),
    });

    // 严格模式：拿原图再校对一遍，只改字符级差异
    if (db.settings.strictVerify) {
      try {
        const v = await ds.verifyExtraction({ settings: db.settings, apiKey, imageDataUrl, draft: result });
        if (v.corrections.length) applyCorrections(result, v.corrections);
        slide.verify = { corrections: v.corrections.length, note: v.note || '' };
        if (v.usage) store.addUsage(v.usage, { subjectId: slide.subjectId, kind: 'extract' });
      } catch (e) {
        slide.verify = { corrections: 0, note: '校对未完成：' + e.message };
      }
    } else {
      slide.verify = null;
    }

    slide.title = result.title;
    slide.summary = result.summary;
    slide.ocrText = result.ocrText;
    slide.formulas = result.formulas;
    slide.uncertain = result.uncertain;
    slide.status = 'done';
    slide.error = '';
    slide.usage = usage;
    slide.extractedAt = store.now();

    // 保留手动笔记和用户改过的条目，避免重新识别把它们冲掉
    const kept = db.items.filter((i) => i.slideId === slide.id && (i.manual || i.updatedAt));
    const keptNames = new Set(kept.map((i) => String(i.name || '').trim()));
    db.items = db.items.filter((i) => i.slideId !== slide.id);
    db.items.push(...kept);

    const created = [];
    let order = 0;
    for (const p of result.points) {
      if (keptNames.has(String(p.name || '').trim())) continue;
      created.push(makeItem(slide, { ...p, kind: 'point', content: p.explanation }, order++));
    }
    for (const e of result.extensions) {
      created.push(
        makeItem(slide, { name: e.title || e.type, content: e.content, kind: 'extension' }, order++)
      );
    }
    db.items.push(...created);
    store.addUsage(usage, { subjectId: slide.subjectId, kind: 'extract' });
    store.save();

    return { slide, items: created, usage };
  } catch (e) {
    if (/429|频繁|限流|rate limit|too many/i.test(e.message || '')) {
      rateLimitUntil = Date.now() + 20000;
      serialMode = true;
    }
    slide.status = 'error';
    slide.error = e.message;
    store.save();
    throw e;
  }
}

async function handleExtract(req, res, id) {
  const db = store.get();
  if (!db.slides.some((s) => s.id === id)) return fail(res, 404, '页面不存在');
  try {
    const out = await performExtraction(id);
    send(res, 200, { slide: out.slide, items: out.items, usage: out.usage, state: publicState() });
  } catch (e) {
    send(res, e.status || 500, { error: e.message, slideId: id });
  }
}

async function organizeSubject(subjectId) {
  const db = store.get();
  const subject = db.subjects.find((x) => x.id === subjectId);
  if (!subject) throw Object.assign(new Error('科目不存在'), { status: 404 });
  const points = db.items.filter((i) => i.subjectId === subjectId && i.kind === 'point');
  if (!points.length) throw Object.assign(new Error('这个科目还没有知识点，先完成识别再整理'), { status: 400 });

  const apiKey = store.getApiKey();
  if (!db.settings.mock && !apiKey) throw Object.assign(new Error('还没有配置 API Key'), { status: 400 });

  const criteria = String(subject.organizePrompt || '').trim();
  const { tree, duplicates, usage } = await ds.organize({
    settings: db.settings,
    apiKey,
    subject: subject.name,
    items: points,
    criteria,
  });
  store.addUsage(usage, { subjectId, kind: 'organize' });

  db.categories = db.categories.filter((c) => c.subjectId !== subjectId);
  const byId = new Map(points.map((p) => [p.id, p]));
  for (const p of points) p.categoryId = null;

  // 先把「讲同一件事」的重复知识点合并掉
  const remap = new Map();
  const removed = new Set();
  for (const g of duplicates || []) {
    const keep = byId.get(g.keep);
    if (!keep || removed.has(keep.id)) continue;
    for (const mid of g.merge) {
      if (mid === keep.id || removed.has(mid)) continue;
      const dup = byId.get(mid);
      if (!dup) continue;
      const content = String(g.content || '').trim();
      if (content) keep.content = content.slice(0, 4000);
      else if (dup.content && !String(keep.content || '').includes(dup.content)) {
        keep.content = (String(keep.content || '') + '\n\n' + dup.content).slice(0, 4000);
      }
      if (g.name) keep.name = g.name.slice(0, 120);
      keep.tags = [...new Set([...(keep.tags || []), ...(dup.tags || [])])].slice(0, 6);
      if (!keep.quote && dup.quote) keep.quote = dup.quote;
      if (!keep.formula && dup.formula) keep.formula = dup.formula;
      if (dup.svg && !keep.svg) keep.svg = dup.svg;
      if (dup.versions?.length) keep.versions = [...(keep.versions || []), ...dup.versions].slice(-10);
      removed.add(dup.id);
      remap.set(dup.id, keep.id);
    }
  }
  if (removed.size) db.items = db.items.filter((i) => !removed.has(i.id));

  let created = 0;
  const walk = (nodes, parentId, depth) => {
    nodes.forEach((node, i) => {
      if (!node || !node.name) return;
      const cat = {
        id: store.newId('cat'),
        subjectId,
        parentId: parentId || null,
        name: String(node.name).slice(0, 40),
        order: i,
        depth,
        count: 0,
      };
      db.categories.push(cat);
      created++;
      const ids = Array.isArray(node.items) ? node.items : [];
      for (const itemId of ids) {
        const item = byId.get(remap.get(itemId) || itemId);
        if (item && !item.categoryId) {
          item.categoryId = cat.id;
          cat.count++;
        }
      }
      if (Array.isArray(node.children) && node.children.length) walk(node.children, cat.id, depth + 1);
    });
  };
  walk(tree, null, 0);

  const countOf = (cat) => {
    let n = db.items.filter((i) => i.categoryId === cat.id).length;
    for (const child of db.categories.filter((c) => c.parentId === cat.id)) n += countOf(child);
    return n;
  };
  for (const c of db.categories.filter((c) => c.subjectId === subjectId)) c.total = countOf(c);

  store.save();
  return { created, merged: removed.size };
}

async function handleOrganize(req, res, subjectId) {
  try {
    const { created, merged } = await organizeSubject(subjectId);
    const db = store.get();
    send(res, 200, { categories: db.categories, items: db.items, created, merged: merged || 0, state: publicState() });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

async function handleSummarizeDeck(req, res, id) {
  const db = store.get();
  const deck = db.decks.find((d) => d.id === id);
  if (!deck) return fail(res, 404, '课件不存在');

  const slides = db.slides
    .filter((s) => s.deckId === id && s.status === 'done')
    .sort((a, b) => a.index - b.index);
  if (!slides.length) return fail(res, 400, '这份课件还没有识别好的页面，先识别再总结');

  const apiKey = store.getApiKey();
  if (!db.settings.mock && !apiKey) return fail(res, 400, '还没有配置 API Key，请先在设置中填写');

  const subject = db.subjects.find((s) => s.id === deck.subjectId) || { name: '课程' };
  const pages = slides.map((s) => ({
    page: s.index,
    title: s.title,
    points: db.items.filter((i) => i.slideId === s.id && i.kind === 'point').map((i) => i.name),
  }));

  try {
    const { summary, usage } = await ds.summarizeDeck({
      settings: db.settings,
      apiKey,
      subject: subject.name,
      deck: deck.title,
      pages,
    });

    const item = {
      id: store.newId('it'),
      slideId: null,
      deckId: null,
      subjectId: deck.subjectId,
      kind: 'point',
      name: `本节总结 · ${deck.title}`.slice(0, 120),
      content: summary.slice(0, 4000),
      quote: '',
      importance: 4,
      tags: ['本节总结'],
      formula: '',
      categoryId: null,
      order: 0,
      createdAt: store.now(),
      manual: true,
      versions: [],
    };
    db.items.push(item);
    store.addUsage(usage, { subjectId: deck.subjectId, kind: 'summarize' });
    store.save();
    send(res, 200, { item, state: publicState() });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

async function handleDigestSlide(req, res, id) {
  const db = store.get();
  const slide = db.slides.find((s) => s.id === id);
  if (!slide) return fail(res, 404, '页面不存在');

  const points = db.items.filter((i) => i.slideId === id && i.kind === 'point');
  if (!points.length) return fail(res, 400, '这一页还没有知识点，先识别再汇总');

  const apiKey = store.getApiKey();
  if (!db.settings.mock && !apiKey) return fail(res, 400, '还没有配置 API Key，请先在设置中填写');

  const subject = db.subjects.find((s) => s.id === slide.subjectId) || { name: '课程' };
  try {
    const { digest, usage } = await ds.digestSlide({
      settings: db.settings,
      apiKey,
      subject: subject.name,
      page: slide.index,
      points,
    });
    slide.digest = digest;
    store.addUsage(usage, { subjectId: slide.subjectId, kind: 'compose' });
    store.save();
    send(res, 200, { digest, state: publicState() });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

async function handleCompose(req, res) {
  const body = await readJson(req);
  const db = store.get();
  const subject = db.subjects.find((s) => s.id === body.subjectId);
  if (!subject) return fail(res, 400, '科目不存在');

  const prompt = String(body.prompt || '').trim();
  if (!prompt) return fail(res, 400, '请先写下你的要求');

  const apiKey = store.getApiKey();
  if (!db.settings.mock && !apiKey) {
    return fail(res, 400, '还没有配置 API Key，请先在设置中填写');
  }

  let slide = null;
  if (body.slideId) {
    slide = db.slides.find((s) => s.id === body.slideId && s.subjectId === subject.id) || null;
  }
  const deck = slide ? db.decks.find((d) => d.id === slide.deckId) : null;

  try {
    const { draft, usage } = await ds.compose({
      settings: db.settings,
      apiKey,
      subject: subject.name,
      deck: deck?.title || '',
      page: slide?.index || 0,
      context: slide ? slide.ocrText || slide.summary : '',
      prompt,
      kind: body.kind,
      base: body.base && typeof body.base === 'object' ? body.base : null,
    });
    if (!draft.content) return fail(res, 422, '模型没有写出内容，换个说法再试');

    store.addUsage(usage, { subjectId: subject.id, kind: 'compose' });
    store.save();
    send(res, 200, { draft, state: publicState() });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

async function handleUpdateItem(req, res, id) {
  const body = await readJson(req);
  const db = store.get();
  const item = db.items.find((i) => i.id === id);
  if (!item) return fail(res, 404, '知识点不存在');
  if (typeof body.name === 'string' && body.name.trim()) item.name = body.name.trim().slice(0, 120);
  if (typeof body.content === 'string') item.content = body.content.slice(0, 4000);
  if (body.kind === 'point' || body.kind === 'extension') item.kind = body.kind;
  if (Number.isFinite(body.importance)) item.importance = Math.max(1, Math.min(5, Math.round(body.importance)));
  if ('tags' in body) item.tags = parseTags(body.tags);
  if ('categoryId' in body) item.categoryId = body.categoryId || null;
  if ('formula' in body) item.formula = cleanFormulaText(body.formula);
  if ('svg' in body) item.svg = cleanSvg(body.svg);
  if ('draw' in body) item.draw = cleanDraw(body.draw);
  item.updatedAt = store.now();
  store.save();
  send(res, 200, publicState());
}

function parseTags(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[,，\s]+/);
  return list.map((t) => String(t).trim().slice(0, 20)).filter(Boolean).slice(0, 6);
}

/** 把「易错点」这类通用名改成内容概括 */
function summarizeTitle(text) {
  const s = String(text || '')
    .replace(/\s+/g, '')
    .replace(/^[，。；：、,.;:\s]+/, '');
  const first = s.split(/[。；;！!？?]/)[0] || s;
  return first.slice(0, 18);
}

async function handleFixExtensionNames(req, res) {
  const db = store.get();
  const exts = db.items.filter((i) => i.kind === 'extension');
  if (!exts.length) return send(res, 200, { changed: 0, state: publicState() });

  const apiKey = store.getApiKey();
  if (!db.settings.mock && !apiKey) return fail(res, 400, '还没有配置 API Key，请先在设置中填写');

  const subject = db.subjects.find((s) => s.id === exts[0].subjectId) || { name: '课程' };
  const used = new Set();
  let changed = 0;

  try {
    for (let i = 0; i < exts.length; i += 15) {
      const batch = exts.slice(i, i + 15);
      const { titles, usage } = await ds.extensionTitles({
        settings: db.settings,
        apiKey,
        subject: subject.name,
        items: batch,
      });
      if (usage) store.addUsage(usage, { subjectId: batch[0].subjectId, kind: 'compose' });

      for (const { id, title } of titles) {
        const item = db.items.find((x) => x.id === id);
        if (!item) continue;
        let name = title.slice(0, 24);
        let n = 2;
        while (used.has(item.slideId + '|' + name)) {
          name = title.slice(0, 20) + '（' + n + '）';
          n++;
        }
        used.add(item.slideId + '|' + name);
        if (item.name !== name) {
          item.name = name;
          item.updatedAt = store.now();
          changed++;
        }
      }
    }

    store.save();
    send(res, 200, { changed, total: exts.length, state: publicState() });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

async function handleCreateItem(req, res) {
  const body = await readJson(req);
  const db = store.get();
  const subject = db.subjects.find((s) => s.id === body.subjectId);
  if (!subject) return fail(res, 400, '科目不存在');

  const name = String(body.name || '').trim();
  const content = String(body.content || '').trim();
  if (!name) return fail(res, 400, '请填写标题');
  if (!content && !body.svg) return fail(res, 400, '请填写内容');

  let slide = null;
  if (body.slideId) {
    slide = db.slides.find((s) => s.id === body.slideId && s.subjectId === subject.id);
    if (!slide) return fail(res, 400, '关联的页面不存在');
  }

  const kind = body.kind === 'extension' ? 'extension' : 'point';
  const item = {
    id: store.newId('it'),
    svg: cleanSvg(body.svg),
    draw: cleanDraw(body.draw),
    slideId: slide ? slide.id : null,
    deckId: slide ? slide.deckId : null,
    subjectId: subject.id,
    kind,
    name: name.slice(0, 120),
    content: content.slice(0, 4000),
    quote: '',
    importance: kind === 'point' ? Math.max(1, Math.min(5, Number(body.importance) || 3)) : 0,
    tags: parseTags(body.tags),
    formula: cleanFormulaText(body.formula),
    categoryId: null,
    order: slide ? nextOrder(db, slide.id) : 0,
    createdAt: store.now(),
    manual: true,
    versions: [],
  };
  db.items.push(item);
  store.save();
  send(res, 200, { item, state: publicState() });
}

async function handleDeleteItem(req, res, id) {
  const db = store.get();
  if (!db.items.some((i) => i.id === id)) return fail(res, 404, '知识点不存在');
  db.items = db.items.filter((i) => i.id !== id);
  store.save();
  send(res, 200, publicState());
}

/* 按用户要求修改 / 补充 */

async function runRefine(req, res, { item, slide, forceAppend }) {
  const body = await readJson(req);
  const db = store.get();
  const instruction = String(body.instruction || '').trim();
  if (!instruction) return fail(res, 400, '请先写下你的要求');
  const mode = forceAppend ? 'append' : body.mode === 'append' ? 'append' : 'rewrite';

  const apiKey = store.getApiKey();
  if (!db.settings.mock && !apiKey) return fail(res, 400, '还没有配置 API Key，请先在设置中填写');

  const deck = slide ? db.decks.find((d) => d.id === slide.deckId) : null;
  const subjectId = slide ? slide.subjectId : item?.subjectId;
  const subject = db.subjects.find((s) => s.id === subjectId) || { name: '课程' };

  try {
    const { items, note, usage } = await ds.refine({
      settings: db.settings,
      apiKey,
      subject: subject.name,
      deck: deck ? deck.title : '手动笔记',
      page: slide ? slide.index : 0,
      context: slide ? slide.ocrText || slide.summary : item?.content || '',
      item,
      instruction,
      mode,
    });
    if (!items.length) return fail(res, 422, '模型没有返回可用内容，换个说法再试');

    if (mode === 'rewrite' && item) {
      const first = items[0];
      item.versions = item.versions || [];
      item.versions.push({
        name: item.name,
        content: item.content,
        quote: item.quote,
        importance: item.importance,
        tags: item.tags,
        at: store.now(),
        instruction,
      });
      if (item.versions.length > 10) item.versions.shift();
      item.name = first.name;
      item.content = first.explanation;
      item.quote = first.quote;
      if (item.kind === 'point') item.importance = first.importance;
      if (first.tags.length) item.tags = first.tags;
      if (first.svg) item.svg = cleanSvg(first.svg);
      const wantsFormula = /公式|formula|表达式|latex|推导/i.test(instruction);
      if (db.settings.keepFormula && !wantsFormula) {
        // 开关打开：明确要求才改公式，其余情况保留原值
      } else if (first.formula) {
        item.formula = cleanFormulaText(first.formula);
      }
      item.updatedAt = store.now();
    } else {
      let order = slide ? nextOrder(db, slide.id) : 0;
      const norm = (s) => String(s || '').trim().replace(/\s+/g, '');
      for (const it of items) {
        const existing = db.items.find(
          (x) => x.slideId === slide.id && norm(x.name) === norm(it.name)
        );
        if (existing) {
          const add = String(it.explanation || '').trim();
          if (add && !String(existing.content || '').includes(add)) {
            existing.content = (String(existing.content || '') + '\n\n' + add).slice(0, 4000);
          }
          if (!existing.quote && it.quote) existing.quote = it.quote;
          if (it.tags?.length) {
            existing.tags = [...new Set([...(existing.tags || []), ...it.tags])].slice(0, 6);
          }
          if (it.formula && !existing.formula) existing.formula = cleanFormulaText(it.formula);
          existing.updatedAt = store.now();
        } else if (slide) {
          db.items.push(makeItem(slide, { ...it, content: it.explanation }, order++));
        } else {
          db.items.push({
            id: store.newId('it'),
            slideId: null,
            deckId: null,
            subjectId,
            kind: it.kind === 'extension' ? 'extension' : 'point',
            name: String(it.name || '').slice(0, 120),
            content: String(it.explanation || '').slice(0, 4000),
            quote: String(it.quote || '').slice(0, 600),
            importance: Number(it.importance) || 3,
            tags: Array.isArray(it.tags) ? it.tags.slice(0, 6) : [],
            formula: cleanFormulaText(it.formula),
            categoryId: null,
            order: order++,
            createdAt: store.now(),
            manual: true,
            versions: [],
          });
        }
      }
    }

    store.addUsage(usage, { subjectId, kind: 'refine' });
    store.save();
    send(res, 200, { note, state: publicState() });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

async function handleRefineItem(req, res, id) {
  const db = store.get();
  const item = db.items.find((i) => i.id === id);
  if (!item) return fail(res, 404, '知识点不存在');
  const slide = item.slideId ? db.slides.find((s) => s.id === item.slideId) : null;
  return runRefine(req, res, { item, slide });
}

async function handleRefineSlide(req, res, id) {
  const db = store.get();
  const slide = db.slides.find((s) => s.id === id);
  if (!slide) return fail(res, 404, '页面不存在');
  return runRefine(req, res, { item: null, slide, forceAppend: true });
}

async function handleRevertItem(req, res, id) {
  const db = store.get();
  const item = db.items.find((i) => i.id === id);
  if (!item) return fail(res, 404, '知识点不存在');
  if (!item.versions || !item.versions.length) return fail(res, 400, '没有可撤销的修改');

  const v = item.versions.pop();
  item.name = v.name;
  item.content = v.content;
  item.quote = v.quote;
  if (item.kind === 'point' && v.importance) item.importance = v.importance;
  if (Array.isArray(v.tags)) item.tags = v.tags;
  item.updatedAt = store.now();
  store.save();
  send(res, 200, publicState());
}

function handleExport(req, res, url) {
  const db = store.get();
  const subjectId = url.searchParams.get('subjectId');
  const format = url.searchParams.get('format') || 'md';
  const subject = db.subjects.find((s) => s.id === subjectId);
  if (!subject) return fail(res, 400, '请先选择科目');

  if (format === 'json') {
    const payload = {
      exportedAt: store.now(),
      subject,
      decks: db.decks.filter((d) => d.subjectId === subjectId),
      slides: db.slides.filter((s) => s.subjectId === subjectId),
      items: db.items.filter((i) => i.subjectId === subjectId),
      categories: db.categories.filter((c) => c.subjectId === subjectId),
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(subject.name + '-备份.json')}`,
    });
    return res.end(JSON.stringify(payload, null, 2));
  }

  const md = buildMarkdown(db, subject);
  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(subject.name + '-知识点.md')}`,
  });
  res.end('\ufeff' + md);
}

function buildMarkdown(db, subject) {
  const decks = db.decks.filter((d) => d.subjectId === subject.id);
  const cats = db.categories.filter((c) => c.subjectId === subject.id);
  const items = db.items.filter((i) => i.subjectId === subject.id);
  const slides = db.slides.filter((s) => s.subjectId === subject.id);
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
  const lines = [];
  const notes = [];

  lines.push(`# ${subject.name} · 知识点整理`, '');
  lines.push(
    `> 导出时间：${new Date().toLocaleString('zh-CN')}　·　${decks.length} 个课件 / ${slides.length} 页 / ${items.filter((i) => i.kind === 'point').length} 个知识点`,
    ''
  );

  if (cats.length) {
    lines.push('## 目录', '');
    const roots = cats.filter((c) => !c.parentId);
    const renderCat = (c, depth) => {
      lines.push(`${'  '.repeat(depth)}- ${c.name}`);
      cats.filter((x) => x.parentId === c.id).forEach((ch) => renderCat(ch, depth + 1));
    };
    roots.forEach((c) => renderCat(c, 0));
    lines.push('');
  }

  const figureMd = (item) => {
    if (!item.svg) return;
    const b64 = Buffer.from(injectSymbols(item.svg), 'utf8').toString('base64');
    lines.push(`![示意图](data:image/svg+xml;base64,${b64})`, '');
    notes.push(`- 配图 · \`${item.name}\`：AI 生成的示意图，请对照正文核对`);
  };

  for (const deck of decks) {
    lines.push(`## ${deck.title}`, '');
    const deckSlides = slides.filter((s) => s.deckId === deck.id).sort((a, b) => a.index - b.index);
    for (const slide of deckSlides) {
      const its = items.filter((i) => i.slideId === slide.id);
      const points = its.filter((i) => i.kind === 'point');
      const exts = its.filter((i) => i.kind === 'extension');
      if (!points.length && !exts.length) continue;

      lines.push(`### 第 ${slide.index} 页 · ${slide.title || '未命名'}`, '');
      if (slide.summary) lines.push(`*${slide.summary}*`, '');
      if (slide.digest) lines.push(`> **本页汇总**：${slide.digest}`, '');

      points.forEach((p, idx) => {
        lines.push(`**${idx + 1}. ${p.name}**　${stars(p.importance)}`, '');
        if (p.content) lines.push(p.content, '');
        if (p.formula) lines.push('$$' + p.formula + '$$', '');
        figureMd(p);
      });
      if (exts.length) {
        lines.push('**拓展**', '');
        exts.forEach((e) => lines.push(`- 【${e.name}】${e.content}`));
        lines.push('');
      }

      // 附注条目：来源、校对、存疑
      const pageNotes = [];
      if (slide.verify) {
        pageNotes.push(`- 二次校对：修正 ${slide.verify.corrections || 0} 处${slide.verify.note ? '（' + slide.verify.note + '）' : ''}`);
      }
      for (const p of points) {
        const parts = [];
        if (p.quote) parts.push(`原文「${p.quote}」`);
        if (p.tags?.length) parts.push('标签：' + p.tags.join(' / '));
        if (parts.length) pageNotes.push(`- \`${p.name}\`：${parts.join('；')}`);
      }
      for (const u of slide.uncertain || []) {
        if (typeof u === 'string') pageNotes.push(`- 存疑：${u}`);
        else {
          const bits = [];
          if (u.where) bits.push('位置：' + u.where);
          if (u.seen) bits.push('看到：' + u.seen);
          if (u.candidates?.length) bits.push('候选：' + u.candidates.join(' / '));
          if (u.why) bits.push('原因：' + u.why);
          if (bits.length) pageNotes.push(`- 存疑：${bits.join('；')}`);
        }
      }
      if (slide.formulas?.length) pageNotes.push(`- 本页公式：${slide.formulas.join('；')}`);

      if (pageNotes.length) {
        notes.push(`### 第 ${slide.index} 页 · ${slide.title || '未命名'}`);
        notes.push(...pageNotes, '');
      }
    }
  }

  const manualPoints = items.filter((i) => i.kind === 'point' && !i.slideId);
  const manualExts = items.filter((i) => i.kind === 'extension' && !i.slideId);
  if (manualPoints.length || manualExts.length) {
    lines.push('## 手动笔记', '');
    manualPoints.forEach((p, idx) => {
      lines.push(`**${idx + 1}. ${p.name}**　${stars(p.importance)}`, '');
      if (p.content) lines.push(p.content, '');
      if (p.formula) lines.push('$$' + p.formula + '$$', '');
      if (p.tags?.length) lines.push(p.tags.map((t) => '`' + t + '`').join(' '), '');
      figureMd(p);
    });
    if (manualExts.length) {
      lines.push('**拓展**', '');
      manualExts.forEach((e) => lines.push(`- 【${e.name}】${e.content}`));
      lines.push('');
    }
  }

  if (notes.length) {
    lines.push('---', '', '## 附注：来源与核验', '', ...notes, '');
  }

  return lines.join('\n');
}

/* ---------- 完整备份（含图片） ---------- */

/* ---------- 完整备份：默认导出全部科目，也支持单个科目 ---------- */

function backupImageEntries(slides) {
  const entries = [];
  const seen = new Set();
  for (const s of slides) {
    for (const file of [s.image, s.thumb]) {
      if (!file) continue;
      const base = path.basename(file);
      if (seen.has(base)) continue;
      const p = path.join(store.IMAGES_DIR, base);
      if (!fs.existsSync(p)) continue;
      seen.add(base);
      entries.push({ name: 'images/' + base, data: fs.readFileSync(p) });
    }
  }
  return entries;
}

/** 备份里要带上的设置（不含 API Key、分享 token 这类设备相关的东西） */
function exportableSettings(s) {
  return {
    provider: s.provider,
    baseUrl: s.baseUrl,
    model: s.model,
    textModel: s.textModel,
    reasoning: s.reasoning,
    concurrency: s.concurrency,
    autoExtract: !!s.autoExtract,
    autoOrganize: !!s.autoOrganize,
    strictVerify: !!s.strictVerify,
    keepFormula: !!s.keepFormula,
    uiScale: Number(s.uiScale) || 1,
    cardLines: Number.isFinite(s.cardLines) ? s.cardLines : 4,
    deckRows: Number(s.deckRows) || 3,
    showQuote: s.showQuote !== false,
    allowSelect: !!s.allowSelect,
  };
}

/** 恢复设置（只覆盖已知字段，不动 API Key） */
function applyBackupSettings(db, src) {
  if (!src || typeof src !== 'object') return 0;
  const s = db.settings;
  let n = 0;
  const set = (fn) => {
    try {
      fn();
      n++;
    } catch {}
  };
  if (src.provider === 'deepseek' || src.provider === 'zhipu') set(() => (s.provider = src.provider));
  if (typeof src.baseUrl === 'string' && src.baseUrl.trim()) set(() => (s.baseUrl = src.baseUrl.trim()));
  if (typeof src.model === 'string' && src.model.trim()) set(() => (s.model = src.model.trim()));
  if (typeof src.textModel === 'string' && src.textModel.trim()) set(() => (s.textModel = src.textModel.trim()));
  if (['off', 'low', 'high', 'max'].includes(src.reasoning)) set(() => (s.reasoning = src.reasoning));
  if (Number.isFinite(src.concurrency)) set(() => (s.concurrency = Math.max(1, Math.min(6, Math.round(src.concurrency)))));
  if (typeof src.autoExtract === 'boolean') set(() => (s.autoExtract = src.autoExtract));
  if (typeof src.autoOrganize === 'boolean') set(() => (s.autoOrganize = src.autoOrganize));
  if (typeof src.strictVerify === 'boolean') set(() => (s.strictVerify = src.strictVerify));
  if (typeof src.keepFormula === 'boolean') set(() => (s.keepFormula = src.keepFormula));
  if (Number.isFinite(src.uiScale)) set(() => (s.uiScale = Math.min(1.3, Math.max(0.8, src.uiScale))));
  if (Number.isFinite(src.cardLines)) set(() => (s.cardLines = Math.max(-1, Math.min(10, Math.round(src.cardLines)))));
  if (Number.isFinite(src.deckRows)) set(() => (s.deckRows = Math.max(1, Math.min(6, Math.round(src.deckRows)))));
  if (typeof src.showQuote === 'boolean') set(() => (s.showQuote = src.showQuote));
  if (typeof src.allowSelect === 'boolean') set(() => (s.allowSelect = src.allowSelect));
  return n;
}

/** 合并备份里的用量：按天取较大值，避免重复恢复把费用翻倍 */
function mergeBackupUsage(db, src) {
  if (!src || typeof src !== 'object') return;
  const daily = src.daily && typeof src.daily === 'object' ? src.daily : {};
  if (!db.usageDaily) db.usageDaily = {};
  for (const [date, v] of Object.entries(daily)) {
    const cur = db.usageDaily[date] || { promptTokens: 0, completionTokens: 0, estimatedCost: 0, calls: 0 };
    db.usageDaily[date] = {
      promptTokens: Math.max(cur.promptTokens || 0, v.promptTokens || 0),
      completionTokens: Math.max(cur.completionTokens || 0, v.completionTokens || 0),
      estimatedCost: Math.max(cur.estimatedCost || 0, v.estimatedCost || 0),
      calls: Math.max(cur.calls || 0, v.calls || 0),
    };
  }
  const g = src.global || {};
  db.usage.promptTokens = Math.max(db.usage.promptTokens || 0, g.promptTokens || 0);
  db.usage.completionTokens = Math.max(db.usage.completionTokens || 0, g.completionTokens || 0);
  db.usage.cachedTokens = Math.max(db.usage.cachedTokens || 0, g.cachedTokens || 0);
  db.usage.estimatedCost = Math.max(db.usage.estimatedCost || 0, g.estimatedCost || 0);
  db.usage.calls = Math.max(db.usage.calls || 0, g.calls || 0);

  // 按用途分类也取较大值
  if (g.byKind && typeof g.byKind === 'object') {
    if (!db.usage.byKind) db.usage.byKind = {};
    for (const [kind, v] of Object.entries(g.byKind)) {
      const cur = db.usage.byKind[kind] || { promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedCost: 0, calls: 0 };
      db.usage.byKind[kind] = {
        promptTokens: Math.max(cur.promptTokens || 0, v.promptTokens || 0),
        completionTokens: Math.max(cur.completionTokens || 0, v.completionTokens || 0),
        cachedTokens: Math.max(cur.cachedTokens || 0, v.cachedTokens || 0),
        estimatedCost: Math.max(cur.estimatedCost || 0, v.estimatedCost || 0),
        calls: Math.max(cur.calls || 0, v.calls || 0),
      };
    }
  }
}

const MAP_EXPORTS = new Map();

async function handleExportMapPost(req, res) {
  const body = await readJson(req);
  const svg = String(body.svg || '');
  if (!svg.startsWith('<svg') || svg.length > 3_000_000) return fail(res, 400, '导图内容无效');
  const token = crypto.randomBytes(8).toString('hex');
  MAP_EXPORTS.set(token, { name: String(body.name || '思维导图.svg').slice(0, 80), svg, at: Date.now() });
  for (const [k, v] of MAP_EXPORTS) if (Date.now() - v.at > 10 * 60 * 1000) MAP_EXPORTS.delete(k);
  send(res, 200, { url: '/api/export-map?token=' + token });
}

function handleExportMapGet(req, res, url) {
  const token = url.searchParams.get('token') || '';
  const rec = MAP_EXPORTS.get(token);
  if (!rec) return fail(res, 404, '导图已过期，请重新导出');
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(rec.name),
  });
  res.end(rec.svg);
}

const DOC_EXPORTS = new Map();

const DOC_STYLE = `
    :root{--ink:#28302b;--muted:#8a8272;--line:#e6ddca;--paper:#fffdf8;}
    *{box-sizing:border-box}
    body{margin:0;background:#f4f1ea;color:var(--ink);font:16px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
    .page{max-width:860px;margin:0 auto;background:var(--paper);padding:48px 56px 64px;box-shadow:0 10px 40px rgba(0,0,0,.06);}
    h1{font-size:30px;margin:0 0 6px}
    .meta{color:var(--muted);font-size:13px;margin:0 0 28px}
    .toc{background:#faf6ec;border:1px solid var(--line);border-radius:12px;padding:18px 24px;margin:0 0 36px}
    .toc h2{font-size:15px;margin:0 0 10px;color:var(--muted);letter-spacing:.04em}
    .toc ol{margin:0;padding-left:20px}
    .toc li{margin:4px 0}
    .toc a{color:#2f5d4b;text-decoration:none;border-bottom:1px dotted #b9c9c1}
    .toc a:hover{color:#173a2c}
    h2.sec{font-size:20px;margin:44px 0 6px;padding-bottom:8px;border-bottom:1px solid var(--line)}
    h2.sec.d2{font-size:17px;margin:30px 0 4px;border:none;color:#4b5d55}
    section.note{margin:26px 0 30px;page-break-inside:avoid;break-inside:avoid}
    section.note h3{font-size:17px;margin:0 0 8px}
    .body{white-space:pre-wrap}
    .formula{margin:10px 0;padding:8px 0;overflow-x:auto}
    figure{margin:16px 0;text-align:center}
    figure img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:#fff}
    figcaption{color:var(--muted);font-size:12px;margin-top:6px}
    .tags{margin-top:8px;color:var(--muted);font-size:12px}
    .tag{display:inline-block;background:#f0ebdf;border-radius:5px;padding:1px 7px;margin-right:5px}
    .top{position:fixed;right:22px;bottom:22px;background:#2f5d4b;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:13px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.2)}
    @media print{.page{box-shadow:none;padding:0;max-width:none}.top{display:none}body{background:#fff}a{color:inherit}}
`;

/* ------------------------------------------------------------------ */
/* 离线 KaTeX：把 CSS、字体、JS 全部内联，导出的笔记文档不依赖网络      */
/* ------------------------------------------------------------------ */

let KATEX_CACHE = null;

function katexInline() {
  if (KATEX_CACHE) return KATEX_CACHE;
  try {
    const dir = path.join(__dirname, '..', 'public', 'vendor', 'katex');
    let css = fs.readFileSync(path.join(dir, 'katex.min.css'), 'utf8');
    const fontsDir = path.join(dir, 'fonts');
    css = css.replace(/url\((['"]?)fonts\/([^)'"]+)\1\)/g, (all, q, file) => {
      const fp = path.join(fontsDir, file);
      if (!fs.existsSync(fp)) return all;
      const b64 = fs.readFileSync(fp).toString('base64');
      return 'url(data:font/woff2;base64,' + b64 + ')';
    });
    const js = fs.readFileSync(path.join(dir, 'katex.min.js'), 'utf8');

    const auto = [
      '(function(){',
      'function looksMath(s){',
      '  if(!s)return false;',
      '  var t=String(s).trim();',
      '  if(!t)return false;',
      '  if(t.length>300)return false;',
      '  if(/[\u4e00-\u9fa5]/.test(t))return false;',
      '  if(/^\\d+([.,]\\d+)?$/.test(t))return false;',
      '  return /[\\^_{}=+\\-*/<>\u2264\u2265\u00b1\u00d7\u00b7\u00f7\u222b\u2211\u221a\u03c0\u03b8\u03b1\u03b2\u03b3\u03bb\u03bc\u03c3\u0394]/.test(t)'
      + " || /^[A-Za-z][A-Za-z0-9 ]{0,12}$/.test(t);",
      '}',
      'function autoMath(root){',
      '  var rx=/\\$\\$([\\s\\S]+?)\\$\\$|\\\\\\[([\\s\\S]+?)\\\\\\]|\\\\\\(([\\s\\S]+?)\\\\\\)|\\$([^$\\n]{1,400})\\$/g;',
      '  var walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null);',
      '  var nodes=[];',
      '  while(walk.nextNode())nodes.push(walk.currentNode);',
      '  nodes.forEach(function(node){',
      '    var text=node.nodeValue;',
      '    if(!text)return;',
      '    if(text.indexOf("$")<0&&text.indexOf("\\\\(")<0&&text.indexOf("\\\\[")<0)return;',
      '    var p=node.parentNode;',
      '    if(p&&p.closest&&p.closest("pre,code,script,style,.katex"))return;',
      '    rx.lastIndex=0;var m,last=0,frag=null;',
      '    while((m=rx.exec(text))){',
      '      var display=!!(m[1]||m[2]);',
      '      var expr=m[1]!==undefined?m[1]:(m[2]!==undefined?m[2]:(m[3]!==undefined?m[3]:m[4]));',
      '      if(expr===undefined||expr===null)continue;',
      '      if(!display&&!looksMath(expr))continue;',

      '      if(!frag)frag=document.createDocumentFragment();',
      '      if(m.index>last)frag.appendChild(document.createTextNode(text.slice(last,m.index)));',
      '      var span=document.createElement("span");',
      '      try{span.innerHTML=katex.renderToString(expr,{displayMode:display,throwOnError:false,strict:false});}',
      '      catch(e){span.textContent=m[0];}',
      '      frag.appendChild(span);last=m.index+m[0].length;',
      '    }',
      '    if(frag){if(last<text.length)frag.appendChild(document.createTextNode(text.slice(last)));node.parentNode.replaceChild(frag,node);}',
      '  });',
      '}',
      'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){autoMath(document.body);});',
      'else autoMath(document.body);',
      '})();',
    ].join('\n');

    KATEX_CACHE = { css, js, auto };
    return KATEX_CACHE;
  } catch (e) {
    KATEX_CACHE = { css: '', js: '', auto: '' };
    return KATEX_CACHE;
  }
}

/** 生成带目录、带图片的学习笔记 HTML */

/* ------------------------------------------------------------------ */
/* 练习题：按科目笔记推测进度 → 出题 → 生成题目 PDF / 答案 PDF          */
/* ------------------------------------------------------------------ */

const PRACTICE = new Map(); // token -> { subject, progress, questions, at }

/** 把科目笔记压成给模型的摘要 */
function practiceDigest(subjectId) {
  const db = store.get();
  const subject = db.subjects.find((s) => s.id === subjectId);
  if (!subject) return null;
  const items = db.items.filter((i) => i.subjectId === subjectId);
  const cats = db.categories.filter((c) => c.subjectId === subjectId);
  const slides = db.slides.filter((s) => s.subjectId === subjectId);

  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const byCat = new Map();
  for (const it of items) {
    const key = it.categoryId || '';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(it);
  }
  const coveredSlides = new Set(items.map((i) => i.slideId).filter(Boolean)).size;

  const lines = [];
  for (const [cid, list] of byCat) {
    const name = cid ? (catName.get(cid) || '未命名分类') : '未归类';
    lines.push(`【${name}】共 ${list.length} 条`);
    const sorted = list.slice().sort((a, b) => (b.importance || 0) - (a.importance || 0)).slice(0, 40);
    for (const it of sorted) {
      const tag = it.kind === 'extension' ? '，拓展' : '';
      lines.push(`- ${it.name}（${it.importance || 3}${tag}）`);
    }
    if (list.length > sorted.length) lines.push(`- …另有 ${list.length - sorted.length} 条`);
  }
  if (!items.length) lines.push('（这个科目还没有任何笔记）');

  let text = lines.join('\n');
  if (text.length > 7000) text = text.slice(0, 7000) + '\n…（已截断）';

  return {
    subject,
    text,
    itemCount: items.length,
    categoryCount: byCat.size,
    slideCount: slides.length,
    coveredSlides,
    sampleNames: items.slice(0, 5).map((i) => i.name),
  };
}

async function handlePractice(req, res) {
  const body = await readJson(req);
  const digest = practiceDigest(String(body.subjectId || ''));
  if (!digest) return fail(res, 404, '科目不存在');
  if (!digest.itemCount) return fail(res, 400, '这个科目还没有笔记，先上传课件或手动写几条');
  const st = store.get();
  if (!store.getApiKey() && !st.settings.mock) return fail(res, 400, '还没有设置 API Key（设置里可先开演示模式）');

  const extra = String(body.extra || '').slice(0, 500);
  const count = Math.max(1, Math.min(50, Number(body.count) || 15));
  let out;
  try {
    out = await ds.practiceSet({
      settings: st.settings,
      apiKey: store.getApiKey(),
      subject: digest.subject,
      digest,
      extra,
      count,
    });
  } catch (e) {
    return fail(res, 502, e.message || '出题失败');
  }
  if (out.usage && out.usage.tokens) {
    store.addUsage(out.usage, { kind: 'practice', subjectId: digest.subject.id });
  }

  const token = crypto.randomBytes(8).toString('hex');
  PRACTICE.set(token, {
    subject: digest.subject,
    progress: out.progress,
    questions: out.questions,
    at: Date.now(),
  });
  // 清理超过 2 小时的缓存
  const now = Date.now();
  for (const [k, v] of PRACTICE) if (now - v.at > 2 * 3600 * 1000) PRACTICE.delete(k);

  send(res, 200, { progress: out.progress, questions: out.questions, token });
}

/** 题目/答案 PDF 的 HTML（打印友好，A4） */
function practiceHtml(rec, kind) {
  const isAnswer = kind === 'answers';
  const title = rec.subject.name + (isAnswer ? ' · 练习题参考答案' : ' · 练习题');
  const rows = rec.questions.map((q, i) => {
    const head = `<div class="q"><div class="qh"><span class="no">${i + 1}</span><span class="type">${escHtml(q.type || '')}</span></div><div class="body">${renderMathText(q.question)}</div>`;
    if (!isAnswer) return head + '<div class="blank"></div></div>';
    return head + `<div class="ans"><b>答案：</b>${renderMathText(q.answer)}</div>`
      + (q.explain ? `<div class="exp"><b>解析：</b>${renderMathText(q.explain)}</div>` : '')
      + (q.ref ? `<div class="ref">对应知识点：${escHtml(q.ref)}</div>` : '') + '</div>';
  }).join('');

  const prog = rec.progress || {};
  const progressBlock = isAnswer ? '' : `
    <div class="prog">
      <div class="pt">学习进度推测：${escHtml(prog.level || '')}</div>
      ${prog.summary ? `<div>${escHtml(prog.summary)}</div>` : ''}
      ${Array.isArray(prog.weak) && prog.weak.length ? `<div>建议重点：${prog.weak.map(escHtml).join('、')}</div>` : ''}
      ${prog.suggest ? `<div>复习建议：${escHtml(prog.suggest)}</div>` : ''}
    </div>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
@page { size: A4; margin: 16mm 15mm; }
body { font-family: "Microsoft YaHei", sans-serif; font-size: 10.5pt; line-height: 1.75; color: #1f2421; }
h1 { font-size: 17pt; color: #2f5d4b; margin: 0 0 2mm; }
.meta { color: #6e7670; font-size: 9pt; margin-bottom: 6mm; }
.prog { border: 1px solid #cec7b6; border-radius: 3mm; padding: 3mm 4mm; margin-bottom: 6mm; background: #faf9f5; font-size: 9.5pt; }
.prog .pt { font-weight: 700; color: #2f5d4b; margin-bottom: 1.5mm; }
.q { margin-bottom: 6mm; page-break-inside: avoid; }
.qh { display: flex; align-items: center; gap: 2mm; margin-bottom: 1.5mm; }
.no { display: inline-block; min-width: 7mm; height: 7mm; line-height: 7mm; text-align: center; border-radius: 50%;
      background: #e6efe9; color: #2f5d4b; font-weight: 700; font-size: 9.5pt; }
.type { font-size: 9pt; color: #6e7670; }
.body { font-size: 10.5pt; }
.blank { height: 28mm; border-bottom: 1px dashed #d6ccb6; margin-top: 2mm; }
.ans, .exp { margin-top: 1.5mm; }
.ref { color: #6e7670; font-size: 9pt; margin-top: 1mm; }
.page-break { page-break-before: always; }
.printhint { margin-top: 10mm; color: #6e7670; font-size: 9pt; }
.printbtn { position: fixed; right: 12mm; bottom: 12mm; padding: 3mm 5mm; border: 0; border-radius: 3mm;
            background: #2f5d4b; color: #fff; font-size: 10pt; cursor: pointer; }
@media print { .printhint, .printbtn { display: none; } }
</style></head><body>
<h1>${escHtml(title)}</h1>
<div class="meta">${escHtml(rec.subject.name)} · 共 ${rec.questions.length} 题 · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
${progressBlock}
${rows}
<div class="printhint">要变成 PDF：点下面的按钮，或在浏览器菜单里选「打印 → 目标：另存为 PDF」</div>
<button class="printbtn" onclick="window.print()">打印 / 存为 PDF</button>
<script>${katexInline().js}<\/script>
<script>${katexInline().auto}<\/script>
</body></html>`;
}

/** 正文里的 $…$ 先做分式化，再交给前端 KaTeX 自动渲染 */
function renderMathText(s) {
  return escHtml(fracifyMath(wrapBareMath(String(s || '')))).replace(/\n/g, '<br>');
}

/** 找本机可用的 Edge / Chrome，用它把 HTML 打成 PDF */
function browserForPdf() {
  const cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of cands) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function htmlToPdf(html) {
  return new Promise((resolve) => {
    const exe = browserForPdf();
    if (!exe) return resolve(null);
    const dir = os.tmpdir();
    const tag = 'mynotes-' + crypto.randomBytes(6).toString('hex');
    const htmlPath = path.join(dir, tag + '.html');
    const pdfPath = path.join(dir, tag + '.pdf');
    try {
      fs.writeFileSync(htmlPath, html, 'utf8');
    } catch (e) {
      return resolve(null);
    }
    const args = ['--headless=new', '--disable-gpu', '--no-pdf-header-footer',
      '--print-to-pdf=' + pdfPath, 'file:///' + htmlPath.replace(/\\/g, '/')];
    const child = spawn(exe, args, { stdio: 'ignore' });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 60000);
    child.on('exit', () => {
      clearTimeout(timer);
      let buf = null;
      try { buf = fs.readFileSync(pdfPath); } catch {}
      try { fs.unlinkSync(htmlPath); } catch {}
      try { fs.unlinkSync(pdfPath); } catch {}
      resolve(buf && buf.length > 1000 ? buf : null);
    });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

async function handlePracticePdf(req, res, url) {
  const rec = PRACTICE.get(url.searchParams.get('token') || '');
  if (!rec) return fail(res, 404, '练习题已过期，请重新生成');
  const kind = url.searchParams.get('kind') === 'answers' ? 'answers' : 'questions';
  const html = practiceHtml(rec, kind);
  const base = rec.subject.name + '-' + (kind === 'answers' ? '答案' : '练习题');
  const wantHtml = url.searchParams.get('format') === 'html';

  const serveHtml = () => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(base + '.html'),
      'Cache-Control': 'no-store',
    });
    res.end(html);
  };

  if (wantHtml) return serveHtml();

  const pdf = await htmlToPdf(html);
  if (!pdf) {
    // 本机没有可用的浏览器（手机端就是这样）：给 HTML 附件，下载后可打印成 PDF
    return serveHtml();
  }
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': pdf.length,
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(base + '.pdf'),
    'Cache-Control': 'no-store',
  });
  res.end(pdf);
}

async function handleExportNotesDoc(req, res) {
  const body = await readJson(req);
  const db = store.get();
  const subject = db.subjects.find((s) => s.id === (body.subjectId || ''));
  if (!subject) return fail(res, 404, '科目不存在');
  const images = body.images && typeof body.images === 'object' ? body.images : {};

  const items = db.items.filter((i) => i.subjectId === subject.id);
  const cats = db.categories.filter((c) => c.subjectId === subject.id);
  const byParent = new Map();
  for (const c of cats) {
    const k = c.parentId || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  for (const l of byParent.values()) l.sort((a, b) => (a.order || 0) - (b.order || 0));

  const groups = [];
  const used = new Set();
  const walk = (parentId, depth) => {
    for (const c of byParent.get(parentId) || []) {
      const own = items.filter((i) => i.categoryId === c.id);
      if (own.length) {
        groups.push({ id: c.id, name: c.name, depth, items: own });
        own.forEach((i) => used.add(i.id));
      }
      walk(c.id, depth + 1);
    }
  };
  walk('', 0);
  const rest = items.filter((i) => !used.has(i.id));
  if (rest.length) groups.push({ id: 'rest', name: '未归类', depth: 0, items: rest });

  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const out = [];
  out.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  out.push('<title>' + escHtml(subject.name) + ' · 学习笔记</title>');
  out.push('<style>' + katexInline().css + '</style>');
  out.push('<style>' + DOC_STYLE + '</style></head><body><div class="page">');
  out.push('<h1>' + escHtml(subject.name) + ' · 学习笔记</h1>');
  out.push('<p class="meta">导出时间 ' + escHtml(stamp) + ' · 共 ' + items.length + ' 条 · 不含课件原图</p>');

  out.push('<nav class="toc"><h2>目录</h2><ol>');
  groups.forEach((g, gi) => {
    out.push('<li><a href="#g' + gi + '">' + escHtml(g.name) + '</a><ol>');
    g.items.forEach((it, ii) => {
      out.push('<li><a href="#g' + gi + '-' + ii + '">' + escHtml(it.name) + '</a></li>');
    });
    out.push('</ol></li>');
  });
  out.push('</ol></nav><main>');

  groups.forEach((g, gi) => {
    out.push('<h2 class="sec' + (g.depth > 0 ? ' d2' : '') + '" id="g' + gi + '">' + escHtml(g.name) + '</h2>');
    g.items.forEach((it, ii) => {
      out.push('<section class="note" id="g' + gi + '-' + ii + '">');
      out.push('<h3>' + escHtml(it.name) + '</h3>');
      const bodyText = fracifyMath(wrapBareMath(String(it.content || '').trim()));
      if (bodyText) out.push('<div class="body">' + escHtml(bodyText) + '</div>');
      if (it.formula) out.push('<div class="formula">$' + escHtml(slashToFrac(it.formula)) + '$</div>');
      const img = images[it.id];
      if (img && /^data:image\/png;base64,/.test(img)) {
        out.push('<figure><img alt="配图" src="' + img + '"><figcaption>AI 生成配图，细节请对照正文核对</figcaption></figure>');
      }
      const tags = Array.isArray(it.tags) ? it.tags : [];
      const sl = db.slides.find((s) => s.id === it.slideId);
      const dk = sl ? db.decks.find((d) => d.id === sl.deckId) : null;
      const src = sl && dk ? dk.title + ' · 第 ' + sl.index + ' 页' : it.manual ? '手动笔记' : '';
      if (tags.length || src) {
        out.push('<div class="tags">' + tags.map((x) => '<span class="tag">' + escHtml(x) + '</span>').join('') + (src ? escHtml(src) : '') + '</div>');
      }
      out.push('</section>');
    });
  });
  out.push('</main>');
  out.push('<button class="top" onclick="window.print()">打印 / 存为 PDF</button>');
  out.push('<script>' + katexInline().js + '<\/script>');
  out.push('<script>' + katexInline().auto + '<\/script>');
  out.push('</div></body></html>');

  const token = crypto.randomBytes(8).toString('hex');
  const name = subject.name + '-学习笔记-' + new Date().toISOString().slice(0, 10) + '.html';
  DOC_EXPORTS.set(token, { name, html: out.join('\n'), at: Date.now() });
  for (const [k, v] of DOC_EXPORTS) if (Date.now() - v.at > 10 * 60 * 1000) DOC_EXPORTS.delete(k);
  send(res, 200, { url: '/api/export-notes-doc?token=' + token });
}

function handleExportNotesDocGet(req, res, url) {
  const rec = DOC_EXPORTS.get(url.searchParams.get('token') || '');
  if (!rec) return fail(res, 404, '文档已过期，请重新导出');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(rec.name),
  });
  res.end(rec.html);
}

/** 去掉内嵌的旧符号定义，并把导线端点重新吸附到最新引脚上 */
function stripSymbolDefs(svg) {
  return String(svg || '').replace(/<defs>[\s\S]*?id="sym-[\s\S]*?<\/defs>/g, '');
}

async function handleRepairDrawings(req, res) {
  const db = store.get();
  let fixed = 0;
  let unknown = 0;
  const known = new Set(Object.keys(SYMBOL_PINS || {}));

  for (const it of db.items) {
    if (!it.svg || !it.svg.includes('<use')) continue;
    const old = it.svg;
    let next = stripSymbolDefs(old);
    for (const m of next.matchAll(/<use\b[^>]*?href\s*=\s*["']#([\w-]+)["']/g)) {
      if (!known.has(m[1])) unknown++;
    }
    next = snapSvg(next);
    if (next !== old) {
      it.svg = next;
      it.updatedAt = store.now();
      fixed++;
    }
  }

  if (fixed) store.save();
  send(res, 200, { fixed, unknown, state: publicState() });
}

/** 导出当前科目的公式合集（按分类，HTML 便于打印成 PDF） */
function handleExportFormulas(req, res, url) {
  const db = store.get();
  const subjectId = url.searchParams.get('subjectId') || '';
  const subject = db.subjects.find((s) => s.id === subjectId);
  if (!subject) return fail(res, 404, '科目不存在');

  const cats = db.categories.filter((c) => c.subjectId === subjectId);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (id) => {
    const out = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 12) {
      out.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return out.join(' / ');
  };

  const items = db.items
    .filter((i) => i.subjectId === subjectId && String(i.formula || '').trim())
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));

  const groups = new Map();
  for (const it of items) {
    const key = it.categoryId && byId.get(it.categoryId) ? pathOf(it.categoryId) : '未分类';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const topOrder = (path) => {
    const first = String(path).split(' / ')[0];
    const c = cats.find((x) => x.name === first);
    return c ? c.order || 0 : 9999;
  };
  const names = [...groups.keys()].sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    const d = topOrder(a) - topOrder(b);
    return d || a.localeCompare(b, 'zh-CN');
  });

  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const out = [];
  out.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  out.push('<title>' + escHtml(subject.name) + ' · 公式合集</title>');
  out.push('<style>' + katexInline().css + '</style>');
  out.push(
    '<style>' +
      '@page{size:A4;margin:16mm 14mm}' +
      'body{max-width:820px;margin:0 auto;padding:24px 20px 60px;font:16px/1.8 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#28302b;background:#fff}' +
      'h1{font-size:26px;margin:0 0 4px}' +
      '.meta{color:#8a8272;font-size:13px;margin-bottom:22px}' +
      'h2{font-size:18px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid #e6ddca;page-break-after:avoid}' +
      '.toc{background:#faf7f0;border:1px solid #ece4d2;border-radius:10px;padding:12px 16px;margin-bottom:26px}' +
      '.toc b{font-size:13px;color:#7b7364}' +
      '.toc a{display:inline-block;margin:4px 12px 4px 0;color:#2f5d4b;font-size:13.5px;text-decoration:none}' +
      '.entry{margin:0 0 18px;padding:0 0 14px;border-bottom:1px dashed #eee6d5;page-break-inside:avoid;break-inside:avoid}' +
      '.entry .name{font-size:14px;color:#42524a;font-weight:600;margin-bottom:4px}' +
      '.entry .fx{margin:6px 0;text-align:center}' +
      '.entry .note{font-size:13px;color:#5d6a63;white-space:pre-wrap;margin-top:6px}' +
      '.empty{color:#8a8272;padding:24px 0}' +
      '@media print{.toc{page-break-after:avoid}}' +
      '</style>'
  );
  out.push('</head><body>');
  out.push('<h1>' + escHtml(subject.name) + ' · 公式合集</h1>');
  out.push('<div class="meta">导出时间 ' + escHtml(stamp) + ' · 共 ' + items.length + ' 条公式 · ' + names.length + ' 个分类</div>');

  if (!items.length) {
    out.push('<div class="empty">这个科目还没有带公式的知识点。</div>');
  } else {
    out.push('<div class="toc"><b>分类</b><br>' +
      names.map((n, i) => '<a href="#f' + i + '">' + escHtml(n) + '（' + groups.get(n).length + '）</a>').join('') + '</div>');

    names.forEach((n, i) => {
      out.push('<h2 id="f' + i + '">' + escHtml(n) + '</h2>');
      for (const it of groups.get(n)) {
        out.push('<div class="entry">');
        out.push('<div class="name">' + escHtml(it.name || '未命名') + '</div>');
        out.push('<div class="fx">$' + escHtml(String(it.formula).trim()) + '$</div>');
        const note = String(it.formulaNote || it.content || '').trim();
        if (note) out.push('<div class="note">' + escHtml(note) + '</div>');
        out.push('</div>');
      }
    });
  }

  out.push('<script>' + katexInline().js + '<\/script>');
  out.push('<script>' + katexInline().auto + '<\/script>');
  out.push('</body></html>');

  const name = subject.name + ' · 公式合集.html';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
  });
  res.end(out.join('\n'));
}

function handleExportNotes(req, res, url) {
  const db = store.get();
  const subjectId = url.searchParams.get('subjectId') || '';
  const subject = db.subjects.find((s) => s.id === subjectId);
  if (!subject) return fail(res, 404, '科目不存在');
  const format = (url.searchParams.get('format') || 'md').toLowerCase();

  const items = db.items.filter((i) => i.subjectId === subjectId);
  const cats = db.categories.filter((c) => c.subjectId === subjectId);
  const byParent = new Map();
  for (const c of cats) {
    const k = c.parentId || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0));

  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = [];
  const isHtml = format === 'html';
  if (isHtml) {
    lines.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">');
    lines.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
    lines.push('<title>' + escHtml(subject.name) + ' · 学习笔记</title>');
    lines.push('<style>body{max-width:820px;margin:40px auto;padding:0 20px;font:16px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#28302b;background:#fbf8f1}h1{font-size:26px}h2{margin-top:36px;border-bottom:1px solid #e6ddca;padding-bottom:6px}h3{margin-top:26px;font-size:18px}.meta{color:#8a8272;font-size:13px}.body{white-space:pre-wrap}.formula{margin:8px 0}.tag{display:inline-block;background:#f0ebdf;color:#7b7364;border-radius:5px;padding:1px 7px;font-size:12px;margin-right:4px}figure{margin:16px 0;text-align:center}figure svg{max-width:100%;height:auto}figcaption{color:#8a8272;font-size:12px}</style>');
    lines.push('</head><body>');
  }
  lines.push((isHtml ? '<h1>' : '# ') + subject.name + (isHtml ? '</h1>' : ' · 学习笔记'));
  lines.push('');
  lines.push((isHtml ? '<p class="meta">' : '> ') + '导出时间 ' + stamp + ' · 共 ' + items.length + ' 条（不含课件原图）' + (isHtml ? '</p>' : ''));
  lines.push('');

  const renderItem = (it) => {
    const out = [];
    out.push(isHtml ? '<h3>' + escHtml(it.name) + '</h3>' : '### ' + it.name);
    out.push('');
    const body = wrapBareMath(String(it.content || '').trim());
    if (body) out.push(isHtml ? '<div class="body">' + escHtml(body) + '</div>' : body);
    if (it.formula) {
      out.push('');
      out.push(isHtml ? '<div class="formula">$' + escHtml(it.formula) + '$</div>' : '$' + it.formula + '$');
    }
    const svg = String(it.svg || '').trim();
    if (svg) {
      out.push('');
      out.push('<figure>' + injectSymbols(svg) + '<figcaption>AI 生成配图，细节请对照正文核对</figcaption></figure>');
    }
    const tags = Array.isArray(it.tags) ? it.tags : [];
    const src = (() => {
      const sl = db.slides.find((s) => s.id === it.slideId);
      const dk = sl ? db.decks.find((d) => d.id === sl.deckId) : null;
      if (sl && dk) return dk.title + ' · 第 ' + sl.index + ' 页';
      return it.manual ? '手动笔记' : '';
    })();
    if (tags.length || src) {
      out.push('');
      const meta = [];
      if (tags.length) meta.push(tags.map((x) => (isHtml ? '<span class="tag">' + escHtml(x) + '</span>' : '`' + x + '`')).join(isHtml ? '' : ' '));
      if (src) meta.push(isHtml ? '<span class="meta">' + escHtml(src) + '</span>' : '_' + src + '_');
      out.push(meta.join(isHtml ? ' ' : ' · '));
    }
    out.push('');
    return out;
  };

  const used = new Set();
  const walk = (parentId, depth) => {
    const list = byParent.get(parentId) || [];
    for (const c of list) {
      const own = items.filter((i) => i.categoryId === c.id);
      if (own.length) {
        lines.push(isHtml ? '<h2>' + escHtml(c.name) + '</h2>' : (depth <= 1 ? '## ' : '### ') + c.name);
        lines.push('');
        own.forEach((it) => {
          used.add(it.id);
          lines.push(...renderItem(it));
        });
      }
      walk(c.id, depth + 1);
    }
  };
  walk('', 0);

  const rest = items.filter((i) => !used.has(i.id));
  if (rest.length) {
    lines.push(isHtml ? '<h2>未归类</h2>' : '## 未归类');
    lines.push('');
    rest.forEach((it) => lines.push(...renderItem(it)));
  }

  if (isHtml) lines.push('</body></html>');
  const text = lines.join('\n');
  const name = subject.name + '-学习笔记-' + new Date().toISOString().slice(0, 10) + (isHtml ? '.html' : '.md');
  res.writeHead(200, {
    'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
  });
  res.end(text);
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function handleExportBackup(req, res, url) {
  const db = store.get();
  const subjectId = url.searchParams.get('subjectId');
  const single = !!subjectId;

  const subject = single ? db.subjects.find((s) => s.id === subjectId) : null;
  if (single && !subject) return fail(res, 400, '科目不存在');

  const inScope = (x) => !single || x.subjectId === subjectId;
  const subjects = single ? [subject] : db.subjects;
  const decks = db.decks.filter(inScope);
  const slides = db.slides.filter(inScope);
  const items = db.items.filter(inScope);
  const categories = db.categories.filter(inScope);

  const manifest = {
    app: 'Make Your Notes',
    kind: single ? 'subject-backup' : 'full-backup',
    version: 4,
    exportedAt: store.now(),
    settings: single ? undefined : exportableSettings(db.settings),
    usage: single ? undefined : { global: db.usage, daily: db.usageDaily || {} },
    subject: single
      ? { id: subject.id, name: subject.name, color: subject.color, organizePrompt: subject.organizePrompt || '' }
      : undefined,
    subjects: single ? undefined : subjects.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      organizePrompt: s.organizePrompt || '',
      usage: s.usage || null,
      createdAt: s.createdAt,
    })),
    decks: decks.map((d) => ({
      id: d.id,
      subjectId: d.subjectId,
      title: d.title,
      createdAt: d.createdAt,
    })),
    slides: slides.map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      deckId: s.deckId,
      index: s.index,
      title: s.title,
      status: s.status,
      summary: s.summary,
      ocrText: s.ocrText,
      formulas: s.formulas,
      uncertain: s.uncertain,
      image: s.image,
      thumb: s.thumb,
      digest: s.digest || '',
      usage: s.usage,
      createdAt: s.createdAt,
    })),
    items: items.map((i) => ({
      id: i.id,
      subjectId: i.subjectId,
      slideId: i.slideId,
      deckId: i.deckId,
      kind: i.kind,
      name: i.name,
      content: i.content,
      quote: i.quote,
      importance: i.importance,
      tags: i.tags,
      categoryId: i.categoryId,
      order: i.order,
      manual: !!i.manual,
      formula: i.formula || '',
      svg: i.svg || '',
      draw: i.draw || '',
      createdAt: i.createdAt,
    })),
    categories: categories.map((c) => ({
      id: c.id,
      subjectId: c.subjectId,
      parentId: c.parentId,
      name: c.name,
      order: c.order,
      depth: c.depth,
    })),
  };

  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    ...backupImageEntries(slides),
  ];
  const buf = zip(entries);
  const fileName = single
    ? `${subject.name}-完整备份.zip`
    : `MakeYourNotes-全部科目-${store.now().slice(0, 10)}.zip`;

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

/** 把一个科目的内容合并进库（同名科目直接合并，页面按图片哈希去重） */
function mergeSubjectPack(db, files, meta, packs) {
  const wanted = String(meta.name || '').trim().slice(0, 40) || '未命名科目';
  let subject = db.subjects.find((s) => s.name.trim() === wanted);
  const merged = !!subject;
  if (!subject) {
    subject = {
      id: store.newId('sub'),
      name: wanted,
      color: meta.color || '#2b5d4b',
      organizePrompt: String(meta.organizePrompt || '').slice(0, 2000),
      usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedCost: 0, calls: 0 },
      createdAt: meta.createdAt || store.now(),
    };
    db.subjects.push(subject);
  }
  const subjectId = subject.id;
  if (meta.usage) {
    const cur = subject.usage || {};
    subject.usage = {
      promptTokens: Math.max(cur.promptTokens || 0, meta.usage.promptTokens || 0),
      completionTokens: Math.max(cur.completionTokens || 0, meta.usage.completionTokens || 0),
      cachedTokens: Math.max(cur.cachedTokens || 0, meta.usage.cachedTokens || 0),
      estimatedCost: Math.max(cur.estimatedCost || 0, meta.usage.estimatedCost || 0),
      calls: Math.max(cur.calls || 0, meta.usage.calls || 0),
    };
  }
  const stats = { subjectId, subjectName: subject.name, merged, decks: 0, slides: 0, items: 0, skipped: 0 };

  // 课件：同名复用
  const deckMap = new Map();
  for (const d of packs.decks) {
    const title = String(d.title || '课件').slice(0, 80);
    let node = db.decks.find((x) => x.subjectId === subjectId && x.title === title);
    if (!node) {
      node = { id: store.newId('deck'), subjectId, title, createdAt: d.createdAt || store.now() };
      db.decks.push(node);
      stats.decks++;
    }
    deckMap.set(d.id, node.id);
  }

  // 页面：图片内容相同就视为同一页
  const existingHashes = new Set();
  for (const s of db.slides.filter((x) => x.subjectId === subjectId)) {
    if (!s.image) continue;
    try {
      const buf = fs.readFileSync(path.join(store.IMAGES_DIR, s.image));
      existingHashes.add(crypto.createHash('sha1').update(buf).digest('hex'));
    } catch {}
  }

  const slideMap = new Map();
  const reused = new Set();
  for (const s of packs.slides) {
    const deckId = deckMap.get(s.deckId);
    if (!deckId) {
      stats.skipped++;
      continue;
    }
    const imgEntry = s.image ? files.get('images/' + path.basename(s.image)) : null;
    if (!imgEntry) {
      stats.skipped++;
      continue;
    }
    const hash = crypto.createHash('sha1').update(imgEntry).digest('hex');
    if (existingHashes.has(hash)) {
      reused.add(s.id);
      continue;
    }
    existingHashes.add(hash);

    const id = store.newId('sl');
    const ext = path.extname(path.basename(s.image)) || '.jpg';
    const image = id + ext;
    fs.writeFileSync(path.join(store.IMAGES_DIR, image), imgEntry);

    let thumb = image;
    const thumbEntry = s.thumb ? files.get('images/' + path.basename(s.thumb)) : null;
    if (thumbEntry) {
      thumb = id + '_t' + (path.extname(path.basename(s.thumb)) || '.jpg');
      fs.writeFileSync(path.join(store.IMAGES_DIR, thumb), thumbEntry);
    }

    slideMap.set(s.id, id);
    db.slides.push({
      id,
      subjectId,
      deckId,
      index: Number(s.index) || db.slides.filter((x) => x.deckId === deckId).length + 1,
      title: String(s.title || ''),
      status: s.status === 'done' ? 'done' : 'pending',
      error: '',
      summary: String(s.summary || ''),
      ocrText: String(s.ocrText || ''),
      formulas: Array.isArray(s.formulas) ? s.formulas : [],
      uncertain: Array.isArray(s.uncertain) ? s.uncertain : [],
      digest: String(s.digest || ''),
      image,
      thumb,
      usage: s.usage || null,
      createdAt: s.createdAt || store.now(),
    });
    stats.slides++;
  }

  // 分类：同一父级下同名复用
  const catMap = new Map();
  const oldCats = new Map(packs.categories.map((c) => [c.id, c]));
  const mapCat = (oldId) => {
    if (!oldId) return null;
    if (catMap.has(oldId)) return catMap.get(oldId);
    const c = oldCats.get(oldId);
    if (!c) return null;
    const parentId = c.parentId ? mapCat(c.parentId) : null;
    const name = String(c.name || '目录').slice(0, 40);
    let node = db.categories.find((x) => x.subjectId === subjectId && x.parentId === parentId && x.name === name);
    if (!node) {
      node = {
        id: store.newId('cat'),
        subjectId,
        parentId,
        name,
        order: Number(c.order) || 0,
        depth: Number(c.depth) || 0,
        count: 0,
      };
      db.categories.push(node);
    }
    catMap.set(oldId, node.id);
    return node.id;
  };
  for (const c of packs.categories) mapCat(c.id);

  // 知识点
  for (const it of packs.items) {
    const oldSlide = it.slideId || null;
    if (oldSlide && !slideMap.has(oldSlide)) {
      if (reused.has(oldSlide)) stats.skipped++;
      continue;
    }
    const slideId = oldSlide ? slideMap.get(oldSlide) : null;
    const deckId = slideId ? db.slides.find((s) => s.id === slideId)?.deckId || null : null;

    const name = String(it.name || '').slice(0, 120);
    const content = String(it.content || '').slice(0, 4000);
    if (!slideId) {
      const dup = db.items.some(
        (x) => x.subjectId === subjectId && !x.slideId && x.name === name && x.content === content
      );
      if (dup) {
        stats.skipped++;
        continue;
      }
    }

    db.items.push({
      id: store.newId('it'),
      slideId,
      deckId,
      subjectId,
      kind: it.kind === 'extension' ? 'extension' : 'point',
      name,
      content,
      quote: String(it.quote || '').slice(0, 600),
      importance: Number(it.importance) || 0,
      tags: Array.isArray(it.tags) ? it.tags : [],
      categoryId: it.categoryId ? catMap.get(it.categoryId) || null : null,
      order: Number(it.order) || 0,
      createdAt: it.createdAt || store.now(),
      manual: !!it.manual,
      formula: cleanFormulaText(it.formula),
      svg: cleanSvg(it.svg),
      draw: cleanDraw(it.draw),
      versions: [],
    });
    stats.items++;
  }

  return stats;
}

async function handleRestoreBackup(req, res) {
  const buf = await readBuffer(req);
  if (!buf.length) return fail(res, 400, '没有收到备份文件');

  let files;
  try {
    files = unzip(buf);
  } catch (e) {
    return fail(res, 400, '无法读取这个 zip：' + e.message);
  }

  const mf = files.get('manifest.json');
  if (!mf) return fail(res, 400, '备份里缺少 manifest.json，可能不是本应用的备份');

  let m;
  try {
    m = JSON.parse(mf.toString('utf8'));
  } catch {
    return fail(res, 400, 'manifest.json 解析失败');
  }

  const full = m.kind === 'full-backup' || (!m.kind && Array.isArray(m.subjects));
  if (!full && (!m.subject || !m.subject.name)) return fail(res, 400, '备份内容不完整');
  const metas = full ? m.subjects || [] : [m.subject];
  if (!metas.length) return fail(res, 400, '备份里没有科目');

  const baseId = full ? null : m.subject.id || '__single__';
  const withSubject = (arr) => (arr || []).map((x) => ({ ...x, subjectId: x.subjectId || baseId }));
  const decks = withSubject(m.decks);
  const slides = withSubject(m.slides);
  const items = withSubject(m.items);
  const categories = withSubject(m.categories);

  const db = store.get();
  if (full && m.settings) applyBackupSettings(db, m.settings);
  if (full && m.usage) mergeBackupUsage(db, m.usage);

  const results = [];
  for (const meta of metas) {
    const sid = meta.id || baseId;
    results.push(
      mergeSubjectPack(
        db,
        files,
        meta,
        {
          decks: decks.filter((d) => d.subjectId === sid),
          slides: slides.filter((s) => s.subjectId === sid),
          items: items.filter((i) => i.subjectId === sid),
          categories: categories.filter((c) => c.subjectId === sid),
        }
      )
    );
  }

  // 重新统计分类条目数
  const touched = new Set(results.map((r) => r.subjectId));
  for (const c of db.categories.filter((x) => touched.has(x.subjectId))) {
    c.count = db.items.filter((i) => i.categoryId === c.id).length;
  }

  store.save();
  const sum = (k) => results.reduce((n, r) => n + (r[k] || 0), 0);
  const first = results[0] || {};
  send(res, 200, {
    scope: full ? 'full' : 'subject',
    results,
    subjectId: first.subjectId,
    merged: first.merged,
    subjectName: first.subjectName,
    imported: { decks: sum('decks'), slides: sum('slides'), items: sum('items'), skipped: sum('skipped') },
    state: publicState(),
  });
}

async function handleReset(req, res) {
  const db = store.get();
  for (const s of db.slides) {
    store.removeImage(s.image);
    store.removeImage(s.thumb);
  }
  db.subjects = [];
  db.decks = [];
  db.slides = [];
  db.items = [];
  db.categories = [];
  store.resetUsage();
  store.save();
  send(res, 200, publicState());
}

/* ------------------------------------------------------------------ */
/* 导出产物（思维导图 PNG 等）：先生成到内存，再走下载                    */
/* ------------------------------------------------------------------ */

const artifacts = new Map(); // id -> { buf, type, name, at }

async function handleCreateArtifact(req, res) {
  const body = await readJson(req);
  const m = /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
  if (!m) return fail(res, 400, '只支持 PNG 数据');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return fail(res, 413, '图片太大（上限 8MB）');

  const id = crypto.randomBytes(8).toString('hex');
  artifacts.set(id, {
    buf,
    type: m[1],
    name: String(body.name || 'mindmap.png').slice(0, 80),
    at: Date.now(),
  });
  // 只保留最近 20 份
  if (artifacts.size > 20) {
    const oldest = [...artifacts.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) artifacts.delete(oldest[0]);
  }
  send(res, 200, { url: `/api/artifacts/${id}` });
}

function serveArtifact(res, id) {
  const a = artifacts.get(id);
  if (!a) return fail(res, 404, '文件已过期，请重新导出');
  res.writeHead(200, {
    'Content-Type': a.type,
    'Content-Length': a.buf.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
    'Cache-Control': 'no-store',
  });
  res.end(a.buf);
}

/* ------------------------------------------------------------------ */
/* 后台识别队列：由服务端执行，浏览器关了也会继续                        */
/* ------------------------------------------------------------------ */

const work = { queue: [], active: 0, total: 0, done: 0, failed: 0, subjects: new Set() };

function enqueueSlides(ids) {
  const db = store.get();
  if (!work.active && !work.queue.length) {
    work.total = 0;
    work.done = 0;
    work.failed = 0;
    work.subjects.clear();
  }
  for (const id of ids) {
    const s = db.slides.find((x) => x.id === id);
    if (!s || s.status === 'running') continue;
    if (work.queue.includes(id)) continue;
    work.queue.push(id);
    work.total++;
    work.subjects.add(s.subjectId);
  }
  pump();
  return work;
}

let rateLimitUntil = 0;
let serialMode = false;
let pumpTimer = null;

function pump() {
  const db = store.get();

  // 刚被限流过：先等一会儿，再用单线程慢慢跑
  const cool = rateLimitUntil - Date.now();
  if (cool > 0) {
    if (!pumpTimer) {
      pumpTimer = setTimeout(() => {
        pumpTimer = null;
        pump();
      }, Math.min(cool, 5000));
    }
    return;
  }

  const configured = Math.max(1, Math.min(4, Number(db.settings.concurrency) || 2));
  const conc = serialMode ? 1 : configured;
  while (work.active < conc && work.queue.length) {
    const id = work.queue.shift();
    work.active++;
    performExtraction(id)
      .then(() => {
        work.done++;
      })
      .catch(() => {
        work.failed++;
      })
      .finally(() => {
        work.active--;
        pump();
        if (!work.active && !work.queue.length) finishBatch();
      });
  }
}

async function finishBatch() {
  const db = store.get();
  serialMode = false;
  rateLimitUntil = 0;
  const subjects = [...work.subjects];
  work.subjects.clear();
  if (!db.settings.autoOrganize || !subjects.length) return;
  for (const sid of subjects) {
    const hasPoints = db.items.some((i) => i.subjectId === sid && i.kind === 'point');
    if (!hasPoints) continue;
    try {
      await organizeSubject(sid);
    } catch {}
  }
}

async function handleProcess(req, res) {
  const body = await readJson(req);
  const db = store.get();
  if (!db.settings.mock && !store.getApiKey()) {
    return fail(res, 400, '还没有配置 API Key，请先在设置中填写');
  }

  let ids = [];
  if (Array.isArray(body.ids) && body.ids.length) {
    ids = body.ids.filter((id) => db.slides.some((s) => s.id === id));
  } else {
    ids = db.slides
      .filter(
        (s) =>
          (s.status === 'pending' || s.status === 'error') &&
          (!body.deckId || s.deckId === body.deckId) &&
          (!body.subjectId || s.subjectId === body.subjectId)
      )
      .map((s) => s.id);
  }

  if (!ids.length) return send(res, 200, { queued: 0, state: publicState() });
  enqueueSlides(ids);
  send(res, 200, { queued: ids.length, state: publicState() });
}

async function handleRotateToken(req, res) {
  const db = store.get();
  db.settings.shareToken = crypto.randomBytes(8).toString('hex');
  store.save();
  send(res, 200, publicState());
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

function serveFile(res, filePath, cache) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache || 'no-cache',
    });
    res.end(buf);
  });
}

function serveMedia(res, name) {
  const safe = path.basename(name);
  if (!/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/.test(safe)) {
    res.writeHead(403);
    return res.end();
  }
  serveFile(res, path.join(store.IMAGES_DIR, safe), 'public, max-age=31536000, immutable');
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const m = req.method;

  if (!allowRequest(req, res, url)) return;

  if (m === 'GET' && (p === '/healthz' || p === '/api/health')) {
    return send(res, 200, { ok: true, node: process.version, embedded: EMBEDDED });
  }

  if (p.startsWith('/media/')) return serveMedia(res, decodeURIComponent(p.slice(7)));

  if (!p.startsWith('/api/')) {
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const filePath = path.resolve(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end();
    }
    return serveFile(res, filePath);
  }

  // API
  if (m === 'GET' && p === '/api/state') return send(res, 200, publicState());
  if (m === 'POST' && p === '/api/settings') return handleSettings(req, res);
  if (m === 'POST' && p === '/api/settings/test') return handleTest(req, res);
  if (m === 'POST' && p === '/api/settings/rotate-token') return handleRotateToken(req, res);
  if (m === 'POST' && p === '/api/process') return handleProcess(req, res);
  if (m === 'POST' && p === '/api/artifacts') return handleCreateArtifact(req, res);
  const artifactMatch = p.match(/^\/api\/artifacts\/([a-f0-9]+)$/);
  if (m === 'GET' && artifactMatch) return serveArtifact(res, artifactMatch[1]);
  if (m === 'POST' && p === '/api/reset') return handleReset(req, res);

  if (m === 'POST' && p === '/api/subjects') return handleCreateSubject(req, res);
  let mm;
  if ((mm = p.match(/^\/api\/subjects\/([\w-]+)$/))) {
    if (m === 'PATCH' || m === 'PUT') return handleUpdateSubject(req, res, mm[1]);
    if (m === 'DELETE') return handleDeleteSubject(req, res, mm[1]);
  }
  if ((mm = p.match(/^\/api\/subjects\/([\w-]+)\/organize$/)) && m === 'POST') {
    return handleOrganize(req, res, mm[1]);
  }
  if ((mm = p.match(/^\/api\/decks\/([\w-]+)$/))) {
    if (m === 'PATCH' || m === 'PUT') return handleUpdateDeck(req, res, mm[1]);
    if (m === 'DELETE') return handleDeleteDeck(req, res, mm[1]);
  }
  if (m === 'POST' && p === '/api/slides') return handleAddSlide(req, res);
  if (m === 'POST' && p === '/api/items') return handleCreateItem(req, res);
  if (m === 'POST' && p === '/api/ai/compose') return handleCompose(req, res);
  if (m === 'POST' && p === '/api/items/fix-extension-names') return handleFixExtensionNames(req, res);
  if (m === 'POST' && p === '/api/items/repair-drawings') return handleRepairDrawings(req, res);
  if (m === 'GET' && p === '/api/export-formulas') return handleExportFormulas(req, res, url);
  if (m === 'GET' && p === '/api/export-notes') return handleExportNotes(req, res, url);
  if (m === 'POST' && p === '/api/export-map') return handleExportMapPost(req, res);
  if (m === 'POST' && p === '/api/practice') return handlePractice(req, res);
  if (m === 'GET' && p === '/api/practice/pdf') return handlePracticePdf(req, res, url);
  if (m === 'POST' && p === '/api/export-notes-doc') return handleExportNotesDoc(req, res);
  if (m === 'GET' && p === '/api/export-notes-doc') return handleExportNotesDocGet(req, res, url);
  if (m === 'GET' && p === '/api/export-map') return handleExportMapGet(req, res, url);
  if (m === 'POST' && /^\/api\/decks\/[^/]+\/summarize$/.test(p)) return handleSummarizeDeck(req, res, p.split('/')[3]);
  if (m === 'POST' && /^\/api\/slides\/[^/]+\/digest$/.test(p)) return handleDigestSlide(req, res, p.split('/')[3]);
  if ((mm = p.match(/^\/api\/slides\/([\w-]+)\/extract$/)) && m === 'POST') {
    return handleExtract(req, res, mm[1]);
  }
  if ((mm = p.match(/^\/api\/slides\/([\w-]+)\/refine$/)) && m === 'POST') {
    return handleRefineSlide(req, res, mm[1]);
  }
  if ((mm = p.match(/^\/api\/items\/([\w-]+)\/refine$/)) && m === 'POST') {
    return handleRefineItem(req, res, mm[1]);
  }
  if ((mm = p.match(/^\/api\/items\/([\w-]+)\/revert$/)) && m === 'POST') {
    return handleRevertItem(req, res, mm[1]);
  }
  if ((mm = p.match(/^\/api\/slides\/([\w-]+)$/)) && m === 'DELETE') {
    return handleDeleteSlide(req, res, mm[1]);
  }
  if ((mm = p.match(/^\/api\/items\/([\w-]+)$/))) {
    if (m === 'PATCH' || m === 'PUT') return handleUpdateItem(req, res, mm[1]);
    if (m === 'DELETE') return handleDeleteItem(req, res, mm[1]);
  }
  if (m === 'GET' && p === '/api/export') return handleExport(req, res, url);
  if (m === 'GET' && p === '/api/export-backup') return handleExportBackup(req, res, url);
  if (m === 'POST' && p === '/api/backup/restore') return handleRestoreBackup(req, res);

  return fail(res, 404, '接口不存在：' + m + ' ' + p);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {}
}

function cleanupPid() {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (pid === process.pid) fs.unlinkSync(PID_FILE);
  } catch {}
}

process.on('exit', cleanupPid);
process.on('SIGINT', () => {
  cleanupPid();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupPid();
  process.exit(0);
});

function start(port, attempt = 0) {
  store.init();

  // 已有实例在跑就直接退出，避免后台重复启动占端口（手机端不适用：PID 可能被系统复用）
  if (!EMBEDDED && attempt === 0 && fs.existsSync(PID_FILE)) {
    try {
      const oldPid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
      if (oldPid && oldPid !== process.pid) {
        process.kill(oldPid, 0);
        console.log(`\n  已经在运行（进程 ${oldPid}）。\n  打开 http://127.0.0.1:${port} 即可，无需重复启动。\n`);
        process.exit(0);
      }
    } catch {}
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) return;
      send(res, e.status || 500, { error: e.message || '服务器内部错误' });
    });
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < 10) {
      return start(port + 1, attempt + 1);
    }
    console.error('启动失败：', e.message);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    activePort = port;
    try {
      fs.writeFileSync(PID_FILE, String(process.pid));
    } catch {}

    const local = `http://127.0.0.1:${port}`;
    const db = store.get();
    const lan = `http://${lanAddress()}:${port}`;
    const phoneUrl = `${lan}/?k=${db.settings.shareToken}`;

    console.log('\n  Make Your Notes');
    console.log('  ' + '─'.repeat(48));
    console.log('  电脑访问   ' + local);
    if (db.settings.allowLan) {
      console.log('  手机访问   ' + lan);
      console.log('  手机扫码   在电脑上点左下角「手机访问」');
    } else {
      console.log('  手机访问   已关闭（设置 → 允许手机访问 打开）');
    }
    console.log('  数据目录   ' + store.DATA_DIR);
    console.log('  关闭此窗口即退出；后台运行请用「后台启动.vbs」\n');

    openBrowser(local);
  });
}

const PORT = Number(process.env.PORT) || 8713;

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`\n  需要 Node.js 18 或更高版本，当前为 v${process.versions.node}。`);
  console.error('  请到 https://nodejs.org/ 下载安装后重试。\n');
  process.exit(1);
}

start(PORT);
