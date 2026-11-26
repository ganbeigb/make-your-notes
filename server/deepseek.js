'use strict';
/**
 * DeepSeek 调用层：视觉抽取 + 自动归类。
 * 只依赖 Node 内置 fetch（Node 18+）。
 */

// 单位：美元 / 1M tokens，取高峰价估算，宁可高估
const PRICE = { hit: 0.006, miss: 0.3, out: 1.2 };
const USD_TO_CNY = 7.2;

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const SYMBOL_GUIDE = `电路 / 元器件类配图请优先用内置元件库，用 <use> 引用，不要自己画电阻电容：

  <use href="#sym-resistor" transform="translate(160,120)"/>
  <use href="#sym-npn" transform="translate(300,180)"/>

坐标是器件中心，引脚位置（相对中心）：
- 所有两端器件（电阻、电容、电解电容、电感、电位器、二极管、稳压管、LED、光电二极管、电池、电压源、电流源、开关、按钮、灯泡、保险丝、热敏电阻、压敏电阻、晶振、蜂鸣器、喇叭、排针、电流表、电压表）：(-20,0) 和 (20,0)
- sym-transformer 变压器：原边 (-20,-10)(-20,10)，副边 (20,-10)(20,10)
- sym-switch-spdt 单刀双掷：公共 (-20,0)，常开 (20,-10)，常闭 (20,10)
- sym-npn / sym-pnp 三极管：基极 (-20,0)，集电极 (20,-16)，发射极 (20,16)
- sym-nmos MOS：栅极 (-20,0)，漏极 (20,-14)，源极 (20,14)
- sym-opamp 运放：反相 (-20,-8)，同相 (-20,8)，输出 (20,0)
- sym-optocoupler 光耦：左 (-30,-8)(-30,8)，右 (30,-8)(30,8)
- sym-and / sym-or 逻辑门：输入 (-30,-8)(-30,8)，输出 (20,0)
- sym-not 非门：输入 (-20,0)，输出 (20,0)
- sym-bridge 整流桥：(-30,-10)(-30,10)(30,-10)(30,10)
- sym-antenna 天线：(0,12)；sym-ground 接地：(0,-12)；sym-vcc / sym-vdd：(0,12)

连线用 <line> 或 <path>，走直角；导线端点要落在上面的引脚坐标上；节点用 <circle r="2.5" fill="#243029"/> 表示。
器件旁边用 <text font-size="12"> 标注编号（R1、C2）和数值（10kΩ、100µF）。`;

const EXTRACT_SYSTEM = `你是一位严谨的大学课程助教，负责把课件截图整理成可复习的结构化笔记。

你会收到一张 PPT / 课件截图（可能拍摄自投影，存在倾斜、反光或模糊）。请完成三件事：

1. 转录（ocr_text）：逐字提取图中可见的文字，保持原有层次与符号。看不清的字用 [?] 代替，绝不猜测或补全。
2. 知识点（knowledge_points）：从图中真正讲到、**值得记**的内容中抽取，1~4 条。只挑这一页的重点，不要逐行罗列，也不要把同一段内容拆成多条。每条的 quote 必须是图中对应原文的片段，用于人工核对；importance 取 1~5；如果这条知识点对应某个公式，把公式写进 formula（LaTeX 源码，不带 $ 符号），没有就留空。
3. 拓展（extensions）：与该页内容相关、但图中没有出现的信息，例如背景、易错点、考点、典型例题、相关概念。每条用 type 标注类别，并给出 title（10 字以内、对这条内容的概括，例如「饱和电流要留余量」），不要直接用「易错点」「考点」当标题。

规则：
- knowledge_points 只能来自图片，extensions 必须是图片之外的内容，两者不得混淆。
- 数学符号与公式一律使用 LaTeX：正文里的数学表达式必须用 $...$ 包住（例如 $\frac{a}{b}$、$x^2$），独立公式用 $$...$$；不要写裸露的 LaTeX 命令。
- 单独的符号可以直接写 Unicode 字符（ε、δ、≤、≥、∑、∫、∂、∞ 等），不必包 $。
- 不确定、无法辨认的内容放进 uncertain，不要强行给出答案。
- 推导、证明、计算过程不要拆成多条知识点：把整个过程概括成一条（名称写方法或结论，explanation 说明步骤脉络），除非图里并列讲了多个互不相关的结论。
- 如果这一页主体就是一道证明题或解题过程，把整道题作为一条知识点输出（名称写题型或结论），关键结论同时写进 formulas；不要一步一条。
- 只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。

保真规则（转录时同样重要）：
- 数字：保留小数末尾的零、有效数字、千分位、百分号、正负号；不得自行舍入或统一写法。
- 单位：保留原有大小写与数量级前缀（mA 不要写成 MA，µF 不要写成 uF 或 MF），不要自动换算。
- 区间与比较：保留开闭区间、≤ 与 <、≈ 与 = 的原样。
- 公式：保留编号与多行结构；分子分母的覆盖范围、根号覆盖范围、上下标归属必须与图一致；括号成对。
- 原文若明显写错，按原样转录，并在 uncertain 里注明「原文疑似有误」。

易混字符自查（转录完成后逐项对照原图复查一遍）：
- 0 / O / o，1 / l / I，2 / z，5 / S，6 / b，8 / B，9 / g
- + / - / ± / ∓，减号与短横线，× 与 x，· 与 .
- = / ≠ / ≈，< 与 ≤，> 与 ≥
- 小数点、逗号、下标数字、上标负号
- d / ∂ / δ，拉丁字母与希腊字母，大小写
- 求和与积分的上下限、矩阵行列、转置与逆

uncertain 里每一条必须写清楚：哪里（where，例如「图 2 下半部第 3 个公式」）、看到了什么（seen）、可能的候选（candidates 数组）、为什么不能确定（why）。不要编造置信度百分比。

JSON 结构如下（字段名必须一致）：
{
  "title": "本页标题，没有则概括一个",
  "summary": "一句话概括本页讲了什么",
  "ocr_text": "逐字转录的原文",
  "knowledge_points": [
    {"name": "知识点名称", "explanation": "解释，1~3 句", "quote": "图中原文片段", "importance": 4, "tags": ["标签"], "formula": "这条知识点对应的公式，LaTeX 源码，不带 $；没有就留空"}
  ],
  "extensions": [
    {"type": "易错点", "title": "10 字以内的概括", "content": "补充说明"}
  ],
  "formulas": ["本页出现的公式，写 LaTeX 源码，不要带 $ 符号"],
  "uncertain": [
    {"where": "图 2 下半部第 3 个公式", "seen": "看起来是 ε>0", "candidates": ["ε>0", "ε≥0"], "why": "反光，符号下半部分被遮住"}
  ]
}`;

