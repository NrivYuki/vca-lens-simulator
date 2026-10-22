/* node --test tests/ で実行する */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Lens = require('../lens.js');

const circle = (r, n = 360) => ({ radii: Array(n).fill(r), hbox: 2 * r, vbox: 2 * r });
const base = { sph: 0, cyl: 0, ax: 0, n: 1.6, base: 3, minCT: 1.2, minEdge: 0.8, edge: 'flat' };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);

test('球面のマイナスレンズの縁厚が、式で求めた値と合う', () => {
  const m = Lens.build(circle(25), Object.assign({}, base, { sph: -4 }));
  const k = 600, c1 = 3 / 530;
  const F1eff = c1 * k / (1 - (m.ct / 1000 / 1.6) * c1 * k);
  const c2 = -(-4 - F1eff) / k;
  const sag = c => c * 625 / (1 + Math.sqrt(1 - c * c * 625));
  near(m.ct, 1.2, 1e-9, '中心厚');
  for (const e of m.edge) near(e.t, 1.2 + sag(c2) - sag(c1), 1e-6, '縁厚');
});

test('プラスレンズは最も薄い縁が最小縁厚になるように中心厚を決める', () => {
  const m = Lens.build(circle(25), Object.assign({}, base, { sph: 3, base: 6 }));
  near(m.thn.t, 0.8, 0.01, '最薄の縁');
  // 薄いレンズの近似 P·r²/(2000(n−1)) + 最小縁厚 ≒ 2.36 mm
  near(m.ct, 3 * 625 / 1200 + 0.8, 0.1, `中心厚 ${m.ct}`);
});

test('乱視軸 0° のマイナス乱視は、上下の縁が左右より厚い', () => {
  const m = Lens.build(circle(25), Object.assign({}, base, { sph: -2, cyl: -2, ax: 0 }));
  const at = deg => m.edge[deg].t;
  assert.ok(at(90) > at(0) + 1, `90°: ${at(90)}, 0°: ${at(0)}`);
  near(at(90), at(270), 1e-6);
  near(at(0), at(180), 1e-6);
});

test('右眼の光学中心が鼻側（+x）にあると、マイナスレンズは耳側（−x）が厚い', () => {
  const oc = Lens.opticalCenter('R', 50, 40, 18, 31, 20);
  near(oc.x, 3, 1e-9); near(oc.y, 0, 1e-9);
  const m = Lens.build(circle(25), Object.assign({}, base, { sph: -4, ocX: oc.x, ocY: oc.y }));
  assert.strictEqual(Math.round(m.thk.a), 180);
  assert.strictEqual(Math.round(m.thn.a), 0);
  const L = Lens.opticalCenter('L', 50, 40, 18, 31, 20);
  near(L.x, -3, 1e-9);
});

test('プリズムは基底の向きの縁を厚くする', () => {
  const m = Lens.build(circle(25), Object.assign({}, base, { sph: -1, prism: 2, prismBase: 90 }));
  assert.ok(m.edge[90].t > m.edge[270].t + 1, `${m.edge[90].t} / ${m.edge[270].t}`);
});

test('メッシュは閉じていて、外向きで、体積が正しい', () => {
  for (const edge of ['flat', 'bevel', 'groove']) {
    const m = Lens.build(circle(25), Object.assign({}, base, { sph: -4, edge }));
    const g = Lens.mesh(m, { step: 2, rings: 40 });
    // 同じ位置の頂点をまとめて、すべての辺がちょうど 2 枚の三角形に共有されることを確かめる
    const key = i => [0, 1, 2].map(k => g.positions[i * 3 + k].toFixed(4)).join(',');
    const id = new Map(), canon = i => { const s = key(i); if (!id.has(s)) id.set(s, id.size); return id.get(s); };
    const edges = new Map();
    let vol = 0;
    for (let t = 0; t < g.indices.length; t += 3) {
      const v = [0, 1, 2].map(k => canon(g.indices[t + k]));
      if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3], s = a + '>' + b;
        edges.set(s, (edges.get(s) || 0) + 1);
      }
      const P = [0, 1, 2].map(k => [0, 1, 2].map(c => g.positions[g.indices[t + k] * 3 + c]));
      vol += (P[0][0] * (P[1][1] * P[2][2] - P[1][2] * P[2][1]) - P[0][1] * (P[1][0] * P[2][2] - P[1][2] * P[2][0]) + P[0][2] * (P[1][0] * P[2][1] - P[1][1] * P[2][0])) / 6;
    }
    for (const [s, c] of edges) {
      const [a, b] = s.split('>');
      assert.strictEqual(c, 1, `${edge}: 辺 ${s} が同じ向きで ${c} 回`);
      assert.ok(edges.has(b + '>' + a), `${edge}: 辺 ${s} の相手が無い`);
    }
    // 体積の目安：厚みを面積で積分した値
    let est = 0;
    const N = 400;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = -25 + (i + 0.5) * 50 / N, y = -25 + (j + 0.5) * 50 / N;
      if (x * x + y * y < (edge === 'bevel' ? 24.4 : 25) ** 2) est += m.thick(x, y) * (50 / N) ** 2;
    }
    assert.ok(vol > 0, `${edge}: 体積が負（内向き）`);
    assert.ok(Math.abs(vol - est) / est < (edge === 'flat' ? 0.01 : 0.03), `${edge}: 体積 ${vol} / 目安 ${est}`);
  }
});

