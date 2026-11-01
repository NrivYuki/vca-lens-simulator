// 読み込み(fromVCA)と厚みの書き出し(thicknessVCA)が DCS v3.14 の決まりを守るかのテスト。番号は docs/conformance.md の表の番号
// 期待値は規格書の文から決めている(各テストに節を書く)
'use strict';
const assert = require('node:assert/strict');
const spec = require('./spec.js');
const Lens = require('../lens.js');

const CRLF = '\r\n';
const file = (...ls) => ls.join(CRLF) + CRLF;
const ring = (r, n = 40) => Array(n).fill(r);
const rLines = vals => { const out = []; for (let i = 0; i < vals.length; i += 10) out.push('R=' + vals.slice(i, i + 10).join(';')); return out; };
const trace = (eye, vals) => [`TRCFMT=1;${vals.length};E;${eye};F`, ...rLines(vals)];
const withTrace = (...ls) => file('REQ=FIL', 'JOB=A1', ...ls, ...trace('R', ring(2500)), ...trace('L', ring(2500)));

const circle = r => ({ radii: Array(360).fill(r), hbox: 2 * r, vbox: 2 * r });
const base = { sph: -2, cyl: 0, ax: 0, n: 1.6, base: 3, minCT: 1.2, minEdge: 0.8 };
const model = p => Lens.build(circle(25), Object.assign({}, base, p));
const opts = o => Object.assign({ job: 'A1', n: 1.6, minCT: 1.2, minEdge: 0.8 }, o);
const vca = (p, o, eyes = ['R', 'L']) => {
  const models = {};
  for (const e of eyes) models[e] = model(p);
  return Lens.thicknessVCA(models, opts(o));
};
function lines(text) {
  assert.ok(text.endsWith(CRLF), '最後の行も CR LF で終わる');
  return text.slice(0, -2).split(CRLF);
}
const label = l => l.slice(0, l.indexOf('='));
const fields = l => l.slice(l.indexOf('=') + 1).split(';');
const CHIRAL = ['LIND', 'FRNT', 'CTHICK', 'THKP', 'THKA', 'THKR', 'THNP', 'THNA', 'THNR', 'MINCTR', 'MINEDG', 'BEVP', 'BEVM', 'BEVC', 'BEVANG', 'GWIDTH', 'GDEPTH'];
// 縁の加工の組み合わせ(ヤゲン・フレームカーブ・Z に沿わせる・溝・平)
const EDGES = [
  { edge: 'bevel', bevelMode: 'front', bevelM: 1.5 }, { edge: 'bevel', bevelMode: 'frame', bevelC: 5 },
  { edge: 'mini', bevelMode: 'trace' }, { edge: 'groove', bevelMode: 'percent', grooveW: 0.6, grooveD: 0.4 }, { edge: 'bevel', bevelMode: 'half' }, { edge: 'flat' },
];

// ==== 送る側(thicknessVCA) ==========================================================
spec('ファイルの 1 行目は REQ=FIL、2 行目は JOB で、CRC・STATUS は書かない(7.5.1・7.5.4・7.5.5)',
  { req: ['R182', 'R183'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const p of EDGES) {
      const ls = lines(vca(p).text);
      assert.equal(ls[0], 'REQ=FIL');
      assert.equal(ls[1], 'JOB=A1');
      assert.deepEqual(ls.filter(l => ['CRC', 'STATUS'].includes(label(l))), []);
    }
  });

spec('読み込んだファイルに JOB が無ければ JOB=?(表 A.2 の JOB、7.5.4)',
  { req: ['R225'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const job of [undefined, '', '?']) assert.equal(lines(vca({ edge: 'flat' }, { job }).text)[1], 'JOB=?', JSON.stringify(job));
    // 読み込みから書き出しまで: JOB=? のファイルは JOB=?
    const d = Lens.fromVCA(file('REQ=FIL', 'JOB=?', ...trace('R', ring(2500))));
    assert.equal(lines(vca({ edge: 'flat' }, { job: d.job }).text)[1], 'JOB=?');
  });

