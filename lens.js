/*
 * lens.js — 加工後のレンズの形（厚み・コバ・ヤゲン）を計算する
 *
 * 玉形（等角度の半径）と処方・素材・レイアウトから、前面と後面の高さ、
 * 縁の厚み、ヤゲン・溝の位置を求め、表示用の三角形の網（メッシュ）も作る。
 * 面は球面（前面）と双円錐（後面のトーリック）で近似する。非球面や累進の面は扱わない。
 * MIT License
 *
 * 座標（このファイルの中の共通の形）
 *   単位 mm。検者が装用者を正面から見た向き（x 右、y 上、z 手前）。原点は玉形の箱中心。
 *   前面の頂点（光学中心）が z = 0 で、レンズは z < 0 の側にある。
 *   角度は 0° が 3 時方向、反時計回り（VCA の玉形と同じ）。
 *
 * 依存: vca-parser.js（fromVCA を使うときだけ。ブラウザでは window.VCA）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vca-parser.js'));
  else root.Lens = factory(root.VCA);
})(typeof self !== 'undefined' ? self : this, function (VCA) {
  'use strict';

  const TIND = 1.53;          // カーブ値（D）の換算に使う屈折率の既定値
  const DEG = Math.PI / 180;

  /** 素材の一覧。最小中心厚は一般的な目安（マイナスレンズのとき） */
  const MATERIALS = [
    { id: '1.50', name: '1.50（CR-39）', n: 1.50, minCT: 2.0 },
    { id: '1.56', name: '1.56', n: 1.56, minCT: 1.6 },
    { id: '1.59', name: '1.59（ポリカーボネート）', n: 1.59, minCT: 1.2 },
    { id: '1.60', name: '1.60', n: 1.60, minCT: 1.3 },
    { id: '1.67', name: '1.67', n: 1.67, minCT: 1.2 },
    { id: '1.74', name: '1.74', n: 1.74, minCT: 1.1 },
  ];

  // ---- 玉形 -----------------------------------------------------------------
  /**
   * 閉じた点列を、箱中心を原点にした等角度の半径に測り直す。
   * 1 本の線が輪郭と 2 回以上交わるときは、いちばん外側を使う。
   * 点に z（フレームの奥行き）があれば、同じ位置の z も補間して返す。
   * @returns {{radii: number[], z?: number[], box: {hbox, vbox, cx, cy}}}
   */
  function resample(pts, n) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const q = pts.map(p => ({ x: p.x - cx, y: p.y - cy, z: p.z }));
    const hasZ = q.every(p => Number.isFinite(p.z));
    const radii = [], zs = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, dx = Math.cos(a), dy = Math.sin(a);
      let best = 0, bz = 0;
      for (let j = 0; j < q.length; j++) {
        const p = q[j], r = q[(j + 1) % q.length];
        const ex = r.x - p.x, ey = r.y - p.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = (p.x * ey - p.y * ex) / den;
        const u = (p.x * dy - p.y * dx) / den;
        if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) { best = t; if (hasZ) bz = p.z + (r.z - p.z) * Math.min(1, Math.max(0, u)); }
      }
      radii.push(best || (radii.length ? radii[radii.length - 1] : 0));
      zs.push(best ? bz : (zs.length ? zs[zs.length - 1] : 0));
    }
    const out = { radii, box: { hbox: x1 - x0, vbox: y1 - y0, cx, cy } };
    if (hasZ) out.z = zs;
    return out;
  }

  /** 等角度の半径の、任意の角度（ラジアン）での値（直線補間） */
  function radiusAt(radii, a) {
    const n = radii.length;
    let f = ((a / (2 * Math.PI)) * n) % n;
    if (f < 0) f += n;
    const i = Math.floor(f), t = f - i;
    return radii[i] * (1 - t) + radii[(i + 1) % n] * t;
  }

  // ---- VCA の読み込み ---------------------------------------------------------
  /**
   * VCA テキストから、両眼の玉形とレイアウト・処方の値を取り出す。
   * 片眼しか無いときは、反対の眼を左右反転して作る（mirrored: true）。
   */
  function fromVCA(text, n) {
    n = n || 360;
    const d = VCA.parse(text);
    const out = { eyes: {}, rec: d.rec, warnings: d.warnings.slice(), errors: d.errors.slice() };
    const num = (label, eye) => VCA.sideNumber(d.rec[label], eye);
    out.dbl = num('DBL', 'R');
    out.fcrv = num('FCRV', 'R');
    out.etyp = num('ETYP', 'R');
    // 縁の加工（DCS の Table A.1）。値が無いものは undefined
    out.edging = {
      bevp: num('BEVP', 'R'), bevm: num('BEVM', 'R'), bevc: num('BEVC', 'R'), bevang: num('BEVANG', 'R'),
      gdepth: num('GDEPTH', 'R'), gwidth: num('GWIDTH', 'R'),
    };
    const traces = d.traces.filter(t => t.radii.length);
    for (const eye of ['R', 'L']) {
      let t = traces.find(t => t.eye === eye), mirrored = false;
      if (!t) { t = traces.find(t => t.eye === (eye === 'R' ? 'L' : 'R')) || traces[0]; mirrored = !!t; }
      if (!t) continue;
      const pts = VCA.tracePoints(t, eye);
      const frameZ = sagAt(t, eye);
      if (frameZ) pts.forEach(p => { p.z = frameZ(p.a); });
      const s = resample(pts, n);
      out.eyes[eye] = {
        radii: s.radii, hbox: s.box.hbox, vbox: s.box.vbox, mirrored,
        frameZ: s.z,   // フレーム（玉形）の奥行き（mm、前方が 0、後ろへ正）。Z データが無ければ undefined
        frameCurve: fitFrameCurve(s.radii, s.z),
        offset: Math.hypot(s.box.cx, s.box.cy),
        rx: {
          sph: num('SPH', eye), cyl: num('CYL', eye), ax: num('AX', eye),
          prism: num('PRVM', eye), prismBase: num('PRVA', eye),
          ipd: num('IPD', eye), ocht: num('OCHT', eye),
          n: num('LIND', eye), front: num('FRNT', eye), ct: num('CTHICK', eye),
          minCT: num('MINCTR', eye), minEdge: num('MINEDG', eye),
        },
      };
    }
    if (!out.eyes.R) out.errors.push('玉形（TRCFMT と R）が見つかりません');
    // 穴あけ（DCS 5.5 の DRILLE。1 レコードが 1 か所）
    out.drills = [];
    for (const r of d.records) {
      if (r.label === 'DRILL') out.warnings.push('DRILL レコード（古い形式）は読み込みません。DRILLE を使ってください');
      if (r.label !== 'DRILLE') continue;
      const f = parseDrill(r.fields);
      if (f.error) out.warnings.push(`DRILLE=${r.fields.join(';')}：${f.error}`);
      else if (f.side !== '0') out.drills.push(f);
    }
    return out;
  }

  /**
   * DRILLE レコードの欄を読む（DCS 5.5.2）。
   * 1 眼（R・L・B・0）、2 基準（C・E・B・R に、E・B は N・T、最後に取付面 F・R）、3・4 始点 x・y、5 径、
   * 6・7 終点 x・y、8 深さ（0・空欄は貫通）、9 種類（1 穴・長穴、2 四角の切り欠き）、10 角度の決め方、
   * 13・14 最小・最大の厚み
   */
  function parseDrill(fields) {
    const v = i => (fields[i] === undefined || fields[i] === '' || fields[i] === '?' ? undefined : fields[i].trim());
    const n = i => { const x = v(i); return x === undefined || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(x) ? undefined : +x; };
    const side = (v(0) || '').toUpperCase();
    if (!['R', 'L', 'B', '0'].includes(side)) return { error: '1 番目の欄（眼）が R・L・B・0 ではありません' };
    const ref = (v(1) || 'C').toUpperCase();
    if (side === '0' || ref === '0') return { side: '0' };
    const m = ref.match(/^([CEBR])([NT])?([FR])?$/);
    if (!m || ((m[1] === 'E' || m[1] === 'B') && !m[2])) return { error: `2 番目の欄（基準）「${ref}」が読めません` };
    if (m[1] === 'R') return { error: 'グループの中の相対位置（R）には対応していません' };
    const x = n(2), y = n(3);
    if (x === undefined || y === undefined) return { error: '位置（3・4 番目の欄）がありません' };
    const type = n(8) === 2 ? 2 : 1;
    return {
      side, ref: m[1], nt: m[2] || '', surface: m[3] || 'F', x, y,
      dia: n(4), x2: n(5), y2: n(6), depth: n(7) || 0, type,
      minThk: n(12), maxThk: n(13),
    };
  }

  /**
   * DRILLE の位置を、この眼の玉形中心からの座標（検者側から見る向き）にする。
   * B（両眼）は右眼のデータで、左眼では左右を反転する。E は玉形の縁、B は外接長方形の辺から中心向きに測る。
   * @returns [{x, y, x2?, y2?, dia, depth, surface, type, minThk, maxThk}]
   */
  function placeDrills(drills, eyeId, radii) {
    const N = radii.length;
    const outline = radii.map((r, i) => [r * Math.cos((2 * Math.PI * i) / N), r * Math.sin((2 * Math.PI * i) / N)]);
    let x0 = Infinity, x1 = -Infinity;
    for (const [x] of outline) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    // 水平線 y と玉形の交点のうち、いちばん左・右の x
    const edgeAt = y => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < N; i++) {
        const [ax, ay] = outline[i], [bx, by] = outline[(i + 1) % N];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const x = ax + ((y - ay) / (by - ay)) * (bx - ax);
          lo = Math.min(lo, x); hi = Math.max(hi, x);
        }
      }
      return [lo, hi];
    };
    const out = [];
    for (const f of drills) {
      if (f.side !== 'B' && f.side !== eyeId) continue;
      const flip = f.side === 'B' && eyeId === 'L';   // 両眼の指定は右眼のデータ
      // 鼻側は、右眼では +x、左眼では −x（検者側から見る）
      const nasalPlus = eyeId === 'R';
      const place = (x, y) => {
        if (f.ref === 'C') return [flip ? -x : x, y];
        const plusSide = f.nt === 'N' ? nasalPlus : !nasalPlus;
        const [lo, hi] = f.ref === 'E' ? edgeAt(y) : [x0, x1];
        return [plusSide ? hi - x : lo + x, y];
      };
      const [px, py] = place(f.x, f.y);
      const g = { x: px, y: py, dia: f.dia == null ? 1.4 : f.dia, depth: f.depth, surface: f.surface, type: f.type, minThk: f.minThk, maxThk: f.maxThk };
      if (f.x2 !== undefined && f.y2 !== undefined) { const [qx, qy] = place(f.x2, f.y2); g.x2 = qx; g.y2 = qy; }
      out.push(g);
    }
    return out;
  }

  /**
   * トレースの Z データ（DCS 5.4.14：いちばん前の点が最小の正の値、後ろへ 0.01 mm 単位で増える）から、
   * 角度（度、asEye の向き）の奥行き（mm、いちばん前が 0）を返す関数を作る。Z データが無ければ null。
   */
  function sagAt(trace, asEye) {
    const sg = trace.sag;
    if (!sg || !sg.values || !sg.values.length || sg.values.some(v => !Number.isFinite(v))) return null;
    const n = sg.values.length;
    const mirror = asEye && asEye !== trace.eye && (trace.eye === 'R' || trace.eye === 'L');
    let list = sg.values.map((v, i) => {
      let a = sg.equi ? (i * 360) / n : (sg.angles[i] || 0) / 100;
      if (mirror) a = (540 - a) % 360;
      return [a, v / 100];
    }).sort((p, q) => p[0] - q[0]);
    const min = Math.min(...list.map(p => p[1]));
    list = list.map(([a, z]) => [a, z - min]);
    return a => {
      a = ((a % 360) + 360) % 360;
      let i = list.findIndex(p => p[0] > a);
      if (i < 0) i = list.length;
      const p = list[(i - 1 + list.length) % list.length], q = list[i % list.length];
      let span = q[0] - p[0], d = a - p[0];
      if (span <= 0) span += 360;
      if (d < 0) d += 360;
      return p[1] + (q[1] - p[1]) * (span ? d / span : 0);
    };
  }

  /**
   * フレームの奥行きに、玉形中心を軸とする球面を当てはめてカーブ（TIND 基準 D）を求める。
   * 奥行き z = z0 + c·g(r)、g(r) = r² / (1 + √(1 − c²r²)) を最小二乗で解く。
   * g が c に依存するので、近似（g = r²/2）から始めて数回繰り返す（フレームカーブ FCRV の目安）。
   */
  function fitFrameCurve(radii, frameZ) {
    if (!frameZ) return undefined;
    const n = radii.length;
    let c = 0;
    for (let iter = 0; iter < 8; iter++) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) {
        const r2 = radii[i] * radii[i];
        const x = r2 / (1 + Math.sqrt(Math.max(0, 1 - c * c * r2))), y = frameZ[i];
        sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      const next = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      if (!Number.isFinite(next)) return undefined;
      if (Math.abs(next - c) < 1e-9) { c = next; break; }
      c = next;
    }
    return c * (TIND - 1) * 1000;
  }

  // ---- 面 ------------------------------------------------------------------
  /** 球面のサグ（曲率 c [1/mm]、中心からの距離 r） */
  function sagSphere(c, r2) {
    const k = 1 - c * c * r2;
    return (c * r2) / (1 + Math.sqrt(Math.max(k, 0)));
  }

  /** 双円錐（円錐係数 0）のサグ。X が乱視軸の向き */
  function sagBiconic(cx, cy, X, Y) {
    const num = cx * X * X + cy * Y * Y;
    const k = 1 - cx * cx * X * X - cy * cy * Y * Y;
    return num / (1 + Math.sqrt(Math.max(k, 0)));
  }

  /**
   * ベースカーブ（前面カーブ、TIND 基準 D）の目安。Vogel の式による。
   * 等価球面度数 SE が 0 以上なら SE + 6、マイナスなら SE / 2 + 6。0.5〜10 D に収める。
   */
  function autoBase(sph, cyl) {
    const se = sph + cyl / 2;
    const b = se >= 0 ? se + 6 : se / 2 + 6;
    return Math.min(10, Math.max(0.5, Math.round(b * 4) / 4));
  }

  /**
   * 処方と玉形からレンズの形を決める。
   * @param eye  { radii: number[]（箱中心からの等角度の半径 mm）, hbox, vbox }
   * @param p    {
   *   sph, cyl, ax, prism, prismBase,   処方（D・度・Δ）
   *   n, base,                           屈折率、前面カーブ（TIND 基準 D）
   *   ocX, ocY,                          光学中心の位置（箱中心から、mm）
   *   minCT, minEdge,                    最小中心厚、最小縁厚（mm）
   *   edge: 'bevel'|'mini'|'flat'|'groove',  縁の加工（DCS の ETYP 1・4・2・3）
   *   bevelMode, bevelM, bevelC,         ヤゲン・溝の位置の決め方（DCS の BEVP・BEVM・BEVC。BEVEL_MODES を参照）
   *   bevelPos,                          bevelMode が無いときの位置（0 = 前面側 〜 1 = 後面側、コバ厚に対する比）
   *   bevelH, bevelAngle,                ヤゲンの高さ（mm）と山の角度（度、DCS の BEVANG）
   *   grooveW, grooveD,                  溝の幅・深さ（mm、DCS の GWIDTH・GDEPTH）
   * }
   */
  function build(eye, p) {
    const n = p.n, k = (n - 1) * 1000;
    const c1 = p.base / ((TIND - 1) * 1000);       // 前面の曲率（形は TIND 基準のカーブで決まる）
    const F1 = c1 * k;                              // 前面の実際の屈折力（素材の屈折率で）
    const cylAx = (p.ax || 0) * DEG, cosA = Math.cos(cylAx), sinA = Math.sin(cylAx);
    const sph = p.sph || 0, cyl = p.cyl || 0;
    const wedge = Math.atan((p.prism || 0) / 100) / (n - 1);  // プリズムのくさび角（ラジアン、薄いプリズムの近似）
    const pb = (p.prismBase || 0) * DEG, pbx = Math.cos(pb), pby = Math.sin(pb);
    const ocX = p.ocX || 0, ocY = p.ocY || 0;
    const radii = eye.radii, N = radii.length;
    const edgeType = p.edge || 'bevel';
    const vShape = edgeType === 'bevel' || edgeType === 'mini';
    const bevelH = vShape ? (p.bevelH == null ? (edgeType === 'mini' ? 0.4 : 0.6) : p.bevelH) : 0;
    // 山の角度の既定値は 120°（JIS B 7281 で玉形を定めるときに仮定するやげん角度）
    const bevelW = 2 * bevelH * Math.tan(((p.bevelAngle || 120) / 2) * DEG);

    let ct = Math.max(p.minCT || 1, 0.3), c2x = 0, c2y = 0;

    const zFront = (x, y) => {
      const u = x - ocX, v = y - ocY;
      return -sagSphere(c1, u * u + v * v);
    };
    // 中心厚を除いた後面の高さ（中心厚 0 のときの後面）
    const zBack0 = (x, y) => {
      const u = x - ocX, v = y - ocY;
      const X = u * cosA + v * sinA, Y = -u * sinA + v * cosA;
      return -sagBiconic(c2x, c2y, X, Y) - wedge * (u * pbx + v * pby);
    };

    // 中心厚と後面の曲率は互いに依存する（厚いレンズの補正）ので、数回繰り返して決める
    const probe = [];
    for (let i = 0; i < N; i += 2) {
      const a = (2 * Math.PI * i) / N, re = radii[i] - bevelH;
      for (const f of [0.25, 0.5, 0.75, 1]) probe.push([re * f * Math.cos(a), re * f * Math.sin(a), f === 1]);
    }
    probe.push([ocX, ocY, false]);
    let gMinAll = 0, gMinEdge = 0;
    for (let iter = 0; iter < 6; iter++) {
      const F1eff = F1 / (1 - (ct / 1000 / n) * F1);  // 前面の屈折力を後頂点に移した値
      c2x = -(sph - F1eff) / k;                       // 乱視軸の向きの曲率
      c2y = -(sph + cyl - F1eff) / k;                 // 軸と直交する向きの曲率
      gMinAll = Infinity; gMinEdge = Infinity;
      for (const [x, y, isEdge] of probe) {
        const g = zFront(x, y) - zBack0(x, y);
        if (g < gMinAll) gMinAll = g;
        if (isEdge && g < gMinEdge) gMinEdge = g;
      }
      const next = p.ct > 0 ? p.ct : Math.max(p.minCT || 1, (p.minEdge || 0.8) - gMinAll);
      if (Math.abs(next - ct) < 1e-6) { ct = next; break; }
      ct = next;
    }
    const zBack = (x, y) => zBack0(x, y) - ct;
    const thick = (x, y) => zFront(x, y) - zBack(x, y);

    // 縁（角度ごと）
    const edge = [];
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N, ca = Math.cos(a), sa = Math.sin(a);
      const R = radii[i], re = R - bevelH;
      const x = re * ca, y = re * sa;
      const zf = zFront(x, y), zb = zBack(x, y), t = zf - zb;
      edge.push({ i, a: (i * 360) / N, R, re, x, y, ca, sa, zf, zb, t });
    }

    // ヤゲン・溝の中心の高さ（DCS の BEVP）。縁からはみ出す分は後で収める
    const mode = p.bevelMode || 'percent';
    const M = p.bevelM;
    let center;
    if (mode === 'front') center = e => e.zf - (M == null ? 1 : M);
    else if (mode === 'back') center = e => e.zb + (M == null ? 1 : M);
    else if (mode === 'half') center = e => e.zf - 0.5 * e.t;
    else if (mode === 'frame' || mode === 'trace') {
      // frame：フレームカーブ（BEVC、TIND 基準 D）の球面に沿わせる。球の中心軸は玉形中心を通る。
      // trace：トレーサーで測ったフレームの奥行き（Z データ）に沿わせる。Z データが無ければ frame と同じ。
      // どちらも、前面にいちばん近いところで前面から BEVM mm になるように前後の位置を決める
      let zc;
      if (mode === 'trace' && eye.frameZ) zc = e => -eye.frameZ[e.i];
      else {
        const cB = (p.bevelC == null ? p.base : p.bevelC) / ((TIND - 1) * 1000);
        zc = e => -sagSphere(cB, e.re * e.re);
      }
      let off = Infinity;
      for (const e of edge) off = Math.min(off, e.zf - zc(e));
      const shift = off - (M == null ? 1 : M);
      center = e => zc(e) + shift;
    } else {
      const ratio = mode === 'percent' && M != null ? M / 100 : (p.bevelPos == null ? 0.4 : p.bevelPos);
      center = e => e.zf - ratio * e.t;
    }

    for (const e of edge) {
      const zf = e.zf, zb = e.zb, t = e.t;
      if (vShape) {
        // 山が縁からはみ出さないように位置を収める。縁が山より薄いときは山を細くする
        const w = Math.min(bevelW, t * 0.9);
        e.bevelW = w;
        e.zApex = Math.min(zf - w / 2, Math.max(zb + w / 2, center(e)));
        e.front = zf - e.zApex - w / 2;   // 前面側の肩の幅（前面からヤゲンの付け根まで）
        e.back = e.zApex - w / 2 - zb;
      } else if (edgeType === 'groove') {
        const w = Math.min(p.grooveW || 0.6, t * 0.6);
        e.grooveW = w;
        e.zGroove = Math.min(zf - w / 2 - 0.2, Math.max(zb + w / 2 + 0.2, center(e)));
      }
    }

    let thk = edge[0], thn = edge[0];
    for (const e of edge) { if (e.t > thk.t) thk = e; if (e.t < thn.t) thn = e; }

    const warnings = [];
    if (thn.t < (p.minEdge || 0.8) - 0.05) warnings.push(`最も薄い縁が ${thn.t.toFixed(2)} mm で、最小縁厚より薄くなっています`);
    if (vShape && thn.t < bevelW) warnings.push(`縁の厚み（最も薄いところ ${thn.t.toFixed(2)} mm）がヤゲンの幅 ${bevelW.toFixed(2)} mm より薄い部分があります`);
    const maxR = Math.max(...radii.map((r, i) => Math.hypot(r * Math.cos((2 * Math.PI * i) / N) - ocX, r * Math.sin((2 * Math.PI * i) / N) - ocY)));
    if (Math.abs(c1) * maxR >= 1 || Math.max(Math.abs(c2x), Math.abs(c2y)) * maxR >= 1) warnings.push('カーブが強すぎて、玉形の端で面が成り立ちません');

    const m = {
      params: Object.assign({}, p, { edge: edgeType, vShape }),
      ct, base: p.base, F1, c1, c2x, c2y, ocX, ocY, bevelH, bevelW,
      zFront, zBack, thick, radii, edge, thk, thn,
      maxDia: 2 * maxR,   // 光学中心を中心にしたときに必要なブランクの直径（目安）
      ed: 2 * Math.max(...radii),   // 有効直径（玉形中心から最も遠い点までの距離の 2 倍、JIS B 7281 附属書 A）
      warnings,
    };
    m.profile = e => edgeProfile(m, e);
    m.plane = edgePlane(m);
    // フレーム基準の座標に直す：縁の面がまっすぐ立つように、玉形中心・縁の面の高さを軸に回す（3D・三面図で使う）
    m.toFrame = frameRotation(m.plane);
    return m;
  }

  /**
   * 角度ごとの縁の断面（半径方向の位置 r と高さ z の列。前面側から後面側へ）
   */
  function edgeProfile(m, e) {
    const type = m.params.edge;
    if (m.params.vShape) {
      return [
        [e.re, e.zf], [e.re, e.zApex + e.bevelW / 2], [e.R, e.zApex],
        [e.re, e.zApex - e.bevelW / 2], [e.re, e.zb],
      ];
    }
    if (type === 'groove') {
      const d = m.params.grooveD || 0.4, w = e.grooveW;
      return [
        [e.R, e.zf], [e.R, e.zGroove + w / 2], [e.R - d, e.zGroove + w / 2],
        [e.R - d, e.zGroove - w / 2], [e.R, e.zGroove - w / 2], [e.R, e.zb],
      ];
    }
    return [[e.R, e.zf], [e.R, e.zb]];
  }

  /**
   * 表示用の三角形の網を作る。面ごとに別の頂点を持たせ、角をはっきり見せる。
   * @param opts {step?: 角度の間引き（1 = 全点）, rings?: 前面・後面の同心円の数}
   * @returns {{positions: Float32Array, indices: Uint32Array, values: Float32Array（各頂点の厚み mm）}}
   */
  function mesh(m, opts) {
    opts = opts || {};
    const step = opts.step || 2, rings = opts.rings || 28;
    const E = m.edge.filter((e, i) => i % step === 0), N = E.length;
    const pos = [], val = [], idx = [];
    const vert = (x, y, z, t) => { pos.push(x, y, z); val.push(t); return pos.length / 3 - 1; };

    // 前面・後面：箱中心から縁までを同心円で区切る。中心付近は細かくしすぎない
    for (const side of ['front', 'back']) {
      const zf = side === 'front' ? m.zFront : m.zBack;
      const c = vert(0, 0, zf(0, 0), m.thick(0, 0));
      const ring = [];
      for (let k = 1; k <= rings; k++) {
        const f = k / rings, row = [];
        for (const e of E) {
          const r = (m.params.vShape ? e.re : e.R) * f;
          const x = r * e.ca, y = r * e.sa;
          row.push(vert(x, y, zf(x, y), m.thick(x, y)));
        }
        ring.push(row);
      }
      const tri = side === 'front' ? (a, b, d) => idx.push(a, b, d) : (a, b, d) => idx.push(a, d, b);
      for (let i = 0; i < N; i++) tri(c, ring[0][i], ring[0][(i + 1) % N]);
      for (let k = 0; k < rings - 1; k++) {
        for (let i = 0; i < N; i++) {
          const j = (i + 1) % N, a = ring[k][i], b = ring[k][j], d = ring[k + 1][i], g = ring[k + 1][j];
          tri(a, d, b); tri(b, d, g);
        }
      }
    }

    // 縁：断面の線分ごとに帯を作る
    const prof = E.map(e => edgeProfile(m, e));
    const segs = prof[0].length - 1;
    for (let s = 0; s < segs; s++) {
      const ids = E.map((e, i) => {
        const [r0, z0] = prof[i][s], [r1, z1] = prof[i][s + 1];
        return [vert(r0 * e.ca, r0 * e.sa, z0, e.t), vert(r1 * e.ca, r1 * e.sa, z1, e.t)];
      });
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N, A = ids[i][0], D = ids[i][1], B = ids[j][0], C = ids[j][1];
        idx.push(A, D, B, B, D, C);
      }
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx), values: new Float32Array(val) };
  }

  /**
   * 縁の面（フレームにはまる位置を結んだ面）を z = a·x + b·y + c で当てはめる。
   * 計算は光軸を z 軸に取っているので、光学中心を玉形中心からずらすと、この面が光軸に対して傾く
   * （ずらした量 ÷ カーブの半径 くらい）。3D でフレームを立てて見せるときに、この傾きを打ち消す。
   * 縁の位置は、ヤゲンなら山、溝なら溝の中心、平なら厚みの中央。
   * @returns { a, b, c, tiltX, tiltY }  tiltX・tiltY は x 軸・y 軸まわりの傾き（度）
   */
  function edgePlane(m) {
    let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sz = 0, Sxz = 0, Syz = 0, n = 0;
    for (const e of m.edge) {
      const z = e.zApex ?? e.zGroove ?? (e.zf + e.zb) / 2;
      Sxx += e.x * e.x; Sxy += e.x * e.y; Syy += e.y * e.y; Sx += e.x; Sy += e.y; Sz += z; Sxz += e.x * z; Syz += e.y * z; n++;
    }
    // 正規方程式（3 元連立）をクラメルの公式で解く
    const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], B = [Sxz, Syz, Sz], D = det(A);
    const sol = i => det(A.map((r, k) => r.map((v, j) => (j === i ? B[k] : v)))) / D;
    const a = sol(0), b = sol(1), c = sol(2);
    return { a, b, c, tiltX: Math.atan(b) / DEG, tiltY: -Math.atan(a) / DEG };
  }

  /**
   * 縁の面の法線を z 軸に重ねる回転（ロドリゲスの式）。回す軸は点 (0, 0, c)。
   * @returns 点 [x, y, z] を回した点を返す関数
   */
  function frameRotation(pl) {
    const nl = Math.hypot(pl.a, pl.b, 1), nx = -pl.a / nl, ny = -pl.b / nl, nz = 1 / nl;
    // 法線 n を z に重ねる：軸 k = n × z、角 θ（cos θ = nz）
    const kx = ny, ky = -nx, s = Math.hypot(kx, ky), c = nz;
    if (s < 1e-12) return p => [p[0], p[1], p[2]];
    const ux = kx / s, uy = ky / s, C = 1 - c;
    return ([x, y, z0]) => {
      const z = z0 - pl.c, d = ux * x + uy * y;   // k は xy 面内（uz = 0）
      return [
        x * c + (uy * z) * s + ux * d * C,
        y * c + (-ux * z) * s + uy * d * C,
        z * c + (ux * y - uy * x) * s + pl.c,
      ];
    };
  }

  /** 結果を VCA の仕上がり厚みのレコード（片眼分）にする */
  function records(m) {
    const f = v => v.toFixed(2);
    return {
      CTHICK: f(m.ct),
      THKP: f(m.thk.t), THKA: f(m.thk.a), THKR: f(m.thk.re),
      THNP: f(m.thn.t), THNA: f(m.thn.a), THNR: f(m.thn.re),
    };
  }

  /**
   * 光学中心の位置（箱中心から、mm）。
   * 水平：鼻側へ (HBOX + DBL) / 2 − 片眼 PD。正面視では右眼の鼻側が +x、左眼の鼻側が −x。
   * 垂直：OCHT − VBOX / 2（OCHT は箱の下辺から）。
   */
  function opticalCenter(eyeId, hbox, vbox, dbl, ipd, ocht) {
    const dec = (hbox + dbl) / 2 - ipd;
    return { x: eyeId === 'L' ? -dec : dec, y: ocht - vbox / 2, dec };
  }

  // ---- プリズムの表し方 ----------------------------------------------------------
  /**
   * 水平・垂直の成分（基底内方・外方・上方・下方）を 360° 表示（基底方向）に直す。
   * 角度は ISO 8429・JIS T 7330 と同じく、検者側から見て 3 時方向が 0°、反時計回り。
   * 右眼は鼻側（基底内方）が 0°、左眼は鼻側が 180°。
   * @param h 水平成分（Δ、基底内方が正、外方が負）
   * @param v 垂直成分（Δ、基底上方が正、下方が負）
   */
  function prismFromComponents(eyeId, h, v) {
    const x = eyeId === 'L' ? -h : h, y = v;
    const m = Math.hypot(x, y);
    let a = (Math.atan2(y, x) * 180) / Math.PI;
    if (a < 0) a += 360;
    return { prism: m, base: m ? a : 0 };
  }

  /** 360° 表示を水平・垂直の成分に分ける（prismFromComponents の逆） */
  function prismToComponents(eyeId, prism, base) {
    const a = ((base || 0) * Math.PI) / 180, x = (prism || 0) * Math.cos(a), y = (prism || 0) * Math.sin(a);
    return { h: eyeId === 'L' ? -x : x, v: y };
  }

  // ---- 許容差（JIS T 7337:2020・対応国際規格 ISO 21987:2017） ----------------------
  // 表 1：単焦点・多焦点レンズの後面頂点屈折力。[絶対値で大きい主経線の屈折力の上限, 各主経線の許容差,
  //       乱視屈折力の許容差（≦0.75、≦4.00、≦6.00、>6.00）]
  const POWER_TOL = [
    [3, 0.12, [0.09, 0.12, 0.18, null]],
    [6, 0.12, [0.12, 0.12, 0.18, 0.25]],
    [9, 0.12, [0.12, 0.18, 0.18, 0.25]],
    [12, 0.18, [0.12, 0.18, 0.25, 0.25]],
    [20, 0.25, [0.18, 0.25, 0.25, 0.25]],
    [Infinity, 0.37, [0.25, 0.25, 0.37, 0.37]],
  ];
  // 表 3：乱視軸方向。[乱視屈折力の上限, 許容差（°）]。0.12 D 未満は規定なし
  const AXIS_TOL = [[0.25, 16], [0.5, 9], [0.75, 6], [1.5, 4], [2.5, 3], [Infinity, 2]];
  // 表 5：プリズムインバランス。[指定プリズム成分の上限, 水平の固定値, 水平の加算値, 垂直の固定値, 垂直の加算値]
  // 屈折力 S が水平 3.37 D・垂直 5.00 D 以下なら固定値、それより大きければ 加算値 + 0.2S（水平）・0.1S（垂直）
  const IMBALANCE_TOL = [[2, 0.67, 0, 0.5, 0], [10, 1.0, 0.33, 0.75, 0.25], [Infinity, 1.25, 0.58, 1.0, 0.5]];

  /**
   * 処方から、枠入れレンズの検査で使う許容差を求める。
   * @param rx { R?: {sph, cyl, ax, prism, prismBase}, L?: {...} }
   * @returns {
   *   eyes: { R?: {power, cyl, axis}, L?: ... },   各眼の後面頂点屈折力・乱視屈折力（D）・乱視軸（°、規定なしは null）
   *   imbalance: {S, h, v, hMm, vMm},             プリズムインバランスの許容差（Δ）と、それに相当する左右合計の心取り誤差（mm）
   *   thickness: 0.3,                              厚さ（mm、5.4）
   *   fitting: 1.0,                                フィッティングポイントの位置（mm、5.5.2。姿勢指定付き単焦点・累進）
   * }
   */
  function tolerances(rx) {
    const out = { eyes: {}, thickness: 0.3, fitting: 1.0 };
    let S = 0, ph = 0, pv = 0;
    for (const e of ['R', 'L']) {
      const r = rx[e];
      if (!r) continue;
      const sph = r.sph || 0, cyl = r.cyl || 0, ac = Math.abs(cyl);
      const big = Math.max(Math.abs(sph), Math.abs(sph + cyl));
      S = Math.max(S, big);
      const row = POWER_TOL.find(t => big <= t[0] + 1e-9);
      const col = ac <= 0.75 ? 0 : ac <= 4 ? 1 : ac <= 6 ? 2 : 3;
      const ax = ac < 0.12 ? null : AXIS_TOL.find(t => ac <= t[0] + 1e-9)[1];
      out.eyes[e] = { power: row[1], cyl: ac ? row[2][col] : null, axis: ax };
      const c = prismToComponents(e, r.prism, r.prismBase);
      ph = Math.max(ph, Math.abs(c.h)); pv = Math.max(pv, Math.abs(c.v));
    }
    const rowH = IMBALANCE_TOL.find(t => ph <= t[0] + 1e-9), rowV = IMBALANCE_TOL.find(t => pv <= t[0] + 1e-9);
    const h = S <= 3.37 ? rowH[1] : rowH[2] + 0.2 * S;
    const v = S <= 5.0 ? rowV[3] : rowV[4] + 0.1 * S;
    // プレンティスの式（Δ = 0.1 × 偏心 mm × D）で、許容差を左右合計の心取り誤差に直す
    out.imbalance = { S, h, v, hMm: S ? (10 * h) / S : Infinity, vMm: S ? (10 * v) / S : Infinity };
    return out;
  }

  return { TIND, MATERIALS, resample, radiusAt, fromVCA, sagAt, fitFrameCurve, parseDrill, placeDrills, sagSphere, sagBiconic, autoBase, build, edgeProfile, edgePlane, mesh, records, opticalCenter, prismFromComponents, prismToComponents, tolerances };
});
