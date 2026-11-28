'use strict';

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};
const fmtTokens = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n || 0));
const money = (n) => {
  n = Number(n) || 0;
  if (!n) return '¥0.00';
  if (n < 0.001) return '¥' + n.toFixed(4);
  if (n < 0.1) return '¥' + n.toFixed(3);
  return '¥' + n.toFixed(2);
};

/* 数学公式渲染：$...$ / $$...$$ / \(...\) / \[...\] */
const MATH_PATTERN = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]{1,300}\$)/g;

function nl2br(html) {
  return html.replace(/\n/g, '<br>');
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

/** 判断 $…$ 里是不是真公式：中文、纯数字（常是金额）、过长的一律不渲染 */
function looksLikeMath(expr, display) {
  const t = String(expr == null ? '' : expr).trim();
  if (!t) return false;
  if (display) return true;
  if (t.length > 300) return false;
  if (/^\d+([.,]\d+)?$/.test(t)) return false;
  const mathMark = /[\\^_{}=+\-*/<>≤≥±×·÷∫∑√πθαβγλμσΔ]/.test(t);
  // 含中文时，只有确实带数学符号（如 $\text{面积}=S$）才当公式，避免吞掉普通文字
  if (/[\u4e00-\u9fa5]/.test(t)) return mathMark && /\\|\^|_|=/.test(t);
  return mathMark || /^[A-Za-z][A-Za-z0-9 ]{0,12}$/.test(t);
}

function renderMath(text) {
  const wrapped = wrapBareMath(text);
  if (!window.katex) return nl2br(esc(wrapped));
  // 行内代码 `…` 里的内容不参与公式渲染：先挖掉，最后原样填回
  const codes = [];
  const raw = wrapped.replace(/`[^`\n]*`/g, (mm) => {
    codes.push(mm);
    return '\u0003' + (codes.length - 1) + '\u0003';
  });
  let out = '';
  let last = 0;
  let m;
  MATH_PATTERN.lastIndex = 0;
  while ((m = MATH_PATTERN.exec(raw))) {
    out += nl2br(esc(raw.slice(last, m.index)));
    const token = m[0];
    let expr = token;
    let display = false;
    if (token.startsWith('$$')) {
      expr = token.slice(2, -2);
      display = true;
    } else if (token.startsWith('\\[')) {
      expr = token.slice(2, -2);
      display = true;
    } else if (token.startsWith('\\(')) {
      expr = token.slice(2, -2);
    } else {
      expr = token.slice(1, -1);
    }
    if (!looksLikeMath(expr, display)) {
      // 判定不是公式：含中文的一律去掉 $ 定界符（多半是误配对的句子），
      // 纯数字/英文保留原样（可能是金额 $5 这种写法）
      out += /[\u4e00-\u9fa5]/.test(expr) ? esc(expr) : esc(token);
      last = m.index + token.length;
      continue;
    }
    try {
      const rendered = window.katex.renderToString(slashToFrac(expr), {
        displayMode: display,
        throwOnError: false,
        strict: false,
      });
      // KaTeX 渲染失败时会塞一个红色的 katex-error；这时宁可显示原始写法，也别显示报错
      if (/katex-error/.test(rendered)) out += `<code class="mathfail">${esc(token)}</code>`;
      else out += rendered;
    } catch {
      out += `<code class="mathfail">${esc(token)}</code>`;
    }
    last = m.index + token.length;
  }
  out += nl2br(esc(raw.slice(last)));
  // 还原被保护的行内代码
  out = out.replace(/\u0003(\d+)\u0003/g, (mm, i) => nl2br(esc(codes[Number(i)])));
  return out;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 3z"/><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16z"/>',
  tree: '<path d="M12 4v4M12 12H6v3M12 12h6v3M12 8v4"/><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="3" y="15" width="6" height="4" rx="1"/><rect x="15" y="15" width="6" height="4" rx="1"/>',
  download: '<path d="M12 4v10m0 0l-4-4m4 4l4-4"/><path d="M4 18h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 2.6h.1A1.7 1.7 0 0 0 8.3 1V1a2 2 0 1 1 4 0v.1"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5L21 2m-4 4l3 3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};

function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

let S = null;
const ui = {
  subjectId: null,
  view: 'decks',
  q: '',
  filter: 'all',
  modal: null,
  ask: null,
  mindmap: null,
  catView: 'list',
  scale: 1,
  sort: 'page',
  usageRange: 'day',
  expanded: new Set(),
  deckOpen: new Set(),
  select: { on: false, ids: new Set() },
  renderTimer: null,
  uploadDeckId: null,
  uploading: false,
};

/* 界面缩放：0.9 / 1 / 1.1 / 1.2，通过 CSS zoom 实现，布局高度同步补偿 */
function applyUiScale(v) {
  const s = Math.min(1.3, Math.max(0.8, Number(v) || 1));
  ui.scale = s;
  document.documentElement.style.setProperty('--ui-scale', String(s));
}

try {
  const saved = Number(localStorage.getItem('mn.scale'));
  if (saved) applyUiScale(saved);
} catch {}

async function api(path, body, method) {  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(path, opt);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

async function refresh() {
  const data = await api('/api/state');
  S = data;
  if (!S.subjects.some((s) => s.id === ui.subjectId)) {
    ui.subjectId = S.subjects[0]?.id || null;
  }
}

/* ---------- 服务端识别队列：浏览器关了也会继续 ---------- */

let pollTimer = null;

function isBusy() {
  const p = S?.processing;
  return !!p && (p.active > 0 || p.queued > 0);
}

function updateQueueBar() {
  if (!S) return;
  const p = S.processing;
  if (p && (p.active > 0 || p.queued > 0)) {
    const finished = (p.done || 0) + (p.failed || 0);
    const total = p.total || finished;
    showQueue(`后台识别中 ${finished} / ${total}${p.failed ? ` · 失败 ${p.failed}` : ''}`);
  } else if (!ui.uploading) {
    hideQueue();
  }
}

function ensurePolling() {
  if (isBusy() && !pollTimer) {
    pollTimer = setInterval(async () => {
      try {
        S = await api('/api/state');
        const el = document.activeElement;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        if (!typing) {
          render();
          updateQueueBar();
        }
        if (!isBusy()) stopPolling();
      } catch {}
    }, 1600);
    updateQueueBar();
  } else if (!isBusy()) {
    stopPolling();
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  updateQueueBar();
}

async function startProcessing(payload) {
  try {
    const res = await api('/api/process', payload);
    S = res.state;
    render();
    if (res.queued) {
      toast(`已开始后台识别 ${res.queued} 页`);
      ensurePolling();
    } else {
      toast('没有待识别的页面');
    }
  } catch (e) {
    toast(e.message, 'err');
  }
}

function currentSubject() {
  return S?.subjects.find((s) => s.id === ui.subjectId) || null;
}

/* ------------------------------------------------------------------ */
/* 渲染：侧栏                                                          */
/* ------------------------------------------------------------------ */

function pointsOf(subjectId) {
  return S.items.filter((i) => i.subjectId === subjectId && i.kind === 'point').length;
}

function renderSidebar() {
  const subs = S.subjects;
  $('#sidebar').innerHTML = `
    <div class="brand">
      <div class="brand-mark">M</div>
      <div>
        <div class="brand-title">Make Your Notes</div>
        <div class="brand-sub">Local · DeepSeek</div>
      </div>
    </div>
    <div class="side-head">
      <span>科目</span>
      <button class="icon-btn" data-act="new-subject" title="新建科目">${icon('plus')}</button>
    </div>
    <div class="subject-list">
      ${
        subs.length
          ? subs
              .map(
                (s) => `
        <div class="subject ${s.id === ui.subjectId ? 'active' : ''}" data-act="select-subject" data-id="${s.id}">
          <span class="dot" style="background:${esc(s.color || '#2c5d4a')}"></span>
          <span class="name">${esc(s.name)}</span>
          <span class="count">${pointsOf(s.id) || ''}</span>
        </div>`
              )
              .join('')
          : `<div class="side-empty">还没有科目<br><button class="link" data-act="new-subject">创建第一个科目</button></div>`
      }
    </div>
    <div class="side-foot">
      <div class="usage" data-act="open-usage" title="查看用量明细">
        <span>累计消耗</span><b>${money(S.usage.estimatedCost)}</b>
      </div>
      <div class="usage-sub" data-act="open-usage">${S.usage.calls || 0} 次调用 · ${fmtTokens((S.usage.promptTokens || 0) + (S.usage.completionTokens || 0))} tokens · 明细</div>
      <div class="side-btns">
        ${S.share?.embedded ? '' : `<button class="btn ghost" data-act="open-phone">${icon('phone')} 手机访问</button>`}
        <button class="btn ghost" data-act="open-settings">${icon('settings')} 设置</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 渲染：顶栏                                                          */
/* ------------------------------------------------------------------ */

function renderTopbar() {
  const sub = currentSubject();
  if (!sub) {
    $('#topbar').innerHTML = '';
    return;
  }
  const decks = S.decks.filter((d) => d.subjectId === sub.id);
  const slides = S.slides.filter((s) => s.subjectId === sub.id);
  const pts = pointsOf(sub.id);
  const pending = slides.filter((s) => s.status === 'pending' || s.status === 'error').length;

  $('#topbar').innerHTML = `
    <div class="topbar-main">
      <h1><span class="subj-dot" style="background:${esc(sub.color || '#2c5d4a')}"></span>${esc(sub.name)}</h1>
      <div class="meta">${decks.length} 个课件 · ${slides.length} 页 · ${pts} 个知识点</div>
    </div>
    <div class="mobile-actions">
      <select class="subject-select" id="m-subject" aria-label="切换科目">
        ${S.subjects
          .map((s) => `<option value="${s.id}" ${s.id === ui.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`)
          .join('')}
      </select>
      <button class="btn" data-act="new-subject" aria-label="新建科目">${icon('plus')}</button>
      <button class="btn primary" data-act="upload" aria-label="上传">${icon('upload')}</button>
      <button class="btn icon-toggle ${S.settings.strictVerify ? 'on' : ''}" data-act="toggle-strict" aria-label="严格校对" title="严格校对：${S.settings.strictVerify ? '开' : '关'}">${icon('spark')}</button>
      <button class="btn" data-act="open-more" aria-label="更多">${icon('more')}</button>
    </div>
    <div class="topbar-actions desktop-only">
      ${pending ? `<button class="btn" data-act="extract-all">${icon('spark')} 识别待处理（${pending}）</button>` : ''}
      <button class="btn" data-act="organize" ${pts ? '' : 'disabled'}>${icon('tree')} 自动整理</button>
      <button class="btn chip-toggle ${S.settings.strictVerify ? 'on' : ''}" data-act="toggle-strict" title="开启后每页识别完再用原图校对一遍">${icon('spark')} 严格校对 ${S.settings.strictVerify ? '开' : '关'}</button>
      <div class="menu-wrap">
        <button class="btn" data-act="toggle-export">${icon('download')} 导出</button>
        <div class="menu" id="export-menu">
          <button data-act="export-md">${icon('file')} 导出 Markdown</button>
          <button data-act="export-notes">${icon('file')} 学习笔记（含配图）</button>
          <button data-act="export-notes-html">${icon('code')} 学习笔记（图文文档）</button>
          <button data-act="export-formulas">${icon('spark')} 公式合集（HTML/PDF）</button>
          <button data-act="export-map">${icon('tree')} 思维导图（SVG）</button>
          <button data-act="export-backup">${icon('download')} 完整备份（含设置与用量）</button>
          <button data-act="export-json">${icon('code')} 导出 JSON（仅文字）</button>
        </div>
      </div>
      <div class="menu-wrap">
        <button class="btn" data-act="toggle-subject-menu" title="科目操作">${icon('edit')}</button>
        <div class="menu" id="subject-menu">
          <button data-act="new-note">${icon('edit')} 手动写一条</button>
          <button data-act="open-criteria">${icon('file')} 分类标准</button>
          <button data-act="rename-subject">${icon('edit')} 重命名科目</button>
          <button data-act="delete-subject">${icon('trash')} 删除科目</button>
        </div>
      </div>
      <button class="btn primary" data-act="upload">${icon('upload')} 上传课件</button>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 渲染：视图切换                                                      */
/* ------------------------------------------------------------------ */

function renderViewbar() {
  const sub = currentSubject();
  if (!sub) {
    $('#viewbar').innerHTML = '';
    return;
  }
  const slides = S.slides.filter((s) => s.subjectId === sub.id).length;
  const pts = pointsOf(sub.id);
  $('#viewbar').innerHTML = `
    <div class="tabs">
      <button class="tab ${ui.view === 'decks' ? 'active' : ''}" data-act="view" data-view="decks">课件<span class="badge">${slides}</span></button>
      <button class="tab ${ui.view === 'items' ? 'active' : ''}" data-act="view" data-view="items">知识点<span class="badge">${pts}</span></button>
      <button class="tab ${ui.view === 'categories' ? 'active' : ''}" data-act="view" data-view="categories">分类</button>
    </div>
    ${
      ui.view === 'items'
        ? `<div class="search-wrap">${icon('search')}<input class="input" id="search" placeholder="搜索知识点、原文、标签…" value="${esc(ui.q)}"></div>`
        : ''
    }`;
}

/* ------------------------------------------------------------------ */
/* 渲染：课件视图                                                      */
/* ------------------------------------------------------------------ */

function statusChip(s) {
  if (s.status === 'running') return '<span class="chip running">识别中</span>';
  if (s.status === 'done') return '<span class="chip done">已完成</span>';
  if (s.status === 'error') return '<span class="chip error">失败</span>';
  return '<span class="chip pending">待识别</span>';
}

function slideCard(s) {
  const count = S.items.filter((i) => i.slideId === s.id && i.kind === 'point').length;
  const errText = s.status === 'error' ? String(s.error || '识别失败') : '';
  return `
    <div class="slide" data-act="open-slide" data-id="${s.id}" title="${esc(
      (s.title || '第 ' + s.index + ' 页') + (errText ? '｜' + errText : '')
    )}">
      <img src="/media/${esc(s.thumb || s.image)}" loading="lazy" alt="" />
      ${statusChip(s)}
      ${errText ? `<div class="slide-err">${esc(errText)}</div>` : ''}
      ${count ? `<span class="n">${count}</span>` : ''}
    </div>`;
}

function deckCard(d) {
  const slides = S.slides.filter((s) => s.deckId === d.id).sort((a, b) => a.index - b.index);
  const pending = slides.filter((s) => s.status === 'pending' || s.status === 'error').length;
  const pts = S.items.filter((i) => i.deckId === d.id && i.kind === 'point').length;
  const LIMIT = 6;
  const open = ui.deckOpen.has(d.id);
  const folded = !open && slides.length > LIMIT;
  return `
    <section class="deck">
      <div class="deck-head">
        <div>
          <div class="deck-title">${esc(d.title)} ${pending ? `<span class="pill">${pending} 页待识别</span>` : ''}</div>
          <div class="deck-meta">${slides.length} 页 · ${pts} 个知识点 · ${fmtDate(d.createdAt)} 上传</div>
        </div>
        <div class="deck-actions">
          ${pending ? `<button class="btn sm" data-act="extract-deck" data-id="${d.id}">${icon('spark')} 识别</button>` : ''}
          <button class="btn sm" data-act="summarize-deck" data-id="${d.id}" ${pts || slides.some((s) => s.status === 'done') ? '' : 'disabled'} title="用 AI 汇总这份课件的要点">${icon('file')} 本节总结</button>
          <button class="btn sm ghost" data-act="rename-deck" data-id="${d.id}" title="重命名">${icon('edit')}</button>
          <button class="btn sm ghost" data-act="delete-deck" data-id="${d.id}" title="删除">${icon('trash')}</button>
        </div>
      </div>
      <div class="thumbs ${folded ? 'folded' : ''}">${slides.map(slideCard).join('')}</div>
      ${slides.length > LIMIT
        ? `<button class="slides-more" data-act="toggle-deck" data-id="${d.id}">${open ? '收起' : `展开全部 ${slides.length} 页`}</button>`
        : ''}
      <div class="dropzone" data-act="upload" data-deck="${d.id}">${icon('plus')} 追加图片到这份课件</div>
    </section>`;
}

function emptyDeckView() {
  return `
    <div class="empty" data-act="upload">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.4"/><path d="M21 15l-5-5L5 21"/></svg>
      <b>这个科目还没有课件</b>
      <p>把上课拍的 PPT 图片加进来：${isTouchUi() ? '点下面按钮从相册选，或直接拍照' : '拖拽进来、或点下面按钮从相册选，也可以直接拍照'}。</p>
      <button class="btn primary" data-act="upload">${icon('upload')} 选择图片</button>
    </div>`;
}

function deckView() {
  const sub = currentSubject();
  const decks = S.decks
    .filter((d) => d.subjectId === sub.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!decks.length) return emptyDeckView();
  return decks.map(deckCard).join('') + `<div class="dropzone" data-act="upload">${icon('plus')} 新建一份课件并上传图片</div>`;
}

/* ------------------------------------------------------------------ */
/* 渲染：知识点视图                                                    */
/* ------------------------------------------------------------------ */

function itemCard(it) {
  const slide = S.slides.find((s) => s.id === it.slideId);
  const deck = S.decks.find((d) => d.id === it.deckId);
  const isExt = it.kind === 'extension';
  const imp = it.importance || 0;
  const picking = ui.select.on;
  const picked = picking && ui.select.ids.has(it.id);
  const lines = Number.isFinite(Number(S.settings.cardLines)) ? Number(S.settings.cardLines) : 4;
  const hideBody = lines === 0;
  const longContent = lines >= 1 && String(it.content || '').length > lines * 20;
  return `
    <article class="kcard ${isExt ? 'ext' : ''} ${picking ? 'pickable' : ''} ${picked ? 'picked' : ''}" ${picking ? `data-act="toggle-select" data-id="${it.id}"` : `data-act="open-item" data-item="${it.id}"`}>
      ${picking ? `<span class="pick-mark">${picked ? '✓' : ''}</span>` : ''}
      <div class="kcard-top">
        <span class="kindex">${isExt ? '拓展' : 'P' + (slide?.index || '')}</span>
        <h3>${renderMath(it.name)}</h3>
        ${it.formula ? '<span class="badge-svg">ƒ</span>' : ''}
        ${it.svg ? '<span class="badge-svg">图</span>' : ''}
        ${isExt ? '' : `<span class="imp">${'●'.repeat(imp)}<b>${'○'.repeat(5 - imp)}</b></span>`}
      </div>
      ${hideBody ? '' : `<div class="body ${longContent && !ui.expanded.has(it.id) ? 'clamp' : ''}">${renderMath(it.content)}</div>`}
      ${!hideBody && it.formula ? `<div class="kformula">${renderMath('$' + it.formula + '$')}</div>` : ''}
      ${longContent ? `<button class="kcard-more" data-act="expand-card" data-id="${it.id}">${ui.expanded.has(it.id) ? '收起' : '展开全文'}</button>` : ''}
      ${it.quote && S.settings.showQuote !== false ? `<blockquote>${renderMath(it.quote)}</blockquote>` : ''}
      <div class="kfoot">
        ${isExt ? '<span class="badge-ai">AI 补充 · 请核对</span>' : ''}
        ${it.tags?.length ? `<span class="tags">${it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
        ${
          picking
            ? `<span class="src">${slide ? `第 ${slide.index} 页` : '手动笔记'}</span>`
            : slide
              ? `<span class="src" data-act="open-slide" data-id="${it.slideId}" title="查看所在页面">${esc(deck?.title || '')} · 第 ${slide.index} 页</span>`
              : `<span class="src">手动笔记</span>`
        }
        ${
          picking
            ? ''
            : `<span class="acts">
                 <button data-act="edit-note" data-id="${it.id}" title="手动编辑这条（不走 AI）">${icon('edit')}</button>
                 <button data-act="refine-item" data-id="${it.id}" title="让 AI 修改或补充">${icon('spark')}</button>
                 <button data-act="delete-item" data-id="${it.id}" title="删除这条">${icon('trash')}</button>
               </span>`
        }
      </div>
    </article>`;
}

function itemsView() {
  const sub = currentSubject();
  let items = S.items.filter((i) => i.subjectId === sub.id);
  const total = items.length;

  if (ui.filter === 'point') items = items.filter((i) => i.kind === 'point');
  if (ui.filter === 'ext') items = items.filter((i) => i.kind === 'extension');
  if (ui.q.trim()) {
    const q = ui.q.trim().toLowerCase();
    items = items.filter((i) =>
      [i.name, i.content, i.quote, ...(i.tags || [])].join(' ').toLowerCase().includes(q)
    );
  }

  const order = (it) => {
    const sl = S.slides.find((s) => s.id === it.slideId);
    return (sl?.deckId || '') + String(sl?.index || 0).padStart(4, '0') + String(it.order || 0).padStart(3, '0');
  };
  const sorters = {
    page: (a, b) => order(a).localeCompare(order(b)),
    importance: (a, b) => (b.importance || 0) - (a.importance || 0) || order(a).localeCompare(order(b)),
    created: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    updated: (a, b) =>
      String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')),
  };
  items = [...items].sort(sorters[ui.sort] || sorters.page);

  const sel = ui.select;
  const filters = `
    <div class="filters">
      <button class="chipbtn ${ui.filter === 'all' ? 'active' : ''}" data-act="filter" data-f="all">全部 ${total}</button>
      <button class="chipbtn ${ui.filter === 'point' ? 'active' : ''}" data-act="filter" data-f="point">知识点</button>
      <button class="chipbtn ${ui.filter === 'ext' ? 'active' : ''}" data-act="filter" data-f="ext">拓展</button>
      <select class="select-sm" id="items-sort" aria-label="排序方式">
        <option value="page" ${ui.sort === 'page' ? 'selected' : ''}>按页面</option>
        <option value="importance" ${ui.sort === 'importance' ? 'selected' : ''}>按重要度</option>
        <option value="created" ${ui.sort === 'created' ? 'selected' : ''}>按创建时间</option>
        <option value="updated" ${ui.sort === 'updated' ? 'selected' : ''}>按最近修改</option>
      </select>
      <span style="margin-left:auto"></span>
      ${
        sel.on
          ? `<span class="sel-count">已选 ${sel.ids.size}</span>
             <button class="chipbtn" data-act="select-all">全选</button>
             <button class="chipbtn active" data-act="mm-selected" ${sel.ids.size ? '' : 'disabled'}>生成导图</button>
             <button class="chipbtn" data-act="select-off">取消</button>`
          : `<button class="chipbtn" data-act="new-note">＋ 手动笔记</button>
             <button class="chipbtn" data-act="open-draw">✎ 画图</button>
             <button class="chipbtn" data-act="select-on">选择</button>
             <button class="chipbtn" data-act="mm-subject">导图</button>`
      }
    </div>`;

  if (!items.length) {
    return (
      filters +
      `<div class="empty">${icon('file', 'icon')}<b>${total ? '没有匹配的内容' : '还没有知识点'}</b><p>${
        total ? '换个关键词试试。' : '上传课件并完成识别后，这里会出现结构化的知识点卡片。'
      }</p></div>`
    );
  }
  return filters + `<div class="klist">${items.map(itemCard).join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/* 渲染：分类视图                                                      */
/* ------------------------------------------------------------------ */

function childrenOf(parentId) {
  return S.categories
    .filter((c) => c.subjectId === ui.subjectId && c.parentId === (parentId || null))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function catTotal(cat) {
  let n = S.items.filter((i) => i.categoryId === cat.id).length;
  for (const child of childrenOf(cat.id)) n += catTotal(child);
  return n;
}

function catNode(cat, depth) {
  const items = S.items.filter((i) => i.categoryId === cat.id);
  const kids = childrenOf(cat.id);
  return `
    <details ${depth === 0 ? 'open' : ''}>
      <summary>
        <span class="chev">${icon('chev')}</span>
        <b>${esc(cat.name)}</b>
        <span class="num">${catTotal(cat)} 条</span>
      </summary>
      <div class="inner">
        ${kids.map((k) => catNode(k, depth + 1)).join('')}
        ${
          items.length
            ? `<div class="leaf-list">${items
                .map((it) => {
                  const sl = S.slides.find((s) => s.id === it.slideId);
                  return `<div class="leaf" data-act="open-item" data-item="${it.id}">
                    <span class="dotmark"></span><span>${esc(it.name)}</span>
                    <span class="from">${sl ? `第 ${sl.index} 页` : '手动'}</span>
                  </div>`;
                })
                .join('')}</div>`
            : ''
        }
      </div>
    </details>`;
}

function categoriesView() {
  const sub = currentSubject();
  const roots = childrenOf(null);
  const pts = pointsOf(sub.id);
  const toggle = `
    <div class="segmented seg-sm" id="cat-mode" data-level="${esc(ui.catView)}">
      <button data-act="cat-mode" data-mode="list" class="${ui.catView === 'list' ? 'active' : ''}">列表</button>
      <button data-act="cat-mode" data-mode="map" class="${ui.catView === 'map' ? 'active' : ''}">导图</button>
    </div>`;

  if (!roots.length && ui.catView !== 'map') {
    return `
      <div class="empty">
        ${icon('tree', 'icon')}
        <b>还没有整理过目录</b>
        <p>${pts ? '把 ' + pts + ' 个知识点交给模型，自动归入 2~3 层目录；不满意可以随时重新整理。' : '先上传并识别课件，再让模型自动整理目录。'}</p>
        <button class="btn primary" data-act="organize" ${pts ? '' : 'disabled'}>${icon('tree')} 自动整理</button>
      </div>`;
  }

  const uncat = S.items.filter((i) => i.subjectId === sub.id && i.kind === 'point' && !i.categoryId);
  const hint = roots.length
    ? `共 ${roots.length} 个一级目录 · ${S.items.filter((i) => i.subjectId === sub.id && i.kind === 'point').length} 个知识点`
    : '还没整理过，当前按课件结构显示';

  const toolbar = `
    <div class="cat-toolbar">
      <span class="hint">${hint}</span>
      <span style="margin-left:auto"></span>
      ${toggle}
      <button class="btn sm" data-act="mm-subject">${icon('tree')} 全屏导图</button>
      <button class="btn sm" data-act="map-reset">${icon('refresh')} 复位缩放</button>
      <button class="btn sm" data-act="organize">${icon('refresh')} 重新整理</button>
    </div>`;

  if (ui.catView === 'map') {
    return toolbar + `<div class="cat-map" id="cat-map"></div>`;
  }

  return (
    toolbar +
    `
    <div class="tree">
      ${roots.map((c) => catNode(c, 0)).join('')}
      ${
        uncat.length
          ? `<details open><summary><span class="chev">${icon('chev')}</span><b>未归类的知识点</b><span class="num">${uncat.length} 条</span></summary>
              <div class="inner"><div class="leaf-list">${uncat
                .map((it) => `<div class="leaf" data-act="open-item" data-item="${it.id}"><span class="dotmark"></span><span>${esc(it.name)}</span></div>`)
                .join('')}</div></div></details>`
          : ''
      }
    </div>`
  );
}

/* ------------------------------------------------------------------ */
/* 渲染：主入口                                                        */
/* ------------------------------------------------------------------ */


/**
 * 是否是触摸/手机环境：APK 内置、移动 UA、粗指针设备
 * 用来决定是否展示「Ctrl+V」「拖拽」这类电脑专属操作提示
 */
function isTouchUi() {
  try {
    if (S?.share?.embedded) return true;
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
    if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent || '')) return true;
  } catch {}
  return false;
}

function welcomeView() {
  return `
    <div class="welcome">
      <div class="welcome-card">
        <div class="kicker">Local · DeepSeek Vision</div>
        <h1>把课件照片，变成<br>可以反复复习的知识库</h1>
        <p class="lead">按科目上传上课拍的 PPT，模型自动提取知识点、补充拓展，并整理成目录。${isTouchUi() ? '图片和笔记全部保存在这台手机里，只把图片发给 DeepSeek。' : '图片和笔记全部保存在你自己的电脑里，只把图片发给 DeepSeek。'}</p>
        <div class="steps">
          <div class="step"><b>01 建科目</b><span>高数、操作系统、经济学…按科目分开管理</span></div>
          <div class="step"><b>02 传图片</b><span>${isTouchUi() ? '从相册选图或直接拍照，一次可以传几十张' : '拖拽或粘贴截图，一次可以传几十张'}</span></div>
          <div class="step"><b>03 自动整理</b><span>逐页提取知识点，再自动归类成目录</span></div>
        </div>
        <div class="foot">
          <button class="btn primary" data-act="new-subject">${icon('plus')} 创建第一个科目</button>
          <button class="btn ghost" data-act="open-settings">${icon('key')} 先填 API Key</button>
        </div>
      </div>
    </div>`;
}

/** 应用折叠相关的设置（CSS 变量 + 课件折叠高度） */
function applySelectSetting() {
  const on = !!(S && S.settings && S.settings.allowSelect);
  document.documentElement.classList.toggle('allow-select', on);
}

function applyFoldSettings() {
  const lines = Number(S.settings.cardLines);
  document.documentElement.style.setProperty('--card-lines', String(lines >= 1 ? lines : 9999));

  const rows = Number(S.settings.deckRows) || 3;
  const gap = 12;
  document.querySelectorAll('.thumbs.folded').forEach((el) => {
    const card = el.querySelector('.slide');
    if (!card) return;
    el.style.maxHeight = rows * card.offsetHeight + (rows - 1) * gap + 'px';
  });
}

function renderContent() {
  // 内容变化后重新计算折叠高度
  requestAnimationFrame(() => {
    if (S) applyFoldSettings();
  });
  const el = $('#content');
  if (!S) {
    el.innerHTML = `<div class="empty"><b>载入中…</b></div>`;
    return;
  }
  if (!currentSubject()) {
    el.innerHTML = welcomeView();
    return;
  }
  if (ui.view === 'items') el.innerHTML = itemsView();
  else if (ui.view === 'categories') {
    el.innerHTML = categoriesView();
    if (ui.catView === 'map') renderCatMap();
  } else el.innerHTML = deckView();
}

function render() {
  if (!S) return;
  renderSidebar();
  renderTopbar();
  renderViewbar();
  renderContent();
  if (ui.modal?.type === 'slide') renderModal();
  applyFoldSettings();
  applySelectSetting();
}

function scheduleRender() {
  clearTimeout(ui.renderTimer);
  ui.renderTimer = setTimeout(render, 220);
}

/* ------------------------------------------------------------------ */
/* 弹窗                                                                */
/* ------------------------------------------------------------------ */

function openModal(type, id) {
  ui.modal = { type, id };
  document.body.style.overflow = 'hidden';
  $('#overlay').classList.add('open');
  renderModal();
}

function closeModal() {
  ui.modal = null;
  $('#overlay').classList.remove('open');
  $('#overlay').innerHTML = '';
  document.body.style.overflow = '';
}

/* ---------- 应用内输入框 / 确认框（WebView 里 prompt/confirm 不可用） ---------- */

function askModal(spec) {
  return new Promise((resolve) => {
    ui.ask = { spec, resolve };
    ui.modal = { type: 'ask' };
    document.body.style.overflow = 'hidden';
    const box = $('#overlay');
    box.classList.add('open');
    box.innerHTML = `
      <div class="panel ask">
        <div class="panel-head">
          <div>
            <h2>${esc(spec.title)}</h2>
            ${spec.sub ? `<div class="sub">${esc(spec.sub)}</div>` : ''}
          </div>
        </div>
        <div class="panel-body">
          ${
            spec.kind === 'input'
              ? `<input class="input" id="ask-input" value="${esc(spec.value || '')}" placeholder="${esc(spec.placeholder || '')}" />`
              : `<p class="ask-msg">${esc(spec.message || '')}</p>`
          }
          <div class="ask-actions">
            <button class="btn" data-act="ask-cancel">取消</button>
            <button class="btn ${spec.danger ? 'danger' : 'primary'}" data-act="ask-ok">${esc(spec.okText || '确定')}</button>
          </div>
        </div>
      </div>`;

    if (spec.kind === 'input') {
      setTimeout(() => {
        const el = $('#ask-input');
        if (el) {
          el.focus();
          el.select();
        }
      }, 30);
    }
  });
}

function askOk() {
  const a = ui.ask;
  if (!a) return;
  if (a.spec.kind === 'input') {
    const v = ($('#ask-input')?.value || '').trim();
    if (!v) {
      $('#ask-input')?.focus();
      return;
    }
    a.resolve(v);
  } else {
    a.resolve(true);
  }
  ui.ask = null;
  closeModal();
}

function askCancel() {
  const a = ui.ask;
  if (!a) return;
  a.resolve(a.spec.kind === 'input' ? null : false);
  ui.ask = null;
  closeModal();
}

function renderModal() {
  const box = $('#overlay');
  if (!ui.modal) return;
  if (ui.modal.type === 'settings') box.innerHTML = settingsModal();
  else if (ui.modal.type === 'slide') box.innerHTML = slideModal(ui.modal.id);
  else if (ui.modal.type === 'item') box.innerHTML = itemModal(ui.modal.id);
  else if (ui.modal.type === 'refine') box.innerHTML = refineModal(ui.modal.id, 'item');
  else if (ui.modal.type === 'refine-slide') box.innerHTML = refineModal(ui.modal.id, 'slide');
  else if (ui.modal.type === 'phone') {
    box.innerHTML = phoneModal();
    drawQR();
  } else if (ui.modal.type === 'more') box.innerHTML = moreSheet();
  else if (ui.modal.type === 'note') {
    box.innerHTML = noteModal();
    attachNoteHandlers();
  } else if (ui.modal.type === 'criteria') box.innerHTML = criteriaModal();
  else if (ui.modal.type === 'usage') box.innerHTML = usageModal();
  else if (ui.modal.type === 'practice') box.innerHTML = practiceModal();
  else if (ui.modal.type === 'onboard') box.innerHTML = onboardModal();
  else if (ui.modal.type === 'mindmap') {
    box.innerHTML = mindmapModal();
    renderMindmap();
  }
}

function phoneModal() {
  const sh = S.share || {};
  return `
    <div class="panel phone-panel">
      <div class="panel-head">
        <div>
          <h2>手机访问</h2>
          <div class="sub">手机和电脑连同一个 WiFi，扫码即可</div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        ${
          sh.allowLan
            ? `
          <div class="qr-box" id="qr"></div>
          <div class="phone-url" id="phone-url">${esc(sh.lanUrl || '')}</div>
          <div class="phone-tip">首次打开会自动记住访问凭证，之后直接访问 <b>${esc('http://' + sh.lanIp + ':' + sh.port)}</b> 也能进。</div>
        `
            : `<div class="empty" style="border:none;padding:30px 0">${icon('phone', 'icon')}<b>局域网访问已关闭</b><p>到设置里打开「允许手机访问」，再回到这里扫码。</p></div>`
        }
        <div class="set-note">
          <b>手机上能做什么：</b>拍照或相册选图上传、看知识点、让 AI 改笔记，和电脑一样。<br>
          <b>打不开？</b>① 确认同一 WiFi；② 第一次运行 Windows 防火墙弹窗选「允许访问」；③ 公司/校园网常会隔离设备，换手机热点试试。<br>
          <b>安全：</b>链接里的 <code>k</code> 参数是访问凭证，只有拿到链接的人能打开。
        </div>
        <div class="set-actions">
          <button class="btn" data-act="rotate-token">${icon('refresh')} 重新生成访问链接</button>
          <span class="spacer"></span>
          <span class="hint" style="font-size:11.5px;color:var(--muted)">换链接后旧链接立即失效</span>
        </div>
      </div>
    </div>`;
}

function drawQR() {
  const box = $('#qr');
  if (!box || typeof window.qrcode !== 'function') return;
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(S.share.lanUrl);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 });
  } catch {
    box.innerHTML = '<div style="font-size:12px;color:#8b8477">二维码生成失败，请手动输入上面的链接</div>';
  }
}

function moreSheet() {
  const sub = currentSubject();
  const pending = sub
    ? S.slides.filter((s) => s.subjectId === sub.id && (s.status === 'pending' || s.status === 'error')).length
    : 0;
  return `
    <div class="panel sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-actions">
        <button data-act="new-subject">${icon('plus')} 新建科目</button>
        <button data-act="new-note">${icon('edit')} 手动写一条</button>
        <button data-act="upload">${icon('upload')} 上传课件图片</button>
        <button data-act="extract-all" ${pending ? '' : 'disabled'}>${icon('spark')} 识别待处理${pending ? `（${pending}）` : ''}</button>
        <button data-act="toggle-strict">${icon('spark')} 严格校对：${S.settings.strictVerify ? '已开' : '已关'}</button>
        <button data-act="organize">${icon('tree')} 自动整理目录</button>
        <button data-act="mm-subject">${icon('tree')} 思维导图</button>
        <button data-act="open-practice">${icon('spark')} 练习题（推测进度）</button>
        <button data-act="open-help">${icon('file')} 用户手册（${isTouchUi() ? '手机版' : '电脑版'}）</button>
        <button data-act="open-criteria">${icon('file')} 分类标准</button>
        <button data-act="open-usage">${icon('download')} 用量与花费</button>
        <button data-act="export-md">${icon('file')} 导出 Markdown</button>
          <button data-act="export-notes">${icon('file')} 学习笔记（含配图）</button>
          <button data-act="export-notes-html">${icon('code')} 学习笔记（HTML）</button>
          <button data-act="export-map">${icon('tree')} 思维导图（SVG）</button>
        <button data-act="export-backup">${icon('download')} 完整备份（全部科目）</button>
        <button data-act="restore-backup">${icon('upload')} 从备份恢复</button>
        <button data-act="export-json">${icon('code')} 导出 JSON（仅文字）</button>
        ${S.share?.embedded ? '' : `<button data-act="open-phone">${icon('phone')} 手机访问</button>`}
        <button data-act="open-settings">${icon('settings')} 设置</button>
        <button data-act="rename-subject">${icon('edit')} 重命名科目</button>
        <button data-act="delete-subject" class="danger">${icon('trash')} 删除科目</button>
      </div>
      <button class="sheet-cancel" data-act="close-modal">取消</button>
    </div>`;
}


/* ---------------- 练习题：推测进度 → 出题（结果在弹窗内看答案） ---------------- */


/* ---------------- 首次启动引导 ---------------- */

const ONBOARD_STEPS = [
  {
    title: '欢迎使用 Make Your Notes',
    body: `把课件照片丢进来，它会逐页识别成知识点，再按你的标准整理成目录。
支持公式、手写笔记、画板配图，手机上也能用。`,
    tip: '三步就能跑起来：建科目 → 上传课件 → 看知识点。',
  },
  {
    title: '① 建一个科目',
    body: `点左上角「+」，比如「高等数学」。
顺便写一句你希望的分类方式（留空也行），自动整理时会照着它归类。`,
    tip: '一个科目 = 一门课。',
  },
  {
    title: '② 上传课件照片',
    body: isTouchUi()
      ? `点「上传课件」，从相册里选课件照片，或者直接拍。\n识别在后台跑，切到别的应用也会继续。`
      : `点「上传课件」选图，也可以直接把图片拖进窗口，或截图后按 Ctrl+V 粘贴。\n识别在后台跑，关掉页面也会继续。`,
    tip: '一学期的 PPT 拍照可以一次性全传。',
  },
  {
    title: '③ 看知识点、整理目录',
    body: `「知识点」里是识别结果：每条带公式、重要度、来源页，点一下能跳回原页核对。
「自动整理」按你的标准归成多级目录，可以反复整理。`,
    tip: '不满意某条，点「手动编辑」或「AI 修改这条」。',
  },
  {
    title: '填一个 API Key 就可以开始了',
    body: `识别和改写要用大模型。到 platform.deepseek.com 建一个 Key，粘到设置里即可；
没有 Key 也能先开「演示模式」走一遍流程。`,
    tip: '识别一页大约 1 分钱。',
  },
];

function onboardModal() {
  const st = ui.onboard || { step: 0 };
  const step = ONBOARD_STEPS[st.step] || ONBOARD_STEPS[ONBOARD_STEPS.length - 1];
  const last = st.step >= ONBOARD_STEPS.length - 1;
  const dots = ONBOARD_STEPS.map(
    (_, i) => `<span class="onb-dot ${i === st.step ? 'on' : ''}"></span>`
  ).join('');
  return `
    <div class="panel onboard-panel">
      <div class="panel-head">
        <div>
          <h2>${esc(step.title)}</h2>
          <div class="sub">第 ${st.step + 1} / ${ONBOARD_STEPS.length} 步</div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="onboard-skip" title="跳过">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        <div class="onb-body">${esc(step.body).replace(/\n/g, '<br>')}</div>
        ${step.tip ? `<div class="onb-tip">${esc(step.tip)}</div>` : ''}
        <div class="onb-dots">${dots}</div>
        <div class="onb-actions">
          <button class="btn ghost sm" data-act="onboard-help">看用户手册</button>
          ${st.step > 0 ? `<button class="btn sm" data-act="onboard-prev">上一步</button>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost sm" data-act="onboard-skip">跳过</button>
          ${last
            ? `<button class="btn primary" data-act="onboard-finish">开始使用</button>`
            : `<button class="btn primary" data-act="onboard-next">下一步</button>`}
        </div>
      </div>
    </div>`;
}

async function finishOnboard(openSettings) {
  ui.onboard = null;
  closeModal();
  try {
    S = await api('/api/settings', { onboarded: true }, 'POST');
  } catch {}
  render();
  if (openSettings) {
    setTimeout(() => openModal('settings'), 120);
  } else {
    toast(isTouchUi() ? '随时可以在「⋯ → 用户手册（手机版）」里再看一遍' : '随时可以在「⋯ → 用户手册（电脑版）」里再看一遍');
  }
}

function practiceState() {
  if (!ui.practice) ui.practice = { loading: false, data: null, error: '' };
  return ui.practice;
}

function practiceModal() {
  const st = practiceState();
  const sub = currentSubject();
  const data = st.data;
  const count = st.count || 15;
  const extra = st.extra || '';

  const progress = data
    ? `
      <div class="practice-progress">
        <div class="pp-level">学习进度推测：${esc(data.progress?.level || '')}</div>
        ${data.progress?.summary ? `<div class="pp-line">${esc(data.progress.summary)}</div>` : ''}
        ${data.progress?.weak?.length ? `<div class="pp-line">建议重点：${data.progress.weak.map((x) => esc(x)).join('、')}</div>` : ''}
        ${data.progress?.suggest ? `<div class="pp-line">下一步：${esc(data.progress.suggest)}</div>` : ''}
      </div>`
    : '';

  const list = data
    ? `<div class="practice-list">
        ${data.questions
          .map(
            (q, i) => `
          <div class="practice-q">
            <div class="pq-head"><span class="pq-no">${i + 1}</span><span class="pq-type">${esc(q.type || '')}</span></div>
            <div class="pq-body">${renderMath(q.question)}</div>
            <details class="pq-ans"><summary>答案与解析</summary>
              <div class="pq-a">${renderMath(q.answer)}</div>
              <div class="pq-e">${q.explain ? renderMath(q.explain) : '（本题未给出解析）'}</div>
              ${q.ref ? `<div class="pq-ref">对应知识点：${esc(q.ref)}</div>` : ''}
            </details>
          </div>`
          )
          .join('')}
      </div>
`
    : '';

  return `
    <div class="panel practice-panel">
      <div class="panel-head">
        <div>
          <h2>练习题</h2>
          <div class="sub">按当前科目已有的笔记推测进度，再据此出题；每题可展开看答案与解析</div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        <div class="row2">
          <div class="field">
            <label>题量</label>
            <select class="input" id="practice-count">
              ${[10, 15, 20, 30]
                .map((n) => `<option value="${n}" ${n === count ? 'selected' : ''}>${n} 题</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label>科目</label>
            <div class="input" style="display:flex;align-items:center">${esc(sub?.name || '未选择科目')} · ${esc(String(S.items.filter((i) => i.subjectId === sub?.id).length))} 条笔记</div>
          </div>
        </div>
        <div class="field">
          <label>额外要求 <span class="hint-inline">可选，例如「多考计算题」「只考第 3–5 章」「难度偏难」</span></label>
          <textarea class="input" id="practice-extra" rows="2" placeholder="留空则按笔记覆盖情况自动安排">${esc(extra)}</textarea>
        </div>
        <div class="ask-actions">
          <button class="btn" data-act="close-modal">取消</button>
          <button class="btn primary" data-act="practice-generate" ${st.loading ? 'disabled' : ''}>${st.loading ? '正在生成…' : data ? '重新生成' : '生成练习题'}</button>
        </div>
        ${st.error ? `<div class="hint" style="color:#a2453a;margin-top:8px">${esc(st.error)}</div>` : ''}
        ${progress}
        ${list}
      </div>
    </div>`;
}

async function generatePractice() {
  const st = practiceState();
  const sub = currentSubject();
  if (!sub) return toast('请先选择科目', 'err');
  st.count = Number($('#practice-count')?.value) || 15;
  st.extra = ($('#practice-extra')?.value || '').trim();
  st.loading = true;
  st.error = '';
  renderModal();
  try {
    const res = await api('/api/practice', {
      subjectId: sub.id,
      count: st.count,
      extra: st.extra,
    });
    st.data = res;
    renderModal();
    toast('已生成 ' + (res.questions?.length || 0) + ' 道题');
  } catch (e) {
    st.error = e.message || '生成失败';
    renderModal();
  } finally {
    st.loading = false;
  }
}

function refineModal(id, scope) {
  const isItem = scope === 'item';
  const item = isItem ? S.items.find((i) => i.id === id) : null;
  const slide = isItem
    ? S.slides.find((s) => s.id === item?.slideId)
    : S.slides.find((s) => s.id === id);

  if (isItem && !item) return '<div class="panel refine"><div class="panel-body">这条知识点已不存在</div></div>';
  if (!isItem && !slide) return '<div class="panel refine"><div class="panel-body">页面已不存在</div></div>';

  const deck = slide ? S.decks.find((d) => d.id === slide.deckId) : null;
  const chips = isItem
    ? ['更简洁一些', '补充一个例子', '补充易错点', '补充推导过程', '讲得更通俗']
    : ['补充本页的前提条件', '补充一个典型例题', '补充常见易错点'];

  return `
    <div class="panel refine">
      <div class="panel-head">
        <div>
          <h2>${isItem ? '按要求修改这条' : 'AI 补充本页'}</h2>
          <div class="sub">${slide ? esc(deck?.title || '课件') + ' · 第 ' + slide.index + ' 页 · 基于本页原文' : '手动笔记 · 基于这条内容'}${isItem ? '，修改可撤销' : '，会新增条目'}</div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        ${
          isItem
            ? `<div class="refine-source">
                 <b>${renderMath(item.name)}</b>
                 <p>${renderMath(item.content)}</p>
               </div>`
            : ''
        }
        <label class="refine-label">告诉 AI 你想怎么改</label>
        <textarea class="input" id="refine-input" rows="4" placeholder="${
          isItem ? '例如：把解释压缩到两行，并补一个具体的数字例子' : '例如：补充这一页没讲清楚的适用条件，再给一个反例'
        }"></textarea>
        <div class="refine-chips">
          ${chips.map((c) => `<button class="chipbtn" data-act="refine-suggest" data-text="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
        <div class="refine-foot">
          ${
            isItem && item.versions?.length
              ? `<button class="btn sm ghost" data-act="revert-item" data-id="${item.id}">${icon('refresh')} 撤销上次修改</button>`
              : ''
          }
          <span class="spacer"></span>
          <button class="btn" data-act="close-modal">取消</button>
          ${
            isItem
              ? `<button class="btn" data-act="submit-refine" data-id="${item.id}" data-mode="append">再补一条</button>
                 <button class="btn primary" data-act="submit-refine" data-id="${item.id}" data-mode="rewrite">修改这条</button>`
              : `<button class="btn primary" data-act="submit-refine-slide" data-id="${slide.id}">补充到本页</button>`
          }
        </div>
      </div>
    </div>`;
}

/* ---------- 供应商预设 ---------- */

const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: [
      ['deepseek-flash', 'deepseek-flash（支持读图）'],
      ['deepseek-v4-pro', 'deepseek-v4-pro（纯文本）'],
    ],
    vision: ['deepseek-flash'],
    text: ['deepseek-flash', 'deepseek-v4-pro'],
    defaultVision: 'deepseek-flash',
    defaultText: 'deepseek-flash',
    hint: 'DeepSeek 按量计费，一页约 1 分钱。',
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      ['glm-4.6v-flash', 'glm-4.6v-flash（免费 · 支持读图）'],
      ['glm-4.1v-thinking-flash', 'glm-4.1v-thinking-flash（免费 · 带思考）'],
      ['glm-4v-flash', 'glm-4v-flash（免费 · 旧版，仅 4K）'],
      ['glm-4.7-flash', 'glm-4.7-flash（免费 · 纯文本）'],
      ['glm-5.3-flash', 'glm-5.3-flash（付费 · 支持读图）'],
    ],
    vision: ['glm-4.6v-flash', 'glm-4.1v-thinking-flash', 'glm-4v-flash', 'glm-5.3-flash'],
    text: ['glm-4.7-flash', 'glm-4.6v-flash', 'glm-5.3-flash'],
    defaultVision: 'glm-4.6v-flash',
    defaultText: 'glm-4.7-flash',
    hint: '智谱的 glm-4.6v-flash 免费且能读图（128K），4.7-flash 免费且擅长文字。',
  },
};

/** 同步供应商相关的界面状态（分段选中、提示、警告、Key 提示） */
function syncProviderUi(prov) {
  const cfg = PROVIDERS[prov];
  if (!cfg) return;
  const wrap = $('#set-provider');
  if (wrap) wrap.dataset.level = prov;
  $$('#set-provider button').forEach((b) => b.classList.toggle('active', b.dataset.provider === prov));
  const hint = $('#provider-hint');
  if (hint) hint.textContent = cfg.hint;
  const warn = $('#provider-warn');
  if (warn) warn.style.display = prov === 'zhipu' ? '' : 'none';
  const keyHint = $('#key-hint');
  if (keyHint) {
    keyHint.textContent =
      prov === 'zhipu'
        ? '在 bigmodel.cn → API Keys 创建，glm-4.6v-flash 免费。'
        : '在 platform.deepseek.com → API keys 创建。';
  }
  const key = $('#set-key');
  if (key && !key.value) key.placeholder = prov === 'zhipu' ? '在 bigmodel.cn 创建' : 'sk-...';
}

/** 某一类任务可选的模型：vision（要能读图）/ text */
function modelOptions(prov, current, kind) {
  const cfg = PROVIDERS[prov] || PROVIDERS.deepseek;
  const ids = cfg[kind] || cfg.text;
  const opts = ids
    .map((id) => {
      const found = cfg.models.find(([mid]) => mid === id);
      const label = found ? found[1] : id;
      return `<option value="${id}" ${id === current ? 'selected' : ''}>${label}</option>`;
    })
    .join('');
  const known = cfg.models.some(([id]) => id === current);
  const extra =
    current && !known
      ? `<option value="${esc(current)}" selected>${esc(current)}（自定义）</option>`
      : '';
  return extra + opts;
}

/* ---------- SVG 配图 ---------- */

/** 清洗模型生成的 SVG（去掉脚本、外链、事件属性） */
function sanitizeSvg(raw) {
  const s = String(raw || '').trim();
  if (!s || !s.includes('<svg') || s.length > 300000) return '';
  try {
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return '';
    doc.querySelectorAll('script, foreignObject, iframe, image').forEach((n) => n.remove());
    doc.querySelectorAll('use').forEach((n) => {
      const href = n.getAttribute('href') || n.getAttribute('xlink:href') || '';
      if (!href.startsWith('#')) n.remove();
    });
    for (const el of [svg, ...svg.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        const bad =
          n.startsWith('on') ||
          ((n === 'href' || n === 'xlink:href') && /^(javascript|data|https?):/i.test(attr.value));
        if (bad) el.removeAttribute(attr.name);
      }
    }
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return '';
  }
}

function withSymbols(svg) {
  if (!svg || !window.SYMBOL_DEFS) return svg;
  if (window.snapSvg) svg = window.snapSvg(svg);
  // 清掉旧的内嵌符号定义（可能来自旧版本，重新注入最新的）
  svg = svg.replace(/<defs>[\s\S]*?id="sym-[\s\S]*?<\/defs>/g, '');
  if (svg.includes('id="sym-')) return svg;
  // 插到 <svg ...> 之后
  const i = svg.indexOf('>');
  if (i < 0) return svg;
  return svg.slice(0, i + 1) + window.SYMBOL_DEFS + svg.slice(i + 1);
}

function svgFigure(svg, note) {
  const clean = withSymbols(sanitizeSvg(svg));
  if (!clean) return '';
  return [
    '<figure class="figure">',
    '<div class="figure-box">' + clean + '</div>',
    '<figcaption>' + esc(note || 'AI 生成的示意图，细节请对照正文核对') + '</figcaption>',
    '</figure>',
  ].join('');
}

function uncertainLine(u) {
  if (!u) return '';
  if (typeof u === 'string') return u;
  const parts = [];
  if (u.where) parts.push('位置：' + u.where);
  if (u.seen) parts.push('看到：' + u.seen);
  if (u.candidates && u.candidates.length) parts.push('候选：' + u.candidates.join(' / '));
  if (u.why) parts.push('原因：' + u.why);
  return parts.join('；') || '';
}

/* ---------- 手动笔记 ---------- */

const SYMBOLS = {
  常用: ['±', '×', '÷', '≠', '≈', '≤', '≥', '∞', '∝', '∴', '∵', '°', '′', '″', '→', '⇒'],
  希腊: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'κ', 'λ', 'μ', 'ν', 'ξ', 'π', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω', 'Δ', 'Σ', 'Π', 'Ω'],
  运算: ['∑', '∏', '∫', '∬', '∮', '∂', '∇', '√', '∠', '⊥', '∥', '⊕', '⊗', '·', '!', '∘'],
  集合: ['∈', '∉', '⊂', '⊃', '⊆', '⊇', '∪', '∩', '∅', '∀', '∃', '¬', '∧', '∨', '⇔', '↦'],
};

function insertSymbol(ta, sym) {
  if (!ta) return;
  // 没聚焦时（比如刚打开还没点输入框）追加到末尾，而不是插到第 0 位
  const focused = document.activeElement === ta;
  const start = focused ? ta.selectionStart ?? ta.value.length : ta.value.length;
  const end = focused ? ta.selectionEnd ?? ta.value.length : ta.value.length;
  ta.value = ta.value.slice(0, start) + sym + ta.value.slice(end);
  const pos = start + sym.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function openNoteEditor(opts = {}) {
  const item = opts.item || null;
  const hand = !!(item && Array.isArray(item.tags) && item.tags.includes('手绘'));
  ui.note = { item, slideId: opts.slideId || null, svg: (item && item.svg) || '', draw: (item && item.draw) || '', svgHand: hand };
  openModal('note');
}

function noteModal() {
  const it = ui.note?.item || null;
  const slide = ui.note?.slideId ? S.slides.find((s) => s.id === ui.note.slideId) : null;
  const sub = currentSubject();
  const deck = slide ? S.decks.find((d) => d.id === slide.deckId) : null;
  const kind = it?.kind || 'point';
  const imp = it?.importance || 3;

  return `
    <div class="panel note-panel">
      <div class="panel-head">
        <div>
          <h2>${it ? '编辑笔记' : '新建笔记'}</h2>
          <div class="sub">数学公式用 <code>$...$</code>，独立公式用 <code>$$...$$</code></div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        <div class="ai-draft">
          <div class="ai-draft-head">让 AI 起草<span>${ui.note?.item ? '会基于当前这条笔记修改，不会换题' : '写一句要求，生成后还可以改'}</span></div>
          <div class="ai-row">
            <input class="input" id="note-prompt" placeholder="例如：用两句话解释洛必达法则的适用条件，并给一个例子" />
            <button class="btn primary" data-act="ai-compose">生成</button>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>类型</label>
            <div class="segmented" id="note-kind" data-level="${esc(kind)}">
              <button data-act="note-kind" data-kind="point" class="${kind === 'point' ? 'active' : ''}">知识点</button>
              <button data-act="note-kind" data-kind="extension" class="${kind === 'extension' ? 'active' : ''}">拓展</button>
            </div>
          </div>
          <div class="field">
            <label>重要度</label>
            <div class="segmented" id="note-imp" data-level="${imp}">
              ${[1, 2, 3, 4, 5]
                .map((n) => `<button data-act="note-imp" data-imp="${n}" class="${imp === n ? 'active' : ''}">${n}</button>`)
                .join('')}
            </div>
          </div>
        </div>
        <div class="field">
          <label>标题</label>
          <input class="input" id="note-name" value="${esc(it?.name || '')}" placeholder="例如：连续函数的性质" />
        </div>
        <div class="field">
          <label>内容</label>
          <textarea class="input" id="note-content" rows="6" placeholder="写点什么……公式用 $...$ 包起来，也可以直接点下面的符号">${esc(it?.content || '')}</textarea>
          <div class="symbol-bar" id="symbol-bar">
            <div class="symbol-tabs">
              ${Object.keys(SYMBOLS)
                .map(
                  (g, i) =>
                    `<button data-act="sym-tab" data-group="${g}" class="${i === 0 ? 'active' : ''}">${g}</button>`
                )
                .join('')}
            </div>
            <div class="symbol-grid" id="symbol-grid"></div>
          </div>
        </div>
        <div class="field">
          <label>公式 <span class="hint-inline">可选，LaTeX，不用写 $</span></label>
          <label class="mini-check"><input type="checkbox" id="note-keep-formula" ${S.settings.keepFormula ? 'checked' : ''} /> 改稿时保留原公式</label>
          <input class="input" id="note-formula" value="${esc(it?.formula || '')}" placeholder="例如 \\frac{U_{out}}{U_{in}} = \\frac{D}{1-D}" />
          <div class="note-preview" id="formula-preview" style="margin-top:6px"></div>
        </div>
        <div class="field">
          <label>预览</label>
          <div class="note-preview" id="note-preview"></div>
        </div>
        <div class="field" id="note-figure-field">
          <label>配图 <span class="hint-inline">可以画，也可以让 AI 生成</span></label>
          <div id="note-figure">${ui.note?.svg ? svgFigure(ui.note.svg, ui.note?.svgHand ? '手绘配图' : '') : '<span class="muted">还没有配图</span>'}</div>
          <div class="fig-actions">
            <button class="btn sm" data-act="draw-figure">✎ ${ui.note?.svg ? '重新画' : '画配图'}</button>
            ${ui.note?.svg ? `<button class="btn sm ghost" data-act="drop-figure">${icon('trash')} 去掉配图</button>` : ''}
          </div>
        </div>
        <div class="field">
          <label>标签</label>
          <input class="input" id="note-tags" value="${esc((it?.tags || []).join(', '))}" placeholder="可选，逗号分隔" />
        </div>
        <div class="field">
          <label>分类 <span class="hint-inline">手动归到某个目录，不改动 AI 整理结果的其他条目</span></label>
          <select class="input" id="note-category">
            <option value="">未分类</option>
            ${(S.categories || [])
              .filter((c) => !sub || c.subjectId === sub.id)
              .map((c) => `<option value="${c.id}" ${it?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="note-where">
          ${slide ? `归属：${esc(deck?.title || '')} · 第 ${slide.index} 页` : `归属：${esc(sub?.name || '')} · 不关联具体页面`}
        </div>
        <div class="ask-actions">
          <button class="btn" data-act="close-modal">取消</button>
          <button class="btn primary" data-act="note-save">保存</button>
        </div>
      </div>
    </div>`;
}

/** 复制到剪贴板（优先 Clipboard API，失败退回 execCommand） */
async function copyText(text) {
  const s = String(text == null ? '' : text);
  if (!s) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 把一条笔记的完整文本拼出来 */
function itemPlainText(it) {
  if (!it) return '';
  const lines = [it.name || ''];
  if (it.content) lines.push(String(it.content));
  if (it.formula) lines.push('$$' + it.formula + '$$');
  if (it.quote) lines.push('原文：' + it.quote);
  return lines.filter(Boolean).join('\n\n');
}

function refreshNoteFigure() {
  const box = $('#note-figure');
  if (box) {
    box.innerHTML = ui.note?.svg
      ? svgFigure(ui.note.svg, ui.note?.svgHand ? '手绘配图' : '')
      : '<span class="muted">还没有配图</span>';
  }
  const drawBtn = document.querySelector('#note-figure-field [data-act="draw-figure"]');
  if (drawBtn) drawBtn.textContent = ui.note?.svg ? '✎ 重新画' : '✎ 画配图';
  $$('#note-figure-field .fig-actions button').forEach((b) => {
    if (b.dataset.act === 'drop-figure') b.style.display = ui.note?.svg ? '' : 'none';
  });
}

function attachNoteHandlers() {
  const ta = $('#note-content');
  const pv = $('#note-preview');
  if (!ta || !pv) return;

  const update = () => {
    const v = ta.value.trim();
    pv.innerHTML = v ? renderMath(v) : '<span class="muted">内容会实时显示在这里</span>';
  };
  ta.addEventListener('input', update);
  update();

  const formulaInput = $('#note-formula');
  const formulaPreview = $('#formula-preview');
  const updateFormula = () => {
    if (!formulaPreview) return;
    const v = (formulaInput?.value || '').trim();
    formulaPreview.innerHTML = v ? renderMath('$' + v + '$') : '<span class="muted">公式会实时显示在这里</span>';
  };
  formulaInput?.addEventListener('input', updateFormula);
  updateFormula();

  const promptInput = $('#note-prompt');
  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        aiCompose();
      }
    });
  }

  const bar = $('#symbol-bar');
  const grid = $('#symbol-grid');
  if (!bar || !grid) return;

  let group = Object.keys(SYMBOLS)[0];
  const drawGrid = () => {
    grid.innerHTML = SYMBOLS[group].map((s) => `<button type="button" class="sym" data-sym="${s}">${s}</button>`).join('');
  };
  drawGrid();

  bar.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-act="sym-tab"]');
    if (!tab) return;
    group = tab.dataset.group;
    bar.querySelectorAll('[data-act="sym-tab"]').forEach((b) => b.classList.toggle('active', b === tab));
    drawGrid();
  });

  // pointerdown + preventDefault：手机上点符号不会把输入法收起来
  grid.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-sym]');
    if (!b) return;
    e.preventDefault();
    insertSymbol(ta, b.dataset.sym);
  });
}

function setImportance(n) {
  const wrap = $('#note-imp');
  if (!wrap) return;
  wrap.dataset.level = String(n);
  $$('#note-imp button').forEach((b) => b.classList.toggle('active', b.dataset.imp === String(n)));
}

async function aiCompose() {
  const input = $('#note-prompt');
  const prompt = (input?.value || '').trim();
  if (!prompt) {
    input?.focus();
    toast('先写一句你想要什么', 'err');
    return;
  }

  showQueue('AI 正在写…');
  try {
    const editing = ui.note?.item;
    const res = await api('/api/ai/compose', {
      subjectId: currentSubject()?.id,
      slideId: ui.note?.slideId || null,
      kind: $('#note-kind')?.dataset.level || 'point',
      prompt,
      base: editing
        ? { name: editing.name, content: editing.content, formula: editing.formula || '' }
        : null,
    });
    const d = res.draft || {};
    if (d.name) $('#note-name').value = d.name;
    if (d.content) $('#note-content').value = d.content;
    if (d.tags?.length) $('#note-tags').value = d.tags.join('，');
    if (d.importance) setImportance(d.importance);
    if (d.formula) {
      const fi = $('#note-formula');
      if (fi) {
        fi.value = d.formula;
        fi.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (d.svg) {
      ui.note.svg = d.svg;
      const field = $('#note-figure-field');
      const box = $('#note-figure');
      if (field && box) {
        box.innerHTML = svgFigure(d.svg);
        field.style.display = '';
      }
    }
    $('#note-content')?.dispatchEvent(new Event('input', { bubbles: true }));

    S = res.state;
    renderSidebar();
    toast('已生成，检查后点保存');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function repairDrawings() {
  showQueue('正在修复手绘图…');
  try {
    const res = await api('/api/items/repair-drawings', {});
    S = res.state;
    render();
    const parts = [];
    if (res.fixed) parts.push('已更新 ' + res.fixed + ' 张图');
    if (res.unknown) parts.push(res.unknown + ' 处引用了未知元件');
    toast(parts.length ? parts.join('，') : '手绘图都是最新的');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function fixExtensionNames() {
  const total = S.items.filter((i) => i.kind === 'extension').length;
  if (!total) {
    toast('还没有拓展条目');
    return;
  }
  const ok = await askModal({
    kind: 'confirm',
    title: '用 AI 重写拓展标题',
    message: `将为 ${total} 条拓展生成标题，大约 ${Math.ceil(total / 15)} 次调用，消耗少量 tokens。继续？`,
    okText: '开始',
  });
  if (!ok) return;

  showQueue('AI 正在起标题…');
  try {
    const res = await api('/api/items/fix-extension-names', {});
    S = res.state;
    render();
    toast(res.changed ? `已用 AI 重命名 ${res.changed} 条拓展` : '标题已经是最新');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function digestSlide(id) {
  showQueue('正在汇总这一页…');
  try {
    const res = await api(`/api/slides/${id}/digest`, {});
    S = res.state;
    if (ui.modal?.type === 'slide') renderModal();
    toast('已生成本页汇总');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function summarizeDeck(id) {
  const deck = S.decks.find((d) => d.id === id);
  if (!deck) return;
  showQueue('正在汇总这一节…');
  try {
    const res = await api(`/api/decks/${id}/summarize`, {});
    S = res.state;
    render();
    toast('本节总结已生成，去「知识点」里看');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function saveNote() {
  const name = ($('#note-name')?.value || '').trim();
  const content = ($('#note-content')?.value || '').trim();
  if (!name) {
    $('#note-name')?.focus();
    toast('请填写标题', 'err');
    return;
  }
  if (!content) {
    $('#note-content')?.focus();
    toast('请填写内容', 'err');
    return;
  }

  const kind = $('#note-kind')?.dataset.level || 'point';
  const importance = Number($('#note-imp')?.dataset.level) || 3;
  let tags = $('#note-tags')?.value || '';
  if (ui.note?.svgHand && ui.note?.svg && !tags.includes('手绘')) tags = (tags ? tags + ',' : '') + '手绘';
  const formula = ($('#note-formula')?.value || '').trim();
  const categoryEl = $('#note-category');
  const categoryId = categoryEl ? (categoryEl.value || null) : undefined;
  const editing = ui.note?.item;

  try {
    if (editing) {
      const patch = { name, content, kind, importance, tags, formula, svg: ui.note?.svg || '', draw: ui.note?.draw || '' };
      if (categoryId !== undefined) patch.categoryId = categoryId;
      S = await api(`/api/items/${editing.id}`, patch, 'PATCH');
      closeModal();
      render();
      toast('已保存');
    } else {
      const res = await api('/api/items', {
        subjectId: currentSubject()?.id,
        slideId: ui.note?.slideId || null,
        kind,
        name,
        content,
        importance,
        tags,
        formula,
        categoryId: categoryId || null,
        svg: ui.note?.svg || '',
        draw: ui.note?.draw || '',
      });
      S = res.state;
      closeModal();
      render();
      toast('已添加；下次「重新整理」时会一起归类');
    }
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------- 每个科目的分类标准 ---------- */

function criteriaModal() {
  const sub = currentSubject();
  return `
    <div class="panel criteria-panel">
      <div class="panel-head">
        <div>
          <h2>分类标准</h2>
          <div class="sub">只影响「${esc(sub?.name || '')}」，留空则用默认标准</div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        <div class="field">
          <label>你希望怎么分类</label>
          <textarea class="input" id="criteria-text" rows="6" placeholder="例如：按教材章节分一级目录；每章下面按「定义 / 定理 / 例题 / 易错点」分二级；公式密集的页单独归到「公式速查」">${esc(sub?.organizePrompt || '')}</textarea>
          <div class="hint">保存后，点「重新整理」立即生效；开启自动整理时，下次识别完也会按这个标准。</div>
        </div>
        <div class="ask-actions">
          <button class="btn" data-act="close-modal">取消</button>
          <button class="btn primary" data-act="save-criteria">保存</button>
        </div>
      </div>
    </div>`;
}

async function saveCriteria() {
  const sub = currentSubject();
  if (!sub) return;
  try {
    S = await api(`/api/subjects/${sub.id}`, { organizePrompt: $('#criteria-text')?.value || '' }, 'PATCH');
    closeModal();
    render();
    toast('分类标准已保存');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------- 用量与花费 ---------- */

/** 用量折线图：按天 / 周 / 月分桶 */
function usageChart() {
  const daily = S.usageDaily || {};
  const range = ui.usageRange || 'day';
  const buckets = [];

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (range === 'day') {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = iso(d);
      buckets.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, cost: (daily[key] || {}).estimatedCost || 0, calls: (daily[key] || {}).calls || 0 });
    }
  } else if (range === 'week') {
    for (let i = 11; i >= 0; i--) {
      const end = new Date(today);
      end.setDate(end.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      let cost = 0;
      let calls = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const v = daily[iso(d)] || {};
        cost += v.estimatedCost || 0;
        calls += v.calls || 0;
      }
      buckets.push({ key: iso(start), label: `${start.getMonth() + 1}/${start.getDate()}`, cost, calls });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const y = ref.getFullYear();
      const m = ref.getMonth() + 1;
      let cost = 0;
      let calls = 0;
      for (const [k, v] of Object.entries(daily)) {
        const [yy, mm] = k.split('-').map(Number);
        if (yy === y && mm === m) {
          cost += v.estimatedCost || 0;
          calls += v.calls || 0;
        }
      }
      buckets.push({ key: `${y}-${m}`, label: `${m}月`, cost, calls });
    }
  }

  const max = Math.max(0.0001, ...buckets.map((b) => b.cost));
  const W = 320;
  const H = 120;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const step = buckets.length > 1 ? innerW / (buckets.length - 1) : 0;
  const pts = buckets.map((b, i) => ({
    x: padL + i * step,
    y: padT + innerH - (b.cost / max) * innerH,
    cost: b.cost,
    label: b.label,
  }));
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${padL},${padT + innerH} ${line} ${padL + innerW},${padT + innerH}`;
  const dots = pts
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.2" fill="#2b5d4b"><title>${p.label}：${money(p.cost)}</title></circle>`)
    .join('');
  const labels = pts
    .map((p, i) =>
      i % Math.ceil(pts.length / 6) === 0 || i === pts.length - 1
        ? `<text x="${p.x.toFixed(1)}" y="${H - 5}" font-size="8" fill="#9b9384" text-anchor="middle">${p.label}</text>`
        : ''
    )
    .join('');

  const total = buckets.reduce((n, b) => n + b.cost, 0);
  const calls = buckets.reduce((n, b) => n + b.calls, 0);

  return `
    <div class="chart-head">
      <div class="segmented seg-sm" id="usage-range" data-level="${range}">
        <button data-act="usage-range" data-range="day" class="${range === 'day' ? 'active' : ''}">按天</button>
        <button data-act="usage-range" data-range="week" class="${range === 'week' ? 'active' : ''}">按周</button>
        <button data-act="usage-range" data-range="month" class="${range === 'month' ? 'active' : ''}">按月</button>
      </div>
      <div class="chart-sum">区间合计 <b>${money(total)}</b> · ${calls} 次</div>
    </div>
    <div class="chart-box">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="usage-chart">
        <polygon points="${area}" fill="rgba(43,93,75,.10)"/>
        <polyline points="${line}" fill="none" stroke="#2b5d4b" stroke-width="1.6" stroke-linejoin="round"/>
        ${dots}
        ${labels}
      </svg>
    </div>
  `;
}

function usageModal() {
  const u = S.usage || {};
  const byKind = u.byKind || {};
  const kindRows = [
    ['extract', '逐页识别'],
    ['organize', '自动整理'],
    ['refine', 'AI 改稿'],
    ['compose', 'AI 起草'],
    ['summarize', '本节总结'],
  ]
    .map(([k, label]) => {
      const x = byKind[k] || { calls: 0, estimatedCost: 0, promptTokens: 0, completionTokens: 0 };
      return `<tr><td>${label}</td><td>${x.calls}</td><td>${fmtTokens((x.promptTokens || 0) + (x.completionTokens || 0))}</td><td class="num">${money(x.estimatedCost)}</td></tr>`;
    })
    .join('');

  const subRows = S.subjects
    .map((s) => {
      const x = s.usage || { calls: 0, estimatedCost: 0 };
      return `<tr class="${s.id === ui.subjectId ? 'cur' : ''}"><td>${esc(s.name)}</td><td>${x.calls || 0}</td><td class="num">${money(x.estimatedCost)}</td></tr>`;
    })
    .join('');

  return `
    <div class="panel usage-panel">
      <div class="panel-head">
        <div><h2>用量与花费</h2><div class="sub">按 DeepSeek 官网价格估算，实际以账单为准</div></div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        <div class="usage-total">
          <div><b>${money(u.estimatedCost || 0)}</b><span>累计花费</span></div>
          <div><b>${u.calls || 0}</b><span>调用次数</span></div>
          <div><b>${fmtTokens((u.promptTokens || 0) + (u.completionTokens || 0))}</b><span>tokens</span></div>
        </div>

        <div class="sect-title">用量趋势</div>
        ${usageChart()}

        <div class="sect-title">按用途</div>
        <table class="usage-table">
          <thead><tr><th>用途</th><th>次数</th><th>tokens</th><th class="num">花费</th></tr></thead>
          <tbody>${kindRows}</tbody>
        </table>

        <div class="sect-title">按科目</div>
        <table class="usage-table">
          <thead><tr><th>科目</th><th>次数</th><th class="num">花费</th></tr></thead>
          <tbody>${subRows || '<tr><td colspan="3" class="muted">还没有科目</td></tr>'}</tbody>
        </table>

        <div class="set-note">
          <b>估算口径</b>（deepseek-flash 官网高峰价，单位美元 / 百万 tokens）：输入缓存未命中 $0.30、缓存命中 $0.006、输出 $1.20；按 1 美元 ≈ 7.2 元换算。
          空闲时段（北京时间 00:00–09:00、12:00–14:00、18:00–24:00 及周末）价格减半，所以实际账单通常比这里低。
          ${
            S.settings.provider === 'zhipu'
              ? '<br><b>当前供应商：</b>智谱 GLM，flash 系列免费，费用按 0 计。'
              : ''
          }
        </div>
      </div>
    </div>`;
}

/* ---------- 思维导图 ---------- */

const mmState = { scale: 1, w: 0, h: 0, ctx: null, auto: false };

function openMindmap(mode, ids) {
  ui.mindmap = { mode, ids: ids || [] };
  mmState.scale = 1;
  mmState.auto = true;
  openModal('mindmap');
}

function buildMindTree() {
  const sub = currentSubject();
  const root = { label: sub?.name || '科目', children: [] };
  const mode = ui.mindmap?.mode || 'subject';
  const ids = ui.mindmap?.ids || [];

  if (mode === 'selected') {
    const picked = S.items.filter((i) => ids.includes(i.id));
    const groups = new Map();
    for (const it of picked) {
      const cat = S.categories.find((c) => c.id === it.categoryId);
      const key = cat ? cat.id : '__none';
      if (!groups.has(key)) groups.set(key, { label: cat ? cat.name : '未归类', children: [] });
      groups.get(key).children.push({ label: it.name, itemId: it.id, slideId: it.slideId || null });
    }
    root.children = [...groups.values()];
    return root;
  }

  const cats = S.categories.filter((c) => c.subjectId === sub?.id);
  if (cats.length) {
    const build = (parentId) =>
      cats
        .filter((c) => c.parentId === (parentId || null))
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((c) => ({
          label: c.name,
          children: [
            ...build(c.id),
            ...S.items
              .filter((i) => i.categoryId === c.id)
              .map((i) => ({ label: i.name, itemId: i.id, slideId: i.slideId || null })),
          ],
        }));
    root.children = build(null);
    return root;
  }

  for (const deck of S.decks.filter((d) => d.subjectId === sub?.id)) {
    const slides = S.slides
      .filter((s) => s.deckId === deck.id)
      .sort((a, b) => a.index - b.index)
      .map((s) => ({
        label: `第 ${s.index} 页`,
        children: S.items
          .filter((i) => i.slideId === s.id && i.kind === 'point')
          .map((i) => ({ label: i.name, itemId: i.id, slideId: i.slideId })),
      }))
      .filter((n) => n.children.length);
    if (slides.length) root.children.push({ label: deck.title, children: slides });
  }
  const manual = S.items.filter((i) => i.subjectId === sub?.id && i.kind === 'point' && !i.slideId);
  if (manual.length) {
    root.children.push({
      label: '手动笔记',
      children: manual.map((i) => ({ label: i.name, itemId: i.id, slideId: null })),
    });
  }
  return root;
}

function measureText(text) {
  if (!mmState.ctx) mmState.ctx = document.createElement('canvas').getContext('2d');
  mmState.ctx.font = '13px "Microsoft YaHei", "PingFang SC", sans-serif';
  return mmState.ctx.measureText(text).width;
}

function layoutTree(root) {
  const ROW = 38;
  const NODE_H = 30;
  const GAP_X = 58;
  const PAD = 26;
  let leafY = 0;
  const perDepth = [];
  const nodes = [];

  const walk = (node, depth) => {
    node.depth = depth;
    node.h = NODE_H;
    let label = String(node.label || '');
    let w = measureText(label) + 26;
    while (w > 250 && label.length > 4) {
      label = label.slice(0, -2) + '…';
      w = measureText(label) + 26;
    }
    node.text = label;
    node.w = w;
    perDepth[depth] = Math.max(perDepth[depth] || 0, w);

    if (!node.children || !node.children.length) {
      node.y = leafY;
      leafY += ROW;
    } else {
      node.children.forEach((c) => walk(c, depth + 1));
      node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2;
    }
    nodes.push(node);
  };
  walk(root, 0);

  const xs = [];
  let acc = PAD;
  for (let d = 0; d < perDepth.length; d++) {
    xs[d] = acc;
    acc += perDepth[d] + GAP_X;
  }
  nodes.forEach((n) => {
    n.x = xs[n.depth];
    n.y += PAD;
  });

  return { nodes, w: Math.ceil(acc + PAD), h: Math.ceil(Math.max(leafY, 1) + PAD * 2) };
}

function renderMindmap() {
  const host = $('#mm-scroll');
  if (!host) return;
  const root = buildMindTree();
  const { nodes, w, h } = layoutTree(root);
  mmState.w = w;
  mmState.h = h;

  const links = [];
  const walk = (n) => {
    (n.children || []).forEach((c) => {
      const x1 = n.x + n.w;
      const y1 = n.y + n.h / 2;
      const x2 = c.x;
      const y2 = c.y + c.h / 2;
      const dx = Math.max(26, (x2 - x1) * 0.55);
      links.push(`<path d="M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="#d8cfbc" stroke-width="1.4"/>`);
      walk(c);
    });
  };
  walk(root);

  const draw = (n) => {
    const isLeaf = !n.children || !n.children.length;
    if (isLeaf && n.depth >= 2) {
      return `<g><circle cx="${n.x + 4}" cy="${n.y + n.h / 2}" r="3" fill="#bcb096"/>
        <text x="${n.x + 14}" y="${n.y + n.h / 2 + 4.5}" font-size="13" fill="#3b362e">${esc(n.text)}</text></g>`;
    }
    const fill = n.depth === 0 ? '#2c5d4a' : n.depth === 1 ? '#e6efe9' : '#fffdf8';
    const stroke = n.depth === 0 ? '#2c5d4a' : n.depth === 1 ? '#cfe0d6' : '#e0d8c8';
    const color = n.depth === 0 ? '#ffffff' : n.depth === 1 ? '#1f4a3b' : '#33302a';
    const weight = n.depth <= 1 ? 600 : 500;
    return `<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${fill}" stroke="${stroke}"/>
      <text x="${n.x + 13}" y="${n.y + n.h / 2 + 4.5}" font-size="13" font-weight="${weight}" fill="${color}">${esc(n.text)}</text></g>`;
  };

  const scale = mmState.scale;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" style="width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#fffdf8"/>
    ${links.join('')}
    ${nodes.map(draw).join('')}
  </svg>`;
  applyPanZoom(host);

  // 首次打开时自动缩放到一屏宽（手机上默认就能看全）
  if (mmState.auto) {
    mmState.auto = false;
    const avail = host.clientWidth - 32;
    if (avail > 200 && w > avail) {
      mmState.scale = Math.max(0.4, avail / w);
      return renderMindmap();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 导图手势：双指缩放 + 拖动（只在导图区域内生效）                      */
/* ------------------------------------------------------------------ */

const PZ = new WeakMap();

function ensurePanZoom(el) {
  if (!el) return null;
  if (PZ.has(el)) return PZ.get(el);

  const st = { scale: 1, x: 0, y: 0, dist: 0, mx: 0, my: 0, s0: 1, x0: 0, y0: 0, px: 0, py: 0, panning: false };
  PZ.set(el, st);

  const apply = () => {
    const svg = el.querySelector('svg');
    if (!svg) return;
    svg.style.transformOrigin = '0 0';
    svg.style.transform = 'translate(' + st.x.toFixed(1) + 'px, ' + st.y.toFixed(1) + 'px) scale(' + st.scale.toFixed(3) + ')';
  };
  st.apply = apply;

  const clamp = (s) => Math.min(4, Math.max(0.3, s));

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        st.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const r = el.getBoundingClientRect();
        const z = (el.clientWidth || el.offsetWidth) ? r.width / (el.clientWidth || el.offsetWidth) : 1;
        st.mx = ((a.clientX + b.clientX) / 2 - r.left) / z;
        st.my = ((a.clientY + b.clientY) / 2 - r.top) / z;
        st.z = z;
        st.s0 = st.scale;
        st.x0 = st.x;
        st.y0 = st.y;
      } else if (e.touches.length === 1 && st.scale > 1.01) {
        st.panning = true;
        st.px = e.touches[0].clientX;
        st.py = e.touches[0].clientY;
        st.z = z;
        st.x0 = st.x;
        st.y0 = st.y;
      }
    },
    { passive: true }
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length === 2 && st.dist > 0) {
        e.preventDefault();
        const a = e.touches[0];
        const b = e.touches[1];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const s = clamp(st.s0 * (d / st.dist));
        const k = s / st.s0;
        st.scale = s;
        st.x = st.mx - (st.mx - st.x0) * k;
        st.y = st.my - (st.my - st.y0) * k;
        apply();
      } else if (st.panning && e.touches.length === 1) {
        e.preventDefault();
        const zz = st.z || 1;
        st.x = st.x0 + (e.touches[0].clientX - st.px) / zz;
        st.y = st.y0 + (e.touches[0].clientY - st.py) / zz;
        apply();
      }
    },
    { passive: false }
  );

  el.addEventListener(
    'touchend',
    () => {
      st.dist = 0;
      st.panning = false;
    },
    { passive: true }
  );

  el.addEventListener(
    'touchcancel',
    () => {
      st.dist = 0;
      st.panning = false;
    },
    { passive: true }
  );

  // 桌面端：滚轮 / 触控板缩放
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const z = (el.clientWidth || el.offsetWidth) ? r.width / (el.clientWidth || el.offsetWidth) : 1;
      const mx = (e.clientX - r.left) / z;
      const my = (e.clientY - r.top) / z;
      const s = clamp(st.scale * (e.deltaY < 0 ? 1.12 : 0.89));
      const k = s / st.scale;
      st.x = mx - (mx - st.x) * k;
      st.y = my - (my - st.y) * k;
      st.scale = s;
      apply();
    },
    { passive: false }
  );

  // 双击复位
  el.addEventListener('dblclick', () => {
    st.scale = 1;
    st.x = 0;
    st.y = 0;
    apply();
  });

  return st;
}

function resetPanZoom(el) {
  const st = PZ.get(el);
  if (!st) return;
  st.scale = 1;
  st.x = 0;
  st.y = 0;
  st.apply ? st.apply() : applyPanZoom(el);
}

function applyPanZoom(el) {
  const st = ensurePanZoom(el);
  if (!st) return;
  const svg = el.querySelector('svg');
  if (!svg) return;
  svg.style.transformOrigin = '0 0';
  svg.style.transform = 'translate(' + st.x.toFixed(1) + 'px, ' + st.y.toFixed(1) + 'px) scale(' + st.scale.toFixed(3) + ')';
}

/** 页面其它地方禁止双指缩放 */
function lockPageZoom() {
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length < 2) return;
      const t = e.target;
      if (t instanceof Element && t.closest('.cat-map, .mm-scroll')) return;
      e.preventDefault();
    },
    { passive: false }
  );
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((name) =>
    document.addEventListener(name, (e) => e.preventDefault(), { passive: false })
  );
}

function renderCatMap() {
  const host = $('#cat-map');
  if (!host) return;
  const root = buildMindTree();
  const { nodes, w, h } = layoutTree(root);
  const avail = Math.max(260, host.clientWidth - 24);
  const scale = Math.min(1.05, Math.max(0.42, avail / w));

  const links = [];
  const walk = (n) => {
    (n.children || []).forEach((c) => {
      const x1 = n.x + n.w;
      const y1 = n.y + n.h / 2;
      const x2 = c.x;
      const y2 = c.y + c.h / 2;
      const dx = Math.max(26, (x2 - x1) * 0.55);
      links.push(`<path d="M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="#d8cfbc" stroke-width="1.4"/>`);
      walk(c);
    });
  };
  walk(root);

  const draw = (n) => {
    const isLeaf = !n.children || !n.children.length;
    const action =
      isLeaf && n.itemId
        ? `data-act="open-item" data-item="${n.itemId}"`
        : '';
    const cls = action ? 'mm-node clickable' : 'mm-node';

    if (isLeaf && n.depth >= 2) {
      return `<g class="${cls}" ${action}>
        <title>${esc(n.label)}</title>
        <rect x="${n.x - 6}" y="${n.y}" width="${n.w + 12}" height="${n.h}" fill="transparent"/>
        <circle cx="${n.x + 4}" cy="${n.y + n.h / 2}" r="3" fill="#bcb096"/>
        <text x="${n.x + 14}" y="${n.y + n.h / 2 + 4.4}" font-size="12.5" fill="#3b362e">${esc(n.text)}</text>
      </g>`;
    }

    const fill = n.depth === 0 ? '#2c5d4a' : n.depth === 1 ? '#e6efe9' : '#fffdf8';
    const stroke = n.depth === 0 ? '#2c5d4a' : n.depth === 1 ? '#cfe0d6' : '#e0d8c8';
    const color = n.depth === 0 ? '#ffffff' : n.depth === 1 ? '#1f4a3b' : '#33302a';
    return `<g class="${cls}" ${action}>
      <title>${esc(n.label)}</title>
      <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${fill}" stroke="${stroke}"/>
      <text x="${n.x + 13}" y="${n.y + n.h / 2 + 4.4}" font-size="12.5" font-weight="600" fill="${color}">${esc(n.text)}</text>
    </g>`;
  };

  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" style="width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#fffdf8"/>
    ${links.join('')}
    ${nodes.map(draw).join('')}
  </svg>`;
  applyPanZoom(host);
}

function mindmapModal() {
  const sub = currentSubject();
  const mode = ui.mindmap?.mode || 'subject';
  const n = ui.mindmap?.ids?.length || 0;
  const organized = S.categories.some((c) => c.subjectId === sub?.id);
  return `
    <div class="panel mm-panel">
      <div class="panel-head">
        <div>
          <h2>思维导图</h2>
          <div class="sub">${mode === 'selected' ? `已选 ${n} 个知识点` : esc(sub?.name || '')}${organized ? '' : ' · 还没整理过，先按课件结构生成'}</div>
        </div>
        <div class="actions">
          <button class="btn sm" data-act="mm-zoom" data-dir="-1" title="缩小">−</button>
          <button class="btn sm" data-act="mm-zoom" data-dir="1" title="放大">＋</button>
          <button class="btn sm" data-act="mm-fit">适应</button>
          <button class="btn sm" data-act="mm-export">${icon('download')} 导出 PNG</button>
          <button class="btn sm ghost" data-act="close-modal">${icon('close')}</button>
        </div>
      </div>
      <div class="panel-body mm-body"><div class="mm-scroll" id="mm-scroll"></div></div>
    </div>`;
}

function mmZoom(dir) {
  mmState.scale = Math.min(2, Math.max(0.4, mmState.scale + (dir > 0 ? 0.15 : -0.15)));
  renderMindmap();
}

function mmFit() {
  const host = $('#mm-scroll');
  if (!host || !mmState.w) return;
  const avail = host.clientWidth - 8;
  mmState.scale = Math.min(1.4, Math.max(0.4, avail / mmState.w));
  renderMindmap();
}

async function mmExport() {
  const svgEl = document.querySelector('#mm-scroll svg');
  if (!svgEl) return;
  try {
    toast('正在生成图片…');
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const svgText = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    });

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(mmState.w * scale);
    canvas.height = Math.round(mmState.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const data = canvas.toDataURL('image/png');
    const sub = currentSubject();
    const res = await api('/api/artifacts', { data, name: `${sub?.name || 'notes'}-思维导图.png` });
    window.location.href = res.url;
    toast('已导出，请查看下载');
  } catch (e) {
    toast('导出失败：' + e.message, 'err');
  }
}

function toggleSelect(id) {
  if (ui.select.ids.has(id)) ui.select.ids.delete(id);
  else ui.select.ids.add(id);
  renderContent();
}

/* 单条知识点：先看内容，想看现场再「跳转原文」 */
function itemModal(id) {
  const it = S.items.find((x) => x.id === id);
  if (!it) return '<div class="panel"><div class="panel-body" style="padding:40px">这条知识点已不存在</div></div>';

  const slide = it.slideId ? S.slides.find((x) => x.id === it.slideId) : null;
  const deck = slide ? S.decks.find((d) => d.id === slide.deckId) : null;
  const cat = it.categoryId ? S.categories.find((c) => c.id === it.categoryId) : null;
  const catPath = (() => {
    const names = [];
    let cur = cat;
    let guard = 0;
    while (cur && guard++ < 10) {
      names.unshift(cur.name);
      cur = cur.parentId ? S.categories.find((c) => c.id === cur.parentId) : null;
    }
    return names.join(' / ');
  })();

  const stars = '●'.repeat(it.importance || 0) + '○'.repeat(5 - (it.importance || 0));
  const where = slide
    ? `${deck?.title || '课件'} · 第 ${slide.index} 页`
    : '手动笔记（未关联页面）';

  return `
    <div class="panel item-panel">
      <div class="panel-head">
        <div>
          <h2>${esc(it.name || '知识点')}</h2>
          <div class="sub">${it.kind === 'extension' ? '拓展' : '知识点'}${catPath ? ' · ' + esc(catPath) : ''} · ${esc(where)}</div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        <div class="item-body">
          <div class="item-meta">
            <span class="item-imp" title="重要度">${stars}</span>
            ${(it.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
            ${it.manual ? '<span class="tag">手动</span>' : ''}
          </div>
          <div class="item-content">${renderMath(it.content || '')}</div>
          ${it.formula ? `<div class="item-formula">${renderMath('$' + it.formula + '$')}</div>` : ''}
          ${it.quote && S.settings.showQuote !== false ? `<blockquote class="item-quote">原文：${renderMath(it.quote)}</blockquote>` : ''}
          ${it.svg ? svgFigure(it.svg, it.tags?.includes('手绘') ? '手绘配图' : '') : ''}
          ${it.draw ? '<button class="btn sm ghost" data-act="edit-figure" data-id="' + it.id + '">✎ 编辑配图</button>' : ''}
          <button class="btn sm ghost" data-act="copy-item" data-id="${it.id}">📋 复制内容</button>
        </div>
      </div>
      <div class="item-foot">
        ${
          slide
            ? `<button class="btn" data-act="open-slide" data-id="${slide.id}">${icon('file')} 跳转原文</button>`
            : `<span class="hint">这条是手动笔记，没有关联的原页面</span>`
        }
        <span class="spacer"></span>
        <button class="btn" data-act="edit-note" data-id="${it.id}">${icon('edit')} 手动编辑</button>
        <button class="btn" data-act="refine-item" data-id="${it.id}">${icon('spark')} AI 修改这条</button>
      </div>
    </div>`;
}

function slideModal(id) {
  const s = S.slides.find((x) => x.id === id);
  if (!s) return '<div class="panel"><div class="panel-body" style="padding:40px">页面已不存在</div></div>';
  const items = S.items.filter((i) => i.slideId === s.id);
  const points = items.filter((i) => i.kind === 'point');
  const exts = items.filter((i) => i.kind === 'extension');
  const deck = S.decks.find((d) => d.id === s.deckId);
  const busy = s.status === 'running';

  const body =
    s.status === 'pending'
      ? `<div class="empty" style="border:none;padding:40px 0">${icon('spark', 'icon')}<b>这一页还没有识别</b><p>点击右下角按钮，调用 DeepSeek 提取知识点。</p></div>`
      : s.status === 'error'
      ? `<div class="empty" style="border:none;padding:40px 0;color:var(--red)">${icon('close', 'icon')}<b>识别失败</b><p>${esc(s.error || '未知错误')}</p></div>`
      : `
        <h3>${renderMath(s.title || '未命名页面')}</h3>
        <p class="summary">${renderMath(s.summary || '')}</p>
        ${s.digest ? `<div class="slide-digest">${renderMath(s.digest)}</div>` : ''}
        ${
          points.length
            ? `<div class="sect-title">知识点 · ${points.length}</div>
               ${points
                 .map(
                   (p) => `<div class="kitem">
                      <div class="kt"><b>${renderMath(p.name)}</b><span class="imp">${'●'.repeat(p.importance || 0)}<b>${'○'.repeat(5 - (p.importance || 0))}</b></span>
                        <button class="mini-btn" data-act="refine-item" data-id="${p.id}" title="按要求修改这条">${icon('spark')}</button>
                      </div>
                      <p>${renderMath(p.content)}</p>
                      ${p.quote ? `<blockquote>原文：${renderMath(p.quote)}</blockquote>` : ''}
                    </div>`
                 )
                 .join('')}`
            : ''
        }
        ${
          exts.length
            ? `<div class="sect-title">拓展 · AI 补充</div>
               ${exts
                 .map((e) => `<div class="ext-item"><span class="ext-type">${esc(e.name)}</span><span>${renderMath(e.content)}</span></div>`)
                 .join('')}`
            : ''
        }
        ${
          s.formulas?.length
            ? `<div class="sect-title">公式</div>${s.formulas
                .map((f) => `<div class="formula">${renderMath(f.includes('$') ? f : '$' + f + '$')}</div>`)
                .join('')}`
            : ''
        }
        ${
          s.uncertain?.length
            ? `<div class="sect-title">存疑 / 未识别</div><div class="uncertain-list">${s.uncertain
                .map((u) => '<div>· ' + esc(uncertainLine(u)) + '</div>')
                .join('')}</div>`
            : ''
        }
        ${s.ocrText ? `<details class="ocr"><summary>查看图片原文</summary><pre>${esc(s.ocrText)}</pre></details>` : ''}
      `;

  return `
    <div class="panel" style="width:min(1180px,100%)">
      <div class="panel-head">
        <div>
          <h2>${esc(deck?.title || '课件')} · 第 ${s.index} 页</h2>
          <div class="sub">${statusText(s)}${s.usage?.costCny ? ` · 本次约 ¥${s.usage.costCny.toFixed(3)}` : ''}${s.verify ? ` · 二次校对：修正 ${s.verify.corrections || 0} 处` : ''}</div>
        </div>
        <div class="actions">
          <button class="btn sm" data-act="extract-slide" data-id="${s.id}" ${busy ? 'disabled' : ''}>${icon('refresh')} ${points.length ? '重新识别' : '开始识别'}</button>
          <button class="btn sm" data-act="digest-slide" data-id="${s.id}" ${points.length ? '' : 'disabled'} title="把本页知识点写成一段连贯的话">${icon('file')} 汇总本页</button>
          <button class="btn sm" data-act="new-note" data-slide="${s.id}">${icon('edit')} 手动笔记</button>
          <button class="btn sm" data-act="refine-slide" data-id="${s.id}" ${s.status !== 'done' ? 'disabled' : ''}>${icon('spark')} AI 补充本页</button>
          <button class="btn sm ghost" data-act="delete-slide" data-id="${s.id}" title="删除这一页">${icon('trash')}</button>
          <button class="btn sm ghost" data-act="close-modal">${icon('close')}</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="detail">
          <div class="detail-media">
            <img src="/media/${esc(s.image)}" alt="" />
            <div class="cap"><span>${esc(s.title || '')}</span><span style="margin-left:auto">${fmtDate(s.createdAt)}</span></div>
          </div>
          <div class="detail-body">${body}</div>
        </div>
      </div>
    </div>`;
}

function statusText(s) {
  if (s.status === 'running') return '正在识别…';
  if (s.status === 'error') return '识别失败';
  if (s.status === 'done') return '识别完成';
  return '待识别';
}

function settingsModal() {
  const st = S.settings;
  const prov = st.provider || 'deepseek';
  const pcfg = PROVIDERS[prov] || PROVIDERS.deepseek;
  return `
    <div class="panel settings">
      <div class="panel-head">
        <div>
          <h2>设置</h2>
          <div class="sub">Key 只保存在本机，不会上传到任何地方</div>
        </div>
        <div class="actions"><button class="btn sm ghost" data-act="close-modal">${icon('close')}</button></div>
      </div>
      <div class="panel-body">
        <div class="field">
          <label>供应商</label>
          <div class="segmented" id="set-provider" data-level="${esc(prov)}">
            <button data-act="provider" data-provider="deepseek" class="${prov === 'deepseek' ? 'active' : ''}">DeepSeek</button>
            <button data-act="provider" data-provider="zhipu" class="${prov === 'zhipu' ? 'active' : ''}">智谱 GLM（可免费）</button>
          </div>
          <div class="hint" id="provider-hint">${esc(pcfg.hint)}</div>
          <div class="set-warn" id="provider-warn" ${prov === 'zhipu' ? '' : 'style="display:none"'}>
            <b>用智谱时请注意</b>
            <ul>
              <li>免费模型有速率限制：碰到 429 会自动退避重试并转成单线程，但仍建议把并发数设为 1。</li>
              <li>识图用 glm-4.6v-flash（免费）或 glm-4v-flash；密排小字、公式仍可能不如 deepseek-flash，重要页面可以切回 DeepSeek 单独跑。</li>
              <li>智谱的 Key 与 DeepSeek 不通用；接口地址要保留 <code>/v4</code> 结尾，填错会 401 或 404。</li>
              <li>免费模型和额度可能调整或下线（官方公告过模型退役）；报错时先看提示，必要时换模型。</li>
              <li>部分智谱模型不支持 JSON 模式，程序会自动去掉该参数重试，个别时候仍可能解析失败，重试一次通常就好。</li>
            </ul>
          </div>
        </div>
        <div class="field">
          <label>API Key</label>
          <input class="input" id="set-key" type="password" autocomplete="off" placeholder="${st.hasKey ? '已保存（' + esc(st.maskedKey) + '），留空则不修改' : prov === 'zhipu' ? '在 bigmodel.cn 创建' : 'sk-...'}" />
          <div class="hint"><span id="key-hint">${
            prov === 'zhipu'
              ? '在 bigmodel.cn → API Keys 创建，glm-4.6v-flash 免费。'
              : '在 platform.deepseek.com → API keys 创建。'
          }</span>${st.hasKey ? (st.keyProtected ? ' 已用 Windows 凭据保护（DPAPI）加密存储。' : ' 当前为明文保存（DPAPI 不可用）。') : ''}</div>
        </div>
        <div class="row2">
          <div class="field">
            <label>接口地址</label>
            <input class="input" id="set-base" value="${esc(st.baseUrl)}" />
          </div>
          <div class="field">
            <label>识别模型（需要能读图）</label>
            <select class="select" id="set-model">
              ${modelOptions(prov, st.model, 'vision')}
            </select>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>文字模型（整理 / 改稿 / 起草）</label>
            <select class="select" id="set-text-model">
              ${modelOptions(prov, st.textModel || st.model, 'text')}
            </select>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <div class="hint" style="margin:0">识别用能读图的模型，整理和改稿用纯文字模型；两者都来自当前供应商。</div>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>并发数</label>
            <input class="input" id="set-conc" type="number" min="1" max="6" value="${st.concurrency}" />
            <div class="hint">同时识别几页，建议 2~3</div>
          </div>
          <div class="field">
            <label>推理等级</label>
            <div class="segmented" id="set-reasoning" data-level="${esc(st.reasoning || 'off')}">
              ${[
                ['off', '关闭'],
                ['low', '低'],
                ['high', '高'],
                ['max', '最大'],
              ]
                .map(
                  ([lv, label]) =>
                    `<button data-act="reasoning" data-level="${lv}" class="${(st.reasoning || 'off') === lv ? 'active' : ''}">${label}</button>`
                )
                .join('')}
            </div>
            <div class="hint">越高越慢越贵，抽取和归类更准</div>
          </div>
        </div>
        <div class="set-divider"></div>
        <div class="row2">
          <label class="switch">
            <input type="checkbox" id="set-autoextract" ${st.autoExtract ? 'checked' : ''} />
            <span class="track"></span>
            <span><b style="font-size:12.5px">上传后自动识别</b><br><span class="hint">关闭后需手动点「识别」</span></span>
          </label>
          <label class="switch">
            <input type="checkbox" id="set-autoorganize" ${st.autoOrganize ? 'checked' : ''} />
            <span class="track"></span>
            <span><b style="font-size:12.5px">自动整理目录</b><br><span class="hint">识别完成后自动归类（可随时重来）</span></span>
          </label>
        </div>
        <label class="switch">
          <input type="checkbox" id="set-mock" ${st.mock ? 'checked' : ''} />
          <span class="track"></span>
          <span><b style="font-size:12.5px">演示模式</b><br><span class="hint">不调用 API，返回示例数据，方便先看效果</span></span>
        </label>
        <label class="switch">
          <input type="checkbox" id="set-strict" ${st.strictVerify ? 'checked' : ''} />
          <span class="track"></span>
          <span><b style="font-size:12.5px">严格模式（二次校对）</b><br><span class="hint">识别后再拿原图对一遍，只改形近字、符号、上下标等字符差异；每页多一次调用</span></span>
        </label>
        <div class="row2">
          <div class="field">
            <label>知识点卡片折叠行数</label>
            <input class="input" id="set-cardlines" type="number" min="-1" max="10" value="${Number.isFinite(st.cardLines) ? st.cardLines : 4}" />
            <div class="hint">1~10：超过这个行数折叠；<b>0：不显示正文</b>；<b>-1：不折叠</b></div>
          </div>
          <div class="field">
            <label>课件图片折叠行数</label>
            <input class="input" id="set-deckrows" type="number" min="1" max="6" value="${st.deckRows || 3}" />
            <div class="hint">缩略图超过这个行数就折叠（1~6）</div>
          </div>
        </div>
        <label class="switch">
          <input type="checkbox" id="set-allowselect" ${st.allowSelect ? 'checked' : ''} />
          <span class="track"></span>
          <span><b style="font-size:12.5px">允许选中文字</b><br><span class="hint">开启后可以手动长按/拖选文字复制，关闭时用「复制内容」按钮</span></span>
        </label>
        <label class="switch">
          <input type="checkbox" id="set-showquote" ${st.showQuote !== false ? 'checked' : ''} />
          <span class="track"></span>
          <span><b style="font-size:12.5px">显示原文引用</b><br><span class="hint">知识点卡片和详情里是否显示「原文引用」那个灰框</span></span>
        </label>
        <label class="switch">
          <input type="checkbox" id="set-keepformula" ${st.keepFormula ? 'checked' : ''} />
          <span class="track"></span>
          <span><b style="font-size:12.5px">改稿时保留原公式</b><br><span class="hint">开启后，AI 修改笔记时除非你明确提到公式，否则不替换原有公式</span></span>
        </label>
        ${
          S.share?.embedded
            ? ''
            : `<label class="switch">
                 <input type="checkbox" id="set-allowlan" ${st.allowLan ? 'checked' : ''} />
                 <span class="track"></span>
                 <span><b style="font-size:12.5px">允许手机访问</b><br><span class="hint">同一 WiFi 下用手机打开；关闭后只有本机能访问</span></span>
               </label>`
        }
        <div class="field">
          <label>界面大小</label>
          <div class="segmented" id="set-scale" data-level="${ui.scale}">
            ${[
              [0.9, '小'],
              [1, '标准'],
              [1.1, '大'],
              [1.2, '特大'],
            ]
              .map(
                ([v, label]) =>
                  `<button data-act="ui-scale" data-scale="${v}" class="${Number(ui.scale) === v ? 'active' : ''}">${label}</button>`
              )
              .join('')}
          </div>
          <div class="hint">字太小或按钮挤在一起时调一下；一行放不下的按钮会自动换到下一行</div>
        </div>
        <div class="set-note">
          <b>费用参考：</b>每页图片约 1 分钱（deepseek-flash）。图片会被压缩到长边 1800px 再上传，原图只留在本机。
          <br><b>数据目录：</b>${esc(S.dataDir)}
          ${
            S.share?.allowLan
              ? `<br><b>手机地址：</b><span class="mono">${esc(S.share.lanUrl)}</span>`
              : ''
          }
        </div>
        <div class="set-actions">
          <button class="btn" data-act="test-key">${icon('spark')} 测试连接</button>
          <button class="btn" data-act="fix-ext-names">${icon('file')} 整理拓展标题</button>
          <button class="btn" data-act="repair-drawings">${icon('refresh')} 修复手绘图</button>
          <button class="btn" data-act="restore-backup">${icon('upload')} 从备份恢复</button>
          <button class="btn danger" data-act="reset-data">清空全部数据</button>
          <span class="spacer"></span>
          <button class="btn primary" data-act="save-settings">保存</button>
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 交互                                                                */
/* ------------------------------------------------------------------ */

function toast(msg, type = '') {
  const host = $('#toast');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  host.appendChild(el);
  host.classList.add('show');
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => {
      el.remove();
      if (!host.children.length) host.classList.remove('show');
    }, 320);
  }, 3200);
}

function showQueue(text) {
  const el = $('#queuebar');
  el.classList.add('show');
  el.innerHTML = `<span class="spinner"></span><span>${esc(text)}</span>`;
}

function hideQueue() {
  $('#queuebar').classList.remove('show');
}

/* ---------- 上传 ---------- */

async function makeImage(file, maxSide, quality) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片无法读取'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  return canvas.toDataURL('image/jpeg', quality);
}

