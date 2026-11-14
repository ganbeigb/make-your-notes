/* 画图板：手绘 / 文本 / 电子元件 / 连线 / 自定义芯片
   依赖 app.js 的 askModal / api / toast / icon，依赖 symbols.js 的元件库 */
(function () {
  let opts = {};

  const st = {
    settings: { autoRewire: true, grid: true, snap: true, snapDrag: true, avoid: true },
    open: false,
    subjectId: null,
    items: [],
    sel: new Set(),
    tool: 'select',
    electro: false,
    view: { s: 1, tx: 0, ty: 0 },
    color: '#243029',
    width: 2,
    pending: null, // 正在画的线
    drag: null,
    marquee: null,
    history: [],
    future: [],
    pointers: new Map(),
    pipeDir: 'auto',
    selSeg: null, // { id, i } 选中的导线线段
    pen: { color: '#243029', width: 3, alpha: 1 },
    shape: { color: '#2f6fb3', width: 2, alpha: 1 },
    shapeKind: 'rect',
    pinch: null,
  };

  const GRID = 10;
  const SNAP = 12;
  const uid = () => 'o' + Math.random().toString(36).slice(2, 9);

  let root = null;
  let svgEl = null;
  let world = null;

  /* ---------------- 坐标 ---------------- */
  /** 页面整体 zoom 会把 rect 放大，这里换算回 SVG 自身坐标 */
  function pageZoom(el) {
    const r = el.getBoundingClientRect();
    const cw = el.clientWidth || el.offsetWidth || 0;
    return cw ? r.width / cw : 1;
  }

  function toWorld(e) {
    const r = svgEl.getBoundingClientRect();
    const z = pageZoom(svgEl);
    return {
      x: ((e.clientX - r.left) / z - st.view.tx) / st.view.s,
      y: ((e.clientY - r.top) / z - st.view.ty) / st.view.s,
    };
  }

  const snapGrid = (v) => Math.round(v / GRID) * GRID;

  /** 当前工具对应的绘制样式（画笔 / 图形各自独立） */
  function activeStyle() {
    return st.tool === 'shape' ? st.shape : st.pen;
  }

  function symbolPins(it) {
    const pins = (window.SYMBOL_PINS || {})[it.symId] || [];
    const rot = it.rot || 0;
    const k = it.k || 1;
    return pins.map(([px, py]) => {
      let x = px;
      let y = py;
      if (rot === 90) [x, y] = [-py, px];
      else if (rot === 180) [x, y] = [-px, -py];
      else if (rot === 270) [x, y] = [py, -px];
      return { x: it.x + x * k, y: it.y + y * k };
    });
  }

  const STUB = 18;

  function chipPinPoint(it, pin) {
    const t01 = Math.min(1, Math.max(0, pin.t || 0));
    if (pin.side === 'L') return { x: it.x - STUB, y: it.y + t01 * it.h };
    if (pin.side === 'R') return { x: it.x + it.w + STUB, y: it.y + t01 * it.h };
    if (pin.side === 'T') return { x: it.x + t01 * it.w, y: it.y - STUB };
    return { x: it.x + t01 * it.w, y: it.y + it.h + STUB };
  }

  function chipPins(it) {
    if (Array.isArray(it.pins)) return it.pins.map((pin) => chipPinPoint(it, pin));
    // 兼容旧数据：left / right 名称数组
    const out = [];
    const n = it.left ? it.left.length : 0;
    const m = it.right ? it.right.length : 0;
    for (let i = 0; i < n; i++) out.push({ x: it.x - 22, y: it.y + ((i + 1) * it.h) / (n + 1) });
    for (let i = 0; i < m; i++) out.push({ x: it.x + it.w + 22, y: it.y + ((i + 1) * it.h) / (m + 1) });
    return out;
  }

  /** 找一个不和已有图形重叠的落点 */
  function freeSpot(x, y) {
    let px = x;
    let py = y;
    for (let n = 0; n < 40; n++) {
      const clash = st.items.some((it) => {
        const b = bboxOf(it);
        return px > b.x - 24 && px < b.x + b.w + 24 && py > b.y - 24 && py < b.y + b.h + 24;
      });
      if (!clash) break;
      px += 28;
      py += 28;
    }
    return { x: px, y: py };
  }

  /** 每条引脚的线段（用于吸附判定）与吸附落点（引脚外端） */
  function pinStubs() {
    const out = [];
    for (const it of st.items) {
      if (it.type === 'symbol') {
        const pts = symbolPins(it);
        const k = it.k || 1;
        pts.forEach((p, i) => {
          const toward = { x: it.x + (p.x - it.x) * 0.45, y: it.y + (p.y - it.y) * 0.45 };
          out.push({ x1: p.x, y1: p.y, x2: toward.x, y2: toward.y, x: p.x, y: p.y, itemId: it.id, pinIndex: i });
          void k;
        });
      } else if (it.type === 'chip') {
        const pts = chipPins(it);
        pts.forEach((p, i) => {
          const pin = it.pins && it.pins[i];
          const inner = pin
            ? {
                x: it.x + (pin.side === 'L' ? 0 : pin.side === 'R' ? it.w : Math.min(1, Math.max(0, pin.t)) * it.w),
                y: it.y + (pin.side === 'T' ? 0 : pin.side === 'B' ? it.h : Math.min(1, Math.max(0, pin.t)) * it.h),
              }
            : { x: p.x, y: p.y };
          out.push({ x1: p.x, y1: p.y, x2: inner.x, y2: inner.y, x: p.x, y: p.y, itemId: it.id, pinIndex: i });
        });
      }
    }
    return out;
  }

  function distToSeg(px, py, s) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    if (!len2) return Math.hypot(px - s.x1, py - s.y1);
    let u = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(px - (s.x1 + u * dx), py - (s.y1 + u * dy));
  }

  function allPins() {
    return pinStubs().map((s) => ({ x: s.x, y: s.y, itemId: s.itemId, pinIndex: s.pinIndex }));
  }

  /** 取某个引脚的当前位置（元件移动/缩放后重算导线用） */
  /** 引用（引脚或导线端点）对应的坐标 */
  function refPos(ref) {
    if (!ref || !ref.itemId) return null;
    if (ref.kind === 'wire') {
      const w = st.items.find((i) => i.id === ref.itemId);
      if (!w || !w.pts || !w.pts.length) return null;
      return w.pts[Math.min(ref.end, w.pts.length - 1)] || null;
    }
    return pinPos(ref.itemId, ref.pinIndex);
  }

  function pinPos(itemId, pinIndex) {
    const it = st.items.find((x) => x.id === itemId);
    if (!it) return null;
    if (it.type === 'symbol') return symbolPins(it)[pinIndex] || null;
    if (it.type === 'chip') return chipPins(it)[pinIndex] || null;
    return null;
  }

  /** 找最近的引脚；容差按屏幕像素换算，缩放后手感一致 */
  function nearestPin(p, tol) {
    if (!st.settings.snap) return null;
    const limit = tol == null ? Math.max(12, 26 / st.view.s) : tol;
    let best = null;
    let bestD = limit;
    for (const s of pinStubs()) {
      const d = distToSeg(p.x, p.y, s);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best ? { x: best.x, y: best.y, itemId: best.itemId, pinIndex: best.pinIndex } : null;
  }

  /** 所有导线的端点 */
  function wireEnds() {
    const out = [];
    for (const it of st.items) {
      if (it.type !== 'wire' || !it.pts || it.pts.length < 2) continue;
      out.push({ itemId: it.id, end: 0, x: it.pts[0].x, y: it.pts[0].y });
      const last = it.pts.length - 1;
      out.push({ itemId: it.id, end: last, x: it.pts[last].x, y: it.pts[last].y });
    }
    return out;
  }

  function nearestWireEnd(p) {
    let best = null;
    let bestD = 14;
    for (const e of wireEnds()) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function snapPoint(p) {
    const pin = nearestPin(p);
    if (pin) return { x: pin.x, y: pin.y, pin: true, ref: { kind: 'pin', itemId: pin.itemId, pinIndex: pin.pinIndex } };
    const wEnd = nearestWireEnd(p);
    if (wEnd) return { x: wEnd.x, y: wEnd.y, pin: true, ref: { kind: 'wire', itemId: wEnd.itemId, end: wEnd.end } };
    // 网格模式才对坐标取整；非网格模式保留自由坐标，但走线仍然是直角折线
    if (st.electro) return { x: snapGrid(p.x), y: snapGrid(p.y) };
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }

  /* ---------------- 正交折线 ---------------- */
  function orthoRoute(from, to, horizontalFirst) {
    const hf = horizontalFirst !== false;
    if (from.x === to.x || from.y === to.y) return [to];
    if (hf) return [{ x: to.x, y: from.y }, { x: to.x, y: to.y }];
    return [{ x: from.x, y: to.y }, { x: to.x, y: to.y }];
  }


  /** 一段水平/垂直直线是否穿过某个矩形 */
  function segHits(a, b, box, pad) {
    const x1 = Math.min(a.x, b.x) - pad;
    const x2 = Math.max(a.x, b.x) + pad;
    const y1 = Math.min(a.y, b.y) - pad;
    const y2 = Math.max(a.y, b.y) + pad;
    return x1 < box.x + box.w && x2 > box.x && y1 < box.y + box.h && y2 > box.y;
  }

  function obstacles(exclude) {
    const skip = exclude instanceof Set ? exclude : new Set(exclude ? [exclude] : []);
    return st.items
      .filter((i) => (i.type === 'symbol' || i.type === 'chip') && !skip.has(i.id))
      .map((i) => bboxOf(i));
  }

  /** 绕障：把穿过器件的直线换成绕上/绕下的折线 */
  function detour(a, b, box, pad) {
    const horizontal = a.y === b.y;
    if (horizontal) {
      const top = box.y - pad;
      const bottom = box.y + box.h + pad;
      const y = Math.abs(a.y - top) <= Math.abs(a.y - bottom) ? top : bottom;
      return [{ x: a.x, y }, { x: b.x, y }];
    }
    const left = box.x - pad;
    const right = box.x + box.w + pad;
    const x = Math.abs(a.x - left) <= Math.abs(a.x - right) ? left : right;
    return [{ x, y: a.y }, { x, y: b.y }];
  }

  /** 正交网格 A* 布线：绕开所有元件，尽量避免穿过器件 */
  function routeGrid(from, to, exclude) {
    const STEP = 10;
    const CLEAR = 6;

    const boxes = obstacles(exclude).map((b) => ({
      x1: b.x - CLEAR,
      y1: b.y - CLEAR,
      x2: b.x + b.w + CLEAR,
      y2: b.y + b.h + CLEAR,
    }));

    let minX = Math.min(from.x, to.x) - 50;
    let maxX = Math.max(from.x, to.x) + 50;
    let minY = Math.min(from.y, to.y) - 50;
    let maxY = Math.max(from.y, to.y) + 50;
    for (const b of boxes) {
      minX = Math.min(minX, b.x1 - STEP);
      maxX = Math.max(maxX, b.x2 + STEP);
      minY = Math.min(minY, b.y1 - STEP);
      maxY = Math.max(maxY, b.y2 + STEP);
    }
    minX = Math.floor(minX / STEP) * STEP;
    minY = Math.floor(minY / STEP) * STEP;
    maxX = Math.ceil(maxX / STEP) * STEP;
    maxY = Math.ceil(maxY / STEP) * STEP;

    const cols = Math.round((maxX - minX) / STEP) + 1;
    const rows = Math.round((maxY - minY) / STEP) + 1;
    if (cols < 3 || rows < 3 || cols * rows > 60000) return null;

    const idx = (c, r) => r * cols + c;
    const blocked = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = minX + c * STEP;
        const y = minY + r * STEP;
        for (const b of boxes) {
          if (x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2) {
            blocked[idx(c, r)] = 1;
            break;
          }
        }
      }
    }

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const toCell = (pt) => ({
      c: clamp(Math.round((pt.x - minX) / STEP), 0, cols - 1),
      r: clamp(Math.round((pt.y - minY) / STEP), 0, rows - 1),
    });
    const s = toCell(from);
    const g = toCell(to);

    // 起点/终点所在的格子先放开，避免被元件挡住出不来
    // 起终点周围放出 16px 连接区，避免被自己所在元件堵死
    const freeCells = (cell) => {
      const rad = Math.ceil(16 / STEP);
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          const c2 = cell.c + dc;
          const r2 = cell.r + dr;
          if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows) continue;
          blocked[idx(c2, r2)] = 0;
        }
      }
    };
    freeCells(s);
    freeCells(g);

    const total = cols * rows;
    const gScore = new Float32Array(total).fill(Infinity);
    const fScore = new Float32Array(total).fill(Infinity);
    const came = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);

    const h = (c, r) => Math.abs(c - g.c) + Math.abs(r - g.r);
    const startK = idx(s.c, s.r);
    gScore[startK] = 0;
    fScore[startK] = h(s.c, s.r);

    // 简单二叉堆
    const heap = [startK];
    const push = (k) => {
      heap.push(k);
      let i = heap.length - 1;
      while (i > 0) {
        const par = (i - 1) >> 1;
        if (fScore[heap[par]] <= fScore[heap[i]]) break;
        [heap[par], heap[i]] = [heap[i], heap[par]];
        i = par;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
          if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };

    const goalK = idx(g.c, g.r);
    let found = false;
    while (heap.length) {
      const cur = pop();
      if (closed[cur]) continue;
      if (cur === goalK) {
        found = true;
        break;
      }
      closed[cur] = 1;
      const cc = cur % cols;
      const cr = (cur - cc) / cols;
      const nb = [
        [cc + 1, cr],
        [cc - 1, cr],
        [cc, cr + 1],
        [cc, cr - 1],
      ];
      for (const [nc, nr] of nb) {
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nk = idx(nc, nr);
        if (blocked[nk] || closed[nk]) continue;
        const tentative = gScore[cur] + 1;
        if (tentative < gScore[nk]) {
          gScore[nk] = tentative;
          fScore[nk] = tentative + h(nc, nr);
          came[nk] = cur;
          push(nk);
        }
      }
    }
    if (!found) return null;

    const cells = [];
    let cur = goalK;
    while (cur !== -1) {
      cells.push(cur);
      cur = came[cur];
    }
    cells.reverse();

    // 转成点，并去掉共线的中间点
    const pts = cells.map((k) => ({ x: minX + (k % cols) * STEP, y: minY + Math.floor(k / cols) * STEP }));
    pts[0] = { x: from.x, y: from.y };
    pts[pts.length - 1] = { x: to.x, y: to.y };
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const sameX = a.x === b.x && b.x === c.x;
      const sameY = a.y === b.y && b.y === c.y;
      if (!sameX && !sameY) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out.slice(1);
  }

  /** 判断一条折线是否撞到元件（端点附近留出 12px 连接区） */
  function pipeHits(pts, from, to, boxes) {
    let prev = from;
    for (let i = 0; i < pts.length; i++) {
      const next = pts[i];
      let a = prev;
      let b = next;
      const isFirst = i === 0;
      const isLast = i === pts.length - 1;
      if (isFirst) {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const k = Math.min(12, len) / len;
        a = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
      if (isLast) {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const k = Math.min(12, len) / len;
        b = { x: b.x + (a.x - b.x) * k, y: b.y + (a.y - b.y) * k };
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      for (const box of boxes) {
        const cx2 = box.x + box.w / 2;
        const cy2 = box.y + box.h / 2;
        const inside = (pt) =>
          pt.x >= box.x - 1 && pt.x <= box.x + box.w + 1 && pt.y >= box.y - 1 && pt.y <= box.y + box.h + 1;
        const isFrom = Math.abs(a.x - from.x) < 0.01 && Math.abs(a.y - from.y) < 0.01;
        const isTo = Math.abs(b.x - to.x) < 0.01 && Math.abs(b.y - to.y) < 0.01;
        // 只有真正的起点朝外走才豁免
        if (isFrom && inside(a) && ux * (cx2 - a.x) + uy * (cy2 - a.y) <= 0) continue;
        // 只有真正的终点由外接近才豁免
        if (isTo && inside(b) && ux * (cx2 - b.x) + uy * (cy2 - b.y) >= 0) continue;
        if (segHits(a, b, box, 4)) return true;
      }
      prev = next;
    }
    return false;
  }

  function pathLength(pts, from) {
    let len = 0;
    let prev = from;
    for (const p of pts) {
      len += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      prev = p;
    }
    return len;
  }

  function firstDir(from, pts) {
    const f = pts[0];
    if (!f) return '';
    if (Math.abs(f.y - from.y) < 0.01 && Math.abs(f.x - from.x) > 0.01) return f.x > from.x ? 'right' : 'left';
    if (Math.abs(f.x - from.x) < 0.01 && Math.abs(f.y - from.y) > 0.01) return f.y > from.y ? 'down' : 'up';
    return '';
  }

  /** 管道式直角走线：在若干种规整走法里挑一条不撞元件、弯最少的 */
  function routePipe(from, to, dir) {
    const boxes = obstacles();
    const grid = st.electro;
    const r = (v) => (grid ? Math.round(v / GRID) * GRID : v);
    const midX = r((from.x + to.x) / 2);
    const midY = r((from.y + to.y) / 2);
    const cands = [
      [{ x: to.x, y: from.y }, to],
      [{ x: from.x, y: to.y }, to],
      [{ x: midX, y: from.y }, { x: midX, y: to.y }, to],
      [{ x: from.x, y: midY }, { x: to.x, y: midY }, to],
    ];

    // 绕行：以每个元件的四条边向外偏移为候选走法（大芯片也能绕过）
    const GAP = 18;
    const xs = new Set();
    const ys = new Set();
    for (const b of boxes) {
      xs.add(r(b.x - GAP));
      xs.add(r(b.x + b.w + GAP));
      ys.add(r(b.y - GAP));
      ys.add(r(b.y + b.h + GAP));
    }
    for (const x of xs) cands.push([{ x, y: from.y }, { x, y: to.y }, to]);
    for (const y of ys) cands.push([{ x: from.x, y }, { x: to.x, y }, to]);
    // 起点/终点外侧再各给一条兜底
    cands.push([{ x: to.x, y: from.y - GAP * 2 }, { x: to.x, y: to.y }, to]);
    cands.push([{ x: from.x + GAP * 2, y: from.y }, { x: from.x + GAP * 2, y: to.y }, to]);

    let best = null;
    let bestScore = Infinity;
    for (const pts of cands) {
      // 去掉退化的重复点
      const clean = [];
      let prev = from;
      for (const q of pts) {
        if (Math.abs(q.x - prev.x) > 0.01 || Math.abs(q.y - prev.y) > 0.01) clean.push(q);
        prev = q;
      }
      if (!clean.length) continue;
      if (st.settings.avoid && pipeHits(clean, from, to, boxes)) continue;
      const bends = Math.max(0, clean.length - 1);
      const d = firstDir(from, clean);
      let score = bends * 100 + pathLength(clean, from);
      if (dir && dir !== 'auto') {
        if (d === dir) score -= 60;
        else if (d && d !== dir) score += 40;
      }
      if (score < bestScore) {
        bestScore = score;
        best = clean;
      }
    }
    return best;
  }

  /** 走线：网格模式用管道布线，普通模式用自由直角 */
  function routeAvoid(from, to, horizontalFirst) {
    // 两端几乎贴在一起（例如相邻元件的引脚），直接连最短线
    if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < 26) return orthoRoute(from, to, horizontalFirst);
    const pipe = routePipe(from, to, st.pipeDir || 'auto');
    if (pipe && pipe.length) return pipe;
    const grid = routeGrid(from, to, null);
    if (grid && grid.length) return grid;
    return orthoRoute(from, to, horizontalFirst);
  }


  /** 导线交叉处的结点 */
  function junctionPoints() {
    const segs = [];
    for (const it of st.items) {
      if (it.type !== 'wire' || !it.pts || it.pts.length < 2) continue;
      for (let i = 0; i + 1 < it.pts.length; i++) {
        segs.push({ a: it.pts[i], b: it.pts[i + 1], id: it.id });
      }
    }
    const hits = [];
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s1 = segs[i];
        const s2 = segs[j];
        if (s1.id === s2.id) continue;
        const h1 = s1.a.y === s1.b.y;
        const h2 = s2.a.y === s2.b.y;
        if (h1 === h2) continue;
        const hs = h1 ? s1 : s2;
        const vs = h1 ? s2 : s1;
        const y = hs.a.y;
        const x = vs.a.x;
        const inH = Math.min(hs.a.x, hs.b.x) <= x && x <= Math.max(hs.a.x, hs.b.x);
        const inV = Math.min(vs.a.y, vs.b.y) <= y && y <= Math.max(vs.a.y, vs.b.y);
        if (inH && inV) hits.push({ x, y });
      }
    }
    // 端点落在其它导线上的 T 形连接
    for (const it of st.items) {
      if (it.type !== 'wire' || !it.pts) continue;
      for (const pt of [it.pts[0], it.pts[it.pts.length - 1]]) {
        for (const s of segs) {
          if (s.id === it.id) continue;
          if (s.a.y === s.b.y && Math.abs(pt.y - s.a.y) < 0.5 && pt.x >= Math.min(s.a.x, s.b.x) - 0.5 && pt.x <= Math.max(s.a.x, s.b.x) + 0.5) {
            hits.push({ x: pt.x, y: pt.y });
          } else if (s.a.x === s.b.x && Math.abs(pt.x - s.a.x) < 0.5 && pt.y >= Math.min(s.a.y, s.b.y) - 0.5 && pt.y <= Math.max(s.a.y, s.b.y) + 0.5) {
            hits.push({ x: pt.x, y: pt.y });
          }
        }
      }
    }
    const seen = new Set();
    return hits.filter((h) => {
      const k = Math.round(h.x) + ',' + Math.round(h.y);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function junctionHtml() {
    const pts = junctionPoints();
    if (!pts.length) return '';
    return pts
      .map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + 3 / st.view.s + '" fill="#243029"/>')
      .join('');
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!world) return;
    const zoom = st.view.s;
    const g = [];
    g.push('<defs><pattern id="dwgrid" width="' + GRID + '" height="' + GRID + '" patternUnits="userSpaceOnUse">' +
      '<path d="M ' + GRID + ' 0 L 0 0 0 ' + GRID + '" fill="none" stroke="#e9e1d0" stroke-width="' + 0.6 / zoom + '"/></pattern></defs>');
    if (st.electro || st.settings.grid) g.push('<rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#dwgrid)"/>');

    const drawOrder = st.items.slice().sort((a, b) => rank(a) - rank(b));
    let junctionDone = false;
    for (const it of drawOrder) {
      if (!junctionDone && rank(it) > 0) {
        g.push(junctionHtml());
        junctionDone = true;
      }
      const sel = st.sel.has(it.id);
      g.push('<g class="dw-item' + (sel ? ' sel' : '') + '" data-id="' + it.id + '">');
      if (it.type === 'stroke' || it.type === 'wire') {
        g.push(pathOf(it));
        // 导线：单独高亮被选中的那一段
        if (it.type === 'wire' && st.selSeg && st.selSeg.id === it.id && it.pts && it.pts[st.selSeg.i] && it.pts[st.selSeg.i + 1]) {
          const a = it.pts[st.selSeg.i];
          const b = it.pts[st.selSeg.i + 1];
          g.push('<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y +
            '" stroke="#3d7a61" stroke-width="' + ((it.width || 2) + 4) + '" stroke-opacity="0.45" stroke-linecap="round"/>');
          g.push('<circle cx="' + a.x + '" cy="' + a.y + '" r="' + 4 / zoom + '" fill="#3d7a61"/>');
          g.push('<circle cx="' + b.x + '" cy="' + b.y + '" r="' + 4 / zoom + '" fill="#3d7a61"/>');
        }
      } else if (it.type === 'text') {
        g.push('<text x="' + it.x + '" y="' + it.y + '" font-size="' + (it.size || 14) +
          '" fill="' + (it.color || '#243029') + '" font-family="PingFang SC, Microsoft YaHei, sans-serif">' + esc(it.text) + '</text>');
      } else if (it.type === 'shape') {
        g.push(shapeHtml(it));
      } else if (it.type === 'symbol') {
        g.push('<use href="#' + it.symId + '" transform="translate(' + it.x + ',' + it.y + ') rotate(' + (it.rot || 0) + ') scale(' + (it.k || 1) + ')"/>');
      } else if (it.type === 'chip') {
        g.push(chipHtml(it));
      }
      if (sel && !it.group) g.push(selBox(it));
      g.push('</g>');
    }

    // 选中的组合只画一个整体外框
    const groups = new Map();
    for (const it of st.items) {
      if (!it.group || !st.sel.has(it.id)) continue;
      const b = bboxOf(it);
      const cur = groups.get(it.group);
      if (!cur) groups.set(it.group, { x: b.x, y: b.y, w: b.w, h: b.h });
      else {
        const x2 = Math.max(cur.x + cur.w, b.x + b.w);
        const y2 = Math.max(cur.y + cur.h, b.y + b.h);
        cur.x = Math.min(cur.x, b.x);
        cur.y = Math.min(cur.y, b.y);
        cur.w = x2 - cur.x;
        cur.h = y2 - cur.y;
      }
    }
    for (const b of groups.values()) {
      g.push('<rect x="' + (b.x - 4) + '" y="' + (b.y - 4) + '" width="' + (b.w + 8) + '" height="' + (b.h + 8) +
        '" fill="none" stroke="#3d7a61" stroke-width="' + 1.5 / zoom + '" stroke-dasharray="' + 8 / zoom + ' ' + 4 / zoom + '"/>');
    }

    if (st.pending) g.push(pendingHtml());
    if (st.hoverPin && st.pending && st.pending.type === 'wire') {
      const r = 5 / st.view.s;
      g.push('<circle cx="' + st.hoverPin.x + '" cy="' + st.hoverPin.y + '" r="' + r * 2.2 + '" fill="none" stroke="#3d7a61" stroke-width="' + 1.2 / st.view.s + '" opacity=".5"/>');
      g.push('<circle cx="' + st.hoverPin.x + '" cy="' + st.hoverPin.y + '" r="' + r + '" fill="#3d7a61"/>');
    }
    if (st.rect) {
      const r = st.rect;
      const rx = Math.min(r.x1, r.x2);
      const ry = Math.min(r.y1, r.y2);
      const rw = Math.abs(r.x2 - r.x1);
      const rh = Math.abs(r.y2 - r.y1);
      if (r.shape) {
        if (r.shapeK === 'ellipse' || st.shapeKind === 'ellipse') {
          g.push('<ellipse cx="' + (rx + rw / 2) + '" cy="' + (ry + rh / 2) + '" rx="' + Math.max(1, rw / 2) + '" ry="' + Math.max(1, rh / 2) +
            '" fill="none" stroke="' + activeStyle().color + '" stroke-width="' + activeStyle().width + '" stroke-opacity="' + activeStyle().alpha + '"/>');
        } else if (st.shapeKind === 'line') {
          g.push('<line x1="' + r.x1 + '" y1="' + r.y1 + '" x2="' + r.x2 + '" y2="' + r.y2 + '" stroke="' + activeStyle().color +
            '" stroke-width="' + activeStyle().width + '" stroke-opacity="' + activeStyle().alpha + '" stroke-linecap="round"/>');
        } else {
          g.push('<rect x="' + rx + '" y="' + ry + '" width="' + Math.max(1, rw) + '" height="' + Math.max(1, rh) +
            '" rx="3" fill="none" stroke="' + activeStyle().color + '" stroke-width="' + activeStyle().width + '" stroke-opacity="' + activeStyle().alpha + '"/>');
        }
      } else {
        g.push('<rect x="' + rx + '" y="' + ry + '" width="' + rw + '" height="' + rh +
          '" fill="rgba(47,93,75,.06)" stroke="#3d7a61" stroke-dasharray="6 4" stroke-width="' + 1.5 / zoom + '"/>');
      }
    }

    if (st.marquee) {
      const m = st.marquee;
      g.push('<rect x="' + Math.min(m.x1, m.x2) + '" y="' + Math.min(m.y1, m.y2) + '" width="' + Math.abs(m.x2 - m.x1) +
        '" height="' + Math.abs(m.y2 - m.y1) + '" fill="rgba(47,93,75,.08)" stroke="#2f5d4b" stroke-dasharray="4 3" stroke-width="' + 1 / zoom + '"/>');
    }

    if (!junctionDone) g.push(junctionHtml());
    world.innerHTML = g.join('');
    world.setAttribute('transform', 'translate(' + st.view.tx + ',' + st.view.ty + ') scale(' + st.view.s + ')');
  }

  /** 线、画笔在最底层，文字中间，元件和芯片在最上层，避免导线盖住器件 */
  function rank(it) {
    if (it.type === 'stroke' || it.type === 'wire') return 0;
    if (it.type === 'shape') return 2;
    if (it.type === 'text') return 1;
    return 2;
  }

  function pathOf(it) {
    if (!it.pts || it.pts.length < 2) return '';
    const d = it.pts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ');
    const op = it.alpha == null ? 1 : it.alpha;
    return '<path d="' + d + '" fill="none" stroke="' + (it.color || '#243029') + '" stroke-width="' + (it.width || 2) +
      '" stroke-opacity="' + op + '" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  /** 常用图形：矩形 / 椭圆 / 直线 */
  function shapeHtml(it) {
    const x = Math.min(it.x, it.x + it.w);
    const y = Math.min(it.y, it.y + it.h);
    const w = Math.abs(it.w);
    const h = Math.abs(it.h);
    const op = it.alpha == null ? 1 : it.alpha;
    const common = 'fill="none" stroke="' + (it.color || '#243029') + '" stroke-width="' + (it.width || 2) +
      '" stroke-opacity="' + op + '" stroke-linecap="round" stroke-linejoin="round"';
    if (it.kind === 'ellipse') {
      return '<ellipse cx="' + (x + w / 2) + '" cy="' + (y + h / 2) + '" rx="' + Math.max(1, w / 2) + '" ry="' + Math.max(1, h / 2) + '" ' + common + '/>';
    }
    if (it.kind === 'line') {
      return '<line x1="' + it.x + '" y1="' + it.y + '" x2="' + (it.x + it.w) + '" y2="' + (it.y + it.h) + '" ' + common + '/>';
    }
    return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(1, w) + '" height="' + Math.max(1, h) + '" rx="3" ' + common + '/>';
  }

  function chipNameOffset(it) {
    const pins = Array.isArray(it.pins) ? it.pins : [];
    const clash = pins.some((pin) => (pin.side === 'L' || pin.side === 'R') && pin.t > 0.34 && pin.t < 0.66);
    return clash ? -13 : 0;
  }

  function chipHtml(it) {
    const out = [];
    out.push('<rect x="' + it.x + '" y="' + it.y + '" width="' + it.w + '" height="' + it.h + '" rx="4" fill="#fffdf8" stroke="#243029" stroke-width="1.8"/>');
    out.push('<text x="' + (it.x + it.w / 2) + '" y="' + (it.y + it.h / 2 + 5 + chipNameOffset(it)) + '" text-anchor="middle" font-size="14" font-weight="600" fill="#243029">' + esc(it.name || '芯片') + '</text>');

    if (Array.isArray(it.pins)) {
      for (const pin of it.pins) {
        const p = chipPinPoint(it, pin);
        const inner = { x: it.x + (pin.side === 'L' ? 0 : pin.side === 'R' ? it.w : Math.min(1, Math.max(0, pin.t)) * it.w),
          y: it.y + (pin.side === 'T' ? 0 : pin.side === 'B' ? it.h : Math.min(1, Math.max(0, pin.t)) * it.h) };
        out.push('<line x1="' + p.x + '" y1="' + p.y + '" x2="' + inner.x + '" y2="' + inner.y + '" stroke="#243029" stroke-width="1.6"/>');
        // 编号画在引脚外侧
        const nx = p.x + (pin.side === 'L' ? -6 : pin.side === 'R' ? 6 : 0);
        const ny = p.y + (pin.side === 'T' ? -5 : pin.side === 'B' ? 12 : 3.5);
        out.push('<text x="' + nx + '" y="' + ny + '" font-size="9" fill="#6b7a72" text-anchor="' + (pin.side === 'L' ? 'end' : pin.side === 'R' ? 'start' : 'middle') + '">' + esc(pin.num || '') + '</text>');
        // 名字画在矩形内侧
        if (pin.name) {
          const lx = inner.x + (pin.side === 'L' ? 5 : pin.side === 'R' ? -5 : 0);
          const ly = inner.y + (pin.side === 'T' ? 11 : pin.side === 'B' ? -5 : 3.5);
          out.push('<text x="' + lx + '" y="' + ly + '" font-size="10.5" fill="#42524a" text-anchor="' + (pin.side === 'L' ? 'start' : pin.side === 'R' ? 'end' : 'middle') + '">' + esc(pin.name) + '</text>');
        }
      }
      return out.join('');
    }

    const left = it.left || [];
    const right = it.right || [];
    left.forEach((label, i) => {
      const y = it.y + ((i + 1) * it.h) / (left.length + 1);
      out.push('<line x1="' + (it.x - 22) + '" y1="' + y + '" x2="' + it.x + '" y2="' + y + '" stroke="#243029" stroke-width="1.6"/>');
      out.push('<text x="' + (it.x + 6) + '" y="' + (y + 4) + '" font-size="11" fill="#42524a">' + esc(label) + '</text>');
    });
    right.forEach((label, i) => {
      const y = it.y + ((i + 1) * it.h) / (right.length + 1);
      out.push('<line x1="' + (it.x + it.w) + '" y1="' + y + '" x2="' + (it.x + it.w + 22) + '" y2="' + y + '" stroke="#243029" stroke-width="1.6"/>');
      out.push('<text x="' + (it.x + it.w - 6) + '" y="' + (y + 4) + '" font-size="11" text-anchor="end" fill="#42524a">' + esc(label) + '</text>');
    });
    return out.join('');
  }

  function bboxOf(it) {
    if (it.type === 'symbol') {
      const k = it.k || 1;
      const pins = symbolPins(it);
      if (!pins.length) return { x: it.x - 25, y: it.y - 25, w: 50, h: 50 };
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const p of pins) {
        x1 = Math.min(x1, p.x);
        y1 = Math.min(y1, p.y);
        x2 = Math.max(x2, p.x);
        y2 = Math.max(y2, p.y);
      }
      return { x: x1 - 12 * k, y: y1 - 12 * k, w: x2 - x1 + 24 * k, h: y2 - y1 + 24 * k };
    }
    if (it.type === 'chip') return { x: it.x - 6, y: it.y - 6, w: it.w + 12, h: it.h + 12 };
    if (it.type === 'shape') {
      const x = Math.min(it.x, it.x + it.w);
      const y = Math.min(it.y, it.y + it.h);
      return { x: x - 4, y: y - 4, w: Math.abs(it.w) + 8, h: Math.abs(it.h) + 8 };
    }
    if (it.type === 'text') {
      const w = String(it.text || '').length * (it.size || 14) * 0.62;
      return { x: it.x, y: it.y - (it.size || 14), w, h: (it.size || 14) * 1.3 };
    }
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const p of it.pts || []) {
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    }
    if (!isFinite(x1)) return { x: 0, y: 0, w: 1, h: 1 };
    const pad = (it.width || 2) + 2;
    return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  }

  function selBox(it) {
    const b = bboxOf(it);
    return '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
      '" fill="none" stroke="#3d7a61" stroke-width="' + 1.5 / st.view.s + '" stroke-dasharray="' + 5 / st.view.s + ' ' + 3 / st.view.s + '"/>';
  }

  function pendingHtml() {
    const p = st.pending;
    if (!p) return '';
    if (p.type === 'wire') {
      if (!p.pts.length) return '';
      const pts = p.pts.slice();
      const tail = pts[pts.length - 1];
      const add = (q) => {
        if (!q) return;
        if (tail && Math.abs(q.x - tail.x) < 0.01 && Math.abs(q.y - tail.y) < 0.01) return;
        const last = pts[pts.length - 1];
        if (last && Math.abs(q.x - last.x) < 0.01 && Math.abs(q.y - last.y) < 0.01) return;
        pts.push(q);
      };
      if (p.preview && p.preview.length) p.preview.forEach(add);
      else add(p.cursor);
      const d = pts.map((q, i) => (i ? 'L' : 'M') + q.x + ' ' + q.y).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + activeStyle().color + '" stroke-width="2" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    if (p.type === 'stroke') {
      if (!p.pts.length) return '';
      const d = p.pts.map((q, i) => (i ? 'L' : 'M') + q.x + ' ' + q.y).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + activeStyle().color + '" stroke-width="' + activeStyle().width + '" stroke-opacity="' + activeStyle().alpha + '" stroke-linecap="round"/>';
    }
    return '';
  }

  /* ---------------- 命中测试 ---------------- */
  /** 点到折线的最短距离 */
  function distToPolyline(p, pts) {
    if (!pts || !pts.length) return Infinity;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t2 = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
      t2 = Math.max(0, Math.min(1, t2));
      const d = Math.hypot(p.x - (a.x + dx * t2), p.y - (a.y + dy * t2));
      if (d < best) best = d;
    }
    return best;
  }

  /** 返回导线里离点最近的那一段下标（超出宽度返回 -1） */
  function hitSegment(p, item, tol) {
    const pts = item.pts || [];
    let best = -1;
    let bestD = tol || 9;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t2 = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
      t2 = Math.max(0, Math.min(1, t2));
      const d = Math.hypot(p.x - (a.x + dx * t2), p.y - (a.y + dy * t2));
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function hitTest(p) {
    const solid = [];
    const lines = [];
    for (const it of st.items) {
      if (it.type === 'wire' || it.type === 'stroke') lines.push(it);
      else solid.push(it);
    }
    // 元件、芯片、文字、图形优先，避免被导线包围时选不到
    for (let i = solid.length - 1; i >= 0; i--) {
      const b = bboxOf(solid[i]);
      if (p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4) return solid[i];
    }
    // 导线 / 笔画：必须点在线上（容差 9px）
    for (let i = lines.length - 1; i >= 0; i--) {
      const it = lines[i];
      const tol = it.type === 'wire' ? 9 : Math.max(6, (it.width || 2) / 2 + 5);
      if (distToPolyline(p, it.pts) <= tol) return it;
    }
    return null;
  }


  function groupSel() {
    const sel = selectedItems();
    if (sel.length < 2) return toast('先选中两个以上图形再组合', 'err');
    snapshot();
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    sel.forEach((i) => (i.group = gid));
    render();
    toast('已组合 ' + sel.length + ' 个图形');
  }

  function ungroupSel() {
    const sel = selectedItems();
    if (!sel.length) return toast('先选中要拆开的图形', 'err');
    snapshot();
    sel.forEach((i) => delete i.group);
    render();
    toast('已拆开');
  }

  function expandSelection(item) {
    const ids = new Set([item.id]);
    if (item.group) {
      for (const it of st.items) if (it.group === item.group) ids.add(it.id);
    }
    return ids;
  }

  function selectedItems() {
    return st.items.filter((i) => st.sel.has(i.id));
  }

  /* ---------------- 历史 ---------------- */
  function snapshot() {
    st.history.push(JSON.stringify(st.items));
    if (st.history.length > 60) st.history.shift();
    st.future.length = 0;
  }

  function undo() {
    if (!st.history.length) return;
    st.future.push(JSON.stringify(st.items));
    st.items = JSON.parse(st.history.pop());
    st.sel.clear();
    render();
  }

  function redo() {
    if (!st.future.length) return;
    st.history.push(JSON.stringify(st.items));
    st.items = JSON.parse(st.future.pop());
    st.sel.clear();
    render();
  }

  /* ---------------- 交互 ---------------- */
  function onDown(e) {
    if (e.button === 2) return;
    try {
      svgEl.setPointerCapture?.(e.pointerId);
    } catch {}
    st.pointers.set(e.pointerId, e);

    if (st.pointers.size === 2) {
      st.tapInfo = { t: Date.now(), x: (e.clientX + (st.pointers.get([...st.pointers.keys()][0])?.clientX || 0)) / 2, y: e.clientY, ids: [...st.pointers.keys()] };
      const [a, b] = [...st.pointers.values()];
      const r = svgEl.getBoundingClientRect();
      const z = pageZoom(svgEl);
      const mx = ((a.clientX + b.clientX) / 2 - r.left) / z;
      const my = ((a.clientY + b.clientY) / 2 - r.top) / z;
      // 记录开始时的「双指中点对应的世界坐标」，之后让这个点始终跟着手指走
      st.pinch = {
        d0: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        s0: st.view.s,
        wx: (mx - st.view.tx) / st.view.s,
        wy: (my - st.view.ty) / st.view.s,
      };
      st.drag = null;
      st.tapInfo = { t: Date.now(), moved: false, mx, my };
      return;
    }

    const p = toWorld(e);

    if (st.tool === 'pen') {
      snapshot();
      st.pending = { type: 'stroke', pts: [st.electro ? snapPoint(p) : p] };
      render();
      return;
    }

    if (st.tool === 'wire') {
      const allowSnap = !st.pending || st.pending.pts.length <= 1;
      const sp = allowSnap ? snapPoint(p) : { x: p.x, y: p.y };
      if (!st.pending) {
        snapshot();
        st.pending = { type: 'wire', pts: [sp], cursor: sp, startRef: sp.ref || null, endRef: null };
      } else {
        const last = st.pending.pts[st.pending.pts.length - 1];
        st.pending.endRef = sp.ref || null;
        const route = routeAvoid(last, sp, Math.abs(sp.x - last.x) >= Math.abs(sp.y - last.y));
        st.pending.pts.push(...route);
        st.pending.cursor = sp;
        st.pending.preview = null;
        st.pending.previewCache = null;
        // 点完终点不自动成线，等「完成」再结束
      }
      render();
      return;
    }

    if (st.tool === 'shape') {
      st.rect = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, shape: true };
      render();
      return;
    }

    if (st.tool === 'chip') {
      st.rect = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      render();
      return;
    }

    if (st.tool === 'select') {
      const hit = hitTest(p);
      if (hit) {
        let segIndex = -1;
        if (hit.type === 'wire') segIndex = hitSegment(p, hit, 9);
        const already = st.sel.has(hit.id) && st.selSeg && st.selSeg.id === hit.id;
        if (!st.sel.has(hit.id) || (hit.type === 'wire' && !already)) {
          st.sel = expandSelection(hit);
        }
        if (hit.type === 'wire') {
          st.selSeg = segIndex >= 0 ? { id: hit.id, i: segIndex } : null;
          snapshot();
          // 拖拽：靠近端点改端点，否则整段平移
          const pts = hit.pts || [];
          const segLen = segIndex >= 0 && pts[segIndex] && pts[segIndex + 1]
            ? Math.hypot(pts[segIndex + 1].x - pts[segIndex].x, pts[segIndex + 1].y - pts[segIndex].y)
            : 0;
          const vertexTol = segLen >= 26 ? 9 : 0;
          let near = -1;
          for (let k = 0; k < pts.length; k++) {
            if (Math.hypot(pts[k].x - p.x, pts[k].y - p.y) <= vertexTol) {
              near = k;
              break;
            }
          }
          if (segIndex >= 0 && near >= 0 && Array.isArray(hit.refs)) {
            const ref = near === 0 ? hit.refs[0] : near === hit.pts.length - 1 ? hit.refs[1] : null;
            if (ref && ref.kind === 'wire' && ref.itemId !== hit.id) {
              const src = st.items.find((i) => i.id === ref.itemId);
              if (src && src.pts && src.pts[ref.end]) {
                st.sel = new Set([src.id]);
                st.selSeg = { id: src.id, i: Math.max(0, Math.min(ref.end, src.pts.length - 2)) };
                st.drag = { mode: 'vertex', id: src.id, index: ref.end, start: p, last: p };
                snapshot();
                render();
                return;
              }
            }
          }
          if (segIndex >= 0 && near >= 0 && Array.isArray(hit.refs)) {
            const ref = near === 0 ? hit.refs[0] : near === hit.pts.length - 1 ? hit.refs[1] : null;
            if (ref && ref.kind === 'wire' && ref.itemId !== hit.id) {
              const src = st.items.find((i) => i.id === ref.itemId);
              if (src && src.pts && src.pts[ref.end]) {
                st.sel = new Set([src.id]);
                st.selSeg = { id: src.id, i: Math.max(0, Math.min(ref.end, src.pts.length - 2)) };
                st.drag = { mode: 'vertex', id: src.id, index: ref.end, start: p, last: p };
                snapshot();
                render();
                return;
              }
            }
          }
          if (segIndex >= 0) {
            st.drag = near >= 0
              ? { mode: 'vertex', id: hit.id, index: near, start: p, last: p }
              : { mode: 'segment', id: hit.id, index: segIndex, start: p, last: p };
            render();
            return;
          }
        }
        snapshot();
        st.drag = { mode: 'move', start: p, items: selectedItems().map((i) => ({ id: i.id, snap: JSON.parse(JSON.stringify(i)) })) };
        render();
      } else {
        st.selSeg = null;
        st.sel.clear();
        st.marquee = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        render();
      }
      return;
    }
  }

  function onMove(e) {
    if (st.pointers.has(e.pointerId)) st.pointers.set(e.pointerId, e);

    if (st.pinch && st.pointers.size >= 2) {
      const [a, b] = [...st.pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const r = svgEl.getBoundingClientRect();
      const mx = (a.clientX + b.clientX) / 2 - r.left;
      const my = (a.clientY + b.clientY) / 2 - r.top;
      // 缩放比例由两指距离决定，平移量由中点移动决定，两者同时生效
      if (st.tapInfo && Math.hypot(mx - st.tapInfo.mx, my - st.tapInfo.my) > 12) st.tapInfo.moved = true;
      const s = Math.min(4, Math.max(0.2, st.pinch.s0 * (d / st.pinch.d0)));
      st.view.s = s;
      st.view.tx = mx - st.pinch.wx * s;
      st.view.ty = my - st.pinch.wy * s;
      render();
      return;
    }

    const p = toWorld(e);

    if (st.rect) {
      st.rect.x2 = p.x;
      st.rect.y2 = p.y;
      render();
      return;
    }

    if (st.tool === 'wire' && !st.pending) {
      // 还没开始连线时也高亮最近的引脚
      const pin = nearestPin(p);
      const same = (!pin && !st.hoverPin) || (pin && st.hoverPin && pin.x === st.hoverPin.x && pin.y === st.hoverPin.y);
      if (!same) {
        st.hoverPin = pin;
        render();
      }
      return;
    }

    if (st.pending && st.pending.type === 'stroke') {
      const last = st.pending.pts[st.pending.pts.length - 1];
      const q = st.electro ? snapPoint(p) : p;
      if (Math.hypot(q.x - last.x, q.y - last.y) > (st.electro ? 2 : 1.5)) {
        if (st.electro) {
          const route = orthoRoute(last, q, Math.abs(q.x - last.x) >= Math.abs(q.y - last.y));
          st.pending.pts.push(...route);
        } else {
          st.pending.pts.push(q);
        }
        render();
      }
      return;
    }

    if (st.pending && st.pending.type === 'wire') {
      st.hoverPin = nearestPin(p);
      const sp = snapPoint(p);
      const last = st.pending.pts[st.pending.pts.length - 1];
      // 网格模式且已有完整一段：终点保持显示，不再橡皮筋
      if (st.electro && st.pending.pts.length >= 2) {
        render();
        return;
      }
      if (Math.abs(sp.x - last.x) < 4 && Math.abs(sp.y - last.y) < 4) {
        st.pending.preview = [];
        st.pending.previewCache = null;
        render();
        return;
      }
      const cache = st.pending.previewCache;
      let preview;
      if (cache && Math.abs(cache.x - sp.x) < 3 && Math.abs(cache.y - sp.y) < 3) {
        preview = cache.pts;
      } else {
        preview = routeAvoid(last, sp, Math.abs(sp.x - last.x) >= Math.abs(sp.y - last.y));
        st.pending.previewCache = { x: sp.x, y: sp.y, pts: preview };
      }
      st.pending.preview = preview;
      st.pending.cursor = preview.length ? preview[preview.length - 1] : last;
      st.pending.rawCursor = sp;
      render();
      return;
    }

    if (st.drag && (st.drag.mode === 'segment' || st.drag.mode === 'vertex')) {
      const w = st.items.find((i) => i.id === st.drag.id);
      if (!w || !w.pts) return;
      // 增量位移：跟着手指走，不做网格吸附
      const last = st.drag.last || st.drag.start;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (!dx && !dy) return;
      st.drag.last = p;
      const snapV = (v) => Math.round(v * 10) / 10;

      if (st.drag.mode === 'segment') {
        const i = st.drag.index;
        const a = w.pts[i];
        const b = w.pts[i + 1];
        if (!a || !b) return;
        const refs = Array.isArray(w.refs) ? w.refs : [];
        const pinnedStart = !!(refs[0] && refs[0].itemId && i === 0);
        const pinnedEnd = !!(refs[1] && refs[1].itemId && i === w.pts.length - 2);
        const horizontal = Math.abs(a.y - b.y) < 0.01;
        if (horizontal) {
          const ny = snapV(a.y + dy);
          if (!pinnedStart) w.pts[i] = { x: a.x, y: ny };
          if (!pinnedEnd) w.pts[i + 1] = { x: b.x, y: ny };
        } else {
          const nx = snapV(a.x + dx);
          if (!pinnedStart) w.pts[i] = { x: nx, y: a.y };
          if (!pinnedEnd) w.pts[i + 1] = { x: nx, y: b.y };
        }
        // 段整体平移后，相邻段自动变长/变短（顶点共享，无需额外处理）
      } else {
        const k = st.drag.index;
        const v = w.pts[k];
        if (!v) return;
        const nx = snapV(v.x + dx);
        const ny = snapV(v.y + dy);
        // 相邻线段保持直角：相邻顶点的对应坐标一起动
        const prev = w.pts[k - 1];
        const next = w.pts[k + 1];
        if (prev) {
          const wasH = Math.abs(prev.y - v.y) < 0.01;
          const wasV = Math.abs(prev.x - v.x) < 0.01;
          if (wasH && !wasV) prev.y = ny;
          else if (wasV && !wasH) prev.x = nx;
        }
        if (next) {
          const wasH = Math.abs(next.y - v.y) < 0.01;
          const wasV = Math.abs(next.x - v.x) < 0.01;
          if (wasH && !wasV) next.y = ny;
          else if (wasV && !wasH) next.x = nx;
        }
        w.pts[k] = { x: nx, y: ny };
      }
      render();
      return;
    }

    if (st.drag && st.drag.mode === 'move') {
      const dx = p.x - st.drag.start.x;
      const dy = p.y - st.drag.start.y;
      const useGrid = st.settings.snapDrag && st.electro;
      let ndx = dx;
      let ndy = dy;
      if (useGrid && st.drag.items.length) {
        // 用第一个图形的锚点算一次吸附偏移，整组统一用这个偏移，形状不变
        const first = st.drag.items[0].snap;
        const ax = first.pts && first.pts.length ? first.pts[0].x : first.x;
        const ay = first.pts && first.pts.length ? first.pts[0].y : first.y;
        ndx = Math.round((ax + dx) / GRID) * GRID - ax;
        ndy = Math.round((ay + dy) / GRID) * GRID - ay;
      }
      for (const rec of st.drag.items) {
        const it = st.items.find((i) => i.id === rec.id);
        if (!it) continue;
        if (it.type === 'stroke' || it.type === 'wire') {
          it.pts = rec.snap.pts.map((q) => ({ x: q.x + ndx, y: q.y + ndy }));
        } else if (it.type === 'shape') {
          it.x = rec.snap.x + ndx;
          it.y = rec.snap.y + ndy;
        } else {
          it.x = rec.snap.x + ndx;
          it.y = rec.snap.y + ndy;
        }
      }
      render();
      return;
    }

    if (st.marquee) {
      st.marquee.x2 = p.x;
      st.marquee.y2 = p.y;
      render();
      return;
    }
  }

  function onUp(e) {
    st.pointers.delete(e.pointerId);

    // 双指快速点按（没有明显移动）才取消连线
    if (st.pointers.size === 0 && st.tapInfo) {
      const quick = Date.now() - st.tapInfo.t < 350;
      if (quick && !st.tapInfo.moved && st.pending) {
        st.pending = null;
        st.pinch = null;
        st.tapInfo = null;
        render();
        toast('已取消连线');
        return;
      }
      st.tapInfo = null;
    }

    if (st.rect && st.rect.shape) {
      const r = st.rect;
      st.rect = null;
      const w = r.x2 - r.x1;
      const h = r.y2 - r.y1;
      if (Math.abs(w) > 4 || Math.abs(h) > 4) {
        snapshot();
        st.items.push({
          id: uid(),
          type: 'shape',
          kind: st.shapeKind,
          x: r.x1,
          y: r.y1,
          w,
          h,
          color: st.shape.color,
          width: st.shape.width,
          alpha: st.shape.alpha,
        });
      }
      st.tool = 'select';
      syncTools();
      render();
      return;
    }

    if (st.rect) {
      const r = st.rect;
      st.rect = null;
      let x = Math.min(r.x1, r.x2);
      let y = Math.min(r.y1, r.y2);
      let w = Math.abs(r.x2 - r.x1);
      let h = Math.abs(r.y2 - r.y1);
      if (st.electro) {
        x = Math.round(x / GRID) * GRID;
        y = Math.round(y / GRID) * GRID;
        w = Math.max(GRID * 6, Math.round(w / GRID) * GRID);
        h = Math.max(GRID * 4, Math.round(h / GRID) * GRID);
      }
      render();
      if (w < 40 || h < 30) {
        toast('矩形太小了，重新拖一个大一点的', 'err');
        return;
      }
      openChipEditor({ x, y, w, h });
      return;
    }

    if (st.pinch) {
      if (st.pointers.size < 2) st.pinch = null;
      return;
    }

    if (st.pending && st.pending.type === 'stroke') {
      if (st.pending.pts.length > 1) st.items.push({ id: uid(), type: 'stroke', pts: st.pending.pts, color: st.pen.color, width: st.pen.width, alpha: st.pen.alpha });
      st.pending = null;
      render();
      return;
    }

    if (st.drag) {
      const mode = st.drag.mode;
      const segIdx = st.drag.index;
      const dragId = st.drag.id;
      st.drag = null;
      const w = dragId ? st.items.find((i) => i.id === dragId) : null;
      if (w && mode === 'segment' && w.pts && w.pts[segIdx] && w.pts[segIdx + 1]) {
        const a = w.pts[segIdx];
        const b = w.pts[segIdx + 1];
        // 端点被引脚钉住时会变成斜线，插折点恢复直角
        if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
          const refs = Array.isArray(w.refs) ? w.refs : [];
          const pinAtB = !!(refs[1] && refs[1].itemId && segIdx + 1 === w.pts.length - 1);
          const pinAtA = !!(refs[0] && refs[0].itemId && segIdx === 0);
          const bend = pinAtB ? { x: a.x, y: b.y } : pinAtA ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
          w.pts.splice(segIdx + 1, 0, bend);
        }
        fixPinnedEnds(w);
        syncWireBonds();
        rewireAll();
      } else if (w && mode === 'vertex') {
        fixPinnedEnds(w);
        syncWireBonds();
        rewireAll();
      } else {
        rewireAll();
      }
      render();
      return;
    }

    if (st.marquee) {
      const m = st.marquee;
      const x1 = Math.min(m.x1, m.x2);
      const y1 = Math.min(m.y1, m.y2);
      const x2 = Math.max(m.x1, m.x2);
      const y2 = Math.max(m.y1, m.y2);
      if (Math.abs(x2 - x1) > 4 && Math.abs(y2 - y1) > 4) {
        for (const it of st.items) {
          const b = bboxOf(it);
          if (b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2) expandSelection(it).forEach((id) => st.sel.add(id));
        }
      }
      st.marquee = null;
      render();
    }
  }

  function onDblClick() {
    // 双击不再结束连线（容易误触），请用右侧「完成」或 Enter
  }

  function finishWire() {
    // 只点了起点就按「完成」：把当前指针位置当作终点
    if (st.pending && st.pending.type === 'wire' && st.pending.pts.length === 1) {
      const from = st.pending.pts[0];
      const target = st.pending.rawCursor || st.pending.cursor;
      if (target && (Math.abs(target.x - from.x) > 2 || Math.abs(target.y - from.y) > 2)) {
        const route = st.pending.preview && st.pending.preview.length
          ? st.pending.preview.slice()
          : routeAvoid(from, target, Math.abs(target.x - from.x) >= Math.abs(target.y - from.y));
        st.pending.pts.push(...route);
      }
    }
    if (st.pending && st.pending.pts.length > 1) {
      st.items.push({
        id: uid(),
        type: 'wire',
        color: '#243029',
        width: 2,
        pts: st.pending.pts.slice(),
        refs: [st.pending.startRef || null, st.pending.endRef || null],
      });
    }
    st.pending = null;
    st.hoverPin = null;
    render();
  }

  /* ---------------- 工具动作 ---------------- */
  async function addText() {
    const text = await askModal({ kind: 'input', title: '添加文字', placeholder: '输入内容', value: '' });
    if (!text) return;
    snapshot();
    const cx = (svgEl.clientWidth / 2 - st.view.tx) / st.view.s;
    const cy = (svgEl.clientHeight / 2 - st.view.ty) / st.view.s;
    st.items.push({ id: uid(), type: 'text', x: cx, y: cy, text, size: 14, color: st.pen.color });
    st.tool = 'select';
    syncTools();
    render();
  }

  const CHIP_PRESETS = [
    { name: '运算放大器', pins: [['L', 0.28, '3', 'IN+'], ['L', 0.72, '2', 'IN-'], ['R', 0.5, '1', 'OUT']] },
    { name: '定时器', pins: [['L', 0.25, '2', 'TRIG'], ['L', 0.5, '6', 'THR'], ['L', 0.75, '4', 'RST'], ['R', 0.5, '3', 'OUT']] },
    { name: '稳压器', pins: [['L', 0.35, '1', 'IN'], ['L', 0.72, '2', 'GND'], ['R', 0.5, '3', 'OUT']] },
  ];

  const SIDE_CN = { L: '左', R: '右', T: '上', B: '下' };


  /** 让两端接在引脚上的导线跟着元件走 */
  function rewireAll() {
    if (!st.settings.autoRewire) return;
    for (const it of st.items) {
      if (it.type !== 'wire' || !Array.isArray(it.refs)) continue;
      const [r0, r1] = it.refs;
      if (!r0 && !r1) continue;
      const p0 = r0 ? refPos(r0) : it.pts[0];
      const p1 = r1 ? refPos(r1) : it.pts[it.pts.length - 1];
      if (!p0 || !p1) continue;
      it.pts = [p0, ...routeAvoid(p0, p1, Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y))];
    }
  }

