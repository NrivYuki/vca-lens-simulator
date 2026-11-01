// 3 つのツールをつないだ流れのテスト。隣に vca-shape-maker・vca-ptn-converter があるときだけ動く(無ければ飛ばす)
//   vca-shape-maker の VCA → このツール
//   vca-shape-maker の VCA → vca-ptn-converter(VCA・PTN・JOB・DXF のすべての出力、DXF は読み込んで VCA にする)→ このツール
//   このツールの書き出し(厚みの VCA・三面図の DXF・STL)→ vca-ptn-converter・このツールで読む
// SVG の受け渡し(三面図の SVG・vca-ptn-converter の SVG)はブラウザが要るので、vca-ptn-converter の tests/ui/ で確かめる
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Lens = require('../lens.js');
const Drawing = require('../drawing.js');
const VCA = require('../vca-parser.js');

const sibling = (repo, file) => { const p = path.join(__dirname, '..', '..', repo, file); return fs.existsSync(p) ? require(p) : null; };
const Shape = sibling('vca-shape-maker', 'shape.js');
const Conv = sibling('vca-ptn-converter', 'converter.js');
const skip = Shape && Conv ? false : '../vca-shape-maker か ../vca-ptn-converter が無いので飛ばす';

// 許容差: R の値の 1 単位(0.01 mm)と、折れ線で表した形を測り直すときの弦の誤差を合わせて 0.02 mm
const TOL = 0.02;
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= TOL, `${what}: ${a} / ${b}`);

// shape-maker で作る形: 角の丸い横長の形と、右上の屋根が低い五角形(上下・左右の向きが分かる)
const SHAPES = {
  '角の丸い形': () => Shape.superellipse({ x0: 100, y0: 100, x1: 400, y1: 320 }, [3, 3, 3, 3]),
  '五角形': () => [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 4 }, { x: 3, y: 0 }, { x: 0, y: 4 }],
};
const HOLES = [{ x: 20, y: 3, diameter: 1.4 }, { x: -21, y: 2, diameter: 1.2, xEnd: -18.5, yEnd: 2 }];
const CASES = [];
for (const shape of Object.keys(SHAPES)) for (const eye of ['R', 'L']) for (const n of [360, 1440]) for (const holes of [[], HOLES]) CASES.push({ shape, eye, n, holes });
const caseName = c => `${c.shape}・写した眼 ${c.eye}・${c.n} 点・穴 ${c.holes.length} か所`;
const made = c => Shape.toVCA(SHAPES[c.shape](), { widthMM: 50, groove: 0, eye: c.eye, n: c.n, job: 'FLOW1', holes: c.holes });

// shape-maker が書いた形・穴と、このツールが読んだ形・穴が同じか
function sameAsShape(d, v, c, what, opts = {}) {
  assert.deepEqual(d.errors, [], `${what}: 誤り`);
  assert.deepEqual(d.warnings.filter(w => !/穴|DRILLE/.test(w) || !opts.holesLost), [], `${what}: 知らせ`);
  for (const e of ['R', 'L']) {
    const eye = d.eyes[e];
    assert.equal(eye.mirrored, false, `${what}: ${e} は読んだ玉形`);
    // このツールは 360 方向に測り直すので、shape-maker が書いた半径のうち 1° ごとのものと比べる
    const step = v.radii[e].length / 360, written = v.radii[e].filter((_, i) => i % step === 0);
    written.forEach((r, i) => near(eye.radii[i], r, `${what}: ${e} の ${i}° の半径`));
    near(eye.hbox, v.hbox, `${what}: ${e} の HBOX`);
    near(eye.vbox, v.vbox, `${what}: ${e} の VBOX`);
    if (opts.holesLost) continue;
    // 写した眼の穴は入力どおり、反対の眼は x の符号が反対(箱中心基準)
    const flip = e !== c.eye ? -1 : 1;
    const want = c.holes.map(h => [[h.x * flip, h.y], [(h.xEnd ?? h.x) * flip, h.yEnd ?? h.y]].sort((p, q) => p[0] - q[0]));
    const got = Lens.placeDrills(d.drills, e, eye.radii).map(g => [[g.x, g.y], [g.x2 ?? g.x, g.y2 ?? g.y]].sort((p, q) => p[0] - q[0]));
    assert.equal(got.length, want.length, `${what}: ${e} の穴の数`);
    const key = p => p.flat().join(',');
    want.sort((p, q) => key(p) < key(q) ? -1 : 1); got.sort((p, q) => key(p) < key(q) ? -1 : 1);
    want.forEach((p, i) => p.flat().forEach((x, j) => near(got[i].flat()[j], x, `${what}: ${e} の穴 ${i + 1}`)));
  }
  if (opts.job !== false) assert.equal(d.job, 'FLOW1', `${what}: JOB`);
}

for (const c of CASES) {
  test(`shape-maker → このツール: ${caseName(c)}`, { skip }, () => {
    const v = made(c);
    sameAsShape(Lens.fromVCA(v.text), v, c, '直接');
  });

  test(`shape-maker → ptn-converter(VCA・PTN・JOB・DXF)→ このツール: ${caseName(c)}`, { skip }, () => {
    const v = made(c), set = Conv.fromVCA(v.text);
    for (const keepRecords of [true, false]) {
      // 点数は元のまま(点を減らすと、とがった角が削れて形が変わる)。PTN・JOB は、中身が VCA のテキストを名前と拡張子だけ変えたもの
      const text = Conv.toVCA(set, { n: c.n, job: set.job, dbl: set.dbl, keepRecords }).text;
      sameAsShape(Lens.fromVCA(text), v, c, `VCA・引き継ぎ ${keepRecords}`);
    }
    const fromDxf = Conv.fromDXF(Conv.toDXF(set, { dbl: set.dbl }));
    assert.deepEqual(fromDxf.errors, []);
    const d = Lens.fromVCA(Conv.toVCA(fromDxf, { n: c.n, dbl: fromDxf.dbl }).text);
    sameAsShape(d, v, c, 'DXF → VCA', { job: false });
    assert.equal(d.job, undefined, 'DXF には JOB が無いので JOB=?');
  });
}