spec('読み込んだ JOB が規格に合わなければ(13 文字以上・予約文字・制御文字)、JOB=? と書いて知らせる(5.1.8.1・5.1.8.3・5.1.7.1・5.1.7.2)',
  { req: ['5.1.8.3', '5.1.8.1', 'O004', 'R007'], kind: ['正常', '境界', '異常'], side: '送る' }, () => {
    assert.equal(lines(vca({ edge: 'flat' }, { job: 'ABCDEFGHIJKL' }).text)[1], 'JOB=ABCDEFGHIJKL', '12 文字は書く');
    assert.equal(lines(vca({ edge: 'flat' }, { job: 'A B\x7f' }).text)[1], 'JOB=A B\x7f', '32・127 は書ける');
    for (const job of ['ABCDEFGHIJKLM', 'A;B', 'A=B', 'A,B', 'A*B', 'A?B', 'A|B', 'A\tB', 'Ａ1']) {
      const v = vca({ edge: 'flat' }, { job });
      assert.equal(lines(v.text)[1], 'JOB=?', JSON.stringify(job));
      assert.ok(v.warnings.some(w => w.includes('JOB=?')), JSON.stringify(job));
    }
  });

spec('左右のレコードは 右眼;左眼 の 2 つの値。計算していない眼は ? で、; は省かない(5.1・5.1.4・A.1.1.3)',
  { req: ['R003', 'R005', 'R206'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const p of EDGES) {
      for (const eyes of [['R', 'L'], ['R'], ['L']]) {
        for (const l of lines(vca(p, {}, eyes).text).filter(l => CHIRAL.includes(label(l)))) {
          const f = fields(l);
          assert.equal(f.length, 2, l);
          assert.deepEqual(f.map(v => v === '?'), [!eyes.includes('R'), !eyes.includes('L')], l);
        }
      }
    }
  });

spec('縁の加工の値(BEVP・BEVM・BEVC・BEVANG)も左右の 2 つの値で書く(A.1.1.3)',
  { req: ['R003', 'R206'], kind: ['正常'], side: '送る' }, () => {
    const t = vca({ edge: 'bevel', bevelMode: 'frame', bevelC: 5, bevelM: 1, bevelAngle: 110 }).text;
    for (const [lab, v] of [['BEVP', '3;3'], ['BEVM', '1.00;1.00'], ['BEVC', '5.00;5.00'], ['BEVANG', '110;110']]) assert.ok(lines(t).includes(`${lab}=${v}`), lab);
  });

spec('単一のレコード ETYP は値 1 つ。ETYP・BEVP の整数の欄に小数点を書かない(5.1・A.1.1.5.2)',
  { req: ['R207'], kind: ['正常'], side: '送る' }, () => {
    for (const p of EDGES) {
      const ls = lines(vca(p).text);
      assert.match(ls.find(l => label(l) === 'ETYP'), /^ETYP=\d$/);
      const bevp = ls.find(l => label(l) === 'BEVP');
      if (bevp) assert.match(bevp, /^BEVP=\d;\d$/);
    }
  });

// ==== 受ける側(fromVCA) ===========================================================
spec('DRILLE の基準が空欄なら C(箱中心)。? や省略は誤りとして穴にせず、知らせる(5.5.2.2)',
  { req: ['R055'], kind: ['正常', '異常'], side: '受ける' }, () => {
    const ok = Lens.fromVCA(withTrace('DRILLE=R;;1.00;2.00;1.40'));
    assert.deepEqual(ok.drills.map(f => [f.ref, f.x, f.y]), [['C', 1, 2]]);
    for (const bad of ['DRILLE=R;?;1.00;2.00;1.40', 'DRILLE=R']) {
      const d = Lens.fromVCA(withTrace(bad));
      assert.deepEqual(d.drills, [], bad);
      assert.ok(d.warnings.some(w => w.includes('2 番目の欄(基準)')), bad);
    }
  });