async function uploadFiles(files, deckId) {
  const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
  if (!list.length) return;
  const sub = currentSubject();
  if (!sub) {
    toast('请先创建或选择一个科目', 'err');
    return;
  }
  if (!S.settings.hasKey && !S.settings.mock) {
    toast('还没有配置 API Key，先填好再上传', 'err');
    openModal('settings');
    return;
  }

  let targetDeck = deckId || null;
  const ids = [];
  ui.uploading = true;

  for (let i = 0; i < list.length; i++) {
    showQueue(`正在上传 ${i + 1}/${list.length}`);
    try {
      const image = await makeImage(list[i], 1800, 0.86);
      const thumb = await makeImage(list[i], 520, 0.72);
      const res = await api('/api/slides', { subjectId: sub.id, deckId: targetDeck, image, thumb });
      targetDeck = res.deck.id;
      ids.push(res.slide.id);
      S = res.state;
      render();
    } catch (e) {
      toast(`「${list[i].name}」上传失败：${e.message}`, 'err');
    }
  }
  hideQueue();
  ui.uploading = false;

  if (ids.length) {
    toast(`已上传 ${ids.length} 张`);
    if (S.settings.autoExtract) {
      await startProcessing({ ids });
    }
  }
}

/* ---------- 单页识别（同步） ---------- */