const ORGANIZE_SYSTEM = `你是一位课程内容架构师。用户会给你一个科目的全部知识点（每条含 id、名称、摘要），
请把它们整理成便于复习与检索的 2~3 层目录。

要求：
- 如果用户给出了自己的分类标准，优先按用户标准执行，冲突时以用户为准。
- 一级目录 2~10 个字，按知识脉络组织（章节 / 主题 / 方法），不要用「其他」「杂项」堆砌。
- 同一主题必须合并，不要产生重复或近义目录。
- 每个知识点必须且只能出现在一个目录下，用 id 引用，不得遗漏。
- 一级目录数量控制在 3~9 个。
- 只输出 JSON，不要任何解释。

输出格式：
{"categories":[{"name":"一级目录","children":[{"name":"二级目录","items":["id1","id2"]}]}],
 "duplicates":[{"keep":"保留的 id","merge":["被合并的 id"],"name":"合并后的名称","content":"合并后的解释"}]}
没有二级目录时，把 items 直接放在一级目录上。

另外，如果发现有些知识点讲的是同一件事（措辞不同、内容有重叠，但概念、公式或结论相同），把需要合并的组放进 duplicates：
- 只有确实重复才合并，拿不准就不要合并。
- keep 选名称最完整、内容最具体的那条；merge 列出其余重复项的 id。
- name 用最合适的名称；content 把几条整合成一段通顺的解释，不要重复啰嗦。
- 合并后这个概念仍然要出现在 categories 里（用 keep 的 id）。`;

/* ------------------------------------------------------------------ */
/* 基础请求                                                            */
/* ------------------------------------------------------------------ */

/**
 * 推理等级：off / low / high / max
 * off  → 关闭思考；其余 → 开启思考并指定 reasoning_effort
 */
function applyReasoning(payload, settings) {
  let level = settings.reasoning;
  if (!['off', 'low', 'high', 'max'].includes(level)) {
    level = settings.thinking ? 'high' : 'off'; // 兼容旧配置
  }
  if (level === 'off') {
    payload.thinking = { type: 'disabled' };
    delete payload.reasoning_effort;
  } else {
    payload.thinking = { type: 'enabled' };
    // 智谱只认 thinking.type，不认 reasoning_effort
    if (settings.provider !== 'zhipu') payload.reasoning_effort = level;
  }
  return payload;
}

function textModelOf(settings) {
  return settings.textModel || settings.model || 'deepseek-flash';
}

function normalizeUsage(u, settings = {}, usedModel) {
  const prompt = u?.prompt_tokens || 0;
  const completion = u?.completion_tokens || 0;
  const cached = u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0;
  const miss = Math.max(0, prompt - cached);
  const usd = (cached * PRICE.hit + miss * PRICE.miss + completion * PRICE.out) / 1e6;
  // 智谱的 flash 系列是免费模型，不产生费用
  const model = usedModel || settings.model || '';
  const free = settings.provider === 'zhipu' && /flash/i.test(String(model));
  return {
    prompt,
    completion,
    cached,
    tokens: prompt + completion,
    costCny: free ? 0 : Math.round(usd * USD_TO_CNY * 1e4) / 1e4,
  };
}

function friendlyError(status, msg, settings = {}) {
  const vendor = settings.provider === 'zhipu' ? '智谱' : 'DeepSeek';
  if (status === 401 || status === 403) {
    return `API Key 无效或无权限（${vendor}）：请确认 Key 属于当前供应商，并在设置里重新填写`;
  }
  if (status === 402) return `账户余额不足（${vendor}），请到开放平台充值`;
  if (status === 429) return `请求过于频繁（${vendor} 限流）：已自动重试 3 次仍未成功，稍等一分钟再点识别，或把并发数降到 1`;
  if (status === 404) {
    return `接口返回 404：请检查「接口地址」和模型名（${vendor} 的地址需以 /v4 结尾）`;
  }
  if (status === 400) return `请求被拒绝（${vendor}）：` + msg;
  if (status >= 500) return `${vendor} 服务暂时不可用，请稍后重试`;
  return msg || `请求失败（HTTP ${status}）`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 限流/临时故障时自动退避重试，最多 4 次（总计约 30 秒） */
async function chat(settings, apiKey, payload) {
  const base = (settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const retryable = new Set([429, 500, 502, 503, 504]);

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    let res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('请求超时（4 分钟无响应），请检查网络后重试');
      throw new Error('无法连接接口：' + (e.cause?.code || e.message));
    }
    clearTimeout(timer);

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (res.ok && data) return data;

    if (retryable.has(res.status) && attempt < 3) {
      const after = Number(res.headers.get('retry-after')) || 0;
      const wait = after
        ? Math.min(after * 1000, 20000)
        : Math.min(2000 * Math.pow(2, attempt), 16000);
      await sleep(wait + Math.floor(Math.random() * 500));
      continue;
    }

    if (!res.ok) {
      const raw = data?.error?.message || text.slice(0, 300);
      throw new Error(friendlyError(res.status, raw, settings));
    }
    throw new Error('接口返回了无法解析的内容');
  }
}

/**
 * 带降级的 JSON 请求：不同厂商对 thinking / reasoning_effort / response_format
 * 的支持不一样，被拒时逐项去掉再试，而不是直接失败。
 */
/** 有的厂商只收裸 base64，不收 data:image/...;base64, 前缀 */
function stripDataUrls(payload) {
  let changed = false;
  const messages = (payload.messages || []).map((m) => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.map((part) => {
      const url = part?.image_url?.url;
      if (part?.type === 'image_url' && typeof url === 'string' && url.startsWith('data:')) {
        changed = true;
        return { ...part, image_url: { ...part.image_url, url: url.replace(/^data:[^;]+;base64,/, '') } };
      }
      return part;
    });
    return { ...m, content };
  });
  return changed ? messages : null;
}
async function chatJson(settings, apiKey, payload) {
  const body = { ...payload };
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await chat(settings, apiKey, body);
    } catch (e) {
      last = e;
      const msg = String(e.message || '');
      let changed = false;

      // 1) 模型不认 thinking / reasoning_effort
      if ((body.thinking || body.reasoning_effort) && /thinking|reasoning/i.test(msg)) {
        delete body.thinking;
        delete body.reasoning_effort;
        changed = true;
      }
      // 2) 模型不支持 JSON 模式
      if (body.response_format && /response_format|json_object|json mode|invalid.*json/i.test(msg)) {
        delete body.response_format;
        changed = true;
      }
      // 3) 只收裸 base64、不收 data: 前缀（模型不支持读图时不要重试）
      const formatIssue =
        /base64|data:|decode|解码|格式|format|image_url/i.test(msg) && !/not support|不支持|unsupported/i.test(msg);
      if (formatIssue) {
        const stripped = stripDataUrls(body);
        if (stripped) {
          body.messages = stripped;
          changed = true;
        }
      }
      // 4) max_tokens 超出模型允许范围：逐步降低，最后交给服务端默认值
      const tokenIssue =
        /max_tokens|max tokens|最大输出|token/i.test(msg) && /非法|invalid|超出|exceed|range|范围|too large/i.test(msg);
      if (tokenIssue) {
        const cur = Number(body.max_tokens) || 0;
        if (cur > 2000) body.max_tokens = 2000;
        else if (cur > 1024) body.max_tokens = 1024;
        else if (cur > 512) body.max_tokens = 512;
        else if (cur > 256) body.max_tokens = 256;
        else if (cur > 0) delete body.max_tokens;
        if ((Number(body.max_tokens) || 0) !== cur) changed = true;
      }

      if (!changed) throw e;
    }
  }
  throw last || new Error('请求被多次拒绝，请检查模型参数');
}

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {}
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    const body = t.slice(s, e + 1);
    try {
      return JSON.parse(body);
    } catch {}
    try {
      return JSON.parse(body.replace(/,\s*([}\]])/g, '$1'));
    } catch {}
  }
  return null;
}