test('VCA のサンプルから両眼の玉形を読み込める', () => {
  const text = fs.readFileSync(path.join(__dirname, '../samples/frame-both.vca'), 'latin1');
  const d = Lens.fromVCA(text);
  assert.deepStrictEqual(d.errors, []);
  near(d.eyes.R.hbox, 52.27, 0.05); near(d.eyes.R.vbox, 38.45, 0.05);
  assert.strictEqual(d.dbl, 18);
  assert.strictEqual(d.eyes.R.rx.ipd, 31.5);
  assert.strictEqual(d.eyes.L.rx.ipd, 31);
  const one = Lens.fromVCA(fs.readFileSync(path.join(__dirname, '../samples/frame-right.vca'), 'latin1'));
  assert.ok(one.eyes.L.mirrored);
  near(one.eyes.L.hbox, one.eyes.R.hbox, 0.01);
});

test('プリズムの成分表示と 360° 表示を相互に直せる', () => {
  // 右眼の基底内方は 0°、左眼の基底内方は 180°、上方は 90°
  assert.deepStrictEqual(Lens.prismFromComponents('R', 2, 0), { prism: 2, base: 0 });
  assert.deepStrictEqual(Lens.prismFromComponents('L', 2, 0), { prism: 2, base: 180 });
  near(Lens.prismFromComponents('R', 0, -1).base, 270, 1e-9);
  const p = Lens.prismFromComponents('L', -3, 4);
  near(p.prism, 5, 1e-9);
  const c = Lens.prismToComponents('L', p.prism, p.base);
  near(c.h, -3, 1e-9); near(c.v, 4, 1e-9);
});

test('許容差は JIS T 7337（ISO 21987）の表の値になる', () => {
  const t = Lens.tolerances({ R: { sph: -4, cyl: -1, ax: 180 }, L: { sph: -3.5, cyl: -0.5, ax: 10 } });
  assert.strictEqual(t.eyes.R.power, 0.12);   // 5.00 D は 3.00 を超え 6.00 以下
  assert.strictEqual(t.eyes.R.cyl, 0.12);     // 乱視 1.00 D は 0.75 を超え 4.00 以下
  assert.strictEqual(t.eyes.R.axis, 4);       // 1.00 D は 0.75 を超え 1.50 以下
  assert.strictEqual(t.eyes.L.axis, 9);
  near(t.imbalance.S, 5, 1e-9);
  near(t.imbalance.h, 1.0, 1e-9);             // 0.2 × 5.00
  near(t.imbalance.v, 0.5, 1e-9);             // 5.00 D 以下は 0.50Δ
  near(t.imbalance.hMm, 2, 1e-9);
  const low = Lens.tolerances({ R: { sph: 1, cyl: 0 } });
  assert.strictEqual(low.eyes.R.cyl, null); assert.strictEqual(low.eyes.R.axis, null);
  near(low.imbalance.h, 0.67, 1e-9);
  const prism = Lens.tolerances({ R: { sph: -6, prism: 4, prismBase: 0 }, L: { sph: -6 } });
  near(prism.imbalance.h, 0.33 + 1.2, 1e-9);  // 2〜10Δ の行、0.33 + 0.2S
});