async function extractSlide(id) {
  showQueue('正在识别这一页…');
  const slide = S.slides.find((s) => s.id === id);
  if (slide) slide.status = 'running';
  render();
  try {
    const res = await api(`/api/slides/${id}/extract`, {});
    S = res.state;
    render();
    toast('识别完成');
  } catch (e) {
    const s2 = S.slides.find((x) => x.id === id);
    if (s2) {
      s2.status = 'error';
      s2.error = e.message;
    }
    render();
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function organize(silent) {
  const sub = currentSubject();
  if (!sub) return;
  showQueue('正在整理目录…');
  try {
    const res = await api(`/api/subjects/${sub.id}/organize`, {});
    S = res.state;
    ui.view = 'categories';
    ui.q = '';
    render();
    if (!silent) {
      const merged = res.merged || 0;
      toast(`已整理成 ${res.created} 个目录` + (merged ? `，合并了 ${merged} 条重复知识点` : ''));
    }
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

/* ---------- 设置 ---------- */

async function toggleStrict() {
  const next = !S.settings.strictVerify;
  try {
    S = await api('/api/settings', { strictVerify: next });
    render();
    toast(next ? '严格校对已开启：每页多一次校对' : '严格校对已关闭');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function saveSettings() {
  const cardLinesVal = Number($('#set-cardlines')?.value);
  const body = {
    provider: $('#set-provider')?.dataset.level || S.settings.provider,
    apiKey: $('#set-key').value.trim(),
    baseUrl: $('#set-base').value.trim(),
    model: $('#set-model').value,
    textModel: $('#set-text-model')?.value || $('#set-model').value,
    concurrency: Number($('#set-conc').value) || 2,
    reasoning: $('#set-reasoning')?.dataset.level || S.settings.reasoning,
    autoExtract: $('#set-autoextract').checked,
    autoOrganize: $('#set-autoorganize').checked,
    mock: $('#set-mock').checked,
    strictVerify: !!$('#set-strict')?.checked,
    keepFormula: !!$('#set-keepformula')?.checked,
    showQuote: !!$('#set-showquote')?.checked,
    allowSelect: !!$('#set-allowselect')?.checked,
    uiScale: ui.scale,
    cardLines: Number.isFinite(cardLinesVal) ? cardLinesVal : 4,
    deckRows: Number($('#set-deckrows')?.value) || 3,
    allowLan: $('#set-allowlan') ? $('#set-allowlan').checked : S.settings.allowLan,
  };
  try {
    S = await api('/api/settings', body);
    closeModal();
    render();
    toast('设置已保存');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function testKey() {
  const apiKey = $('#set-key').value.trim();
  const baseUrl = $('#set-base').value.trim();
  toast('正在测试连接…');
  try {
    const res = await api('/api/settings/test', { apiKey, baseUrl });
    toast(res.message || '连接正常');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function rotateToken() {
  const ok = await askModal({
    kind: 'confirm',
    title: '重新生成访问链接',
    message: '手机上保存的旧链接会立即失效，需要重新扫码。继续？',
    danger: true,
    okText: '重新生成',
  });
  if (!ok) return;
  try {
    S = await api('/api/settings/rotate-token', {});
    render();
    toast('已生成新的访问链接');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------- 其他 ---------- */

function downloadExport(format) {
  const sub = currentSubject();
  if (!sub) return;
  closeMenu();
  window.location.href = `/api/export?subjectId=${encodeURIComponent(sub.id)}&format=${format}`;
}

function downloadNotes(format) {
  const sub = currentSubject();
  if (!sub) return;
  closeMenu();
  const n = S.items.filter((i) => i.subjectId === sub.id).length;
  if (!n) return toast('这个科目还没有笔记', 'err');
  toast('正在导出 ' + n + ' 条笔记…');
  window.location.href = `/api/export-notes?subjectId=${encodeURIComponent(sub.id)}&format=${format}`;
}

/** 把 SVG 文本栅格化成 PNG dataURL（失败返回空串） */
function svgToPng(svgText, scale = 2) {
  return new Promise((resolve) => {
    const s = String(svgText || '');
    if (!s.includes('<svg')) return resolve('');
    let w = 800;
    let h = 400;
    const vb = s.match(/viewBox\s*=\s*["']\s*([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)/);
    if (vb) {
      w = Math.max(1, parseFloat(vb[3]));
      h = Math.max(1, parseFloat(vb[4]));
    }
    const blob = new Blob([s], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const cw = Math.min(2400, Math.round(w * scale));
        const ch = Math.max(1, Math.round((cw * h) / w));
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(c.toDataURL('image/png'));
      } catch {
        resolve('');
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
}

async function exportNotesDoc() {
  const sub = currentSubject();
  if (!sub) return;
  const items = S.items.filter((i) => i.subjectId === sub.id);
  if (!items.length) return toast('这个科目还没有笔记', 'err');
  closeMenu();

  const withSvg = items.filter((i) => i.svg);
  showQueue(withSvg.length ? '正在把 ' + withSvg.length + ' 张配图转成图片…' : '正在生成文档…');
  try {
    const images = {};
    for (const it of withSvg) {
      const png = await svgToPng(withSymbols(sanitizeSvg(it.svg)), 3);
      if (png) images[it.id] = png;
    }
    const res = await api('/api/export-notes-doc', { subjectId: sub.id, images });
    window.location.href = res.url;
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function exportMindmap() {
  const sub = currentSubject();
  const host = $('#cat-map') || $('#mm-scroll');
  const svg = host?.querySelector('svg');
  if (!svg) {
    toast('先切到「分类 → 导图」再导出', 'err');
    return;
  }
  closeMenu();
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  try {
    const res = await api('/api/export-map', { name: (sub?.name || '科目') + '-思维导图.svg', svg: text });
    window.location.href = res.url;
  } catch (e) {
    toast(e.message, 'err');
  }
}

function downloadBackup() {
  closeMenu();
  toast('正在打包全部科目的图片，稍等一下…');
  window.location.href = '/api/export-backup';
}

async function restoreBackup(file) {
  if (!file) return;
  if (file.size > 80 * 1024 * 1024) {
    toast('备份文件超过 80MB', 'err');
    return;
  }
  showQueue('正在恢复备份…');
  try {
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '恢复失败');

    S = data.state;
    ui.subjectId = data.subjectId || S.subjects[0]?.id || null;
    ui.view = 'decks';
    ui.catView = 'list';
    render();

    const n = data.imported || {};
    const results = data.results || [];
    const created = results.filter((r) => !r.merged).length;
    const mergedCount = results.length - created;
    const parts = [];
    if (created) parts.push(`新建 ${created} 个科目`);
    if (mergedCount) parts.push(`合并 ${mergedCount} 个`);
    const tail = `${n.slides || 0} 页 / ${n.items || 0} 条${n.skipped ? `（跳过 ${n.skipped} 条已有内容）` : ''}`;
    toast(parts.length > 1 || data.scope === 'full' ? `${parts.join('，')}：${tail}` : `${data.merged ? '已合并' : '已新建'}：${tail}`);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

function closeMenu() {
  $$('.menu').forEach((m) => m.classList.remove('open'));
}

function toggleMenu(id) {
  const target = $('#' + id);
  const wasOpen = target?.classList.contains('open');
  closeMenu();
  if (target && !wasOpen) target.classList.add('open');
}

async function createSubject() {
  const name = await askModal({
    kind: 'input',
    title: '新建科目',
    sub: '按科目分开管理课件和知识点',
    placeholder: '例如：高等数学',
    okText: '创建',
  });
  if (!name) return;
  const wanted = name.trim();
  if (subjectNameTaken(wanted)) {
    toast(`已经有叫「${wanted}」的科目了，换个名字吧`, 'err');
    return;
  }
  try {
    const res = await api('/api/subjects', { name: wanted });
    S = res.state;
    ui.subjectId = res.subject.id;
    ui.view = 'decks';
    render();
    toast('科目已创建，可以上传课件了');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function deleteSubject() {
  const sub = currentSubject();
  if (!sub) return;
  const ok = await askModal({
    kind: 'confirm',
    title: '删除科目',
    message: `删除「${sub.name}」及其全部课件、知识点？此操作不可恢复。`,
    danger: true,
    okText: '删除',
  });
  if (!ok) return;
  try {
    S = await api(`/api/subjects/${sub.id}`, null, 'DELETE');
    ui.subjectId = S.subjects[0]?.id || null;
    render();
    toast('已删除');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function renameSubject() {
  const sub = currentSubject();
  if (!sub) return;
  const name = await askModal({ kind: 'input', title: '重命名科目', value: sub.name, okText: '保存' });
  if (!name) return;
  const wanted = name.trim();
  if (subjectNameTaken(wanted, sub.id)) {
    toast(`已经有叫「${wanted}」的科目了，换个名字吧`, 'err');
    return;
  }
  try {
    S = await api(`/api/subjects/${sub.id}`, { name: wanted }, 'PATCH');
    render();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/** 科目名是否已被占用（本地预检，服务端仍会再校验一次） */
function subjectNameTaken(name, exceptId) {
  const key = String(name || '').trim();
  return (S.subjects || []).some((s) => s.id !== exceptId && String(s.name).trim() === key);
}

async function renameDeck(id) {
  const deck = S.decks.find((d) => d.id === id);
  if (!deck) return;
  const title = await askModal({ kind: 'input', title: '重命名课件', value: deck.title, okText: '保存' });
  if (!title) return;
  try {
    S = await api(`/api/decks/${id}`, { title: title.trim() }, 'PATCH');
    render();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function deleteDeck(id) {
  const deck = S.decks.find((d) => d.id === id);
  if (!deck) return;
  const ok = await askModal({
    kind: 'confirm',
    title: '删除课件',
    message: `删除「${deck.title}」及其全部页面和知识点？`,
    danger: true,
    okText: '删除',
  });
  if (!ok) return;
  try {
    S = await api(`/api/decks/${id}`, null, 'DELETE');
    render();
    toast('已删除');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function deleteSlide(id) {
  const ok = await askModal({
    kind: 'confirm',
    title: '删除这一页',
    message: '删除这一页及其知识点？',
    danger: true,
    okText: '删除',
  });
  if (!ok) return;
  try {
    S = await api(`/api/slides/${id}`, null, 'DELETE');
    closeModal();
    render();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function deleteItem(id) {
  try {
    S = await api(`/api/items/${id}`, null, 'DELETE');
    render();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function submitRefine(id, mode) {
  const ta = $('#refine-input');
  const instruction = ta?.value.trim() || '';
  if (!instruction) {
    ta?.focus();
    toast('先写一句你希望怎么改', 'err');
    return;
  }
  showQueue(mode === 'append' ? '正在补充…' : '正在修改…');
  try {
    const res = await api(`/api/items/${id}/refine`, { instruction, mode });
    S = res.state;
    closeModal();
    render();
    toast(res.note || (mode === 'append' ? '已补充' : '已修改'));
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function submitRefineSlide(id) {
  const ta = $('#refine-input');
  const instruction = ta?.value.trim() || '';
  if (!instruction) {
    ta?.focus();
    toast('先写一句你希望补充什么', 'err');
    return;
  }
  showQueue('正在补充…');
  try {
    const res = await api(`/api/slides/${id}/refine`, { instruction });
    S = res.state;
    closeModal();
    render();
    toast(res.note || '已补充到本页');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideQueue();
  }
}

async function revertItem(id) {
  try {
    S = await api(`/api/items/${id}/revert`, {});
    closeModal();
    render();
    toast('已撤销上一次修改');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function resetData() {
  const ok = await askModal({
    kind: 'confirm',
    title: '清空全部数据',
    message: '将清空所有科目、课件、知识点和统计（API Key 保留）。确定继续？',
    danger: true,
    okText: '清空',
  });
  if (!ok) return;
  try {
    S = await api('/api/reset', {});
    ui.subjectId = null;
    ui.view = 'decks';
    closeModal();
    render();
    toast('已清空');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    closeMenu();
    return;
  }
  const act = el.dataset.act;

  if (ui.modal?.type === 'more' && act !== 'close-modal') closeModal();

  if (act !== 'toggle-export' && act !== 'toggle-subject-menu') closeMenu();

  switch (act) {
    case 'new-subject':
      return createSubject();
    case 'select-subject':
      ui.subjectId = el.dataset.id;
      ui.view = 'decks';
      ui.q = '';
      ui.select = { on: false, ids: new Set() };
      render();
      return;
    case 'view':
      ui.view = el.dataset.view;
      if (ui.view !== 'items') {
        ui.select.on = false;
        ui.select.ids.clear();
      }
      render();
      return;
    case 'filter':
      ui.filter = el.dataset.f;
      renderContent();
      return;
    case 'repair-drawings':
      return repairDrawings();
    case 'fix-ext-names':
      return fixExtensionNames();
    case 'map-reset': {
      const host = $('#cat-map');
      if (host) resetPanZoom(host);
      return;
    }
    case 'usage-range':
      ui.usageRange = el.dataset.range;
      renderModal();
      return;
    case 'open-draw': {
      const sub = currentSubject();
      if (sub) window.DrawEditor?.open(sub.id);
      return;
    }
    case 'digest-slide':
      return digestSlide(el.dataset.id);
    case 'toggle-deck': {
      const id = el.dataset.id;
      if (ui.deckOpen.has(id)) ui.deckOpen.delete(id);
      else ui.deckOpen.add(id);
      renderContent();
      return;
    }
    case 'summarize-deck':
      return summarizeDeck(el.dataset.id);
    case 'expand-card': {
      const id = el.dataset.id;
      if (ui.expanded.has(id)) ui.expanded.delete(id);
      else ui.expanded.add(id);
      renderContent();
      return;
    }
    case 'open-settings':
      return openModal('settings');
    case 'open-phone':
      return openModal('phone');
    case 'open-more':
      return openModal('more');
    case 'rotate-token':
      return rotateToken();
    case 'open-slide':
      return openModal('slide', el.dataset.id);
    case 'open-item':
      return openModal('item', el.dataset.item);
    case 'close-modal':
      return closeModal();
    case 'ask-ok':
      return askOk();
    case 'ask-cancel':
      return askCancel();
    case 'toggle-export':
      return toggleMenu('export-menu');
    case 'toggle-subject-menu':
      return toggleMenu('subject-menu');
    case 'export-md':
      return downloadExport('md');
    case 'export-notes':
      return downloadNotes('md');
    case 'export-formulas': {
      const sub = S.subjects.find((s) => s.id === S.currentSubjectId);
      if (!sub) return toast('请先选择科目', 'err');
      window.location.href = '/api/export-formulas?subjectId=' + encodeURIComponent(sub.id);
      return;
    }
    case 'export-notes-html':
      return exportNotesDoc();
    case 'export-map':
      return exportMindmap();
    case 'export-json':
      return downloadExport('json');
    case 'export-backup':
      return downloadBackup();
    case 'restore-backup':
      $('#backup-input').click();
      return;
    case 'upload':
      ui.uploadDeckId = el.dataset.deck || null;
      $('#file-input').click();
      return;
    case 'extract-all': {
      const sub = currentSubject();
      if (!sub) return;
      const ids = S.slides.filter((s) => s.subjectId === sub.id && (s.status === 'pending' || s.status === 'error')).map((s) => s.id);
      if (ids.length) startProcessing({ ids });
      return;
    }
    case 'extract-deck': {
      const ids = S.slides.filter((s) => s.deckId === el.dataset.id && (s.status === 'pending' || s.status === 'error')).map((s) => s.id);
      if (ids.length) startProcessing({ ids });
      return;
    }
    case 'extract-slide':
      return extractSlide(el.dataset.id);
    case 'organize':
      return organize();
    case 'rename-deck':
      return renameDeck(el.dataset.id);
    case 'delete-deck':
      return deleteDeck(el.dataset.id);
    case 'delete-slide':
      return deleteSlide(el.dataset.id);
    case 'delete-item':
      return deleteItem(el.dataset.id);
    case 'refine-item':
      return openModal('refine', el.dataset.id);
    case 'refine-slide':
      return openModal('refine-slide', el.dataset.id);
    case 'refine-suggest': {
      const ta = $('#refine-input');
      if (ta) {
        ta.value = el.dataset.text;
        ta.focus();
      }
      return;
    }
    case 'submit-refine':
      return submitRefine(el.dataset.id, el.dataset.mode);
    case 'submit-refine-slide':
      return submitRefineSlide(el.dataset.id);
    case 'revert-item':
      return revertItem(el.dataset.id);
    case 'subject-menu':
      return renameSubject();
    case 'rename-subject':
      return renameSubject();
    case 'delete-subject':
      return deleteSubject();
    case 'save-settings':
      return saveSettings();
    case 'reasoning': {
      const wrap = $('#set-reasoning');
      if (wrap) {
        wrap.dataset.level = el.dataset.level;
        $$('#set-reasoning button').forEach((b) => b.classList.toggle('active', b === el));
      }
      return;
    }
    case 'ui-scale': {
      const val = Number(el.dataset.scale) || 1;
      applyUiScale(val);
      try {
        localStorage.setItem('mn.scale', String(val));
      } catch {}
      $$('#set-scale button').forEach((b) => b.classList.toggle('active', b === el));
      const wrap = $('#set-scale');
      if (wrap) wrap.dataset.level = String(val);
      api('/api/settings', { uiScale: val })
        .then((st) => {
          S = st;
          const wrap2 = $('#set-scale');
          if (wrap2) wrap2.dataset.level = String(st.settings.uiScale || val);
          $$('#set-scale button').forEach((b) => b.classList.toggle('active', Number(b.dataset.scale) === Number(st.settings.uiScale || val)));
        })
        .catch(() => {});
      return;
    }
    case 'provider': {
      const prov = el.dataset.provider;
      const cfg = PROVIDERS[prov];
      if (!cfg) return;
      syncProviderUi(prov);
      const base = $('#set-base');
      if (base) base.value = cfg.baseUrl;
      const sel = $('#set-model');
      if (sel) {
        sel.innerHTML = modelOptions(prov, cfg.defaultVision, 'vision');
        sel.value = cfg.defaultVision;
      }
      const textSel = $('#set-text-model');
      if (textSel) {
        textSel.innerHTML = modelOptions(prov, cfg.defaultText, 'text');
        textSel.value = cfg.defaultText;
      }
      return;
    }
    case 'new-note':
      return openNoteEditor({ slideId: el.dataset.slide || null });
    case 'edit-note': {
      const item = S.items.find((i) => i.id === el.dataset.id);
      if (item) openNoteEditor({ item });
      return;
    }
    case 'note-kind': {
      const wrap = $('#note-kind');
      if (wrap) {
        wrap.dataset.level = el.dataset.kind;
        $$('#note-kind button').forEach((b) => b.classList.toggle('active', b === el));
      }
      return;
    }
    case 'note-imp': {
      const wrap = $('#note-imp');
      if (wrap) {
        wrap.dataset.level = el.dataset.imp;
        $$('#note-imp button').forEach((b) => b.classList.toggle('active', b === el));
      }
      return;
    }
    case 'note-save':
      return saveNote();
    case 'toggle-strict':
      return toggleStrict();
    case 'copy-item': {
      const item = S.items.find((i) => i.id === el.dataset.id);
      if (!item) return;
      const ok = await copyText(itemPlainText(item));
      toast(ok ? '已复制到剪贴板' : '复制失败，请重试', ok ? '' : 'err');
      return;
    }
    case 'edit-figure': {
      const item = S.items.find((i) => i.id === el.dataset.id);
      const sub = currentSubject();
      if (!item || !sub) return;
      let initial = null;
      try {
        initial = item.draw ? JSON.parse(item.draw) : null;
      } catch {}
      window.DrawEditor?.open(sub.id, {
        initial,
        onSave: async (svg, data) => {
          try {
            S = await api('/api/items/' + item.id, { svg, draw: JSON.stringify(data) }, 'PATCH');
            renderModal();
            toast('配图已更新');
          } catch (e) {
            toast(e.message, 'err');
          }
        },
      });
      return;
    }
    case 'draw-figure': {
      const sub = currentSubject();
      if (!sub || !ui.note) return;
      let initial = null;
      try {
        initial = ui.note.draw ? JSON.parse(ui.note.draw) : null;
      } catch {}
      window.DrawEditor?.open(sub.id, {
        initial,
        onSave: (svg, data) => {
          ui.note.svg = svg;
          ui.note.draw = JSON.stringify(data);
          ui.note.svgHand = true;
          refreshNoteFigure();
          toast(initial ? '配图已更新，保存笔记后生效' : '配图已插入，保存笔记后生效');
        },
      });
      return;
    }
    case 'drop-figure': {
      if (ui.note) {
        ui.note.svg = '';
        ui.note.draw = '';
        ui.note.svgHand = false;
      }
      refreshNoteFigure();
      return;
    }
    case 'ai-compose':
      return aiCompose();
    case 'open-criteria':
      return openModal('criteria');
    case 'save-criteria':
      return saveCriteria();
    case 'open-help':
      location.href = isTouchUi() ? '/help-phone.html' : '/help-pc.html';
      return;
    case 'onboard-next':
      ui.onboard = { step: Math.min(ONBOARD_STEPS.length - 1, (ui.onboard?.step || 0) + 1) };
      return renderModal();
    case 'onboard-prev':
      ui.onboard = { step: Math.max(0, (ui.onboard?.step || 0) - 1) };
      return renderModal();
    case 'onboard-help':
      location.href = isTouchUi() ? '/help-phone.html' : '/help-pc.html';
      return;
    case 'onboard-skip':
      return finishOnboard(false);
    case 'onboard-finish':
      return finishOnboard(!S.settings.hasKey && !S.settings.mock);
    case 'open-practice':
      ui.practice = ui.practice || { loading: false, data: null, error: '' };
      return openModal('practice');
    case 'practice-generate':
      return generatePractice();
    case 'open-usage':
      return openModal('usage');
    case 'mm-subject':
      return openMindmap('subject');
    case 'cat-mode':
      ui.catView = el.dataset.mode === 'map' ? 'map' : 'list';
      try {
        localStorage.setItem('mn.catView', ui.catView);
      } catch {}
      renderContent();
      return;
    case 'mm-selected':
      if (!ui.select.ids.size) return;
      return openMindmap('selected', [...ui.select.ids]);
    case 'select-on':
      ui.select.on = true;
      ui.select.ids.clear();
      renderContent();
      return;
    case 'select-off':
      ui.select.on = false;
      ui.select.ids.clear();
      renderContent();
      return;
    case 'select-all': {
      const subj = currentSubject();
      S.items.filter((i) => i.subjectId === subj?.id).forEach((i) => ui.select.ids.add(i.id));
      renderContent();
      return;
    }
    case 'toggle-select':
      return toggleSelect(el.dataset.id);
    case 'mm-zoom':
      return mmZoom(Number(el.dataset.dir));
    case 'mm-fit':
      return mmFit();
    case 'mm-export':
      return mmExport();
    case 'test-key':
      return testKey();
    case 'reset-data':
      return resetData();
    default:
      return;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'note-keep-formula') {
    const next = e.target.checked;
    api('/api/settings', { keepFormula: next })
      .then((st) => {
        S = st;
        toast(next ? '已开启：改稿时保留原公式' : '已关闭：公式由 AI 决定');
      })
      .catch((err) => toast(err.message, 'err'));
    return;
  }
  if (e.target.id === 'file-input') {
    uploadFiles(e.target.files, ui.uploadDeckId);
    e.target.value = '';
  }
  if (e.target.id === 'backup-input') {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) restoreBackup(f);
  }
  if (e.target.id === 'items-sort') {
    ui.sort = e.target.value || 'page';
    renderContent();
    return;
  }
  if (e.target.id === 'm-subject') {
    ui.subjectId = e.target.value;
    ui.view = 'decks';
    ui.q = '';
    render();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    ui.q = e.target.value;
    clearTimeout(ui.searchTimer);
    ui.searchTimer = setTimeout(renderContent, 140);
  }
});

document.addEventListener('keydown', (e) => {
  if (ui.ask) {
    if (e.key === 'Escape') askCancel();
    if (e.key === 'Enter') {
      e.preventDefault();
      askOk();
    }
    return;
  }
  if (e.key === 'Escape' && ui.modal) closeModal();
});

$('#overlay').addEventListener('click', (e) => {
  if (e.target.id !== 'overlay') return;
  if (ui.ask) return askCancel();
  closeModal();
});

/* 拖拽 */
let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('#drop').classList.add('show');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', (e) => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop').classList.remove('show');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').classList.remove('show');
  if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files, null);
});

/* 粘贴图片 */
document.addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.items || [])
    .filter((i) => i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter(Boolean);
  if (files.length) uploadFiles(files, null);
});

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

window.addEventListener('resize', () => {
  if (S) applyFoldSettings();
});

document.addEventListener('contextmenu', (e) => {
  const t2 = e.target;
  if (t2 instanceof Element && t2.closest('input, textarea, [contenteditable="true"], .selectable')) return;
  e.preventDefault();
});

(async function boot() {
  try {
    await refresh();
  } catch (e) {
    $('#content').innerHTML = `<div class="empty"><b>无法连接本地服务</b><p>${esc(e.message)}</p></div>`;
    return;
  }
  try {
    const savedScale = Number(S.settings.uiScale) || Number(localStorage.getItem('mn.scale')) || 1;
    applyUiScale(savedScale);
    if (localStorage.getItem('mn.catView') === 'map') ui.catView = 'map';
  } catch {}
  lockPageZoom();
  render();
  ensurePolling();
  // 首次启动：走一遍使用引导（设置里标记后再也不弹）
  try {
    if (!S.settings.onboarded) {
      ui.onboard = { step: 0 };
      openModal('onboard');
    }
  } catch {}
})();
