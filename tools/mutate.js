// ミューテーションテスト: 実装の一部をわざと壊し、テストが失敗するかを確かめる(npm run mutate)
//
// テストが「確かめているはずの処理」を本当に確かめているかを調べる。壊してもテストが通るもの(生き残り)は、
// その処理を通る場面をテストが作っていない。生き残りがあれば終了コード 1 で終わる。
//   node tools/mutate.js            すべて試す
//   node tools/mutate.js JOB         名前に「JOB」を含むものだけ試す
// 壊したファイルは各回のあとに元に戻す(途中で Ctrl+C で止めても戻す)。
// 一覧に無い壊し方まで検出できることの保証ではない。規格の決まりを守る処理を足したら、ここにも壊し方を足すこと。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = path.join(__dirname, '..');
const TESTS = ['tests/lens.test.js', 'tests/conformance.test.js', 'tests/flow.test.js'];
const L = 'lens.js';

// [名前, ファイル, 元の文字列, 壊した文字列]。元の文字列はファイルの中にちょうど 1 か所あること(改行は LF で書く)
const M = [
  ['REQ を書かない', L, "      'REQ=FIL', `JOB=${job}`,", "      `JOB=${job}`,"],
  ['JOB を書かない', L, "      'REQ=FIL', `JOB=${job}`,", "      'REQ=FIL',"],
  ['JOB が空でも ? にしない', L, "if (s === '' || s === '?') return '?';", "if (s === '?') return '?';"],
  ['JOB の上限 12 → 13', L, 'if (s.length > 12)', 'if (s.length > 13)'],
  ['JOB の文字の範囲を見ない', L, 'if (/[^\\x20-\\x7f]/.test(s))', 'if (false)'],
  ['JOB の予約文字を見ない', L, 'const bad = s.match(/[;=,*?|]/);', 'const bad = null;'],
  ['規格に合わない JOB をそのまま書く', L, 'try { job = jobValue(o.job); } catch (e) {', 'try { job = o.job === undefined ? jobValue(o.job) : String(o.job); } catch (e) {'],
  ['計算していない眼を空にする', L, "(models[e] ? fn(models[e]) : '?')).join(';');", "(models[e] ? fn(models[e]) : '')).join(';');"],
  ['BEVM を値 1 つにする', L, "BEVM=${both(() => f2(p.bevelM == null ? (p.bevelMode === 'percent' ? 40 : 1) : p.bevelM))}", "BEVM=${f2(p.bevelM == null ? (p.bevelMode === 'percent' ? 40 : 1) : p.bevelM)}"],
  ['ETYP を左右の値にする', L, '`ETYP=${ETYP_CODE[p.edge]}`,', '`ETYP=${both(() => ETYP_CODE[p.edge])}`,'],
  ['BEVP に小数点を付ける', L, 'lines.push(`BEVP=${both(() => BEVP_CODE[p.bevelMode])}`);', 'lines.push(`BEVP=${both(() => f2(BEVP_CODE[p.bevelMode]))}`);'],
  ['DRILLE の基準の ? を C とみなす', L, "if (fields[1].trim() === '?') return", "if (false) return"],
  ['DRILLE の基準の省略を C とみなす', L, "if (fields[1] === undefined) return", "if (false) return"],
  ['DRILLE の眼を確かめない', L, "if (!['R', 'L', 'B', '0'].includes(side)) return", "if (false) return"],
  ['DRILLE の始点を確かめない', L, 'if (x === undefined || y === undefined) return', 'if (false) return'],
  ['DRILLE の E・B の N・T を確かめない', L, "if (!m || ((m[1] === 'E' || m[1] === 'B') && !m[2])) return", 'if (!m) return'],
  ['DRILLE の基準の混ざりを見ない', L, 'if (refs.length > 1) {', 'if (false) {'],
  ['取付面の既定を R にする', L, "surface: m[3] || 'F'", "surface: m[3] || 'R'"],
  ['種類 0 を 1 とみなさない', L, 'const type = n(8) === 2 ? 2 : 1;', 'const type = n(8) === 2 ? 2 : (n(8) ?? 1);'],
  ['左右のレコードを右眼だけ読む', L, 'return r ?? l;', 'return r;'],
  ['左右の違いを知らせない', L, 'if (r !== undefined && l !== undefined && r !== l) out.warnings.push', 'if (false) out.warnings.push'],
  ['眼 B の玉形をそのまま使う', L, "return Object.assign({}, t, { eye: 'R' });", 'return t;'],
  ['CIRC の左右の差を知らせない', L, 'circ.every(Number.isFinite) && Math.abs(circ[0] - circ[1]) >= 0.005', 'false'],
  ['STL に面積 0 の三角形も書く', L, 'if (l > 1e-12) tris.push(', 'if (l >= 0) tris.push('],
  ['STL の三角形の数を書かない', L, 'dv.setUint32(80, tris.length, true);', ''],
  ['DRILL を知らせない', L, "if (r.label === 'DRILL') out.warnings.push", 'if (false) out.warnings.push'],
];

function apply(file, from, to) {
  const p = path.join(repo, file), orig = fs.readFileSync(p, 'utf8');
  const crlf = orig.includes('\r\n'), text = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${file} に「${from.slice(0, 40)}」が ${n} か所あります(1 か所のはず)`);
  const out = text.replace(from, () => to);
  fs.writeFileSync(p, crlf ? out.replace(/\n/g, '\r\n') : out);
  return () => fs.writeFileSync(p, orig);
}

const filter = process.argv[2];
const list = M.filter(m => !filter || m[0].includes(filter));
let restore = null;
process.on('SIGINT', () => { if (restore) restore(); process.exit(130); });
const survived = [];
for (const [name, file, from, to] of list) {
  restore = apply(file, from, to);
  const r = spawnSync(process.execPath, ['--test', ...TESTS], { cwd: repo, encoding: 'utf8' });
  restore(); restore = null;
  const caught = r.status !== 0;
  console.log(`${caught ? '✓ 検出' : '✗ 生き残り'}  ${name}`);
  if (!caught) survived.push(name);
}
console.log(`${list.length} 通り中 ${list.length - survived.length} 通りを検出`);
process.exitCode = survived.length ? 1 : 0;