test('ヤゲンの位置は DCS の BEVP の決め方に従う', () => {
  const b = Object.assign({}, base, { sph: -4, edge: 'bevel', bevelH: 0.6, bevelAngle: 110 });
  const front = Lens.build(circle(25), Object.assign({}, b, { bevelMode: 'front', bevelM: 1.5 }));
  for (const e of front.edge) near(e.zf - e.zApex, 1.5, 1e-9);
  const back = Lens.build(circle(25), Object.assign({}, b, { bevelMode: 'back', bevelM: 1.2 }));
  for (const e of back.edge) near(e.zApex - e.zb, 1.2, 1e-9);
  const half = Lens.build(circle(25), Object.assign({}, b, { bevelMode: 'half' }));
  for (const e of half.edge) near(e.zf - e.zApex, e.t / 2, 1e-9);
  const pct = Lens.build(circle(25), Object.assign({}, b, { bevelMode: 'percent', bevelM: 30 }));
  for (const e of pct.edge) near(e.zf - e.zApex, 0.3 * e.t, 1e-9);
  // フレームカーブ：山は箱中心を軸にした BEVC の球面に乗り、前面にいちばん近いところで BEVM mm
  const oc = Lens.opticalCenter('R', 50, 50, 18, 31, 25);
  const fr = Lens.build(circle(25), Object.assign({}, b, { ocX: oc.x, bevelMode: 'frame', bevelC: 5, bevelM: 1 }));
  const gaps = fr.edge.map(e => e.zf - e.zApex);
  near(Math.min(...gaps), 1, 1e-6);
  const cB = 5 / 530, z0 = fr.edge[0].zApex + Lens.sagSphere(cB, fr.edge[0].re ** 2);
  for (const e of fr.edge) near(e.zApex, z0 - Lens.sagSphere(cB, e.re ** 2), 1e-6);
});