function str(v, max = 4000) {
  return String(v ?? '').slice(0, max);
}

/** 公式字段：去掉 $ 包裹与换行，限制长度 */
function cleanFormula(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\$\$?/, '').replace(/\$\$?$/, '').trim();
  return s.slice(0, 400);
}

function normalizeExtraction(data, { subject, deck, page }) {
  const points = Array.isArray(data.knowledge_points) ? data.knowledge_points : [];
  const exts = Array.isArray(data.extensions) ? data.extensions : [];
  return {
    title: str(data.title, 120) || `${deck} · 第 ${page} 页`,
    summary: str(data.summary, 400),
    ocrText: str(data.ocr_text, 8000),
    formulas: Array.isArray(data.formulas) ? data.formulas.map((x) => str(x, 300)).filter(Boolean) : [],
    uncertain: (Array.isArray(data.uncertain) ? data.uncertain : [])
      .map((x) => {
        if (typeof x === 'string') return { where: '', seen: str(x, 300), candidates: [], why: '' };
        return {
          where: str(x?.where, 120),
          seen: str(x?.seen ?? x?.content ?? x?.note, 300),
          candidates: Array.isArray(x?.candidates)
            ? x.candidates.map((c) => str(c, 80)).filter(Boolean).slice(0, 4)
            : [],
          why: str(x?.why, 200),
        };
      })
      .filter((x) => x.seen || x.where || x.candidates.length),
    points: points
      .map((p) => ({
        name: str(p?.name, 120),
        explanation: str(p?.explanation, 1500),
        quote: str(p?.quote, 600),
        importance: Math.max(1, Math.min(5, Number(p?.importance) || 3)),
        tags: Array.isArray(p?.tags) ? p.tags.map((t) => str(t, 20)).slice(0, 6) : [],
        formula: cleanFormula(p?.formula),
      }))
      .filter((p) => p.name),
    extensions: exts
      .map((e) => ({
        type: str(e?.type, 20) || '拓展',
        title: str(e?.title ?? e?.name, 60),
        content: str(e?.content, 1200),
      }))
      .filter((e) => e.content),
  };
}

/* ------------------------------------------------------------------ */
/* 视觉抽取                                                            */
/* ------------------------------------------------------------------ */

async function extractSlide({ settings, apiKey, subject, deck, page, imageDataUrl, glossary }) {
  if (settings.mock) return mockExtract({ subject, deck, page });

  const userText = [
    `科目：${subject}`,
    `课件：${deck}`,
    `页码：第 ${page} 页`,
    glossary ? `本课件前面页面已出现的符号（保持同一写法）：${glossary}` : '',
    '请按系统要求输出 json。',
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    { role: 'system', content: EXTRACT_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
      ],
    },
  ];

  const basePayload = {
    model: settings.model || 'deepseek-flash',
    messages,
    response_format: { type: 'json_object' },
    max_tokens: 4000,
    temperature: 0.2,
    stream: false,
  };
  applyReasoning(basePayload, settings);

  const data = await chatJson(settings, apiKey, basePayload);

  let content = data?.choices?.[0]?.message?.content || '';
  let parsed = parseJsonLoose(content);

  // 官方文档：JSON 模式偶发返回空内容，重试一次
  if (!parsed) {
    const retry = {
      ...basePayload,
      messages: [...messages, { role: 'user', content: '上一次回复为空或不是合法 JSON。请只输出一个 JSON 对象，不要任何其他文字。' }],
    };
    const d2 = await chat(settings, apiKey, retry);
    content = d2?.choices?.[0]?.message?.content || '';
    parsed = parseJsonLoose(content);
    if (!parsed) throw new Error('模型没有返回可解析的 JSON，请重试或换一页更清晰的图片');
    return {
      result: normalizeExtraction(parsed, { subject, deck, page }),
      usage: normalizeUsage(d2.usage, settings, settings.model),
    };
  }

  return {
    result: normalizeExtraction(parsed, { subject, deck, page }),
    usage: normalizeUsage(data.usage, settings, settings.model),
  };
}

/* ------------------------------------------------------------------ */
/* 自动归类                                                            */
/* ------------------------------------------------------------------ */

/** 合并建议的规范化：只保留有 keep 和 merge 的组 */
function normalizeDuplicates(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((g) => ({
      keep: str(g?.keep, 60),
      merge: Array.isArray(g?.merge) ? g.merge.map((x) => str(x, 60)).filter(Boolean) : [],
      name: str(g?.name, 120),
      content: str(g?.content, 2000),
    }))
    .filter((g) => g.keep && g.merge.length)
    .slice(0, 40);
}

async function organize({ settings, apiKey, subject, items, criteria }) {
  if (settings.mock) return mockOrganize(subject, items);

  const brief = items.slice(0, 400).map((i) => ({
    id: i.id,
    name: i.name,
    summary: (i.content || '').replace(/\s+/g, ' ').slice(0, 110),
  }));

  const rule = String(criteria || '').trim();
  const messages = [
    { role: 'system', content: ORGANIZE_SYSTEM },
    {
      role: 'user',
      content:
        `科目：${subject}\n` +
        (rule ? `用户对这个科目的分类标准（优先遵守）：\n${rule}\n\n` : '') +
        `知识点共 ${brief.length} 条：\n` +
        JSON.stringify(brief) +
        '\n请输出 json。',
    },
  ];

  const payload = {
    model: textModelOf(settings),
    messages,
    response_format: { type: 'json_object' },
    max_tokens: 8000,
    temperature: 0.3,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);

  let content = data?.choices?.[0]?.message?.content || '';
  let parsed = parseJsonLoose(content);
  if (!parsed) {
    const d2 = await chat(settings, apiKey, {
      ...payload,
      messages: [...messages, { role: 'user', content: '上一次输出不是合法 JSON。请只输出 JSON 对象。' }],
    });
    content = d2?.choices?.[0]?.message?.content || '';
    parsed = parseJsonLoose(content);
    if (!parsed) throw new Error('归类结果无法解析，请重试');
    return {
      tree: parsed.categories || [],
      duplicates: normalizeDuplicates(parsed.duplicates),
      usage: normalizeUsage(d2.usage, settings, textModelOf(settings)),
    };
  }
  return {
    tree: parsed.categories || [],
    duplicates: normalizeDuplicates(parsed.duplicates),
    usage: normalizeUsage(data.usage, settings, textModelOf(settings)),
  };
}

/* ------------------------------------------------------------------ */
/* 演示模式（没有 API Key 时也能体验完整流程）                          */
/* ------------------------------------------------------------------ */

