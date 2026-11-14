/* 电子元器件符号库：AI 生成的 SVG 里可以用 <use href="#sym-xxx"> 直接引用。
   约定：两端器件引脚在 (-20,0) 和 (20,0)，图形必须刚好接到引脚上。
   三端器件与特殊器件见下方 SYMBOL_PINS。 */
(function (root) {
  const S = '#243029'; // 线条颜色
  const W = '1.6';
  const F = 'none';

  const p = (d, w) => `<path d="${d}" fill="${F}" stroke="${S}" stroke-width="${w || W}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const fs_ = (d) => `<path d="${d}" fill="${S}" stroke="${S}" stroke-width="1"/>`;

  const defs = [
    // ---------- 无源器件 ----------
    `<g id="sym-resistor">${p('M-20 0h5l5-7 5 14 5-14 5 14 5-14 5 7h5')}</g>`,
    `<g id="sym-resistor-h">${p('M-20 0h5l5-7 5 14 5-14 5 14 5-14 5 7h5')}</g>`,
    `<g id="sym-cap">${p('M-20 0h15M5 0h15')}${p('M-5-10v20M5-10v20', 2)}</g>`,
    `<g id="sym-cap-pol">${p('M-20 0h15M5 0h15')}${p('M-5-10v20', 2)}<path d="M5-10q11 10 0 20" fill="none" stroke="${S}" stroke-width="2"/><text x="-16" y="-6" font-size="9" fill="${S}">+</text></g>`,
    `<g id="sym-inductor">${p('M-20 0h8')}${p('M-12 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0h8')}</g>`,
    `<g id="sym-pot">${p('M-20 0h5l5-7 5 14 5-14 5 14 5-14 5 7h5')}${p('M0-18v9')}${fs_('M-4-11L0-5l4-6z')}</g>`,
    `<g id="sym-varistor">${p('M-20 0h11M9 0h11')}<rect x="-9" y="-7" width="18" height="14" rx="2" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M-6 5l4-10M-1 5l4-10')}</g>`,
    `<g id="sym-fuse">${p('M-20 0h11M9 0h11')}<rect x="-9" y="-6" width="18" height="12" rx="2" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M-9 0h18')}</g>`,
    `<g id="sym-thermistor">${p('M-20 0h11M9 0h11')}<rect x="-9" y="-6" width="18" height="12" rx="2" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M-7-6l14 12')}</g>`,
    `<g id="sym-lamp">${p('M-20 0h10M10 0h10')}<circle cx="0" cy="0" r="10" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M-7-7l14 14M7-7l-14 14')}</g>`,
    `<g id="sym-motor">${p('M-20 0h9M11 0h9')}<circle cx="0" cy="0" r="11" fill="none" stroke="${S}" stroke-width="${W}"/><text x="-4" y="4.5" font-size="12" fill="${S}">M</text></g>`,
    `<g id="sym-battery">${p('M-20 0h12M8 0h12')}${p('M-8-11v22', 2)}${p('M-4-6v12')}${p('M4-11v22', 2)}${p('M8-6v12')}</g>`,
    `<g id="sym-vsource">${p('M-20 0h10M10 0h10')}<circle cx="0" cy="0" r="10" fill="none" stroke="${S}" stroke-width="${W}"/><text x="-5" y="4" font-size="11" fill="${S}">+</text><text x="2" y="4" font-size="11" fill="${S}">−</text></g>`,
    `<g id="sym-isource">${p('M-20 0h10M10 0h10')}<circle cx="0" cy="0" r="10" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M-4 5L4-4')}${fs_('M4-4l-1 5 5-1z')}</g>`,
    `<g id="sym-switch">${p('M-20 0h12M8 0h12')}${fs_('M-8-2.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5')}${fs_('M8-2.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5')}${p('M-6 0l12-9')}</g>`,
    `<g id="sym-button">${p('M-20 0h12M8 0h12')}${fs_('M-8-2.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5')}${fs_('M8-2.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5')}<path d="M-7-4h14" stroke="${S}" stroke-width="2"/>${p('M0-4v-8')}${p('M-5-12h10')}</g>`,

    // ---------- 半导体 ----------
    `<g id="sym-diode">${p('M-20 0h10M10 0h10')}${fs_('M-10-9L10 0L-10 9Z')}<path d="M10-9v18" stroke="${S}" stroke-width="2"/></g>`,
    `<g id="sym-zener">${p('M-20 0h10M10 0h10')}${fs_('M-10-9L10 0L-10 9Z')}<path d="M10-9v18M10-9l-4 3M10 9l4-3" stroke="${S}" stroke-width="2" fill="none" stroke-linecap="round"/></g>`,
    `<g id="sym-led">${p('M-20 0h10M10 0h10')}${fs_('M-10-9L10 0L-10 9Z')}<path d="M10-9v18" stroke="${S}" stroke-width="2"/>${p('M-2-13l6-6M4-6l6-6')}${p('M-3-9l3-2M3-2l3-2')}</g>`,
    `<g id="sym-photodiode">${p('M-20 0h10M10 0h10')}${fs_('M-10-9L10 0L-10 9Z')}<path d="M10-9v18" stroke="${S}" stroke-width="2"/>${p('M-2-13l-6-6M4-13l-6-6')}</g>`,
    `<g id="sym-crystal">${p('M-20 0h10M10 0h10')}${p('M-10-10v20M10-10v20', 2)}<rect x="-4" y="-9" width="8" height="18" rx="1.5" fill="none" stroke="${S}" stroke-width="1.4"/></g>`,
    `<g id="sym-npn">${p('M-20 0h11')}${p('M-9-10v20', 2.4)}${p('M-9-4L20-16M-9 4L20 16')}${fs_('M14 12l-6-2 4-5z')}<circle cx="4" cy="0" r="14" fill="none" stroke="${S}" stroke-width="1" opacity=".3"/></g>`,
    `<g id="sym-pnp">${p('M-20 0h11')}${p('M-9-10v20', 2.4)}${p('M-9-4L20-16M-9 4L20 16')}${fs_('M-6 0l6-2-2-4z')}<circle cx="4" cy="0" r="14" fill="none" stroke="${S}" stroke-width="1" opacity=".3"/></g>`,
    `<g id="sym-nmos">${p('M-20 0h11')}${p('M-9-11v22', 2.4)}${p('M-4-12v24', 1.4)}${p('M-4-14H20M-4 14H20')}${p('M-4 0H6M6 0v-14', 1.4)}${fs_('M2 0l5-2-1 4z')}</g>`,
    `<g id="sym-opamp">${p('M-12-14L16 0L-12 14Z')}${p('M-20-8h8M-20 8h8M16 0h4')}<text x="-8" y="-4" font-size="11" fill="${S}">−</text><text x="-8" y="12" font-size="11" fill="${S}">+</text></g>`,
    `<g id="sym-optocoupler">${p('M-30-8h14M-30 8h14M16-8h14M16 8h14')}<rect x="-16" y="-12" width="32" height="24" rx="3" fill="#fffdf8" stroke="${S}" stroke-width="${W}"/><path d="M-10-4L-2 0L-10 4Z" fill="${S}" stroke="${S}"/><path d="M-10-6v12" stroke="${S}" stroke-width="1.8"/><path d="M2-6l8 6M2 6l8-6" stroke="${S}" stroke-width="1.4" fill="none"/><path d="M4-9v18" stroke="${S}" stroke-width="1.6"/></g>`,

    // ---------- 电源 / 地 / 仪表 ----------
    `<g id="sym-ground">${p('M0-12v6M-10-6h20M-7 0h14M-4 6h8')}</g>`,
    `<g id="sym-vcc">${p('M0 12v-6M-7 6h14')}<text x="-3" y="-2" font-size="9" fill="${S}">V</text></g>`,
    `<g id="sym-vdd">${p('M0 12v-8M-7 4h14')}<circle cx="0" cy="0" r="2.6" fill="${S}"/></g>`,
    `<g id="sym-ammeter">${p('M-20 0h10M10 0h10')}<circle cx="0" cy="0" r="10" fill="none" stroke="${S}" stroke-width="${W}"/><text x="-4" y="4" font-size="11" fill="${S}">A</text></g>`,
    `<g id="sym-voltmeter">${p('M-20 0h10M10 0h10')}<circle cx="0" cy="0" r="10" fill="none" stroke="${S}" stroke-width="${W}"/><text x="-4" y="4" font-size="11" fill="${S}">V</text></g>`,

    // ---------- 其它 ----------
    `<g id="sym-transformer">${p('M-20-10h14M-20 10h14M20-10h-14M20 10h-14')}${p('M-6-10a4 4 0 0 1 0 8a4 4 0 0 1 0 8')}${p('M6-10a4 4 0 0 0 0 8a4 4 0 0 0 0 8')}${p('M-1.5-11v22M1.5-11v22', 1.2)}</g>`,
    `<g id="sym-buzzer">${p('M-20 0h10M10 0h10')}<path d="M-10-8v16L8 0Z" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M12-7a10 10 0 0 1 0 14')}${p('M16-11a15 15 0 0 1 0 22', 1.2)}</g>`,
    `<g id="sym-speaker">${p('M-20 0h10M10 0h10')}<path d="M-10-7v14L6 0Z" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M10-7a11 11 0 0 1 0 14')}</g>`,
    `<g id="sym-antenna">${p('M0 12V0M0 0L-9-11M0 0L9-11')}${fs_('M-2.6 12a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0')}</g>`,
    `<g id="sym-connector">${p('M-20 0h8M12 0h8')}<rect x="-12" y="-8" width="24" height="16" rx="2" fill="none" stroke="${S}" stroke-width="${W}"/>${fs_('M-6-2.2a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4')}${fs_('M6-2.2a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4')}</g>`,
    `<g id="sym-switch-spdt">${p('M-20 0h12')}${fs_('M-8-2.4a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8')}${p('M-6 0L14-10M14-10h6M14 10h6')}${fs_('M14-12.4a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8')}${fs_('M14 7.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8')}</g>`,
    `<g id="sym-bridge">${p('M-30-10H-12M-30 10H-12M12-10H30M12 10H30')}<rect x="-12" y="-12" width="24" height="24" rx="2" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M-6-6l12 12M6-6L-6 6', 1.2)}<text x="14" y="-5" font-size="8" fill="${S}">+</text><text x="14" y="16" font-size="8" fill="${S}">−</text></g>`,

    // ---------- 数字门 ----------
    `<g id="sym-and">${p('M-12-12h8a12 12 0 0 1 0 24h-8Z')}${p('M-30-8h18M-30 8h18M12 0h8')}<text x="-6" y="4" font-size="9" fill="${S}">&amp;</text></g>`,
    `<g id="sym-or">${p('M-14-12h4a14 14 0 0 1 0 24h-4c5-4 7-8 7-12s-2-8-7-12Z')}${p('M-30-8h18M-30 8h18M11 0h9')}<text x="-8" y="4" font-size="9" fill="${S}">≥1</text></g>`,
    `<g id="sym-not">${p('M-12-12L12 0L-12 12Z')}<circle cx="15" cy="0" r="3" fill="none" stroke="${S}" stroke-width="${W}"/>${p('M-20 0h8M18 0h2')}</g>`,
  ];

  root.SYMBOL_DEFS = `<defs>${defs.join('')}</defs>`;

  root.SYMBOL_PINS = {
    'sym-resistor': [[-20, 0], [20, 0]],
    'sym-resistor-h': [[-20, 0], [20, 0]],
    'sym-cap': [[-20, 0], [20, 0]],
    'sym-cap-pol': [[-20, 0], [20, 0]],
    'sym-inductor': [[-20, 0], [20, 0]],
    'sym-pot': [[-20, 0], [20, 0]],
    'sym-varistor': [[-20, 0], [20, 0]],
    'sym-fuse': [[-20, 0], [20, 0]],
    'sym-thermistor': [[-20, 0], [20, 0]],
    'sym-lamp': [[-20, 0], [20, 0]],
    'sym-motor': [[-20, 0], [20, 0]],
    'sym-battery': [[-20, 0], [20, 0]],
    'sym-vsource': [[-20, 0], [20, 0]],
    'sym-isource': [[-20, 0], [20, 0]],
    'sym-switch': [[-20, 0], [20, 0]],
    'sym-button': [[-20, 0], [20, 0]],
    'sym-diode': [[-20, 0], [20, 0]],
    'sym-zener': [[-20, 0], [20, 0]],
    'sym-led': [[-20, 0], [20, 0]],
    'sym-photodiode': [[-20, 0], [20, 0]],
    'sym-crystal': [[-20, 0], [20, 0]],
    'sym-transformer': [[-20, -10], [-20, 10], [20, -10], [20, 10]],
    'sym-buzzer': [[-20, 0], [20, 0]],
    'sym-speaker': [[-20, 0], [20, 0]],
    'sym-antenna': [[0, 12]],
    'sym-connector': [[-20, 0], [20, 0]],
    'sym-switch-spdt': [[-20, 0], [20, -10], [20, 10]],
    'sym-bridge': [[-30, -10], [-30, 10], [30, -10], [30, 10]],
    'sym-and': [[-30, -8], [-30, 8], [20, 0]],
    'sym-or': [[-30, -8], [-30, 8], [20, 0]],
    'sym-not': [[-20, 0], [20, 0]],
    'sym-npn': [[-20, 0], [20, -16], [20, 16]],
    'sym-pnp': [[-20, 0], [20, -16], [20, 16]],
    'sym-nmos': [[-20, 0], [20, -14], [20, 14]],
    'sym-opamp': [[-20, -8], [-20, 8], [20, 0]],
    'sym-optocoupler': [[-30, -8], [-30, 8], [30, -8], [30, 8]],
    'sym-ground': [[0, -12]],
    'sym-vcc': [[0, 12]],
    'sym-vdd': [[0, 12]],
    'sym-ammeter': [[-20, 0], [20, 0]],
    'sym-voltmeter': [[-20, 0], [20, 0]],
  };

  root.SYMBOL_CATALOG = [
    ['sym-resistor', '电阻', '(-20,0) (20,0)'],
    ['sym-cap', '无极性电容', '(-20,0) (20,0)'],
    ['sym-cap-pol', '电解电容', '(-20,0) (20,0)'],
    ['sym-inductor', '电感', '(-20,0) (20,0)'],
    ['sym-pot', '电位器', '(-20,0) (20,0)'],
    ['sym-varistor', '压敏电阻', '(-20,0) (20,0)'],
    ['sym-thermistor', '热敏电阻', '(-20,0) (20,0)'],
    ['sym-fuse', '保险丝', '(-20,0) (20,0)'],
    ['sym-lamp', '灯泡', '(-20,0) (20,0)'],
    ['sym-motor', '电机', '(-20,0) (20,0)'],
    ['sym-battery', '电池', '(-20,0) (20,0)'],
    ['sym-vsource', '电压源', '(-20,0) (20,0)'],
    ['sym-isource', '电流源', '(-20,0) (20,0)'],
    ['sym-switch', '开关', '(-20,0) (20,0)'],
    ['sym-button', '按钮', '(-20,0) (20,0)'],
    ['sym-switch-spdt', '单刀双掷', '公共 (-20,0)，常开 (20,-10)，常闭 (20,10)'],
    ['sym-diode', '二极管', '(-20,0) (20,0)'],
    ['sym-zener', '稳压二极管', '(-20,0) (20,0)'],
    ['sym-led', '发光二极管', '(-20,0) (20,0)'],
    ['sym-photodiode', '光电二极管', '(-20,0) (20,0)'],
    ['sym-crystal', '晶振', '(-20,0) (20,0)'],
    ['sym-transformer', '变压器', '原边 (-20,-10)(-20,10)，副边 (20,-10)(20,10)'],
    ['sym-buzzer', '蜂鸣器', '(-20,0) (20,0)'],
    ['sym-speaker', '喇叭', '(-20,0) (20,0)'],
    ['sym-antenna', '天线', '(0,12)'],
    ['sym-connector', '排针', '(-20,0) (20,0)'],
    ['sym-bridge', '整流桥', '(-30,-10)(-30,10)(30,-10)(30,10)'],
    ['sym-and', '与门', '(-30,-8) (-30,8) 输出 (20,0)'],
    ['sym-or', '或门', '(-30,-8) (-30,8) 输出 (20,0)'],
    ['sym-not', '非门', '输入 (-20,0) 输出 (20,0)'],
    ['sym-npn', 'NPN 三极管', '基极 (-20,0)，集电极 (20,-16)，发射极 (20,16)'],
    ['sym-pnp', 'PNP 三极管', '同上'],
    ['sym-nmos', 'N 沟道 MOS', '栅极 (-20,0)，漏极 (20,-14)，源极 (20,14)'],
    ['sym-opamp', '运算放大器', '反相 (-20,-8)，同相 (-20,8)，输出 (20,0)'],
    ['sym-optocoupler', '光耦', '左 (-30,-8)(-30,8)，右 (30,-8)(30,8)'],
    ['sym-ground', '接地', '(0,-12)'],
    ['sym-vcc', '电源正', '(0,12)'],
    ['sym-vdd', 'VDD', '(0,12)'],
    ['sym-ammeter', '电流表', '(-20,0) (20,0)'],
    ['sym-voltmeter', '电压表', '(-20,0) (20,0)'],
  ];

  /* ---------------- 导线端点吸附 ---------------- */

  function collectPins(svg) {
    const pins = [];
    const re = /<use\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(svg))) {
      const attrs = m[1] || '';
      const idm = attrs.match(/(?:xlink:)?href\s*=\s*["']#([\w-]+)["']/);
      if (!idm) continue;
      const pinsOf = root.SYMBOL_PINS[idm[1]];
      if (!pinsOf) continue;

      let tx = 0;
      let ty = 0;
      let scale = 1;
      const tm = attrs.match(/transform\s*=\s*["']([^"']*)["']/);
      if (tm) {
        const spec = tm[1];
        const tr = spec.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/);
        if (tr) {
          tx += parseFloat(tr[1]);
          ty += parseFloat(tr[2]);
        }
        const sc = spec.match(/scale\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/);
        if (sc) scale *= parseFloat(sc[1]);
      }
      const xa = attrs.match(/\bx\s*=\s*["'](-?[\d.]+)["']/);
      const ya = attrs.match(/\by\s*=\s*["'](-?[\d.]+)["']/);
      if (xa) tx += parseFloat(xa[1]);
      if (ya) ty += parseFloat(ya[1]);

      for (const [px, py] of pinsOf) pins.push([tx + px * scale, ty + py * scale]);
    }
    return pins;
  }

  function nearest(pins, x, y, tol) {
    let best = null;
    let bestD = tol;
    for (const [px, py] of pins) {
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        bestD = d;
        best = [px, py];
      }
    }
    return best;
  }

  root.snapSvg = function snapSvg(svg) {
    const s = String(svg || '');
    if (!s.includes('<use')) return s;
    const pins = collectPins(s);
    if (!pins.length) return s;
    const TOL = 12;
    const fmt = (n) => (Math.round(n * 10) / 10).toString();

    let out = s.replace(/<line\b([^>]*?)(\/?)>/g, (all, attrs, selfClose) => {
      let a = attrs;
      const get = (k) => {
        const m = a.match(new RegExp('\\b' + k + '\\s*=\\s*["\'](-?[\\d.]+)["\']'));
        return m ? parseFloat(m[1]) : null;
      };
      const set = (k, v) => {
        a = a.replace(new RegExp('(\\b' + k + '\\s*=\\s*["\'])-?[\\d.]+(["\'])'), '$1' + fmt(v) + '$2');
      };
      const x1 = get('x1');
      const y1 = get('y1');
      const x2 = get('x2');
      const y2 = get('y2');
      if (x1 == null || y1 == null || x2 == null || y2 == null) return all;
      const p1 = nearest(pins, x1, y1, TOL);
      const p2 = nearest(pins, x2, y2, TOL);
      if (p1) {
        set('x1', p1[0]);
        set('y1', p1[1]);
      }
      if (p2) {
        set('x2', p2[0]);
        set('y2', p2[1]);
      }
      return '<line' + a + selfClose + '>';
    });

    out = out.replace(/(<path\b[^>]*?\bd\s*=\s*")([^"]*)(")/g, (all, pre, d, post) => {
      const parts = d.split(/(?=[MLmlHhVvCcSsQqTtAaZz])/).filter(Boolean);
      const fixed = parts.map((seg) => {
        const cmd = seg[0];
        if (cmd !== 'M' && cmd !== 'L') return seg;
        const nums = (seg.slice(1).match(/-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
        if (!nums.length || nums.some((n) => !Number.isFinite(n))) return seg;
        const outNums = [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const p = nearest(pins, nums[i], nums[i + 1], TOL);
          outNums.push(p ? p[0] : nums[i], p ? p[1] : nums[i + 1]);
        }
        return cmd + outNums.map(fmt).join(' ');
      });
      return pre + fixed.join('') + post;
    });

    return out;
  };
})(typeof window !== 'undefined' ? window : module.exports);