test('このツールの厚みの VCA: 規格どおりに読め、玉形が無いことを vca-ptn-converter もこのツールも知らせる', { skip }, () => {
  const v = made(CASES[0]), d = Lens.fromVCA(v.text);
  const models = {};
  for (const e of ['R', 'L']) models[e] = Lens.build(d.eyes[e], { sph: -2, cyl: -0.5, ax: 90, n: 1.6, base: 4, minCT: 1.2, minEdge: 0.8, edge: 'bevel', bevelMode: 'front', bevelM: 1 });
  const text = Lens.thicknessVCA(models, { job: d.job, n: 1.6, minCT: 1.2, minEdge: 0.8 }).text;
  const p = VCA.parse(text);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(VCA.checkOrder(p, { file: true }), []);
  assert.equal(VCA.sideValue(p.rec.JOB, 'R'), 'FLOW1');
  assert.ok(Conv.fromVCA(text).errors.some(e => e.includes('玉形')));
  assert.ok(Lens.fromVCA(text).errors.some(e => e.includes('玉形')));
  // 玉形のファイルに厚みのレコードを足したものは、どちらのツールでも読める
  const merged = v.text + text.split('\r\n').slice(2).join('\r\n');
  assert.deepEqual(Conv.fromVCA(merged).errors, []);
  const back = Lens.fromVCA(merged);
  assert.deepEqual(back.errors, []);
  assert.equal(back.eyes.R.rx.ct, models.R.ct === undefined ? undefined : +models.R.ct.toFixed(2));
});

test('このツールの三面図の DXF: vca-ptn-converter で図形として読める', { skip }, () => {
  const d = Lens.fromVCA(made(CASES[0]).text);
  for (const edge of ['bevel', 'mini', 'groove', 'flat']) {
    const m = Lens.build(d.eyes.R, { sph: -4, cyl: -1, ax: 180, n: 1.6, base: 3, minCT: 1.2, minEdge: 0.8, edge, grooveW: 0.6, grooveD: 0.4 });
    const dxf = Drawing.toDXF(Drawing.threeView(m, { eye: 'R', title: 'flow' }));
    assert.equal(Conv.detect(dxf, 'lens.dxf'), 'dxf');
    const s = Conv.fromDXF(dxf);
    assert.ok(s.contours.length > 0, `${edge}: 閉じた輪郭`);
    assert.ok(s.contours.every(c => c.pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))), `${edge}: 座標`);
  }
});

test('このツールの STL: 三角形の数・大きさ・法線が形式どおりで、網と同じ三角形・同じ体積(縁の加工 4 通り、両眼)', () => {
  const d = Lens.fromVCA(fs.readFileSync(path.join(__dirname, '../samples/frame-both.vca'), 'latin1'));
  const cross = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
  const vol = (a, b, c) => (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  for (const edge of ['bevel', 'mini', 'groove', 'flat']) {
    const parts = ['R', 'L'].map((e, i) => {
      const m = Lens.build(d.eyes[e], { sph: -3, cyl: 0, ax: 0, n: 1.6, base: 4, minCT: 1.2, minEdge: 0.8, edge, grooveW: 0.6, grooveD: 0.4 });
      return [Lens.mesh(m, { step: 1, rings: 48 }), i ? 35 : -35];
    });
    // 網の三角形のうち、面積のあるもの(面積が 0 のものは書かない)と、網の体積
    const want = [];
    let meshVol = 0;
    for (const [g, dx] of parts) {
      const P = i => [g.positions[i * 3] + dx, g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
      for (let t = 0; t < g.indices.length; t += 3) {
        const a = P(g.indices[t]), b = P(g.indices[t + 1]), c = P(g.indices[t + 2]);
        meshVol += vol(a, b, c);
        if (Math.hypot(...cross(a, b, c)) > 1e-12) want.push([a, b, c]);
      }
    }
    const buf = Lens.toSTL(parts), dv = new DataView(buf);
    assert.equal(dv.getUint32(80, true), want.length, `${edge}: 三角形の数`);
    assert.equal(buf.byteLength, 84 + want.length * 50, `${edge}: 大きさ`);
    let stlVol = 0;
    want.forEach(([a, b, c], k) => {
      const f = Array.from({ length: 12 }, (_, j) => dv.getFloat32(84 + k * 50 + j * 4, true));
      assert.ok(Math.abs(Math.hypot(f[0], f[1], f[2]) - 1) < 1e-4, `${edge}: 三角形 ${k} の法線の長さ`);
      const n = cross(a, b, c), l = Math.hypot(...n);
      assert.ok(f[0] * n[0] / l + f[1] * n[1] / l + f[2] * n[2] / l > 0.999, `${edge}: 三角形 ${k} の法線の向き`);
      [a, b, c].forEach((p, v) => p.forEach((x, j) => assert.ok(Math.abs(f[3 + v * 3 + j] - x) < 1e-3, `${edge}: 三角形 ${k} の頂点 ${v}`)));
      stlVol += vol(f.slice(3, 6), f.slice(6, 9), f.slice(9, 12));
    });
    assert.ok(meshVol > 0 && Math.abs(stlVol - meshVol) / meshVol < 1e-4, `${edge}: 体積 ${stlVol} / ${meshVol}`);
  }
});