const MOCK_TEMPLATES = [
  {
    title: '函数极限与连续',
    summary: '从数列极限过渡到函数极限，给出 ε-δ 定义与连续性的判定。',
    ocr: '第三章 极限与连续\n3.1 函数极限的定义\n设 f(x) 在点 x0 的某去心邻域内有定义，若对任意 ε>0，存在 δ>0，\n使得当 0<|x-x0|<δ 时，恒有 |f(x)-A|<ε，则称 A 为 f 在 x0 处的极限。\n极限存在的充要条件：左右极限存在且相等。',
    points: [
      { name: '函数极限的 ε-δ 定义', explanation: '用任意 ε 与相应的 δ 刻画“无限接近”，是分析学一切严密论证的起点。', quote: '若对任意 ε>0，存在 δ>0，使得当 0<|x-x0|<δ 时，恒有 |f(x)-A|<ε', importance: 5, tags: ['定义', '核心'] },
      { name: '左右极限与极限存在性', explanation: '极限存在当且仅当左右极限都存在且相等，常用于判断分段函数在分界点处的行为。', quote: '极限存在的充要条件：左右极限存在且相等', importance: 4, tags: ['判定'] },
      { name: '连续性的定义', explanation: '函数在一点连续等价于该点极限值等于函数值，即 lim f(x) = f(x0)。', quote: '（本页未直接写出，由极限定义推出）', importance: 4, tags: ['连续性'] },
    ],
    exts: [
      { type: '易错点', content: 'ε-δ 定义中 δ 依赖于 ε 与 x0，不能写成只依赖 ε 的常数；这是考试中最常见的扣分点。' },
      { type: '考点', content: '证明题常要求“对给定的 ε 求出 δ”，复习时建议默写 3 遍标准证明模板。' },
    ],
    formulas: ['lim(x→x0) f(x) = A ⟺ lim(x→x0⁻) f(x) = lim(x→x0⁺) f(x) = A'],
  },
  {
    title: '进程调度与时间片',
    summary: '比较先来先服务、短作业优先与时间片轮转三种调度策略的优劣。',
    ocr: '第四章 处理机调度\n4.2 常见调度算法\n1. 先来先服务 FCFS：按到达顺序执行，简单但平均等待时间长。\n2. 短作业优先 SJF：平均等待时间最短，但可能导致长作业饥饿。\n3. 时间片轮转 RR：每个进程分配固定时间片 q，适合分时系统。\n周转时间 = 完成时间 - 到达时间。',
    points: [
      { name: 'FCFS 与护航效应', explanation: '先来先服务实现简单，但长作业排在前面时会让后续短作业长时间等待。', quote: '先来先服务 FCFS：按到达顺序执行，简单但平均等待时间长', importance: 3, tags: ['算法'] },
      { name: 'SJF 的最优性与饥饿风险', explanation: '在非抢占条件下 SJF 的平均等待时间最小，但长作业可能长期得不到调度。', quote: '短作业优先 SJF：平均等待时间最短，但可能导致长作业饥饿', importance: 5, tags: ['算法', '考点'] },
      { name: '时间片轮转的参数选择', explanation: '时间片过大退化为 FCFS，过小则上下文切换开销占比升高。', quote: '时间片轮转 RR：每个进程分配固定时间片 q', importance: 4, tags: ['分时系统'] },
    ],
    exts: [
      { type: '例题', content: '给出 4 个进程的到达时间与服务时间，分别计算 FCFS、SJF、RR(q=2) 的平均周转时间，是期末必考题型。' },
      { type: '背景', content: 'RR 的思想源自分时系统对响应时间的要求，Unix 的调度器在此基础上演化出多级反馈队列。' },
    ],
    formulas: ['周转时间 = 完成时间 − 到达时间', '带权周转时间 = 周转时间 / 服务时间'],
  },
];

// 初始模板里混入了一条计算机类内容，这里移除，保证数学集合纯粹
{
  const i = MOCK_TEMPLATES.findIndex((t) => t.title === '进程调度与时间片');
  if (i >= 0) MOCK_TEMPLATES.splice(i, 1);
}

MOCK_TEMPLATES.push({
  title: '间断点的分类',
  summary: '按左右极限是否存在，把间断点分为第一类与第二类。',
  ocr: '3.4 函数的间断点\n若 f 在 x0 处不连续，则称 x0 为 f 的间断点。\n第一类：左右极限都存在（可去间断点、跳跃间断点）。\n第二类：至少一个单侧极限不存在（无穷间断点、振荡间断点）。',
  points: [
    { name: '间断点的定义', explanation: '函数在该点无定义、或极限不存在、或极限值不等于函数值，三者满足其一即为间断。', quote: '若 f 在 x0 处不连续，则称 x0 为 f 的间断点', importance: 3, tags: ['定义'] },
    { name: '第一类间断点', explanation: '左右极限都存在：相等但无定义或值不匹配为可去间断点，不相等为跳跃间断点。', quote: '第一类：左右极限都存在（可去间断点、跳跃间断点）', importance: 5, tags: ['判定', '考点'] },
    { name: '第二类间断点', explanation: '至少一个单侧极限不存在，常见于无穷间断（如 1/x）与振荡间断（如 sin(1/x)）。', quote: '第二类：至少一个单侧极限不存在（无穷间断点、振荡间断点）', importance: 4, tags: ['判定'] },
  ],
  exts: [
    { type: '易错点', content: '可去间断点通过补充或修改该点定义即可变为连续，但跳跃间断点无论怎么补定义都不连续。' },
    { type: '考点', content: '期末常考：给出含参数的分段函数，问参数取何值时函数连续，本质是求左右极限并令其相等。' },
  ],
  formulas: ['可去间断点 ⟺ lim(x→x0) f(x) 存在，但 f(x0) 无定义或 ≠ 该极限'],
});

MOCK_TEMPLATES.push({
  title: '导数的定义与几何意义',
  summary: '用差商的极限定义导数，并给出切线斜率与可导、连续的关系。',
  ocr: '4.1 导数的定义\nf\u2032(x0) = lim(Δx→0) [f(x0+Δx) - f(x0)] / Δx\n几何意义：曲线 y=f(x) 在点 (x0, f(x0)) 处切线的斜率。\n可导必连续，连续不一定可导。',
  points: [
    { name: '导数的定义式', explanation: '函数增量与自变量增量之比的极限，刻画瞬时变化率。', quote: "f'(x0) = lim(Δx→0) [f(x0+Δx) - f(x0)] / Δx", importance: 5, tags: ['定义', '核心'] },
    { name: '导数的几何意义', explanation: '导数值等于曲线在该点切线的斜率，切线方程为 y - f(x0) = f\u2032(x0)(x - x0)。', quote: '几何意义：曲线在点 (x0, f(x0)) 处切线的斜率', importance: 4, tags: ['几何'] },
    { name: '可导与连续的关系', explanation: '可导必连续，连续不一定可导；典型反例是 f(x)=|x| 在 x=0 处。', quote: '可导必连续，连续不一定可导', importance: 5, tags: ['定理', '考点'] },
  ],
  exts: [
    { type: '易错点', content: '判断分段函数在分界点是否可导，必须分别求左右导数，二者都存在且相等才可导，只看连续性会误判。' },
    { type: '例题', content: '用定义求 f(x)=|x| 在 x=0 处的导数：左导数为 -1、右导数为 1，故不可导。' },
  ],
  formulas: ["f'(x0) = lim(Δx→0) [f(x0+Δx) − f(x0)] / Δx", '可导 ⇒ 连续'],
});