test('三面図は A3 横・推奨尺度で描かれ、数値に NaN を含まない', () => {
  const Drawing = require('../drawing.js');
  const text = fs.readFileSync(path.join(__dirname, '../samples/frame-both.vca'), 'latin1');
  const d = Lens.fromVCA(text);
  for (const edge of ['bevel', 'mini', 'groove', 'flat']) {
    const e = d.eyes.R, oc = Lens.opticalCenter('R', e.hbox, e.vbox, 18, 31.5, 21);
    const m = Lens.build(e, Object.assign({}, base, { sph: -4, cyl: -1, ax: 180, ocX: oc.x, ocY: oc.y, edge }));
    const svg = Drawing.threeView(m, { eye: 'R', title: 'test' });
    assert.ok(svg.includes('width="420mm" height="297mm"'));
    assert.ok(/>2:1</.test(svg), `${edge}: 尺度が 2:1 でない`);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${edge}: 数値が壊れている`);
    assert.strictEqual((svg.match(/<svg/g) || []).length, 1);
  }
});

// ---- 公開されている計算例との照合（docs/validation.md） ----

test('平凹レンズの縁の増分は、K 値の表（近似式）と 3% 以内で合う', () => {
  // Laramy-K「Methods for Estimating Lens Thickness」Table 1、Hard Resin（n = 1.498）
  const K = { 40: 0.40, 50: 0.63, 60: 0.90, 70: 1.23, 80: 1.60 };
  for (const [d, k] of Object.entries(K)) {
    const m = Lens.build(circle(d / 2), Object.assign({}, base, { sph: -4, n: 1.498, base: 0.0001, ct: 2 }));
    const got = (m.thk.t - 2) / 4;
    // 表は近似式（半径² × D / 2000(n − 1)）の値で、正確なサグはそれより少し大きい
    assert.ok(got >= k - 0.01 && got <= k * 1.03 + 0.01, `直径 ${d}: K ${got.toFixed(3)} / 表 ${k}`);
  }
});

test('乱視・偏心のある計算例（−3.00 −1.00 × 45、偏心 3 mm）と 0.35 mm 以内で合う', () => {
  // 同資料の例：ED 54、偏心 (52 + 16 − 62) / 2 = 3 mm、Spectralite（n = 1.537）、中心厚 1.0 → 耳側の縁 約 3.91 mm
  //（資料では実際のレンズとの差は 0.15 mm 以内。資料のレンズは非球面で、計算は薄いレンズの近似）
  const m = Lens.build(circle(27), Object.assign({}, base, { sph: -3, cyl: -1, ax: 45, n: 1.537, base: 3, ocX: 3, ct: 1.0 }));
  const temporal = m.edge[180].t;   // 右眼で光学中心を鼻側（+x）へ偏心したときの耳側
  near(temporal, 3.91, 0.35, '耳側の縁');
});

test('球面のセミフィニッシュトブランクの縁厚が、メーカーの公表値と 0.25 mm 以内で合う', () => {
  // ZEISS Single Vision Fact Sheets（2023）synchrony Semi-Finished SV Spherical 1.59、直径 74 mm
  // [前面の曲率半径 mm, 後面カーブ（D、1.530 基準）, 中心厚, 公表の縁厚]
  const rows = [[883.33, -5.75, 10.6, 17.8], [229.44, -5.75, 8.8, 13.7], [117.52, -5.75, 8.7, 10.5], [84.94, -5.75, 9.2, 8.5], [66.17, -8.0, 7.2, 7.2]];
  const r2 = 37 * 37;
  for (const [R1, back, ct, et] of rows) {
    const e = ct + Lens.sagSphere(-back / ((Lens.TIND - 1) * 1000), r2) - Lens.sagSphere(1 / R1, r2);
    near(e, et, 0.25, `前面 R${R1}`);
  }
});

test('トレースの Z データ（ZFMT）を読み、フレームカーブを求め、ヤゲンを沿わせられる', () => {
  // samples/frame-3d.vca は、玉形中心を軸とする 5.00 D（TIND 1.53）の球面に乗るフレームとして作ったもの
  const d = Lens.fromVCA(fs.readFileSync(path.join(__dirname, '../samples/frame-3d.vca'), 'latin1'));
  assert.deepStrictEqual(d.errors, []);
  for (const e of ['R', 'L']) {
    near(d.eyes[e].frameCurve, 5.0, 0.03, `${e} のフレームカーブ`);
    near(Math.min(...d.eyes[e].frameZ), 0, 0.02, `${e} のいちばん前`);
  }
  assert.strictEqual(d.edging.bevp, 3);
  const e = d.eyes.R, oc = Lens.opticalCenter('R', e.hbox, e.vbox, 18, 31.5, 21);
  const m = Lens.build(e, Object.assign({}, base, { sph: -6, base: 5, ocX: oc.x, ocY: oc.y, edge: 'bevel', bevelMode: 'trace', bevelM: 1.5 }));
  // 山の高さは「フレームの奥行き + 一定のずれ」。ずれは、前面にいちばん近いところで前面から 1.5 mm になる値。
  // 縁が薄くて山が収まらないところは縁の中に寄せるので、収まっているところだけ比べる
  const shift = Math.min(...m.edge.map(x => x.zf + e.frameZ[x.i])) - 1.5;
  let free = 0;
  for (const x of m.edge) {
    if (x.zApex < x.zf - x.bevelW / 2 - 1e-9 && x.zApex > x.zb + x.bevelW / 2 + 1e-9) { near(x.zApex, shift - e.frameZ[x.i], 1e-6); free++; }
  }
  assert.ok(free > m.edge.length / 2, `山が縁に収まっている点が少ない（${free}）`);
});

test('三面図を DXF（R12）にできる', () => {
  const Drawing = require('../drawing.js');
  const d = Lens.fromVCA(fs.readFileSync(path.join(__dirname, '../samples/frame-both.vca'), 'latin1'));
  const e = d.eyes.R, oc = Lens.opticalCenter('R', e.hbox, e.vbox, 18, 31.5, 21);
  const m = Lens.build(e, Object.assign({}, base, { sph: -4, cyl: -1, ax: 180, ocX: oc.x, ocY: oc.y, edge: 'bevel' }));
  const dxf = Drawing.toDXF(Drawing.threeView(m, { eye: 'R', title: '右眼レンズ' }));
  assert.ok(dxf.includes('$ACADVER\n1\nAC1009'));
  assert.ok(dxf.trimEnd().endsWith('0\nEOF'));
  for (const l of Object.keys(Drawing.DXF_LAYERS)) assert.ok(dxf.includes(`0\nLAYER\n2\n${l}\n`), `画層 ${l}`);
  assert.ok(dxf.includes('\\U+53F3\\U+773C'), '日本語は \\U+ で書く');   // 「右眼」
  assert.ok(!/NaN|undefined|Infinity/.test(dxf));
  // POLYLINE と SEQEND の数が合う
  assert.strictEqual((dxf.match(/\n0\nPOLYLINE\n/g) || []).length, (dxf.match(/\n0\nSEQEND\n/g) || []).length);
  // ハッチングの線は断面の中にある
  const hs = Drawing.hatchLines([[0, 0], [10, 0], [10, 4], [0, 4]], 1);
  assert.ok(hs.length > 5);
  for (const [a, b] of hs) for (const [x, y] of [a, b]) assert.ok(x >= -1e-9 && x <= 10 + 1e-9 && y >= -1e-9 && y <= 4 + 1e-9);
});

test('穴あけ（DRILLE）を読み、基準（中心・縁・外接長方形）と眼に合わせて置ける', () => {
  assert.deepStrictEqual(Lens.parseDrill(['0']), { side: '0' });
  assert.ok(Lens.parseDrill(['X', 'C', '1', '2']).error);
  assert.ok(Lens.parseDrill(['B', 'E', '1', '2']).error, 'E には N・T が要る');
  const radii = Array(360).fill(25);
  const f = [Lens.parseDrill('B;ENF;3.0;2.0;1.4'.split(';')), Lens.parseDrill('B;BT;2;0;1.2'.split(';')), Lens.parseDrill('B;C;-17;10'.split(';')), Lens.parseDrill('R;C;5;5'.split(';'))];
  const R = Lens.placeDrills(f, 'R', radii), L = Lens.placeDrills(f, 'L', radii);
  // 右眼：鼻側は +x。縁から中心向きに 3 mm
  near(R[0].x, Math.sqrt(625 - 4) - 3, 0.01); near(R[0].y, 2, 1e-9);   // 玉形は 360 角形なので円とは少し違う
  near(R[1].x, -25 + 2, 1e-9);
  near(R[2].x, -17, 1e-9);
  assert.strictEqual(R.length, 4); assert.strictEqual(L.length, 3, '右眼だけの指定は左眼に置かない');
  // 左眼：鼻側は −x。両眼の指定は右眼のデータを左右反転
  near(L[0].x, -(Math.sqrt(625 - 4) - 3), 0.01);
  near(L[1].x, 25 - 2, 1e-9);
  near(L[2].x, 17, 1e-9);
  // サンプルの縁なし：穴の位置の厚みが MINDRL（1.8 mm）以上
  const d = Lens.fromVCA(fs.readFileSync(path.join(__dirname, '../samples/frame-rimless.vca'), 'latin1'));
  assert.strictEqual(d.drills.length, 3);
  const e = d.eyes.R, oc = Lens.opticalCenter('R', e.hbox, e.vbox, 18, 31.5, 21);
  const m = Lens.build(e, Object.assign({}, base, { sph: -2.5, cyl: -0.5, ax: 180, ocX: oc.x, ocY: oc.y, minCT: 1.8, minEdge: 1.8, edge: 'flat' }));
  for (const g of Lens.placeDrills(d.drills, 'R', e.radii)) assert.ok(m.thick(g.x, g.y) >= 1.8, `穴 ${g.x.toFixed(1)},${g.y.toFixed(1)}`);
});

test('縁の面の傾き：光学中心が玉形中心なら立ち、下げると「ずらした量 ÷ カーブの半径」ほど傾く', () => {
  const eye = circle(25);
  const at = ocY => Lens.edgePlane(Lens.build(eye, Object.assign({}, base, { sph: -2.5, base: 4, edge: 'bevel', ocY })));
  near(at(0).tiltX, 0, 0.01, '中心');
  near(at(0).tiltY, 0, 0.01, '中心（y 軸まわり）');
  // 前面カーブ 4 D（TIND 1.53）の半径は 132.5 mm。ヤゲンが前面と後面の間に乗るので、前面だけの値より少し大きい
  const t = at(-4).tiltX, front = Math.atan(4 / 132.5) * 180 / Math.PI;
  assert.ok(t < 0 && Math.abs(t) > front * 0.9 && Math.abs(t) < front * 1.6, `4 mm 下げた傾き ${t.toFixed(2)}°（前面だけなら ${front.toFixed(2)}°）`);
  near(at(4).tiltX, -t, 0.01, '上げると逆向き');
});

test('フレーム基準：縁の面を立てる回転は長さを保ち、光学中心をずらした三面図にも NaN が出ない', () => {
  const Drawing = require('../drawing.js');
  const m = Lens.build(circle(25), Object.assign({}, base, { sph: -2.5, base: 4, edge: 'bevel', ocX: 3, ocY: -4 }));
  const zs = m.edge.map(e => m.toFrame([e.x, e.y, e.zApex])[2]), raw = m.edge.map(e => e.zApex);
  const spread = a => Math.max(...a) - Math.min(...a);
  assert.ok(spread(raw) > 1.5 && spread(zs) < 0.15, `縁の高さのばらつき ${spread(raw).toFixed(2)} → ${spread(zs).toFixed(3)} mm`);
  const p = m.toFrame([10, -7, m.plane.c + 2]);
  near(Math.hypot(p[0], p[1], p[2] - m.plane.c), Math.hypot(10, -7, 2), 1e-9, '回しても長さは同じ');
  const svg = Drawing.threeView(m, { eye: 'R', title: 'テスト' });
  assert.ok(!/NaN|Infinity/.test(svg), '数値に NaN・Infinity が無い');
  assert.ok(svg.includes('フレーム基準'), '注記にフレーム基準と書く');
});
