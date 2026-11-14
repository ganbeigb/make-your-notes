'use strict';
/**
 * 极简本地存储：一个 db.json + 一个 images 目录。
 * 所有写操作走「临时文件 + rename」，避免断电/崩溃写坏数据。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const secret = require('./secret');

const ROOT = path.join(__dirname, '..');
// 手机上运行时把数据放在可写目录（payload 会随版本更新被整体替换）
const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(ROOT, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const DEFAULT_SETTINGS = {
  provider: 'deepseek', // deepseek | zhipu
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash', // 识别模型（需要能读图）
  textModel: 'deepseek-flash', // 整理 / 改稿 / 起草用的文字模型
  strictVerify: false, // 严格模式：识别后再用原图校对一遍
  keepFormula: false, // 改稿时是否保留原公式（默认不特殊处理）
  uiScale: 1, // 界面缩放，随服务端保存（换端口也不会丢）
  cardLines: 4, // 知识点卡片折叠行数
  deckRows: 3, // 课件缩略图折叠行数
  showQuote: true,
  allowSelect: false, // 是否允许手动选中文字（默认关，靠「复制」按钮）
  boardSettings: { autoRewire: true, grid: true, snap: true, snapDrag: true, avoid: true }, // 知识点卡片/详情里是否显示原文引用
  reasoning: 'off', // off | low | high | max
  concurrency: 2,
  autoExtract: true,
  autoOrganize: false,
  mock: false,
  allowLan: true,
  shareToken: '',
};

let db = null;

const newId = (p) => p + '_' + crypto.randomBytes(5).toString('hex');
const now = () => new Date().toISOString();

function defaults() {
  return {
    version: 1,
    createdAt: now(),
    settings: { ...DEFAULT_SETTINGS, secret: null },
    subjects: [],
    decks: [],
    slides: [],
    items: [],
    categories: [],
    usage: blankUsage(),
    usageDaily: {},
  };
}

function blankUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    estimatedCost: 0,
    calls: 0,
    byKind: {
      extract: zeroUsage(),
      organize: zeroUsage(),
      refine: zeroUsage(),
      compose: zeroUsage(),
      summarize: zeroUsage(),
    },
  };
}

function zeroUsage() {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedCost: 0, calls: 0 };
}

function normalize(d) {
  const base = defaults();
  d.version = d.version || 1;
  d.settings = { ...base.settings, ...(d.settings || {}) };
  // 旧版本只有 thinking 布尔值，迁移成四档推理等级
  if (!d.settings.reasoning) {
    d.settings.reasoning = d.settings.thinking ? 'high' : 'off';
  }
  if (!['off', 'low', 'high', 'max'].includes(d.settings.reasoning)) {
    d.settings.reasoning = 'off';
  }
  delete d.settings.thinking;
  // 旧版本只有一个 model，迁移成「识别模型 + 文字模型」
  if (!d.settings.textModel) d.settings.textModel = d.settings.model || 'deepseek-flash';
  for (const k of ['subjects', 'decks', 'slides', 'items', 'categories']) {
    if (!Array.isArray(d[k])) d[k] = [];
  }
  if (!d.usageDaily || typeof d.usageDaily !== 'object') d.usageDaily = {};
  d.usage = { ...blankUsage(), ...(d.usage || {}) };
  d.usage.byKind = {
    extract: zeroUsage(),
    organize: zeroUsage(),
    refine: zeroUsage(),
    compose: zeroUsage(),
    summarize: zeroUsage(),
    ...(d.usage.byKind || {}),
  };
  for (const s of d.subjects) {
    if (!s.usage) s.usage = zeroUsage();
    else s.usage = { ...zeroUsage(), ...s.usage };
  }
  return d;
}

function persist() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

function init() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  let loaded = null;
  if (fs.existsSync(DB_PATH)) {
    try {
      loaded = normalize(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
    } catch {
      try {
        fs.copyFileSync(DB_PATH, DB_PATH + '.broken-' + Date.now());
      } catch {}
    }
  }
  db = loaded || defaults();
  if (!db.settings.shareToken) {
    db.settings.shareToken = crypto.randomBytes(8).toString('hex');
  }
  persist();
  return db;
}

function get() {
  if (!db) init();
  return db;
}

function save() {
  if (!db) return;
  persist();
}

function setApiKey(key) {
  const s = get().settings;
  s.secret = key ? secret.protect(key) : null;
}

function getApiKey() {
  const s = get().settings;
  return s.secret ? secret.unprotect(s.secret) : '';
}

function hasStrongKey() {
  return secret.isStrong(get().settings.secret);
}

function addUsage(u, meta = {}) {
  if (!u) return;
  const db = get();
  const apply = (t) => {
    t.promptTokens += u.prompt || 0;
    t.completionTokens += u.completion || 0;
    t.cachedTokens += u.cached || 0;
    t.estimatedCost += u.costCny || 0;
    t.calls += 1;
  };

  apply(db.usage);
  if (!db.usage.byKind) db.usage.byKind = {};
  if (meta.kind) {
    if (!db.usage.byKind[meta.kind]) db.usage.byKind[meta.kind] = zeroUsage();
    apply(db.usage.byKind[meta.kind]);
  }
  if (meta.subjectId) {
    const s = db.subjects.find((x) => x.id === meta.subjectId);
    if (s) {
      if (!s.usage) s.usage = zeroUsage();
      apply(s.usage);
    }
  }

  // 按天累计，供折线图使用
  if (!db.usageDaily) db.usageDaily = {};
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!db.usageDaily[key]) db.usageDaily[key] = { promptTokens: 0, completionTokens: 0, estimatedCost: 0, calls: 0 };
  const day = db.usageDaily[key];
  day.promptTokens += u.prompt || 0;
  day.completionTokens += u.completion || 0;
  day.estimatedCost += u.costCny || 0;
  day.calls += 1;
}

function resetUsage() {
  const db = get();
  db.usage = blankUsage();
  db.usageDaily = {};
  for (const s of db.subjects) s.usage = zeroUsage();
}

/* ---------- 级联删除 ---------- */