const MOCK_OS = [
  {
    title: '进程调度与时间片',
    summary: '比较先来先服务、短作业优先与时间片轮转三种调度策略的优劣。',
    ocr: '第四章 处理机调度\n4.2 常见调度算法\n1. 先来先服务 FCFS：按到达顺序执行，简单但平均等待时间长。\n2. 短作业优先 SJF：平均等待时间最短，但可能导致长作业饥饿。\n3. 时间片轮转 RR：每个进程分配固定时间片 q，适合分时系统。\n周转时间 = 完成时间 - 到达时间。',
    points: [
      { name: 'FCFS 与护航效应', explanation: '先来先服务实现简单，但长作业排在前面时会让后续短作业长时间等待。', quote: '先来先服务 FCFS：按到达顺序执行，简单但平均等待时间长', importance: 3, tags: ['算法'] },
      { name: 'SJF 的最优性与饥饿风险', explanation: '在非抢占条件下 SJF 的平均等待时间最小，但长作业可能长期得不到调度。', quote: '短作业优先 SJF：平均等待时间最短，但可能导致长作业饥饿', importance: 5, tags: ['算法', '考点'] },
      { name: '时间片轮转的参数选择', explanation: '时间片过大退化为 FCFS，过小则上下文切换开销占比升高。', quote: '时间片轮转 RR：每个进程分配固定时间片 q', importance: 4, tags: ['分时系统'] },
    ],
    exts: [
      { type: '例题', content: '给出 4 个进程的到达时间与服务时间，分别计算 FCFS、SJF、RR(q=2) 的平均周转时间，是期末必考题型。' },
      { type: '背景', content: 'RR 的思想源自分时系统对响应时间的要求，Unix 的调度器在此基础上演化出多级反馈队列。' },
    ],
    formulas: ['周转时间 = 完成时间 − 到达时间', '带权周转时间 = 周转时间 / 服务时间'],
  },
  {
    title: '死锁的四个必要条件',
    summary: '死锁产生的四个必要条件，以及预防、避免、检测三类处理策略。',
    ocr: '第五章 死锁\n5.1 死锁的四个必要条件\n互斥、请求并保持、不可剥夺、循环等待。\n处理策略：死锁预防、死锁避免（银行家算法）、死锁检测与解除。',
    points: [
      { name: '四个必要条件', explanation: '互斥、请求并保持、不可剥夺、循环等待必须同时成立才可能死锁，破坏其一即可预防。', quote: '互斥、请求并保持、不可剥夺、循环等待', importance: 5, tags: ['定义', '考点'] },
      { name: '死锁预防与避免的区别', explanation: '预防通过破坏必要条件静态地限制资源请求；避免则在运行时用银行家算法判断是否进入不安全状态。', quote: '处理策略：死锁预防、死锁避免（银行家算法）、死锁检测与解除', importance: 4, tags: ['策略'] },
      { name: '安全状态', explanation: '存在一个安全序列使所有进程都能依次完成，系统处于安全状态时不一定会死锁，但不安全状态可能死锁。', quote: '（由银行家算法的安全性检查推出）', importance: 4, tags: ['算法'] },
    ],
    exts: [
      { type: '易错点', content: '「不安全状态」不等于「已死锁」，只是有可能死锁；反之安全状态一定不会死锁。' },
      { type: '考点', content: '银行家算法的大题通常要求计算 Need 矩阵并判断某个请求能否分配，注意先做安全性检查再答复。' },
    ],
    formulas: ['Need[i][j] = Max[i][j] − Allocation[i][j]'],
  },
  {
    title: '页面置换算法',
    summary: 'OPT、LRU、FIFO 三种页面置换算法的比较与 Belady 异常。',
    ocr: '第六章 虚拟内存\n6.3 页面置换算法\nOPT：淘汰未来最长时间不被访问的页，理论最优但无法实现。\nLRU：淘汰最久未使用的页，性能接近 OPT，实现开销大。\nFIFO：淘汰最早进入内存的页，可能出现 Belady 异常。',
    points: [
      { name: 'OPT 与 LRU 的关系', explanation: 'OPT 是理论下界，LRU 用「过去」近似「未来」，命中率通常接近 OPT。', quote: 'OPT：淘汰未来最长时间不被访问的页，理论最优但无法实现', importance: 4, tags: ['算法'] },
      { name: 'Belady 异常', explanation: 'FIFO 在增加物理块数时缺页次数反而可能上升，这是 FIFO 特有的反常现象。', quote: 'FIFO：淘汰最早进入内存的页，可能出现 Belady 异常', importance: 5, tags: ['考点', '易错'] },
      { name: 'LRU 的实现代价', explanation: '需要栈或链表记录访问顺序，每次访问都要更新，硬件支持成本高。', quote: 'LRU：淘汰最久未使用的页，性能接近 OPT，实现开销大', importance: 3, tags: ['实现'] },
    ],
    exts: [
      { type: '例题', content: '给定页面访问串 1,2,3,4,1,2,5,1,2,3,4,5，分别用 OPT、LRU、FIFO（3 块）计算缺页次数。' },
      { type: '背景', content: '实际系统常用 Clock（近似 LRU）算法，用访问位和环形指针在开销与效果之间折中。' },
    ],
    formulas: ['缺页率 = 缺页次数 / 访问总次数'],
  },
];

function mockExtract({ subject, deck, page }) {
  const set = /操作系统|进程|线程|内存|调度|计算机/.test(subject || '') ? MOCK_OS : MOCK_TEMPLATES;
  const t = set[(page - 1) % set.length];
  return {
    result: {
      title: `${t.title}（演示）`,
      summary: t.summary,
      ocrText: t.ocr,
      formulas: t.formulas,
      uncertain: ['演示模式：以上内容为示例数据，未调用真实 API。'],
      points: t.points,
      extensions: t.exts,
    },
    usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
    mock: true,
  };
}

function mockOrganize(subject, items) {
  const groups = new Map();
  for (const it of items) {
    const key = it.tags?.[0] || '基础概念';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it.id);
  }
  const tree = [...groups.entries()].map(([name, ids], idx) => ({
    name: idx === 0 ? '核心概念' : name,
    items: ids,
  }));
  return { tree, duplicates: [], usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 }, mock: true };
}

/* ------------------------------------------------------------------ */
/* 按要求修改 / 补充知识点                                              */
/* ------------------------------------------------------------------ */

const EDIT_SYSTEM = `你是课程助教，负责按用户要求修改或补充一条课件笔记。

规则：
1. 只使用本页原文和该学科可靠的常识；不得编造与原文冲突的内容，不确定就写进 uncertain。
2. 数学与公式一律使用 LaTeX：行内用 $...$，独立公式用 $$...$$。例如 $\\lim_{x \\to 0}\\frac{\\sin x}{x}=1$。
3. 中文、简洁、可直接复习。修改时保留原条目的核心含义，除非用户明确要求改写。
3.1 用户说「重新生成 / 重写 / 换个说法」时，仍然必须基于「当前条目」的主题、对象与关键结论改写，不得换成无关内容；只有当前条目为空时才自由生成。
3.1.1 除非用户明确要求修改公式，否则必须原样保留当前条目的公式；不要因为没有提到就把它删掉或换掉。
3.2 输出前先对照当前条目，确认新内容与它讲的是同一件事；换了主题就重新写。
4. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释文字。

输出格式：
{
  "change_note": "一句话说明做了什么",
  "unchanged": false,
  "items": [
    {"kind": "point", "name": "知识点名称", "explanation": "解释", "quote": "对应的原文片段", "importance": 3, "tags": ["标签"], "formula": "可选：对应公式的 LaTeX，不带 $", "svg": "可选：<svg ...>...</svg>"}
  ]
}
- kind 取 "point"（本页讲到的内容）或 "extension"（本页之外的补充：易错点、考点、例题、背景）。
- 修改模式只返回 1 条；补充模式返回 1~3 条。
- 拓展条目的 name 要写成内容概括（如「饱和电流要留余量」），不要只写「易错点」「考点」这种分类名。
- 用户要求配图时，可在对应条目里加 "svg" 字段（完整自包含的 <svg>，带 viewBox，只用基本图形、元件库 <use> 与 <text>，不要脚本和外链）；不需要就省略。
- 电路 / 元器件图按下述元件库绘制：

${SYMBOL_GUIDE}`;