/** 重新规划选中的导线（没有选中就处理全部） */
/** 关掉画板上已打开的浮层（面板 / 对话框），可指定保留哪一个 */
  function closeOverlays(keep) {
    if (!root) return;
    root.querySelectorAll('.dw-palette, .dw-mask').forEach((el) => {
      if (el === keep) return;
      el.remove();
    });
  }

  function openBoardSettings() {
    closeOverlays();
    const mask = document.createElement('div');
    mask.className = 'dw-mask';
    const row = (id, label, hint, on) =>
      '<label class="dw-opt"><span><b>' + label + '</b><i>' + hint + '</i></span>' +
      '<input type="checkbox" data-opt="' + id + '"' + (on ? ' checked' : '') + ' /></label>';
    mask.innerHTML =
      '<div class="dw-dialog">' +
      '<div class="dw-dialog-title">画板设置</div>' +
      row('autoRewire', '缩放/移动后自动重连导线', '接在引脚上的线会跟着元件走', st.settings.autoRewire) +
      row('snap', '引脚自动吸附', '靠近引脚时自动对齐', st.settings.snap) +
      row('grid', '显示网格', '网格模式之外也显示 10px 网格', st.settings.grid) +
      row('snapDrag', '拖动时对齐网格', '网格模式下拖动元件/导线按 10px 跳动', st.settings.snapDrag) +
      row('avoid', '网格模式绕开元件', '关闭后管道会直接穿过元件', st.settings.avoid) +
      '<div class="dw-dialog-actions"><button class="btn primary" data-ok>完成</button></div>' +
      '</div>';
    root.appendChild(mask);
    mask.querySelectorAll('[data-opt]').forEach((el) => {
      el.onchange = () => {
        st.settings[el.dataset.opt] = el.checked;
        render();
        if (typeof api === 'function') {
          api('/api/settings', { boardSettings: st.settings })
            .then((next) => {
              S = next;
            })
            .catch(() => {});
        }
      };
    });
    mask.querySelector('[data-ok]').onclick = () => mask.remove();
  }

  function openChipEditor(rect) {
    closeOverlays();
    const pins = [];
    const mask = document.createElement('div');
    mask.className = 'dw-mask';
    mask.innerHTML =
      '<div class="dw-dialog dw-chip-editor">' +
      '<div class="dw-dialog-title">定义芯片</div>' +
      '<div class="dw-presets">' +
      CHIP_PRESETS.map((c, i) => '<button class="dw-preset" data-preset="' + i + '">' + esc(c.name) + '预设</button>').join('') +
      '</div>' +
      '<div class="dw-chip-preview" id="dw-chip-preview"></div>' +
      '<div class="dw-tip">在矩形<b>边框上点一下</b>加引脚；<b>按住引脚可以拖动</b>改位置（自动贴边）；下面可以改编号和名字。</div>' +
      '<label class="dw-field">芯片名称<input class="input" id="dw-chip-name" value="IC" /></label>' +
      '<div class="dw-pin-list" id="dw-pin-list"></div>' +
      '<div class="dw-dialog-actions">' +
      '<button class="btn" data-cancel>取消</button>' +
      '<button class="btn primary" data-ok>完成</button>' +
      '</div></div>';
    root.appendChild(mask);

    const listEl = mask.querySelector('#dw-pin-list');
    const previewEl = mask.querySelector('#dw-chip-preview');
    const nameEl = mask.querySelector('#dw-chip-name');

    const pad = 26;
    const vb = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };

    function drawPreview() {
      const parts = [];
      parts.push('<svg viewBox="' + vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h + '" preserveAspectRatio="xMidYMid meet" width="100%" height="190" style="width:100%;height:190px;display:block">');
      parts.push('<rect x="' + rect.x + '" y="' + rect.y + '" width="' + rect.w + '" height="' + rect.h +
        '" rx="4" fill="#fffdf8" stroke="#243029" stroke-width="1.8"/>');
      const midClash = pins.some((pin) => (pin.side === 'L' || pin.side === 'R') && pin.t > 0.34 && pin.t < 0.66);
      parts.push('<text x="' + (rect.x + rect.w / 2) + '" y="' + (rect.y + rect.h / 2 + 5 + (midClash ? -13 : 0)) +
        '" text-anchor="middle" font-size="13" font-weight="600" fill="#243029">' + esc(nameEl.value || '芯片') + '</text>');
      for (const pin of pins) {
        const p = chipPinPoint({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, pin);
        const inner = {
          x: rect.x + (pin.side === 'L' ? 0 : pin.side === 'R' ? rect.w : pin.t * rect.w),
          y: rect.y + (pin.side === 'T' ? 0 : pin.side === 'B' ? rect.h : pin.t * rect.h),
        };
        parts.push('<line x1="' + p.x + '" y1="' + p.y + '" x2="' + inner.x + '" y2="' + inner.y + '" stroke="#243029" stroke-width="1.6"/>');
        parts.push('<circle data-pin="' + pins.indexOf(pin) + '" cx="' + p.x + '" cy="' + p.y + '" r="14" fill="#3d7a61" fill-opacity="0.001" style="cursor:grab"/>');
        parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="4.2" fill="#3d7a61"/>');
        const lx = inner.x + (pin.side === 'L' ? 6 : pin.side === 'R' ? -6 : 0);
        const ly = inner.y + (pin.side === 'T' ? 12 : pin.side === 'B' ? -6 : 4);
        const anch = pin.side === 'L' ? 'start' : pin.side === 'R' ? 'end' : 'middle';
        parts.push('<text x="' + lx + '" y="' + ly + '" font-size="10.5" fill="#42524a" text-anchor="' + anch + '">' + esc(pin.name || '') + '</text>');
      }
      parts.push('</svg>');
      previewEl.innerHTML = parts.join('');
      previewEl.querySelector('svg').addEventListener('click', (e) => {
        if (suppressClick && Date.now() < suppressClick) return;
        const pt = previewXY(e);
        addPinAt(pt.x, pt.y);
      });
    }

    /** 由鼠标位置算出「落在哪条边、边上什么比例」 */
    function sideTFrom(bx, by) {
      const dLeft = Math.abs(bx - rect.x);
      const dRight = Math.abs(bx - (rect.x + rect.w));
      const dTop = Math.abs(by - rect.y);
      const dBottom = Math.abs(by - (rect.y + rect.h));
      const min = Math.min(dLeft, dRight, dTop, dBottom);
      let side = 'L';
      let t01 = 0;
      if (min === dLeft) { side = 'L'; t01 = (by - rect.y) / rect.h; }
      else if (min === dRight) { side = 'R'; t01 = (by - rect.y) / rect.h; }
      else if (min === dTop) { side = 'T'; t01 = (bx - rect.x) / rect.w; }
      else { side = 'B'; t01 = (bx - rect.x) / rect.w; }
      if (st.electro) {
        if (side === 'L' || side === 'R') {
          const yy = Math.round((rect.y + t01 * rect.h) / GRID) * GRID;
          t01 = (yy - rect.y) / rect.h;
        } else {
          const xx = Math.round((rect.x + t01 * rect.w) / GRID) * GRID;
          t01 = (xx - rect.x) / rect.w;
        }
      }
      return { side, t: Math.min(0.95, Math.max(0.05, t01)) };
    }

    function addPinAt(bx, by) {
      const pos = sideTFrom(bx, by);
      const n = pins.length + 1;
      pins.push({ side: pos.side, t: pos.t, num: String(n), name: 'P' + n });
      drawList();
      drawPreview();
    }

    function previewSVG() {
      return previewEl.querySelector('svg');
    }

    /** 屏幕坐标 → 预览内部坐标（用 CTM，自动处理缩放与等比留白） */
    function previewXY(ev) {
      const svg = previewSVG();
      if (!svg || !svg.getScreenCTM) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    }

    /** 拖动已有引脚改位置 */
    function startPinDrag(index, ev) {
      ev.preventDefault();
      let moved = false;
      const onMove = (e2) => {
        const pt = previewXY(e2);
        const pos = sideTFrom(pt.x, pt.y);
        pins[index].side = pos.side;
        pins[index].t = pos.t;
        moved = true;
        drawPreview();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) drawList();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    function drawList() {
      listEl.innerHTML = pins
        .map(
          (pin, i) =>
            '<div class="dw-pin-row">' +
            '<span class="dw-pin-side">' + SIDE_CN[pin.side] + '</span>' +
            '<input class="input dw-pin-num" data-i="' + i + '" value="' + esc(pin.num) + '" placeholder="编号" />' +
            '<input class="input dw-pin-name" data-i="' + i + '" value="' + esc(pin.name) + '" placeholder="名称" />' +
            '<button class="dw-pin-del" data-del="' + i + '">✕</button>' +
            '</div>'
        )
        .join('');
      listEl.querySelectorAll('.dw-pin-num').forEach((el) => {
        el.oninput = () => (pins[Number(el.dataset.i)].num = el.value);
      });
      listEl.querySelectorAll('.dw-pin-name').forEach((el) => {
        el.oninput = () => {
          pins[Number(el.dataset.i)].name = el.value;
          drawPreview();
        };
      });
      listEl.querySelectorAll('[data-del]').forEach((el) => {
        el.onclick = () => {
          pins.splice(Number(el.dataset.del), 1);
          drawList();
          drawPreview();
        };
      });
    }

    mask.querySelectorAll('[data-preset]').forEach((b) => {
      b.onclick = () => {
        const preset = CHIP_PRESETS[Number(b.dataset.preset)];
        nameEl.value = preset.name;
        pins.length = 0;
        for (const [side, t01, num, name] of preset.pins) pins.push({ side, t: t01, num, name });
        drawList();
        drawPreview();
      };
    });

    /** 引脚在屏幕上的位置 */
    function pinScreenPos(i) {
      const svg = previewSVG();
      if (!svg || !svg.getScreenCTM) return null;
      const pt = chipPinPoint({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, pins[i]);
      const q = svg.createSVGPoint();
      q.x = pt.x;
      q.y = pt.y;
      const p = q.matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    }

    /** 找出离手指最近的引脚（屏幕 26px 内） */
    function pinAtScreen(cx, cy) {
      let best = -1;
      let bestD = 26;
      for (let i = 0; i < pins.length; i++) {
        const pos = pinScreenPos(i);
        if (!pos) continue;
        const d = Math.hypot(pos.x - cx, pos.y - cy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    let suppressClick = 0;

    previewEl.addEventListener('pointerdown', (e) => {
      const idx = pinAtScreen(e.clientX, e.clientY);
      if (idx < 0) return;
      suppressClick = Date.now() + 400;
      startPinDrag(idx, e);
    });

    nameEl.addEventListener('input', drawPreview);
    mask.querySelector('[data-cancel]').onclick = () => mask.remove();
    mask.querySelector('[data-ok]').onclick = () => {
      if (!pins.length) {
        toast('先点边框加几个引脚', 'err');
        return;
      }
      snapshot();
      st.items.push({
        id: uid(),
        type: 'chip',
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        name: (nameEl.value || 'IC').trim() || 'IC',
        pins: pins.map((p) => ({ side: p.side, t: p.t, num: p.num, name: p.name })),
      });
      mask.remove();
      st.tool = 'select';
      syncTools();
      render();
    };

    drawList();
    drawPreview();
  }

const SHAPES = [
    ['rect', '矩形'],
    ['ellipse', '圆形'],
    ['line', '直线'],
  ];

  function penbarHtml() {
    return (
      '<div class="dw-penbar" id="dw-penbar">' +
      '<div class="dw-pen-row"><span>颜色</span>' +
      '<input type="color" id="dw-color" class="dw-color" value="#243029" />' +
      '<b class="dw-color-hex" id="dw-color-hex">#243029</b>' +
      '</div>' +
      '<div class="dw-pen-row"><span>粗细</span>' +
      '<input type="range" id="dw-width" class="dw-range" min="1" max="12" step="1" value="2" />' +
      '<b class="dw-num" id="dw-width-num">2</b>' +
      '</div>' +
      '<div class="dw-pen-row"><span>透明</span>' +
      '<input type="range" id="dw-alpha" class="dw-range" min="10" max="100" step="1" value="100" />' +
      '<b class="dw-num" id="dw-alpha-num">100%</b>' +
      '</div></div>'
    );
  }

  /** 面板显示时同步当前工具的样式值 */
  function syncPenbar() {
    const bar = root && root.querySelector('#dw-penbar');
    if (!bar) return;
    const show = st.tool === 'pen' || st.tool === 'shape';
    bar.classList.toggle('show', show);
    if (!show) return;
    const s = activeStyle();
    const colorEl = bar.querySelector('#dw-color');
    const hexEl = bar.querySelector('#dw-color-hex');
    const wEl = bar.querySelector('#dw-width');
    const wNum = bar.querySelector('#dw-width-num');
    const aEl = bar.querySelector('#dw-alpha');
    const aNum = bar.querySelector('#dw-alpha-num');
    if (colorEl) colorEl.value = s.color;
    if (hexEl) hexEl.textContent = s.color.toUpperCase();
    if (wEl) wEl.value = String(s.width);
    if (wNum) wNum.textContent = String(s.width);
    if (aEl) aEl.value = String(Math.round(s.alpha * 100));
    if (aNum) aNum.textContent = Math.round(s.alpha * 100) + '%';
  }

  /** 面板控件绑定（只在打开画板时绑一次） */
  function bindPenbar() {
    const bar = root && root.querySelector('#dw-penbar');
    if (!bar) return;
    const colorEl = bar.querySelector('#dw-color');
    const wEl = bar.querySelector('#dw-width');
    const aEl = bar.querySelector('#dw-alpha');
    if (colorEl) {
      colorEl.addEventListener('input', () => {
        activeStyle().color = colorEl.value;
        const hexEl = bar.querySelector('#dw-color-hex');
        if (hexEl) hexEl.textContent = colorEl.value.toUpperCase();
      });
    }
    if (wEl) {
      wEl.addEventListener('input', () => {
        activeStyle().width = Number(wEl.value);
        const n = bar.querySelector('#dw-width-num');
        if (n) n.textContent = wEl.value;
      });
    }
    if (aEl) {
      aEl.addEventListener('input', () => {
        activeStyle().alpha = Number(aEl.value) / 100;
        const n = bar.querySelector('#dw-alpha-num');
        if (n) n.textContent = aEl.value + '%';
      });
    }
  }

  function openShapes() {
    const opened = root.querySelector('.dw-palette[data-kind="shapes"]');
    if (opened) {
      opened.remove();
      return;
    }
    closeOverlays();
    const box = document.createElement('div');
    box.className = 'dw-palette';
    box.dataset.kind = 'shapes';
    box.innerHTML =
      '<div class="dw-palette-head">常用图形<button class="btn sm ghost" data-close>✕</button></div>' +
      '<div class="dw-palette-grid">' +
      SHAPES.map(
        ([k, label]) =>
          '<button class="dw-sym" data-shape="' + k + '">' +
          '<svg viewBox="0 0 60 40" width="56" height="38">' +
          (k === 'rect'
            ? '<rect x="10" y="8" width="40" height="24" fill="none" stroke="#243029" stroke-width="2"/>'
            : k === 'ellipse'
            ? '<ellipse cx="30" cy="20" rx="20" ry="13" fill="none" stroke="#243029" stroke-width="2"/>'
            : '<line x1="10" y1="32" x2="50" y2="8" stroke="#243029" stroke-width="2"/>') +
          '</svg><span>' + label + '</span></button>'
      ).join('') +
      '</div>';
    root.appendChild(box);
    box.querySelector('[data-close]').onclick = () => box.remove();
    box.querySelectorAll('[data-shape]').forEach((b) => {
      b.onclick = () => {
        st.shapeKind = b.dataset.shape;
        st.tool = 'shape';
        box.remove();
        syncTools();
        updateHint();
      };
    });
  }

  function openSymbols() {
    const list = window.SYMBOL_CATALOG || [];
    const open = root.querySelector('.dw-palette[data-kind="symbols"]');
    if (open) {
      open.remove();
      return;
    }
    closeOverlays();
    const box = document.createElement('div');
    box.className = 'dw-palette';
    box.dataset.kind = 'symbols';
    box.innerHTML =
      '<div class="dw-palette-head">选择元件<button class="btn sm ghost" data-close>✕</button></div>' +
      '<div class="dw-palette-grid">' +
      list
        .map(
          ([id, name]) =>
            '<button class="dw-sym" data-sym="' + id + '" title="' + esc(name) + '">' +
            (() => {
        const pins = (window.SYMBOL_PINS || {})[id] || [];
        const xs = pins.map((q) => q[0]).concat([-18, 18]);
        const ys = pins.map((q) => q[1]).concat([-10, 10]);
        const x1 = Math.min(...xs) - 10;
        const x2 = Math.max(...xs) + 10;
        const y1 = Math.min(...ys) - 10;
        const y2 = Math.max(...ys) + 10;
        return '<svg viewBox="' + x1 + ' ' + y1 + ' ' + (x2 - x1) + ' ' + (y2 - y1) + '" width="60" height="40" preserveAspectRatio="xMidYMid meet"><use href="#' + id + '"/></svg>';
      })() +
            '<span>' + esc(name) + '</span></button>'
        )
        .join('') +
      '</div>';
    root.appendChild(box);
    box.querySelector('[data-close]').onclick = () => box.remove();
    box.querySelectorAll('[data-sym]').forEach((btn) => {
      btn.onclick = () => {
        snapshot();
        const cx = (svgEl.clientWidth / 2 - st.view.tx) / st.view.s;
        const cy = (svgEl.clientHeight / 2 - st.view.ty) / st.view.s;
        const spot = freeSpot(cx, cy);
        const px = st.electro ? Math.round(spot.x / GRID) * GRID : Math.round(spot.x);
        const py = st.electro ? Math.round(spot.y / GRID) * GRID : Math.round(spot.y);
        st.items.push({ id: uid(), type: 'symbol', symId: btn.dataset.sym, x: px, y: py, rot: 0 });
        box.remove();
        st.tool = 'select';
        syncTools();
        render();
      };
    });
  }

  function rotateSel() {
    const sel = selectedItems().filter((i) => i.type === 'symbol');
    if (!sel.length) return toast('先选中一个元件', 'err');
    snapshot();
    sel.forEach((i) => (i.rot = ((i.rot || 0) + 90) % 360));
    render();
  }


  /** 选区的整体外框（含组合） */
  function selectionBounds() {
    const sel = selectedItems();
    if (!sel.length) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const it of sel) {
      const b = bboxOf(it);
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w);
      y2 = Math.max(y2, b.y + b.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }

  /** 以选区中心为基准缩放 */
  function scaleSel(f) {
    const b = selectionBounds();
    if (!b) return toast('先选中要缩放的内容', 'err');
    snapshot();
    for (const it of selectedItems()) {
      if (it.type === 'stroke' || it.type === 'wire') {
        it.pts = it.pts.map((q) => ({
          x: b.cx + (q.x - b.cx) * f,
          y: b.cy + (q.y - b.cy) * f,
        }));
      } else if (it.type === 'shape') {
        it.x = b.cx + (it.x - b.cx) * f;
        it.y = b.cy + (it.y - b.cy) * f;
        it.w = it.w * f;
        it.h = it.h * f;
      } else if (it.type === 'text') {
        it.x = b.cx + (it.x - b.cx) * f;
        it.y = b.cy + (it.y - b.cy) * f;
        it.size = Math.max(9, Math.min(48, Math.round((it.size || 14) * f)));
      } else if (it.type === 'symbol') {
        it.x = b.cx + (it.x - b.cx) * f;
        it.y = b.cy + (it.y - b.cy) * f;
        it.k = Math.max(0.4, Math.min(4, (it.k || 1) * f));
      } else if (it.type === 'chip') {
        const cx = it.x + it.w / 2;
        const cy = it.y + it.h / 2;
        const w = Math.max(40, it.w * f);
        const h = Math.max(30, it.h * f);
        it.x = b.cx + (cx - b.cx) * f - w / 2;
        it.y = b.cy + (cy - b.cy) * f - h / 2;
        it.w = w;
        it.h = h;
      }
    }
    rewireAll();
    render();
  }

  /** 整体顺时针旋转 90° */
  function rotateSel90() {
    const b = selectionBounds();
    if (!b) return toast('先选中要旋转的内容', 'err');
    snapshot();
    const cx = b.cx;
    const cy = b.cy;
    const rotPt = (x, y) => ({ x: cx - (y - cy), y: cy + (x - cx) });
    const sideMap = { L: ['T', false], R: ['B', false], T: ['R', true], B: ['L', true] };

    for (const it of selectedItems()) {
      if (it.type === 'stroke' || it.type === 'wire') {
        it.pts = it.pts.map((q) => rotPt(q.x, q.y));
      } else if (it.type === 'text') {
        const p2 = rotPt(it.x, it.y);
        it.x = p2.x;
        it.y = p2.y;
      } else if (it.type === 'symbol') {
        const p2 = rotPt(it.x, it.y);
        it.x = p2.x;
        it.y = p2.y;
        it.rot = ((it.rot || 0) + 90) % 360;
      } else if (it.type === 'chip') {
        const ccx = it.x + it.w / 2;
        const ccy = it.y + it.h / 2;
        const p2 = rotPt(ccx, ccy);
        const w = it.h;
        const h = it.w;
        it.x = p2.x - w / 2;
        it.y = p2.y - h / 2;
        it.w = w;
        it.h = h;
        if (Array.isArray(it.pins)) {
          it.pins = it.pins.map((pin) => {
            const map = sideMap[pin.side] || ['L', false];
            return { ...pin, side: map[0], t: map[1] ? 1 - pin.t : pin.t };
          });
        }
      }
    }
    rewireAll();
    render();
  }

/** 导线两端若连着引脚，拖完后钉回引脚，相邻段随之保持直角 */
  function fixPinnedEnds(w) {
    if (!w || !w.pts || w.pts.length < 2 || !Array.isArray(w.refs)) return;
    const snapEnd = (ref, atStart) => {
      if (!ref || !ref.itemId) return;
      const p = refPos(ref);
      if (!p) return;
      const idx = atStart ? 0 : w.pts.length - 1;
      const nbr = atStart ? w.pts[1] : w.pts[w.pts.length - 2];
      const old = w.pts[idx];
      w.pts[idx] = { x: p.x, y: p.y };
      if (!nbr) return;
      if (Math.abs(old.y - nbr.y) < 0.6) nbr.y = p.y;
      else if (Math.abs(old.x - nbr.x) < 0.6) nbr.x = p.x;
    };
    snapEnd(w.refs[0], true);
    snapEnd(w.refs[1], false);
  }

/** 绑定了别的导线端点的导线，端点跟着走 */
  function syncWireBonds() {
    let touched = false;
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const w of st.items) {
        if (w.type !== 'wire' || !w.pts || !w.refs) continue;
        const fixEnd = (ref, atStart) => {
          if (!ref || ref.kind !== 'wire') return;
          if (ref.itemId === w.id) return;
          const p = refPos(ref);
          if (!p) return;
          const idx = atStart ? 0 : w.pts.length - 1;
          const cur = w.pts[idx];
          if (!cur) return;
          if (Math.abs(cur.x - p.x) > 0.01 || Math.abs(cur.y - p.y) > 0.01) {
            w.pts[idx] = { x: p.x, y: p.y };
            changed = true;
            touched = true;
          }
        };
        fixEnd(w.refs[0], true);
        fixEnd(w.refs[1], false);
      }
      if (!changed) break;
    }
    return touched;
  }

  function deleteSel() {
    if (!st.sel.size) return;
    snapshot();
    // 选中了导线的一段：只切掉这一段，剩下的拆成两条导线
    if (st.selSeg) {
      const w = st.items.find((i) => i.id === st.selSeg.id);
      if (w && w.type === 'wire' && w.pts && w.pts.length >= 3) {
        const i = st.selSeg.i;
        const left = w.pts.slice(0, i + 1);
        const right = w.pts.slice(i + 1);
        const keepWire = (pts) => ({
          id: uid(),
          type: 'wire',
          color: w.color || '#243029',
          width: w.width || 2,
          pts,
          refs: [null, null],
        });
        const next = [];
        for (const it of st.items) {
          if (it.id !== w.id) {
            next.push(it);
            continue;
          }
          if (left.length >= 2) next.push(keepWire(left));
          if (right.length >= 2) next.push(keepWire(right));
        }
        st.items = next;
        st.sel.clear();
        st.selSeg = null;
        render();
        toast('已删除这一小段');
        return;
      }
    }
    st.items = st.items.filter((i) => !st.sel.has(i.id));
    st.sel.clear();
    st.selSeg = null;
    syncWireBonds();
    render();
  }

  function duplicateSel() {
    const sel = selectedItems();
    if (!sel.length) return;
    snapshot();
    const newIds = [];
    for (const it of sel) {
      const copy = JSON.parse(JSON.stringify(it));
      copy.id = uid();
      if (copy.pts) copy.pts = copy.pts.map((p) => ({ x: p.x + 20, y: p.y + 20 }));
      else {
        copy.x += 20;
        copy.y += 20;
      }
      st.items.push(copy);
      newIds.push(copy.id);
    }
    st.sel = new Set(newIds);
    render();
  }

  function zoomBy(k, cx, cy) {
    const s = Math.min(4, Math.max(0.2, st.view.s * k));
    const r = svgEl.getBoundingClientRect();
    const z = pageZoom(svgEl);
    const mx = cx == null ? r.width / z / 2 : (cx - r.left) / z;
    const my = cy == null ? r.height / z / 2 : (cy - r.top) / z;
    const kk = s / st.view.s;
    st.view.tx = mx - (mx - st.view.tx) * kk;
    st.view.ty = my - (my - st.view.ty) * kk;
    st.view.s = s;
    render();
  }

  function resetView() {
    st.view = { s: 1, tx: 0, ty: 0 };
    render();
  }

  /* ---------------- 保存 ---------------- */
  function bounds() {
    if (!st.items.length) return { x: 0, y: 0, w: 400, h: 300 };
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const it of st.items) {
      const b = bboxOf(it);
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w);
      y2 = Math.max(y2, b.y + b.h);
    }
    const pad = 16;
    return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  }

  function buildSvg() {
    const b = bounds();
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + b.x + ' ' + b.y + ' ' + b.w + ' ' + b.h +
      '" width="' + Math.round(b.w) + '" height="' + Math.round(b.h) + '">');
    parts.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" fill="#fffdf8"/>');
    for (const it of st.items.slice().sort((a, b) => rank(a) - rank(b))) {
      if (it.type === 'stroke' || it.type === 'wire') parts.push(pathOf(it));
      else if (it.type === 'shape') parts.push(shapeHtml(it));
      else if (it.type === 'text') {
        parts.push('<text x="' + it.x + '" y="' + it.y + '" font-size="' + (it.size || 14) + '" fill="' + (it.color || '#243029') +
          '" font-family="PingFang SC, Microsoft YaHei, sans-serif">' + esc(it.text) + '</text>');
      } else if (it.type === 'symbol') {
        if (!window.SYMBOL_DEFS) parts.push('');
        parts.push('<use href="#' + it.symId + '" transform="translate(' + it.x + ',' + it.y + ') rotate(' + (it.rot || 0) + ') scale(' + (it.k || 1) + ')"/>');
      } else if (it.type === 'chip') parts.push(chipHtml(it));
    }
    parts.push('</svg>');
    return parts.join('');
  }

  async function save() {
    if (!st.items.length) return toast('还没有画东西', 'err');
    if (opts.onSave) {
      const svg = buildSvg();
      const data = { items: JSON.parse(JSON.stringify(st.items)), electro: st.electro };
      close();
      opts.onSave(svg, data);
      return;
    }
    const name = await askModal({ kind: 'input', title: '保存为笔记', placeholder: '给这张图起个名字', value: '手绘图' });
    if (!name) return;
    const svg = buildSvg();
    try {
      const draw = JSON.stringify({ items: st.items, electro: st.electro });
      await api('/api/items', { subjectId: st.subjectId, kind: 'point', name, content: '', svg, draw, tags: ['手绘'] });
      await refresh();
      render();
      toast('已保存为笔记');
      close();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  /* ---------------- 界面 ---------------- */
  function toolbarHtml() {
    const tools = [
      ['select', '选择'],
      ['pen', '画笔'],
      ['text', '文字'],
      ['shape', '图形'],
      ['symbol', '元件'],
      ['wire', '连线'],
      ['chip', '芯片'],
    ];
    return (
      '<div class="dw-top">' +
      '<div class="dw-row1">' +
      '<button class="btn sm ghost" data-act="close">✕</button><b>画图板</b>' +
      '<label class="dw-check dw-check-top"><input type="checkbox" id="dw-electro" /> 网格模式</label>' +
      '<button class="btn sm ghost" data-act="board-settings" title="画板设置">⚙</button>' +
      '<button class="btn sm primary dw-save" data-act="save">' + (opts.onSave ? '插入配图' : '保存') + '</button>' +
      '</div>' +
      '<div class="dw-row2">' +
      tools.map(([id, label]) => '<button class="dw-tool" data-tool="' + id + '">' + label + '</button>').join('') +
      '</div>' +
      '<div class="dw-row3">' +
      '<button class="btn sm" data-act="undo" title="撤销">↶</button>' +
      '<button class="btn sm" data-act="redo" title="重做">↷</button>' +
      '<button class="btn sm" data-act="zoom-out" title="缩小">−</button>' +
      '<button class="btn sm" data-act="zoom-in" title="放大">＋</button>' +
      '<button class="btn sm" data-act="reset" title="复位">复位</button>' +
      '<button class="btn sm ghost" data-act="rotate" title="整体旋转 90°">⟳</button>' +
      '<button class="btn sm ghost" data-act="scale-up" title="放大选区">放大</button>' +
      '<button class="btn sm ghost" data-act="scale-down" title="缩小选区">缩小</button>' +
      '<button class="btn sm ghost" data-act="dup" title="复制">⧉</button>' +
      '<button class="btn sm ghost" data-act="group" title="组合">组合</button>' +
      '<button class="btn sm ghost" data-act="ungroup" title="取消组合">拆开</button>' +
      '<button class="btn sm ghost" data-act="del" title="删除">🗑</button>' +
      '</div></div>'
    );
  }

  /** 方向按钮只在网格模式出现 */
  function syncDirbar() {
    const bar = root && root.querySelector('#dw-dirbar');
    if (!bar) return;
    bar.classList.toggle('show', st.tool === 'wire');
    bar.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('off', !st.electro));
  }

  function syncTools() {
    syncPenbar();
    syncDirbar();
    root.querySelectorAll('.dw-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
  }

  function open(subjectId, options) {
    opts = options || {};
    const savedBoard = (typeof S !== 'undefined' && S && S.settings && S.settings.boardSettings) || null;
    st.settings = { autoRewire: true, grid: true, snap: true, snapDrag: true, avoid: true, ...(savedBoard || {}) };
    st.open = true;
    const saved = opts.initial && Array.isArray(opts.initial.items) ? JSON.parse(JSON.stringify(opts.initial.items)) : null;
    st.subjectId = subjectId;
    st.items = saved || [];
    st.sel.clear();
    st.electro = !!(opts.initial && opts.initial.electro);
    st.tool = 'select';
    st.view = { s: 1, tx: 0, ty: 0 };
    st.history = [];
    st.future = [];

    root = document.createElement('div');
    root.className = 'drawer';
    root.innerHTML =
      toolbarHtml() +
      '<div class="dw-stage"><svg id="dw-svg" class="dw-svg"></svg>' +
      penbarHtml() +
      '<div class="dw-dirbar" id="dw-dirbar">' +
      '<button data-act="wire-done" class="dw-act" title="完成连线">完成</button>' +
      '<button data-act="wire-redo" class="dw-act" title="取消当前连线，重新连一条">重连</button>' +
      '<span class="dw-dirbar-sep"></span>' +
      [['auto', '自动'], ['up', '↑'], ['right', '→'], ['down', '↓'], ['left', '←']]
        .map(([d, label]) => '<button data-dir="' + d + '"' + (st.pipeDir === d ? ' class="on"' : '') + '>' + label + '</button>')
        .join('') +
      '</div></div>' +
      '<div class="dw-hint" id="dw-hint"></div>';
    document.body.appendChild(root);
    bindPenbar();

    svgEl = root.querySelector('#dw-svg');
    world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    world.setAttribute('id', 'dw-world');
    svgEl.appendChild(world);
    if (window.SYMBOL_DEFS) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      defs.innerHTML = window.SYMBOL_DEFS;
      svgEl.insertBefore(defs, world);
    }

    svgEl.addEventListener('pointerdown', onDown);
    svgEl.addEventListener('pointermove', onMove);
    svgEl.addEventListener('pointerup', onUp);
    svgEl.addEventListener('pointercancel', onUp);
    svgEl.addEventListener('dblclick', onDblClick);
    svgEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
    }, { passive: false });

    root.addEventListener('click', (e) => {
      const actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        const act = actBtn.dataset.act;
        if (act === 'wire-done') {
          finishWire();
          return;
        }
        if (act === 'wire-redo') {
          st.pending = null;
          st.hoverPin = null;
          st.tool = 'wire';
          render();
          syncTools();
          updateHint();
          toast('已取消，重新点起点');
          return;
        }
      }
      const dirBtn = e.target.closest('[data-dir]');
      if (dirBtn) {
        st.pipeDir = dirBtn.dataset.dir;
        root.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('on', b === dirBtn));
        if (st.pending && st.pending.type === 'wire' && st.pending.cursor) {
          const last = st.pending.pts[st.pending.pts.length - 1];
          st.pending.preview = routeAvoid(last, st.pending.cursor, Math.abs(st.pending.cursor.x - last.x) >= Math.abs(st.pending.cursor.y - last.y));
          st.pending.previewCache = null;
        }
        render();
        return;
      }
      const tool = e.target.closest('[data-tool]');
      if (tool) {
        const t = tool.dataset.tool;
        if (t === 'shape') {
          openShapes();
          return;
        }
        if (t === 'symbol') {
          openSymbols();
          return;
        }
        if (t === 'chip') {
          st.tool = 'chip';
          syncTools();
          updateHint();
          toast('在画布上拖出一个矩形');
          return;
        }
        if (t === 'text') {
          addText();
          return;
        }
        if (st.pending) finishWire();
        st.hoverPin = null;
        st.tool = t;
        syncTools();
        updateHint();
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'close') close();
      else if (act === 'undo') undo();
      else if (act === 'redo') redo();
      else if (act === 'zoom-in') zoomBy(1.2);
      else if (act === 'zoom-out') zoomBy(0.83);
      else if (act === 'reset') resetView();
      else if (act === 'rotate') rotateSel90();
      else if (act === 'scale-up') scaleSel(1.15);
      else if (act === 'scale-down') scaleSel(0.87);
      else if (act === 'group') groupSel();
      else if (act === 'ungroup') ungroupSel();
      else if (act === 'dup') duplicateSel();
      else if (act === 'del') deleteSel();
      else if (act === 'save') save();
      else if (act === 'board-settings') openBoardSettings();
    });

    const electroBox = root.querySelector('#dw-electro');
    if (electroBox) electroBox.checked = st.electro;
    syncDirbar();
    electroBox?.addEventListener('change', (e) => {
      st.electro = e.target.checked;
      syncDirbar();
      render();
      updateHint();
    });

    document.addEventListener('keydown', onKey);
    render();
    syncTools();
    updateHint();
  }

  function onKey(e) {
    if (!st.open) return;
    if (e.key === 'Escape') {
      if (st.pending) {
        st.pending = null;
        render();
      } else close();
    } else if (e.key === 'Enter' && st.pending?.type === 'wire') finishWire();
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
    else if (e.key === 'v') st.tool = 'select', syncTools();
    else if (e.key === 'p') st.tool = 'pen', syncTools();
    else if (e.key === 'w') st.tool = 'wire', syncTools();
  }

  function updateHint() {
    const hint = root.querySelector('#dw-hint');
    if (!hint) return;
    const map = {
      select: '点选/框选后拖动可移动，Delete 删除；双指拖动平移、捏合缩放',
      pen: st.electro ? '网格模式：画线自动变直线并对齐网格；双指可平移/缩放' : '按住拖动自由绘制；双指可平移/缩放',
      wire: st.electro
        ? '点起点 → 点终点（线会先显示出来）→ 点「完成」才结束；右侧按钮可改优先方向'
        : '点起点 → 点拐点 → 点「完成」或按 Enter 结束；自由坐标，仍为直角折线',
      text: '点击画布添加文字',
      chip: '在画布上拖出一个矩形，然后在边框上点一下加引脚（可改编号/名称）',
      shape: '按住拖动绘制图形（矩形 / 圆形 / 直线），左下角可改颜色粗细透明度',
    };
    hint.textContent = map[st.tool] || '选择工具：元件 / 连线 / 芯片';
  }

  function close() {
    st.open = false;
    document.removeEventListener('keydown', onKey);
    root?.remove();
    root = null;
    svgEl = null;
    world = null;
  }

  window.DrawEditor = { open, close };
})();