function removeImage(file) {
  if (!file) return;
  const p = path.join(IMAGES_DIR, path.basename(file));
  try {
    fs.unlinkSync(p);
  } catch {}
}

function deleteDeck(deckId) {
  const d = get();
  d.slides.filter((s) => s.deckId === deckId).forEach((s) => {
    removeImage(s.image);
    removeImage(s.thumb);
  });
  d.slides = d.slides.filter((s) => s.deckId !== deckId);
  d.decks = d.decks.filter((x) => x.id !== deckId);
  d.items = d.items.filter((i) => i.deckId !== deckId);
  save();
}

function deleteSubject(subjectId) {
  const d = get();
  d.decks.filter((x) => x.subjectId === subjectId).forEach((x) => deleteDeck(x.id));
  const fresh = get();
  fresh.subjects = fresh.subjects.filter((x) => x.id !== subjectId);
  fresh.items = fresh.items.filter((i) => i.subjectId !== subjectId);
  fresh.categories = fresh.categories.filter((c) => c.subjectId !== subjectId);
  save();
}

function deleteSlide(slideId) {
  const d = get();
  const s = d.slides.find((x) => x.id === slideId);
  if (!s) return;
  removeImage(s.image);
  removeImage(s.thumb);
  d.slides = d.slides.filter((x) => x.id !== slideId);
  d.items = d.items.filter((i) => i.slideId !== slideId);
  save();
}

module.exports = {
  ROOT,
  DATA_DIR,
  IMAGES_DIR,
  DB_PATH,
  DEFAULT_SETTINGS,
  init,
  get,
  save,
  newId,
  now,
  setApiKey,
  getApiKey,
  hasStrongKey,
  addUsage,
  resetUsage,
  blankUsage,
  deleteDeck,
  deleteSubject,
  deleteSlide,
  removeImage,
};