async function refine({ settings, apiKey, subject, deck, page, context, item, instruction, mode }) {
  if (settings.mock) return mockRefine({ item, instruction, mode });

  const current = item
    ? `当前条目（kind=${item.kind}）：
名称：${item.name}
解释：${item.content}
原文依据：${item.quote || '（无）'}`
    : '当前条目：无（本页整体补充）';

  const userText = [
    `科目：${subject}`,
    page ? `课件：${deck} 第 ${page} 页` : '关联页面：无（这是手动笔记）',
    `本页原文转录：\n${(context || '（无）').slice(0, 4000)}`,
    '',
    current,
    '',
    `用户要求：${instruction}`,
    `模式：${mode === 'append' ? '在现有内容之外补充 1~3 条' : '修改当前条目，只返回 1 条'}`,
    '请输出 json。',
  ].join('\n');

  const payload = {
    model: textModelOf(settings),
    messages: [
      { role: 'system', content: EDIT_SYSTEM },
      { role: 'user', content: userText },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000,
    temperature: 0.35,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);

  let content = data?.choices?.[0]?.message?.content || '';
  let parsed = parseJsonLoose(content);
  if (!parsed) {
    const d2 = await chat(settings, apiKey, {
      ...payload,
      messages: [...payload.messages, { role: 'user', content: '上一次输出不是合法 JSON。请只输出 JSON 对象。' }],
    });
    content = d2?.choices?.[0]?.message?.content || '';
    parsed = parseJsonLoose(content);
    if (!parsed) throw new Error('模型没有返回可解析的 JSON，请重试');
    return { items: normalizeEditItems(parsed.items), note: str(parsed.change_note, 120), usage: normalizeUsage(d2.usage, settings, textModelOf(settings)) };
  }

  return {
    items: normalizeEditItems(parsed.items),
    note: str(parsed.change_note, 120),
    usage: normalizeUsage(data.usage, settings, textModelOf(settings)),
  };
}

function normalizeEditItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ({
      kind: x?.kind === 'extension' ? 'extension' : 'point',
      name: str(x?.name, 120),
      explanation: str(x?.explanation ?? x?.content, 2000),
      quote: str(x?.quote, 600),
      importance: Math.max(1, Math.min(5, Number(x?.importance) || 3)),
      tags: Array.isArray(x?.tags) ? x.tags.map((t) => str(t, 20)).slice(0, 6) : [],
      formula: cleanFormula(x?.formula),
      svg: normalizeSvg(x?.svg),
    }))
    .filter((x) => x.name && x.explanation);
}

function mockRefine({ item, instruction, mode }) {
  const note = mode === 'append' ? '（演示模式）已补充 1 条示例内容' : '（演示模式）已按你的要求调整';
  if (mode === 'append') {
    return {
      items: [
        {
          kind: 'extension',
          name: '补充说明（演示）',
          explanation: `按你的要求「${instruction}」生成的示例内容。接入真实 API 后，这里会是与本页相关的具体补充。`,
          quote: '',
          importance: 3,
          tags: ['演示'],
        },
      ],
      note,
      usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
      mock: true,
    };
  }
  return {
    items: [
      {
        kind: item?.kind || 'point',
        name: item?.name || '知识点',
        explanation: `${item?.content || ''}\n\n（演示模式）已按你的要求「${instruction}」调整。`,
        quote: item?.quote || '',
        importance: item?.importance || 3,
        tags: item?.tags || [],
      },
    ],
    note,
    usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
    mock: true,
  };
}

/* ------------------------------------------------------------------ */
/* 按提示词起草一条笔记                                                 */
/* ------------------------------------------------------------------ */


const COMPOSE_SYSTEM = `你是一位课程助教，帮用户写一条课程笔记。

规则：
1. 按用户要求写，同时参考给出的课件原文；不要编造与原文冲突的内容。
2. 数学与公式一律使用 LaTeX：行内 $...$，独立公式 $$...$$。
3. 中文，简洁，2~6 句，可以直接拿来复习。
4. 用户要求配图（示意图、框图、原理图、流程图、结构图）时，额外输出 svg 字段；否则省略该字段。
4.1 如果给了「现有笔记」，除非用户明确要求改公式，否则必须原样保留它的公式（formula 字段照抄）。
5. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。

SVG 绘制要求（有 svg 字段时）：
- 输出完整、自包含的 <svg>，必须带 viewBox（如 viewBox="0 0 800 360"）。
- 只用 <rect> <line> <path> <circle> <polyline> <text> <g>；文字用 <text>，字号 ≥12。
- 不要 <script>、<foreignObject>、外链图片、CSS url()、动画。
- 矩形表示芯片/模块，线条表示导线，箭头表示方向，文字标注引脚、电压、元件值。
- 图中文字必须与正文一致，不确定的细节宁可省略。

${SYMBOL_GUIDE}

输出格式：
{
  "name": "标题，10~20 字",
  "content": "正文，可含 LaTeX 公式",
  "tags": ["标签1", "标签2"],
  "importance": 3,
  "formula": "可选：正文对应的核心公式，LaTeX，不带 $",
  "svg": "<svg viewBox=\"0 0 800 360\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>"
}
importance 取 1~5；不需要配图时省略 svg 字段。`;

/** 从模型输出里取 SVG（只接受 <svg ...> 开头的内容） */
function normalizeSvg(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const start = s.indexOf('<svg');
  const end = s.lastIndexOf('</svg>');
  if (start < 0 || end < start) return '';
  const svg = s.slice(start, end + 6);
  return svg.length > 80000 ? '' : svg;
}

function normalizeDraft(d, prompt) {
  const tags = Array.isArray(d?.tags) ? d.tags.map((t) => str(t, 20)).filter(Boolean).slice(0, 6) : [];
  return {
    name: str(d?.name, 120) || str(prompt, 40),
    content: str(d?.content ?? d?.explanation, 2000),
    tags,
    importance: Math.max(1, Math.min(5, Number(d?.importance) || 3)),
    formula: cleanFormula(d?.formula),
    svg: normalizeSvg(d?.svg),
  };
}

/** 用户没要求改公式时，沿用原笔记的公式 */
function keepFormula(draft, base, prompt, settings) {
  if (!settings?.keepFormula) return draft;
  const wants = /公式|formula|表达式|latex|推导/i.test(String(prompt || ''));
  if (base?.formula && !wants) draft.formula = base.formula;
  return draft;
}