spec('DRILLE の眼が空・知らない文字、始点が無い、基準の文字が知らない・E と B に N・T が無いなら、穴にせず知らせる(5.5.2.1・5.5.2.2・5.5.2.4)',
  { req: ['R054', 'R052', 'O014', 'R056', 'R058'], kind: ['正常', '異常'], side: '受ける' }, () => {
    assert.equal(Lens.fromVCA(withTrace('DRILLE=B;ENF;3.00;2.00;1.40')).drills.length, 1, '正しい DRILLE は穴にする');
    for (const bad of ['DRILLE=;C;1.00;2.00', 'DRILLE=X;C;1.00;2.00', 'DRILLE=R;C;;2.00', 'DRILLE=R;C;1.00', 'DRILLE=R;X;1.00;2.00', 'DRILLE=R;E;1.00;2.00']) {
      const d = Lens.fromVCA(withTrace(bad));
      assert.deepEqual(d.drills, [], bad);
      assert.ok(d.warnings.some(w => w.startsWith(bad.replace(/\r\n/g, ''))), bad);
    }
  });

spec('1 つのデータの DRILLE の基準が混ざっていれば、穴を描かず知らせる(5.5.1.5)',
  { req: ['R050'], kind: ['正常', '異常'], side: '受ける' }, () => {
    assert.equal(Lens.fromVCA(withTrace('DRILLE=R;C;1.00;2.00', 'DRILLE=L;CF;-1.00;2.00')).drills.length, 2, '取付面の違いは基準の違いではない');
    const d = Lens.fromVCA(withTrace('DRILLE=R;C;1.00;2.00', 'DRILLE=L;ENF;1.00;2.00'));
    assert.deepEqual(d.drills, []);
    assert.ok(d.warnings.some(w => w.includes('基準が混ざって')));
  });

spec('基準 R(グループの中の相対位置)の穴は、扱えないことを知らせる(5.5.2.2)',
  { req: ['R057'], kind: ['正常', '異常'], side: '受ける' }, () => {
    const d = Lens.fromVCA(withTrace('DRILLE=R;C;1.00;2.00;1.40', 'DRILLE=R;R;2.00;0.00;1.40'));
    assert.equal(d.drills.length, 1);
    assert.ok(d.warnings.some(w => w.includes('相対位置(R)')));
  });

spec('取付面が無ければ前面(F)、種類の欄が無いか 0 なら 1(丸穴・長穴)とみなす(5.5.2.2・5.5.2.9.1)',
  { req: ['R059', 'S017', 'S018'], kind: ['正常', '境界'], side: '受ける' }, () => {
    const d = Lens.fromVCA(withTrace('DRILLE=R;C;1.00;2.00;1.40', 'DRILLE=R;CR;3.00;2.00;1.40;;;;0', 'DRILLE=R;C;5.00;2.00;1.40;;;;2'));
    assert.deepEqual(d.drills.map(f => [f.surface, f.type]), [['F', 1], ['R', 1], ['F', 2]]);
  });

spec('眼 B の穴は右眼の座標で、左眼には左右反転して置く(5.5.2.1)',
  { req: ['R053'], kind: ['正常', '境界'], side: '受ける' }, () => {
    const d = Lens.fromVCA(withTrace('DRILLE=B;C;20.00;3.00;1.40'));
    const at = eye => Lens.placeDrills(d.drills, eye, d.eyes[eye].radii).map(g => [Math.round(g.x * 100) / 100, g.y]);
    assert.deepEqual(at('R'), [[20, 3]]);
    assert.deepEqual(at('L'), [[-20, 3]]);
  });

spec('左右のレコードに値が 1 つなら両眼の値として、片眼だけなら書かれた眼の値として読み、左右で違えば知らせる(5.1・A.1.1.3)',
  { req: ['S002', 'R003'], kind: ['正常', '境界', '異常'], side: '受ける' }, () => {
    assert.equal(Lens.fromVCA(withTrace('BEVM=1.50;1.50')).edging.bevm, 1.5);
    assert.equal(Lens.fromVCA(withTrace('BEVM=1.50')).edging.bevm, 1.5, '値 1 つ');
    assert.equal(Lens.fromVCA(withTrace('BEVM=;1.50')).edging.bevm, 1.5, '左眼だけ');
    assert.equal(Lens.fromVCA(withTrace('FCRV=?;4.00')).fcrv, 4, '右眼が ?');
    const d = Lens.fromVCA(withTrace('BEVC=5.00;6.00'));
    assert.equal(d.edging.bevc, 5);
    assert.ok(d.warnings.some(w => w.includes('BEVC が左右で違います')));
  });

