/*
 * drawing.js — レンズの三面図（第三角法）と断面図を、JIS の製図の決まりに沿って SVG で描く
 *
 * lens.js の build() の結果から、正面図・平面図・右側面図と、光学中心を通る水平断面（A-A）・
 * 垂直断面（B-B）を A3 横の図面に描き、寸法・寸法表・注記・表題欄を入れる。
 * SVG の 1 単位 = 用紙の 1 mm。形は尺度（2:1 など）を掛けて描き、寸法数値は実寸で書く。
 *
 * 従っている主な決まり（詳しくは docs/standards.md）
 *   用紙と様式      JIS Z 8311：A3 横、輪郭線は用紙の縁から 10 mm、中心マーク、表題欄は右下
 *   尺度            JIS Z 8314：推奨尺度（5:1、2:1、1:1）から、図が収まるいちばん大きいもの
 *   投影法          JIS B 0001・JIS Z 8316：第三角法。表題欄に投影法の記号
 *   線              JIS B 0001・JIS Z 8312：細線と太線の太さの比 1:2（0.25 mm・0.5 mm）。
 *                   外形線は太い実線、寸法線・寸法補助線・引出線・ハッチングは細い実線、
 *                   中心線は細い一点鎖線、切断線は細い一点鎖線で端部を太くし、矢印で見る向きを示す
 *   文字            JIS Z 8313・JIS B 0001：文字の高さ 2.5・3.5・5・7 mm（漢字は 3.5 mm 以上）
 *   寸法            JIS Z 8317・JIS B 0001：単位 mm で単位記号は書かない。寸法線の上に書き、
 *                   縦の寸法は図面の右側から読めるように書く。端末記号は塗りつぶした矢印
 * MIT License
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Drawing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHEET = { W: 420, H: 297, frame: 10 };            // A3 横、輪郭線の位置
  const LW = { thin: 0.25, thick: 0.5, border: 0.7 };     // 線の太さ（mm）
  const TH = { num: 3.5, txt: 3.5, sec: 5, title: 7, small: 2.5 };  // 文字の高さ（mm）
  const SCALES = [5, 2, 1];                               // 推奨尺度（倍尺・現尺）
  const TITLE = { w: 180, h: 50 };                        // 表題欄の大きさ
  const CHAIN = '10 2.5 1.2 2.5';                         // 一点鎖線（長い線・すき間・短い線・すき間）
  const ARROW = { len: 3, half: 0.8 };                    // 矢印（長さ 3 mm、開き角 約 30°）

  const f2 = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
  const f1 = v => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n3 = v => (Math.round(v * 1000) / 1000).toString();

  // ---- 描画の部品（座標は用紙の mm） ----------------------------------------------
  function line(x1, y1, x2, y2, cls, w, dash) {
    return `<line class="${cls}" x1="${n3(x1)}" y1="${n3(y1)}" x2="${n3(x2)}" y2="${n3(y2)}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  }
  function poly(pts, cls, w, close, extra) {
    if (pts.length < 2) return '';
    return `<${close ? 'polygon' : 'polyline'} class="${cls}" points="${pts.map(p => n3(p[0]) + ',' + n3(p[1])).join(' ')}" stroke-width="${w}"${extra || ''}/>`;
  }
  function text(x, y, s, o) {
    o = o || {};
    const rot = o.rot ? ` transform="rotate(${o.rot} ${n3(x)} ${n3(y)})"` : '';
    return `<text class="tx${o.cls ? ' ' + o.cls : ''}" x="${n3(x)}" y="${n3(y)}" font-size="${o.size || TH.txt}" text-anchor="${o.anchor || 'middle'}"${o.bold ? ' font-weight="700"' : ''}${rot}>${esc(s)}</text>`;
  }
  /** 塗りつぶした矢印。先端 (x, y)、向き (dx, dy) */
  function arrow(x, y, dx, dy) {
    const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const bx = x - ux * ARROW.len, by = y - uy * ARROW.len;
    return `<path class="ah" d="M${n3(x)},${n3(y)} L${n3(bx - uy * ARROW.half)},${n3(by + ux * ARROW.half)} L${n3(bx + uy * ARROW.half)},${n3(by - ux * ARROW.half)} z"/>`;
  }

  /**
   * 水平方向の寸法。点 a・b（用紙の座標）の x の差を、高さ yd の寸法線で示す。
   * 間が狭いときは矢印を外側から当てる。
   */
  function hdim(a, b, yd, value) {
    const [p, q] = a[0] <= b[0] ? [a, b] : [b, a];
    const out = [];
    for (const r of [p, q]) {
      const s = Math.sign(yd - r[1]) || 1;
      out.push(line(r[0], r[1] + s * 1, r[0], yd + s * 2, 'dm', LW.thin));
    }
    const len = q[0] - p[0];
    if (len >= 8) {
      out.push(line(p[0], yd, q[0], yd, 'dm', LW.thin), arrow(p[0], yd, -1, 0), arrow(q[0], yd, 1, 0));
    } else {
      out.push(line(p[0] - 6, yd, q[0] + 6, yd, 'dm', LW.thin), arrow(p[0], yd, 1, 0), arrow(q[0], yd, -1, 0));
    }
    out.push(text((p[0] + q[0]) / 2, yd - 1, value, { size: TH.num }));
    return out.join('');
  }

  /** 垂直方向の寸法。数値は寸法線の左に、図面の右側から読める向きで書く */
  function vdim(a, b, xd, value) {
    const [p, q] = a[1] <= b[1] ? [a, b] : [b, a];
    const out = [];
    for (const r of [p, q]) {
      const s = Math.sign(xd - r[0]) || 1;
      out.push(line(r[0] + s * 1, r[1], xd + s * 2, r[1], 'dm', LW.thin));
    }
    const len = q[1] - p[1];
    if (len >= 8) {
      out.push(line(xd, p[1], xd, q[1], 'dm', LW.thin), arrow(xd, p[1], 0, -1), arrow(xd, q[1], 0, 1));
    } else {
      out.push(line(xd, p[1] - 6, xd, q[1] + 6, 'dm', LW.thin), arrow(xd, p[1], 0, 1), arrow(xd, q[1], 0, -1));
    }
    out.push(text(xd - 1, (p[1] + q[1]) / 2, value, { size: TH.num, rot: -90 }));
    return out.join('');
  }

  /** 引出線（先端は矢印で外形線に当てる）と、水平の線の上の文字 */
  function leader(tip, elbow, value, toRight) {
    const w = value.length * TH.num * 0.62 + 2;
    const end = [elbow[0] + (toRight ? w : -w), elbow[1]];
    const dx = tip[0] - elbow[0], dy = tip[1] - elbow[1];
    return line(elbow[0], elbow[1], tip[0], tip[1], 'dm', LW.thin) + arrow(tip[0], tip[1], dx, dy) +
      line(elbow[0], elbow[1], end[0], end[1], 'dm', LW.thin) +
      text((elbow[0] + end[0]) / 2, elbow[1] - 1, value, { size: TH.num });
  }

  /** 切断線の端：太い短い線と、見る向きの矢印・記号 */
  function cutEnd(x, y, along, look, label) {
    const [ax, ay] = along, [lx, ly] = look;
    const tx0 = x - ax * 5, ty0 = y - ay * 5;
    const mid = [x - ax * 2.5, y - ay * 2.5];
    const tail = [mid[0] - lx * 7, mid[1] - ly * 7];
    return line(tx0, ty0, x, y, 'cpt', LW.thick) +
      line(tail[0], tail[1], mid[0], mid[1], 'dm', LW.thin) + arrow(mid[0], mid[1], lx, ly) +
      text(tail[0] - lx * 2.5, tail[1] - ly * 2.5 + 1.75, label, { size: TH.sec });
  }

  /** 穴あけの形（正面図）。g は lens.js placeDrills() の 1 件、F はレンズの座標を用紙へ移す関数 */
  function drillOutline(g, steps) {
    const r = g.dia / 2, pts = [];
    if (g.type === 2 && g.x2 !== undefined) {
      // 四角の切り欠き：始点と終点が対角。角は径の半分の丸み
      const xa = Math.min(g.x, g.x2), xb = Math.max(g.x, g.x2), ya = Math.min(g.y, g.y2), yb = Math.max(g.y, g.y2);
      const corners = [[xb, yb, 0], [xa, yb, 90], [xa, ya, 180], [xb, ya, 270]];
      for (const [cx, cy, a0] of corners) for (let k = 0; k <= steps / 4; k++) {
        const a = ((a0 + (90 * k) / (steps / 4)) * Math.PI) / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return pts;
    }
    const x2 = g.x2 === undefined ? g.x : g.x2, y2 = g.y2 === undefined ? g.y : g.y2;
    const dir = Math.atan2(y2 - g.y, x2 - g.x);
    // 長穴は両端の半円をつなぐ。丸穴は始点と終点が同じ長穴
    for (let k = 0; k <= steps / 2; k++) { const a = dir + Math.PI / 2 + (Math.PI * k) / (steps / 2); pts.push([g.x + r * Math.cos(a), g.y + r * Math.sin(a)]); }
    for (let k = 0; k <= steps / 2; k++) { const a = dir - Math.PI / 2 + (Math.PI * k) / (steps / 2); pts.push([x2 + r * Math.cos(a), y2 + r * Math.sin(a)]); }
    return pts;
  }
  function drillShape(g, F, s) {
    const o = [poly(drillOutline(g, 48).map(F), 'ol', LW.thick, true, ' fill="none"')];
    if (g.type !== 2) {
      for (const [x, y] of g.x2 === undefined ? [[g.x, g.y]] : [[g.x, g.y], [g.x2, g.y2]]) {
        const c = F([x, y]), h = (s * g.dia) / 2 + 2;
        o.push(line(c[0] - h, c[1], c[0] + h, c[1], 'cl', LW.thin, '3 1 0.6 1'), line(c[0], c[1] - h, c[0], c[1] + h, 'cl', LW.thin, '3 1 0.6 1'));
      }
    }
    return o.join('');
  }

  // ---- 形の計算（レンズの座標、mm） --------------------------------------------------
  /**
   * 面と縁の形を細かく打った点の集まり（外形線を作るのに使う）。[x, y, z] の配列。
   * 表示用の網は粗いので、外形線はこちらから作る。
   */
  function cloud(m) {
    const pts = [], rings = 60, bevel = m.params.vShape;
    const N = m.edge.length;
    m.edge.forEach((e, i) => {
      const r = bevel ? e.re : e.R;
      for (let k = 0; k <= rings; k++) {
        const x = (r * k / rings) * e.ca, y = (r * k / rings) * e.sa;
        pts.push([x, y, m.zFront(x, y)], [x, y, m.zBack(x, y)]);
      }
      // 縁は外形線を決めるので、隣の角度との間も補って細かくする
      const nx = m.edge[(i + 1) % N], p0 = m.profile(e), p1 = m.profile(nx);
      for (let s = 0; s < 6; s++) {
        const t = s / 6;
        p0.forEach(([r0, z0], j) => {
          const [r1, z1] = p1[j];
          const x = r0 * e.ca * (1 - t) + r1 * nx.ca * t, y = r0 * e.sa * (1 - t) + r1 * nx.sa * t;
          pts.push([x, y, z0 * (1 - t) + z1 * t]);
        });
      }
    });
    return pts;
  }

  /** 点を軸 k（0 = x、1 = y）で区切り、区間ごとの z の最大・最小から外形線を作る */
  function silhouette(pts, k, bins) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; }
    const mx = new Float64Array(bins + 1).fill(-Infinity), mn = new Float64Array(bins + 1).fill(Infinity);
    const span = hi - lo || 1;
    for (const p of pts) {
      const b = Math.round(((p[k] - lo) / span) * bins), z = p[2];
      if (z > mx[b]) mx[b] = z; if (z < mn[b]) mn[b] = z;
    }
    const top = [], bottom = [];
    for (let b = 0; b <= bins; b++) {
      if (mx[b] === -Infinity) continue;
      const c = lo + (b / bins) * span;
      top.push([c, mx[b]]); bottom.push([c, mn[b]]);
    }
    return top.concat(bottom.reverse());
  }

  /** 直線（点 o から向き d）と閉じた輪郭の交点の、線上の位置 t の最小・最大 */
  function cutRange(poly, o, d) {
    let t0 = Infinity, t1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ex = q[0] - p[0], ey = q[1] - p[1], den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = p[0] - o[0], wy = p[1] - o[1];
      const t = (wx * ey - wy * ex) / den, u = (wx * d[1] - wy * d[0]) / den;
      if (u >= 0 && u <= 1) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
    }
    return [t0, t1];
  }

  /**
   * 光学中心を通る断面。axis = 'x'（水平、A-A）または 'y'（垂直、B-B）。
   * 返す点は [線上の位置, z]。縁の端は、断面の向きに最も近い角度の縁の形で近似する。
   */
  function section(m, axis) {
    const o = [m.ocX, m.ocY], d = axis === 'x' ? [1, 0] : [0, 1];
    const lensR = m.edge.map(e => [(m.params.vShape ? e.re : e.R) * e.ca, (m.params.vShape ? e.re : e.R) * e.sa]);
    const [t0, t1] = cutRange(lensR, o, d);
    const N = 160, front = [], back = [], at = t => [o[0] + d[0] * t, o[1] + d[1] * t];
    for (let i = 0; i <= N; i++) {
      const t = t0 + ((t1 - t0) * i) / N, [x, y] = at(t);
      front.push([t, m.zFront(x, y)]); back.push([t, m.zBack(x, y)]);
    }
    const endProfile = (t, dir) => {
      const [x, y] = at(t), a = Math.atan2(y, x), n = m.edge.length;
      const e = m.edge[((Math.round((a / (2 * Math.PI)) * n) % n) + n) % n];
      const base = m.params.vShape ? e.re : e.R;
      return m.profile(e).map(([r, z]) => [t + dir * (r - base), z]);
    };
    const right = endProfile(t1, 1), left = endProfile(t0, -1).reverse();
    const poly = front.slice(1, -1).concat(right, back.slice(1, -1).reverse(), left);
    return {
      poly, t0, t1,
      edge0: front[0][1] - back[0][1], edge1: front[N][1] - back[N][1],
      z0: [front[0][1], back[0][1]], z1: [front[N][1], back[N][1]],
    };
  }

  // ---- 配置 -----------------------------------------------------------------------
  /** 尺度と各図の位置を決める。収まらなければ小さい尺度にする（1:1 でも収まらなければ 1:1 のまま） */
  function layout(ext) {
    const { bw, bh, D } = ext;
    let L;
    for (const s of SCALES) {
      L = { s };
      L.left = SHEET.frame + 40;                         // 縦の寸法と切断線の記号の場所
      L.topTop = SHEET.frame + 18;
      L.frontTop = L.topTop + s * D + 34;
      L.sideLeft = L.left + s * bw + 40;
      L.bbLeft = L.sideLeft + s * D + 30;
      L.secTop = L.frontTop + s * bh + 40;
      L.tableX = L.bbLeft + s * D + 18;
      L.tableW = SHEET.W - SHEET.frame - 4 - L.tableX;
      const bottom = L.secTop + s * D + 14;
      const fitsTable = L.tableW >= 118;
      const fitsBottom = bottom <= SHEET.H - SHEET.frame - 4 && L.left + s * bw + 14 <= SHEET.W - SHEET.frame - TITLE.w - 4;
      if (fitsTable && fitsBottom) return L;
    }
    L.tableW = Math.max(L.tableW, 100);
    return L;
  }

  // ---- 図面 -----------------------------------------------------------------------
  /**
   * 三面図と断面図の SVG を作る。
   * @param m     lens.js build() の結果
   * @param info  {
   *   eye: 'R'|'L', title: string（図名）, number?: string（図番）, material?: string, date?: string,
   *   rows?: [[項目, 値, 備考]]（寸法表に足す行）, notes?: string[]（注記に足す行）
   * }
   */
  function threeView(m, info) {
    const E = m.edge, N = E.length, eye = info.eye === 'L' ? 'L' : 'R';
    const outer = E.map(e => [e.R * e.ca, e.R * e.sa]);
    const inner = E.map(e => [e.re * e.ca, e.re * e.sa]);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of outer) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    // 平面図・側面図・断面はフレーム基準（縁の面を立てた向き）で描く。正面図は縁の面に投影したものなので、玉形の座標のまま
    const toF = m.toFrame || (p => p);
    const pc = cloud(m).map(toF);
    let zmin = Infinity, zmax = -Infinity;
    for (const p of pc) { if (p[2] < zmin) zmin = p[2]; if (p[2] > zmax) zmax = p[2]; }
    const D = zmax - zmin;
    const L = layout({ bw: bx1 - bx0, bh: by1 - by0, D });
    const s = L.s;

    const F = ([x, y]) => [L.left + s * (x - bx0), L.frontTop + s * (by1 - y)];   // 正面図
    const T = ([x, z]) => [L.left + s * (x - bx0), L.topTop + s * (z - zmin)];     // 平面図（前面が下）
    const S = ([y, z]) => [L.sideLeft + s * (zmax - z), L.frontTop + s * (by1 - y)]; // 右側面図（前面が左）
    const A = ([x, z]) => [L.left + s * (x - bx0), L.secTop + s * (z - zmin)];     // 断面 A-A（上から見る）
    const B = ([y, z]) => [L.bbLeft + s * (zmax - z), L.frontTop + s * (by1 - y)];  // 断面 B-B（右から見る）

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.W} ${SHEET.H}" width="${SHEET.W}mm" height="${SHEET.H}mm" class="drawing" font-family="'BIZ UDPGothic', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif">`);
    out.push(`<defs><pattern id="hatch" width="1.5" height="1.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="ht" x1="0" y1="0" x2="0" y2="1.5" stroke-width="${LW.thin}"/></pattern></defs>`);
    out.push(`<rect class="paper" x="0" y="0" width="${SHEET.W}" height="${SHEET.H}"/>`);

    // ---- 輪郭線と中心マーク（JIS Z 8311） ----
    const fr = SHEET.frame;
    out.push(`<rect class="bd" x="${fr}" y="${fr}" width="${SHEET.W - 2 * fr}" height="${SHEET.H - 2 * fr}" fill="none" stroke-width="${LW.border}"/>`);
    out.push(line(SHEET.W / 2, 0, SHEET.W / 2, fr + 5, 'bd', LW.border), line(SHEET.W / 2, SHEET.H - fr - 5, SHEET.W / 2, SHEET.H, 'bd', LW.border));
    out.push(line(0, SHEET.H / 2, fr + 5, SHEET.H / 2, 'bd', LW.border), line(SHEET.W - fr - 5, SHEET.H / 2, SHEET.W, SHEET.H / 2, 'bd', LW.border));

    // ---- 正面図 ----
    const ext = 3;   // 中心線を外形線から出す長さ（用紙の mm）
    out.push(line(F([bx0, 0])[0] - ext, F([0, 0])[1], F([bx1, 0])[0] + ext, F([0, 0])[1], 'cl', LW.thin, CHAIN));
    out.push(line(F([0, by0])[0], F([0, by0])[1] + ext, F([0, by1])[0], F([0, by1])[1] - ext, 'cl', LW.thin, CHAIN));
    out.push(poly(outer.map(F), 'ol', LW.thick, true, ' fill="none"'));
    if (m.params.vShape) out.push(poly(inner.map(F), 'th', LW.thin, true, ' fill="none"'));
    // 穴・長穴・切り欠き（DCS の DRILLE）。穴には中心線を引く
    for (const g of m.drills || []) out.push(drillShape(g, F, s));
    // 切断線（光学中心を通る）
    const ocP = F([m.ocX, m.ocY]);
    const ax0 = F([bx0, 0])[0] - 8, ax1 = F([bx1, 0])[0] + 8, by0p = F([0, by0])[1] + 8, by1p = F([0, by1])[1] - 8;
    out.push(line(ax0, ocP[1], ax1, ocP[1], 'cp', LW.thin, CHAIN), cutEnd(ax0, ocP[1], [-1, 0], [0, 1], 'A'), cutEnd(ax1, ocP[1], [1, 0], [0, 1], 'A'));
    out.push(line(ocP[0], by1p, ocP[0], by0p, 'cp', LW.thin, CHAIN), cutEnd(ocP[0], by1p, [0, -1], [-1, 0], 'B'), cutEnd(ocP[0], by0p, [0, 1], [-1, 0], 'B'));
    // 光学中心（心取り点）の印
    out.push(`<circle class="th" cx="${n3(ocP[0])}" cy="${n3(ocP[1])}" r="1.5" fill="none" stroke-width="${LW.thin}"/>`);
    // 寸法：玉形幅 a・玉形高さ b（ボクシング方式、JIS B 7281）、心取り点の位置
    out.push(hdim(F([bx0, by0]), F([bx1, by0]), F([0, by0])[1] + 16, f2(bx1 - bx0)));
    out.push(vdim(F([bx0, by0]), F([bx0, by1]), F([bx0, 0])[0] - 12, f2(by1 - by0)));
    out.push(vdim(F([bx1, by0]), F([m.ocX, m.ocY]), F([bx1, 0])[0] + 16, f1(m.ocY - by0)));
    if (Math.abs(m.ocX) > 0.05) out.push(hdim(F([0, m.ocY]), F([m.ocX, m.ocY]), F([0, m.ocY])[1] + 9, f2(Math.abs(m.ocX))));
    // 最厚・最薄の縁（引出線）
    for (const [e, label] of [[m.thk, '最厚'], [m.thn, '最薄']]) {
      const tip = F([e.R * e.ca, e.R * e.sa]);
      // 切断線とその記号に重ならないよう、光学中心から離れる斜めの向きへ引き出す
      const dirx = tip[0] >= ocP[0] ? 1 : -1, diry = tip[1] >= ocP[1] ? 1 : -1;
      const elbow = [tip[0] + dirx * 14, tip[1] + diry * 14];
      out.push(leader(tip, elbow, `${label} ${f2(e.t)}`, dirx > 0));
    }

    // ---- 平面図 ----
    out.push(poly(silhouette(pc, 0, 240).map(T), 'ol', LW.thick, true, ' fill="none"'));
    const range = (from, to) => { const r = []; for (let i = from; i <= to; i++) r.push(E[((i % N) + N) % N]); return r; };
    const up = range(0, N / 2), rightSide = range(-N / 4, N / 4);
    // 縁の点（半径 r・高さ z）をフレーム基準に回し、図の軸 k（0 = 平面図の x、1 = 側面図の y）と z に投影する
    const at = (e, r, z, k) => { const p = toF([r * e.ca, r * e.sa, z]); return [p[k], p[2]]; };
    const edgeLines = (list, P, k) => {
      const line2 = (r, z) => poly(list.map(e => P(at(e, r(e), z(e), k))), 'th', LW.thin, false, ' fill="none"');
      const r = [line2(e => e.re, e => e.zf), line2(e => e.re, e => e.zb)];
      if (m.params.vShape) r.push(line2(e => e.R, e => e.zApex));
      if (m.params.edge === 'groove') {
        r.push(line2(e => e.R, e => e.zGroove + e.grooveW / 2));
        r.push(line2(e => e.R, e => e.zGroove - e.grooveW / 2));
      }
      return r.join('');
    };
    out.push(edgeLines(up, T, 0));
    out.push(line(T([0, zmax])[0], T([0, zmax])[1] + ext, T([0, zmin])[0], T([0, zmin])[1] - ext, 'cl', LW.thin, CHAIN));
    const eL = E[Math.round(N / 2)], eR = E[0];
    out.push(vdim(T(at(eL, eL.re, eL.zf, 0)), T(at(eL, eL.re, eL.zb, 0)), T([bx0, 0])[0] - 8, f2(eL.t)));
    out.push(vdim(T(at(eR, eR.re, eR.zf, 0)), T(at(eR, eR.re, eR.zb, 0)), T([bx1, 0])[0] + 10, f2(eR.t)));

    // ---- 右側面図 ----
    out.push(poly(silhouette(pc, 1, 240).map(S), 'ol', LW.thick, true, ' fill="none"'));
    out.push(edgeLines(rightSide, S, 1));
    out.push(line(S([0, zmax])[0] - ext, S([0, 0])[1], S([0, zmin])[0] + ext, S([0, 0])[1], 'cl', LW.thin, CHAIN));
    const eT = E[Math.round(N / 4)], eB = E[Math.round((3 * N) / 4)];
    out.push(hdim(S(at(eT, eT.re, eT.zf, 1)), S(at(eT, eT.re, eT.zb, 1)), F([0, by1])[1] - 8, f2(eT.t)));
    out.push(hdim(S(at(eB, eB.re, eB.zf, 1)), S(at(eB, eB.re, eB.zb, 1)), F([0, by0])[1] + 10, f2(eB.t)));

    // ---- 断面 A-A ----
    const sa = section(m, 'x');
    out.push(text(A([m.ocX, 0])[0], L.secTop - 6, 'A-A', { size: TH.sec }));
    // 断面の点（線上の位置 t・z）を 3D に戻してフレーム基準に回し、A-A は x と z、B-B は y と z に投影する
    const secA = (t, z) => { const p = toF([m.ocX + t, m.ocY, z]); return [p[0], p[2]]; };
    const secB = (t, z) => { const p = toF([m.ocX, m.ocY + t, z]); return [p[1], p[2]]; };
    out.push(poly(sa.poly.map(p => A(secA(p[0], p[1]))), 'sec', LW.thick, true));
    const ct0 = A(secA(0, m.zFront(m.ocX, m.ocY))), ct1 = A(secA(0, m.zBack(m.ocX, m.ocY)));
    out.push(line(ct0[0], ct1[1] - 3, ct0[0], ct0[1] + 3, 'cl', LW.thin, CHAIN));
    // 中心厚：寸法線は中心線の上に置き、矢印を外側から当てる。数値は断面の下に書く
    out.push(line(ct0[0], ct1[1] - 6, ct0[0], ct0[1] + 6, 'dm', LW.thin), arrow(ct0[0], ct1[1], 0, 1), arrow(ct0[0], ct0[1], 0, -1));
    out.push(line(ct0[0], ct0[1] + 6, ct0[0] + 22, ct0[1] + 6, 'dm', LW.thin), text(ct0[0] + 11, ct0[1] + 5, `${f2(m.ct)}±0.3`, { size: TH.num }));
    out.push(vdim(A(secA(sa.t0, sa.z0[0])), A(secA(sa.t0, sa.z0[1])), A(secA(sa.t0, 0))[0] - 8, f2(sa.edge0)));
    out.push(vdim(A(secA(sa.t1, sa.z1[0])), A(secA(sa.t1, sa.z1[1])), A(secA(sa.t1, 0))[0] + 10, f2(sa.edge1)));

    // ---- 断面 B-B ----
    const sb = section(m, 'y');
    out.push(text(B([0, zmax])[0] + s * D / 2, F([0, by1])[1] - 22, 'B-B', { size: TH.sec }));
    out.push(poly(sb.poly.map(p => B(secB(p[0], p[1]))), 'sec', LW.thick, true));
    out.push(hdim(B(secB(sb.t1, sb.z1[0])), B(secB(sb.t1, sb.z1[1])), F([0, by1])[1] - 8, f2(sb.edge1)));
    out.push(hdim(B(secB(sb.t0, sb.z0[0])), B(secB(sb.t0, sb.z0[1])), F([0, by0])[1] + 10, f2(sb.edge0)));

    // ---- 寸法表 ----
    const nasalSide = eye === 'R' ? eR : eL, templeSide = eye === 'R' ? eL : eR;
    const rows = [
      ['中心厚', `${f2(m.ct)} ±0.3`, '光学中心で前面に垂直'],
      ['最厚の縁', f2(m.thk.t), `${Math.round(m.thk.a)}°  r ${f1(m.thk.re)}`],
      ['最薄の縁', f2(m.thn.t), `${Math.round(m.thn.a)}°  r ${f1(m.thn.re)}`],
      ['縁厚 鼻側・耳側', `${f2(nasalSide.t)} ・ ${f2(templeSide.t)}`, '水平径線上'],
      ['縁厚 上・下', `${f2(eT.t)} ・ ${f2(eB.t)}`, '垂直径線上'],
      ['玉形幅 a × 高さ b', `${f2(bx1 - bx0)} × ${f2(by1 - by0)}`, 'ボクシング方式'],
      ['有効直径 ED', f2(m.ed), '玉形中心から最も遠い点の 2 倍'],
      ['心取り点', `内寄せ ${f2(Math.abs(m.ocX))}`, `高さ ${f1(m.ocY - by0)}`],
      ['前面カーブ', `${m.base.toFixed(2)} D`, 'TIND 1.53'],
    ].concat((m.drills || []).length ? [['穴あけ', `${m.drills.length} か所`, `径 ${[...new Set(m.drills.map(g => g.dia.toFixed(1)))].join('・')}  最小厚 ${f2(Math.min(...m.drills.map(g => g.thick)))}`]] : [])
      .concat(info.rows || []);
    const tx = L.tableX, tw = L.tableW, rh = 6.5, c1 = 36, c2 = 36;
    let ty = SHEET.frame + 10;
    out.push(text(tx, ty - 2.5, '寸法表（単位 mm）', { size: TH.txt, anchor: 'start' }));
    out.push(`<rect class="tb" x="${n3(tx)}" y="${n3(ty)}" width="${n3(tw)}" height="${n3(rh * rows.length)}" fill="none" stroke-width="${LW.thick}"/>`);
    rows.forEach((r, i) => {
      const y = ty + rh * i;
      if (i) out.push(line(tx, y, tx + tw, y, 'tb', LW.thin));
      out.push(text(tx + 1.5, y + rh - 1.8, r[0], { size: TH.small + 0.5, anchor: 'start' }));
      out.push(text(tx + c1 + c2 - 1.5, y + rh - 1.8, r[1], { size: TH.small + 0.5, anchor: 'end' }));
      out.push(text(tx + c1 + c2 + 1.5, y + rh - 1.8, r[2] || '', { size: TH.small + 0.5, anchor: 'start', cls: 'sub' }));
    });
    out.push(line(tx + c1, ty, tx + c1, ty + rh * rows.length, 'tb', LW.thin), line(tx + c1 + c2, ty, tx + c1 + c2, ty + rh * rows.length, 'tb', LW.thin));

    // ---- 注記 ----
    const notes = [
      '形は計算による目安（前面は球面、後面は球面・トーリック）',
      '厚さは前面の基準点で前面に垂直に測る（JIS T 7337 5.4）',
      '角度は検者側から見て 3 時方向を 0° とし反時計回り',
      '玉形の寸法はボクシング方式（JIS B 7281）による。玉形はヤゲンの頂点の外縁',
      '平面図・側面図・断面はフレーム基準（縁の面を立てた向き）で描く',
    ].concat(info.notes || []);
    ty += rh * rows.length + 10;
    out.push(text(tx, ty, '注記', { size: TH.txt, anchor: 'start' }));
    notes.forEach((s2, i) => out.push(text(tx, ty + 5.5 * (i + 1), `${i + 1}. ${s2}`, { size: TH.small, anchor: 'start' })));

    // ---- 表題欄（JIS Z 8311：右下） ----
    const X0 = SHEET.W - fr - TITLE.w, Y0 = SHEET.H - fr - TITLE.h, rH = 10;
    out.push(`<rect class="tb" x="${X0}" y="${Y0}" width="${TITLE.w}" height="${TITLE.h}" fill="none" stroke-width="${LW.thick}"/>`);
    for (let i = 1; i < 5; i++) out.push(line(X0, Y0 + rH * i, X0 + TITLE.w, Y0 + rH * i, 'tb', LW.thin));
    const cols = [0, 22, 104, 124, TITLE.w];
    out.push(line(X0 + cols[1], Y0, X0 + cols[1], Y0 + TITLE.h, 'tb', LW.thin));
    for (let i = 1; i < 5; i++) {
      out.push(line(X0 + cols[2], Y0 + rH * i, X0 + cols[2], Y0 + rH * (i + 1), 'tb', LW.thin));
      out.push(line(X0 + cols[3], Y0 + rH * i, X0 + cols[3], Y0 + rH * (i + 1), 'tb', LW.thin));
    }
    const cell = (row, col, s2, o) => text(X0 + cols[col] + 2, Y0 + rH * row + rH / 2 + 1.25, s2, Object.assign({ size: TH.small, anchor: 'start' }, o || {}));
    out.push(cell(0, 0, '図名'), cell(0, 1, info.title || '', { size: TH.txt, bold: true }));
    out.push(cell(1, 0, '図番'), cell(1, 1, info.number || ''), cell(1, 2, '尺度'), cell(1, 3, `${s}:1`, { size: TH.txt }));
    out.push(cell(2, 0, '材料'), cell(2, 1, info.material || ''), cell(2, 2, '投影法'), cell(2, 3, '第三角法'));
    out.push(cell(3, 0, '単位'), cell(3, 1, 'mm'), cell(3, 2, '日付'), cell(3, 3, info.date || ''));
    out.push(cell(4, 0, '作成'), cell(4, 1, 'VCA Lens Simulator'));
    // 投影法の記号（第三角法：円すい台の側面図を、短い辺を円の側に向けて左に置く）
    const sx = X0 + cols[3] + 30, sy = Y0 + rH * 2 + rH / 2;
    out.push(poly([[sx - 9, sy - 3.5], [sx - 2, sy - 1.5], [sx - 2, sy + 1.5], [sx - 9, sy + 3.5]], 'ol', LW.thin, true, ' fill="none"'));
    out.push(`<circle class="th" cx="${n3(sx + 4.5)}" cy="${n3(sy)}" r="3.5" fill="none" stroke-width="${LW.thin}"/><circle class="th" cx="${n3(sx + 4.5)}" cy="${n3(sy)}" r="1.5" fill="none" stroke-width="${LW.thin}"/>`);
    out.push(line(sx - 10.5, sy, sx + 9.5, sy, 'cl', LW.thin, '3 0.8 0.6 0.8'));

    out.push('</svg>');
    return out.join('');
  }

  /** 保存・印刷用：線や文字の色を SVG の中に書き込む（用紙は白、線は黒） */
  const EXPORT_STYLE = '<style>' +
    '.paper{fill:#fff}.ol,.th,.bd,.tb,.cpt{stroke:#000;fill:none}.cl,.cp,.dm{stroke:#000;fill:none}' +
    '.ah{fill:#000}.ht{stroke:#000}.sec{fill:url(#hatch);stroke:#000}.tx{fill:#000}.tx.sub{fill:#333}' +
    '</style>';

  function forExport(svg) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.replace(/(<svg[^>]*>)/, '$1' + EXPORT_STYLE);
  }

  // ---- DXF（CAD 用） -----------------------------------------------------------------
  // 画層：線の種類ごとに分ける。色は AutoCAD の色番号、線種は CONTINUOUS か CENTER（一点鎖線）
  const DXF_LAYERS = {
    OUTLINE: { color: 7, ltype: 'CONTINUOUS', note: '外形線（太い実線）' },
    THIN: { color: 8, ltype: 'CONTINUOUS', note: '細い実線' },
    CENTER: { color: 1, ltype: 'CENTER', note: '中心線・切断線（細い一点鎖線）' },
    CUTTING: { color: 1, ltype: 'CONTINUOUS', note: '切断線の端部（太い実線）' },
    DIM: { color: 3, ltype: 'CONTINUOUS', note: '寸法線・寸法補助線・引出線' },
    HATCH: { color: 9, ltype: 'CONTINUOUS', note: 'ハッチング' },
    TEXT: { color: 7, ltype: 'CONTINUOUS', note: '文字' },
    FRAME: { color: 7, ltype: 'CONTINUOUS', note: '輪郭線・表題欄' },
  };
  const CLASS_LAYER = { ol: 'OUTLINE', th: 'THIN', cl: 'CENTER', cp: 'CENTER', cpt: 'CUTTING', dm: 'DIM', ah: 'DIM', bd: 'FRAME', tb: 'FRAME', sec: 'OUTLINE' };

  /** 文字を DXF に書ける形にする（ASCII 以外は \U+XXXX） */
  function dxfText(s) {
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    let out = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      out += c < 128 ? ch : c <= 0xffff ? '\\U+' + c.toString(16).toUpperCase().padStart(4, '0') : '?';
    }
    return out;
  }

  /** 多角形の内側に 45° の平行線を引く（ハッチング）。用紙の座標、間隔 gap mm */
  function hatchLines(pts, gap) {
    // 45° 回した座標で水平線と辺の交点を求め、内側の区間を返す
    const c = Math.SQRT1_2, rot = ([x, y]) => [x * c + y * c, -x * c + y * c], back = ([u, v]) => [u * c - v * c, u * c + v * c];
    const q = pts.map(rot);
    let v0 = Infinity, v1 = -Infinity;
    for (const p of q) { v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }
    const segs = [];
    for (let v = Math.ceil(v0 / gap) * gap; v <= v1; v += gap) {
      const xs = [];
      for (let i = 0; i < q.length; i++) {
        const a = q[i], b = q[(i + 1) % q.length];
        if ((a[1] <= v && b[1] > v) || (b[1] <= v && a[1] > v)) xs.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) segs.push([back([xs[i], v]), back([xs[i + 1], v])]);
    }
    return segs;
  }

  /**
   * threeView() の SVG を DXF（R12、単位 mm）にする。座標は用紙の mm（左下が原点）。
   * 太い線は幅 0.5 mm のポリラインで書く（R12 には線の太さが無いため）。
   */
  function toDXF(svg) {
    const H = SHEET.H, ents = [];
    const fy = y => H - y;
    const num = v => (Math.round(v * 10000) / 10000).toString();
    const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : undefined; };
    const layerOf = tag => CLASS_LAYER[(attr(tag, 'class') || '').split(' ')[0]] || 'THIN';
    const widthOf = tag => (parseFloat(attr(tag, 'stroke-width')) >= LW.thick ? LW.thick : 0);
    const polyline = (pts, layer, closed, width) => {
      ents.push(`0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n${closed ? 1 : 0}\n40\n${width}\n41\n${width}\n10\n0\n20\n0\n30\n0`);
      for (const [x, y] of pts) ents.push(`0\nVERTEX\n8\n${layer}\n10\n${num(x)}\n20\n${num(fy(y))}\n30\n0`);
      ents.push(`0\nSEQEND\n8\n${layer}`);
    };
    const line = (x1, y1, x2, y2, layer, width) => {
      if (width) polyline([[x1, y1], [x2, y2]], layer, false, width);
      else ents.push(`0\nLINE\n8\n${layer}\n10\n${num(x1)}\n20\n${num(fy(y1))}\n30\n0\n11\n${num(x2)}\n21\n${num(fy(y2))}\n31\n0`);
    };
    const pts = str => str.trim().split(/\s+/).map(p => p.split(',').map(Number));
    const body = svg.replace(/<defs>[\s\S]*?<\/defs>/, '');
    const re = /<(line|polyline|polygon|circle|rect|path|text)\b([^>]*?)(\/>|>([\s\S]*?)<\/text>)/g;
    let m;
    while ((m = re.exec(body))) {
      const [, tag, a] = m, t = ' ' + a;
      const cls = (attr(t, 'class') || '').split(' ')[0];
      if (cls === 'paper') continue;
      const layer = layerOf(t), w = widthOf(t);
      if (tag === 'line') line(+attr(t, 'x1'), +attr(t, 'y1'), +attr(t, 'x2'), +attr(t, 'y2'), layer, w);
      else if (tag === 'polyline' || tag === 'polygon') {
        const p = pts(attr(t, 'points'));
        polyline(p, layer, tag === 'polygon', w);
        if (cls === 'sec') for (const [s0, s1] of hatchLines(p, 1.5)) line(s0[0], s0[1], s1[0], s1[1], 'HATCH', 0);
      } else if (tag === 'rect') {
        const x = +attr(t, 'x'), y = +attr(t, 'y'), wd = +attr(t, 'width'), ht = +attr(t, 'height');
        polyline([[x, y], [x + wd, y], [x + wd, y + ht], [x, y + ht]], layer, true, w);
      } else if (tag === 'circle') {
        ents.push(`0\nCIRCLE\n8\n${layer}\n10\n${num(+attr(t, 'cx'))}\n20\n${num(fy(+attr(t, 'cy')))}\n30\n0\n40\n${num(+attr(t, 'r'))}`);
      } else if (tag === 'path') {
        // 矢印（M x,y L x,y L x,y z）を塗りつぶしの三角形（SOLID）にする
        const v = (attr(t, 'd').match(/-?\d+(\.\d+)?/g) || []).map(Number);
        if (v.length >= 6) {
          const P = [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[4], v[5]]];
          ents.push(`0\nSOLID\n8\nDIM\n` + P.map(([x, y], i) => `${10 + i}\n${num(x)}\n${20 + i}\n${num(fy(y))}\n${30 + i}\n0`).join('\n'));
        }
      } else if (tag === 'text') {
        const x = +attr(t, 'x'), y = +attr(t, 'y'), h = +attr(t, 'font-size') || TH.txt;
        const anchor = attr(t, 'text-anchor') || 'start';
        const rot = (attr(t, 'transform') || '').match(/rotate\((-?[\d.]+)/);
        const just = anchor === 'middle' ? 1 : anchor === 'end' ? 2 : 0;
        const str = dxfText(m[4] || '');
        let e = `0\nTEXT\n8\nTEXT\n10\n${num(x)}\n20\n${num(fy(y))}\n30\n0\n40\n${num(h * 0.72)}\n1\n${str}`;
        if (rot) e += `\n50\n${num(-parseFloat(rot[1]))}`;
        if (just) e += `\n72\n${just}\n11\n${num(x)}\n21\n${num(fy(y))}\n31\n0`;
        ents.push(e);
      }
    }
    // 文字の高さ：SVG の font-size は文字の外枠の高さなので、DXF の文字高さ（大文字の高さ）は約 0.72 倍
    const ltypes = '0\nTABLE\n2\nLTYPE\n70\n2\n' +
      '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n' +
      '0\nLTYPE\n2\nCENTER\n70\n0\n3\nCenter ____ _ ____ _\n72\n65\n73\n4\n40\n16.2\n49\n10.0\n49\n-2.5\n49\n1.2\n49\n-2.5\n' +
      '0\nENDTAB\n';
    const layers = '0\nTABLE\n2\nLAYER\n70\n' + Object.keys(DXF_LAYERS).length + '\n' +
      Object.entries(DXF_LAYERS).map(([n, l]) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${l.color}\n6\n${l.ltype}\n`).join('') + '0\nENDTAB\n';
    return '999\nVCA Lens Simulator: drawing sheet A3 (420 x 297 mm), units mm\n' +
      '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n9\n$EXTMIN\n10\n0\n20\n0\n30\n0\n9\n$EXTMAX\n10\n' + SHEET.W + '\n20\n' + SHEET.H + '\n30\n0\n9\n$LTSCALE\n40\n1.0\n0\nENDSEC\n' +
      '0\nSECTION\n2\nTABLES\n' + ltypes + layers + '0\nENDSEC\n' +
      '0\nSECTION\n2\nENTITIES\n' + ents.join('\n') + '\n0\nENDSEC\n0\nEOF\n';
  }

  return { SHEET, LW, TH, threeView, drillOutline, section, cloud, silhouette, layout, forExport, toDXF, hatchLines, DXF_LAYERS };
});