async function compose({ settings, apiKey, subject, deck, page, context, prompt, kind, base }) {
  if (settings.mock) {
    return {
      draft: {
        name: '（演示）' + str(prompt, 30),
        content: `这是根据你的要求「${str(prompt, 120)}」生成的示例内容。接入真实 API 后，这里会是模型写好的笔记。`,
        tags: ['演示'],
        importance: 3,
      },
      usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
      mock: true,
    };
  }

  const baseBlock = base && (base.name || base.content)
    ? [
        '现有笔记（必须在它的基础上修改，保持同一主题与对象，不要换题）：',
        base.name ? `标题：${base.name}` : '',
        base.content ? `内容：${String(base.content).slice(0, 1500)}` : '',
        base.formula ? `公式：${base.formula}` : '',
        '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const userText = [
    `科目：${subject}`,
    deck ? `关联课件：${deck} 第 ${page} 页` : '未关联具体页面',
    baseBlock,
    context ? `本页原文（可参考）：\n${String(context).slice(0, 2500)}` : '',
    `笔记类型：${kind === 'extension' ? '拓展（背景 / 易错点 / 考点 / 例题）' : '知识点'}`,
    `用户要求：${prompt}`,
    '请输出 json。',
  ]
    .filter(Boolean)
    .join('\n');

  const payload = {
    model: textModelOf(settings),
    messages: [
      { role: 'system', content: COMPOSE_SYSTEM },
      { role: 'user', content: userText },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    temperature: 0.5,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);

  let content = data?.choices?.[0]?.message?.content || '';
  let parsed = parseJsonLoose(content);
  if (!parsed) {
    const d2 = await chat(settings, apiKey, {
      ...payload,
      messages: [...payload.messages, { role: 'user', content: '上一次输出不是合法 JSON。请只输出 JSON 对象。' }],
    });
    content = d2?.choices?.[0]?.message?.content || '';
    parsed = parseJsonLoose(content);
    if (!parsed) throw new Error('模型没有返回可解析的 JSON，请重试');
    return { draft: keepFormula(normalizeDraft(parsed, prompt), base, prompt, settings), usage: normalizeUsage(d2.usage, settings, textModelOf(settings)) };
  }

  return { draft: keepFormula(normalizeDraft(parsed, prompt), base, prompt, settings), usage: normalizeUsage(data.usage, settings, textModelOf(settings)) };
}

/* ------------------------------------------------------------------ */
/* 严格模式：拿原图校对第一遍的转录                                     */
/* ------------------------------------------------------------------ */

const VERIFY_SYSTEM = `你是校对员。给你一张课件原图和一份自动生成的转录草稿（含原文、公式、知识点）。
请逐字符对照原图与草稿，只报告确实不一致的地方。

规则：
1. 只修正能用眼睛确认的字符差异：形近字、符号、上下标、小数点、单位大小写、正负号、区间开闭。
2. 不要改写措辞、不要补全看不清的内容、不要调整结构。
3. 每条修正的 find 必须是草稿中逐字出现的原字符串（尽量短而唯一），replace 是正确写法。
4. 草稿与图一致时，corrections 返回空数组。
5. 只输出 JSON，不要解释。

输出格式：
{
  "corrections": [{"find": "草稿中的原文片段", "replace": "正确写法", "reason": "形近字 / 单位大小写 / 上下标"}],
  "note": "一句话说明校对结论"
}`;

async function verifyExtraction({ settings, apiKey, imageDataUrl, draft }) {
  if (settings.mock) return { corrections: [], note: '演示模式未校对', usage: null };

  const brief = [
    `原文转录：\n${String(draft.ocrText || '').slice(0, 5000) || '（空）'}`,
    draft.formulas?.length ? `公式：\n${draft.formulas.join('\n')}` : '',
    draft.points?.length
      ? `知识点：\n${draft.points.map((p) => `- ${p.name}：${p.explanation}`).join('\n').slice(0, 3000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const payload = {
    model: settings.model || 'deepseek-flash',
    messages: [
      { role: 'system', content: VERIFY_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: brief },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    temperature: 0,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);
  const parsed = parseJsonLoose(data?.choices?.[0]?.message?.content || '') || {};
  const corrections = (Array.isArray(parsed.corrections) ? parsed.corrections : [])
    .map((c) => ({ find: str(c?.find, 300), replace: str(c?.replace, 300), reason: str(c?.reason, 80) }))
    .filter((c) => c.find && c.find !== c.replace)
    .slice(0, 30);

  return {
    corrections,
    note: str(parsed.note, 200),
    usage: normalizeUsage(data.usage, settings, settings.model),
  };
}


/* ------------------------------------------------------------------ */
/* 本节总结                                                             */
/* ------------------------------------------------------------------ */

const SUMMARIZE_SYSTEM = `你是一位课程助教。用户会给你一节课的全部页面标题和知识点清单，请写一段可以直接用来复习的「本节总结」。

要求：
- 先用 2~3 句概括这一节讲什么、解决了什么问题。
- 再按逻辑顺序列出 3~8 条要点，每条以「- 」开头，覆盖关键概念、公式与方法。
- 数学公式用 LaTeX 行内 $...$。
- 中文，简洁；不要编造页面里没有的内容，缺什么就不写。
- 只输出一个 JSON 对象，不要代码块：{"summary": "总结正文"}`;

async function summarizeDeck({ settings, apiKey, subject, deck, pages }) {
  if (settings.mock) {
    return {
      summary: `（演示）${deck} 共 ${pages.length} 页。接入 API 后会生成真正的本节总结。`,
      usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
    };
  }

  const brief = pages
    .map((p) => `第 ${p.page} 页 · ${p.title || '未命名'}：${(p.points || []).join('、') || '（无知识点）'}`)
    .join('\n');

  const payload = {
    model: textModelOf(settings),
    messages: [
      { role: 'system', content: SUMMARIZE_SYSTEM },
      { role: 'user', content: `科目：${subject}\n课件：${deck}\n\n${brief}\n\n请输出 json。` },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    temperature: 0.4,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);
  const parsed = parseJsonLoose(data?.choices?.[0]?.message?.content || '') || {};
  const summary = str(parsed.summary ?? parsed.content, 4000);
  if (!summary) throw new Error('模型没有返回总结内容，请重试');
  return { summary, usage: normalizeUsage(data.usage, settings, textModelOf(settings)) };
}


/* ------------------------------------------------------------------ */
/* 单页汇总（不分块的一段话）                                           */
/* ------------------------------------------------------------------ */

const DIGEST_SYSTEM = `你是课程助教。给你一页课件的知识点列表，请把它们写成一段连贯的中文说明。

要求：
- 不分点、不用列表、不用小标题，就是一段话，2~5 句。
- 把这一页的核心内容串起来，读起来像一段完整的复习笔记。
- 关键公式用 LaTeX 行内 $...$。
- 只输出 JSON：{"digest": "..."}`;

async function digestSlide({ settings, apiKey, subject, page, points }) {
  if (settings.mock) {
    return {
      digest: `（演示）第 ${page} 页共 ${points.length} 个知识点：${points.map((p) => p.name).join('、')}。`,
      usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
    };
  }

  const brief = points
    .map((p, i) => `${i + 1}. ${p.name}：${String(p.content || '').slice(0, 300)}`)
    .join('\n');

  const payload = {
    model: textModelOf(settings),
    messages: [
      { role: 'system', content: DIGEST_SYSTEM },
      { role: 'user', content: `科目：${subject}\n第 ${page} 页\n\n${brief}\n\n请输出 json。` },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1200,
    temperature: 0.4,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);
  const parsed = parseJsonLoose(data?.choices?.[0]?.message?.content || '') || {};
  const digest = str(parsed.digest ?? parsed.summary ?? parsed.content, 2000);
  if (!digest) throw new Error('模型没有返回汇总内容，请重试');
  return { digest, usage: normalizeUsage(data.usage, settings, textModelOf(settings)) };
}


/* ------------------------------------------------------------------ */
/* 批量给拓展条目起标题                                                 */
/* ------------------------------------------------------------------ */

const TITLE_SYSTEM = `你是课程助教。用户会给你若干条「拓展」笔记（id + 内容），请为每条写一个 6~14 字的标题，概括它的重点。

要求：
- 标题要具体，例如「饱和电流要留余量」「不是未定式时不能用」，不要用「易错点」「考点」这类分类名。
- 同一批里标题不能重复。
- 中文，不要以标点结尾。
- 只输出 JSON：{"titles":[{"id":"it_xxx","title":"..."}]}`;

async function extensionTitles({ settings, apiKey, subject, items }) {
  const list = items.map((i) => ({ id: i.id, type: i.type || '', content: String(i.content || '').slice(0, 400) }));

  if (settings.mock) {
    return {
      titles: items.map((i) => ({
        id: i.id,
        title: String(i.content || '').replace(/\s+/g, '').slice(0, 14),
      })),
      usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
    };
  }

  const payload = {
    model: textModelOf(settings),
    messages: [
      { role: 'system', content: TITLE_SYSTEM },
      { role: 'user', content: `科目：${subject}\n\n${JSON.stringify(list)}\n\n请输出 json。` },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    temperature: 0.5,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);
  const parsed = parseJsonLoose(data?.choices?.[0]?.message?.content || '') || {};
  const titles = (Array.isArray(parsed.titles) ? parsed.titles : [])
    .map((x) => ({ id: str(x?.id, 60), title: str(x?.title, 60) }))
    .filter((x) => x.id && x.title);
  return { titles, usage: normalizeUsage(data.usage, settings, textModelOf(settings)) };
}


const PRACTICE_SYSTEM = `你是这门课的经验助教。用户会给你一个科目的全部笔记摘要（分类、知识点名称、重要度、页面覆盖情况）以及他希望的练习方式。
请完成两件事，并只输出一个 JSON 对象：

1. 推测学习进度 progress：根据知识点覆盖了哪些分类、哪些分类还很空、页面覆盖比例来判断。
   - level：从「刚起步 / 已过一半 / 接近完成 / 已系统掌握」里选一个
   - summary：一句话说明依据（提到具体分类与条数）
   - weak：最多 3 条，最需要补的分类或知识点（用笔记里的真实名称）
   - suggest：一句话给下一步该怎么复习
2. 生成练习题 questions：按用户要求的题量出题，优先覆盖 weak 与重要度高的知识点；题型在「选择 / 填空 / 计算 / 简答」中按内容选择。
   - question：题干完整可独立作答（需要数据时自己给具体数值）
   - answer：标准答案（简洁、可直接对照）
   - explain：解析，说明步骤与易错点
   - ref：对应笔记里哪个知识点（照抄笔记里的名称）

要求：
- 只考笔记里出现过的内容，不要编造课程外的知识。
- 数学表达式用 LaTeX，行内 $...$，独立公式 $$...$$。
- 不重复出同一考点的题；难度从易到难排列。
- 中文输出；只输出 JSON，不要 Markdown 代码块。`;

/** 根据科目笔记推测进度并出练习题 */
async function practiceSet({ settings, apiKey, subject, digest, extra, count }) {
  const n = Math.max(1, Math.min(50, Number(count) || 15));
  if (settings.mock) {
    return {
      progress: {
        level: '已过一半',
        summary: `（演示）共 ${digest.itemCount} 条笔记、覆盖 ${digest.categoryCount} 个分类；接入 API 后会给出真实判断。`,
        weak: ['演示模式：这里会列出最需要补的分类'],
        suggest: '先补齐覆盖较少的分类，再做题巩固。',
      },
      questions: Array.from({ length: Math.min(n, 3) }, (_, i) => ({
        type: '简答',
        question: `（演示题目 ${i + 1}）请解释你笔记中“${digest.sampleNames[i] || '某个知识点'}”的含义。`,
        answer: '演示答案：接入 API 后这里是对应标准答案。',
        explain: '演示解析。',
        ref: digest.sampleNames[i] || '示例知识点',
      })),
      usage: { prompt: 0, completion: 0, cached: 0, tokens: 0, costCny: 0 },
    };
  }

  const user = [
    `科目：${subject.name}`,
    subject.criteria ? `学生的分类标准：${subject.criteria}` : '',
    `笔记规模：${digest.itemCount} 条知识点，${digest.categoryCount} 个分类，课程共 ${digest.slideCount} 页，其中 ${digest.coveredSlides} 页已有笔记`,
    '',
    '笔记清单（分类 / 知识点（重要度，是否拓展））：',
    digest.text,
    '',
    `题量：${n} 题`,
    extra ? `额外要求：${extra}` : '额外要求：无',
    '',
    '请输出 JSON：{"progress":{"level":"","summary":"","weak":[],"suggest":""},"questions":[{"type":"","question":"","answer":"","explain":"","ref":""}]}',
  ].filter(Boolean).join('\n');

  const payload = {
    model: textModelOf(settings),
    messages: [
      { role: 'system', content: PRACTICE_SYSTEM },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    max_tokens: Math.min(8000, 1200 + n * 220),
    temperature: 0.5,
    stream: false,
  };
  applyReasoning(payload, settings);

  const data = await chatJson(settings, apiKey, payload);
  const parsed = parseJsonLoose(data?.choices?.[0]?.message?.content || '') || {};
  const pr = parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {};
  const progress = {
    level: str(pr.level, 40) || '未知',
    summary: str(pr.summary, 300),
    weak: Array.isArray(pr.weak) ? pr.weak.map((x) => str(x, 60)).filter(Boolean).slice(0, 3) : [],
    suggest: str(pr.suggest, 200),
  };
  const raw = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = raw
    .map((q) => ({
      type: str(q.type, 8) || '简答',
      question: str(q.question, 1500),
      answer: str(q.answer, 1500),
      explain: str(q.explain, 1000),
      ref: str(q.ref, 80),
    }))
    .filter((q) => q.question)
    .slice(0, n);
  if (!questions.length) throw new Error('模型没有返回题目，请重试');
  return { progress, questions, usage: normalizeUsage(data.usage, settings, textModelOf(settings)) };
}

module.exports = {
  extractSlide,
  practiceSet,
  organize,
  refine,
  compose,
  verifyExtraction,
  summarizeDeck,
  digestSlide,
  extensionTitles,
  normalizeUsage,
  parseJsonLoose,
  PRICE,
  USD_TO_CNY,
};