spec('値が ? の欄は「値なし」として読み、前の入力を残す(5.1.4)',
  { req: ['5.1.4'], kind: ['正常', '境界'], side: '受ける' }, () => {
    const d = Lens.fromVCA(withTrace('SPH=?;-2.00', 'CTHICK=?;?'));
    assert.equal(d.eyes.R.rx.sph, undefined);
    assert.equal(d.eyes.L.rx.sph, -2);
    assert.equal(d.eyes.R.rx.ct, undefined);
  });

spec('右眼だけ・左眼だけの玉形も誤りにせず読み、反対の眼は左右反転で作る(5.4.13)',
  { req: ['R039', 'R037'], kind: ['正常', '境界'], side: '受ける' }, () => {
    // 右上(30-60°)だけへこんだ形。左右反転すると、へこみは左上(120-150°)に来る
    const vals = Array.from({ length: 360 }, (_, i) => (i >= 30 && i <= 60 ? 2000 : 2500));
    for (const [eye, other] of [['R', 'L'], ['L', 'R']]) {
      const d = Lens.fromVCA(file('REQ=FIL', 'JOB=A1', ...trace(eye, vals)));
      assert.deepEqual(d.errors, []);
      assert.equal(d.eyes[other].mirrored, true);
      assert.ok(Math.abs(d.eyes[eye].radii[45] - 20) < 0.05 && Math.abs(d.eyes[other].radii[135] - 20) < 0.05, eye);
    }
  });

spec('データの玉形の眼が B なら右眼として読み、左眼は左右反転で作って知らせる(5.4.12.3)',
  { req: ['R037'], kind: ['異常'], side: '受ける' }, () => {
    const vals = Array.from({ length: 360 }, (_, i) => (i >= 30 && i <= 60 ? 2000 : 2500));
    const d = Lens.fromVCA(file('REQ=FIL', 'JOB=A1', ...trace('B', vals)));
    assert.ok(d.warnings.some(w => w.includes('「B」')));
    assert.equal(d.eyes.R.mirrored, false);
    assert.equal(d.eyes.L.mirrored, true);
    assert.ok(Math.abs(d.eyes.R.radii[45] - 20) < 0.05 && Math.abs(d.eyes.L.radii[135] - 20) < 0.05, '左眼は反転');
  });

spec('片眼の玉形で CIRC の左右が違えば、反対の眼の大きさを変えないことを知らせる(5.4.9.4)',
  { req: ['R033'], kind: ['正常', '異常'], side: '受ける' }, () => {
    const one = c => Lens.fromVCA(file('REQ=FIL', 'JOB=A1', c, ...trace('R', ring(2500))));
    assert.ok(one('CIRC=157.08;160.00').warnings.some(w => w.includes('CIRC の左右が違います')));
    for (const c of ['CIRC=157.08;157.08', 'CIRC=157.08;']) assert.ok(!one(c).warnings.some(w => w.includes('CIRC')), c);
    assert.ok(!Lens.fromVCA(withTrace('CIRC=157.08;160.00')).warnings.some(w => w.includes('CIRC の左右')), '両眼なら知らせない');
  });

spec('廃止された DRILL は読まず、DRILLE を使うよう知らせる(5.5.1.1)',
  { req: ['5.5.1.1'], kind: ['正常', '異常'], side: '受ける' }, () => {
    const d = Lens.fromVCA(withTrace('DRILL=1;2;3'));
    assert.deepEqual(d.drills, []);
    assert.ok(d.warnings.some(w => w.includes('DRILL レコード(古い形式)')));
    assert.ok(!Lens.fromVCA(withTrace('DRILLE=R;C;1.00;2.00')).warnings.some(w => w.includes('DRILL レコード')));
  });
