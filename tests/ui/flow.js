// 3 つのツールの画面をつないだ検査(隣に vca-shape-maker・vca-ptn-converter があるとき)
//   node tests/ui/cdp.js ../vca-shape-maker/index.html tests/ui/flow.js
// vca-shape-maker の画面で形と穴を作る → その VCA をファイルとして vca-ptn-converter の画面に読み込み、VCA と DXF を保存する →
// 保存した DXF を vca-ptn-converter で読み込み直して VCA を保存する(VCA → DXF → VCA) →
// 保存した VCA を .oma・.vca・.ptn・.job の名前で、DXF を通った VCA も、このツールの画面に読み込む、の流れで、
// 形・穴・JOB・保存名が保たれるかを確かめる。保存するファイルは、保存のボタンを押して受け取った名前と中身で確かめる
const path = require('path');
const { pathToFileURL } = require('url');
module.exports = async (t) => {
  const ok = (cond, msg) => t.log((cond ? 'OK   ' : 'NG   ') + msg);
  const $ = id => `document.getElementById(${JSON.stringify(id)})`;
  const page = repo => pathToFileURL(path.join(__dirname, '..', '..', '..', repo, 'index.html')).href;
  const go = async repo => { await t.eval(`location.href = ${JSON.stringify(page(repo))}`); await t.sleep(3500); };
  const set = async (id, v) => { await t.eval(`(() => { const e = ${$(id)}; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); })()`); await t.sleep(300); };
  // ファイルを選んだときと同じように読み込む
  const load = async (name, text) => {
    await t.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)})); const f = ${$('file')}; f.files = dt.files; f.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await t.sleep(1200);
  };
  const lines = text => text.split(/\r\n/);

  // 1. vca-shape-maker: 箱を描いて形を作り、穴を足し、JOB を入れる
  await t.eval(`document.getElementById('modeBox').click()`);
  await t.eval(`(() => { const c = ${$('stage')}, r = c.getBoundingClientRect();
    const ev = (type, fx, fy) => c.dispatchEvent(new PointerEvent(type, { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, button: 0, buttons: 1, bubbles: true, pointerId: 1, isPrimary: true }));
    ev('pointerdown', 0.3, 0.3); for (let k = 1; k <= 5; k++) ev('pointermove', 0.3 + 0.4 * k / 5, 0.3 + 0.35 * k / 5); ev('pointerup', 0.7, 0.65); })()`);
  await t.sleep(400);
  await t.eval(`document.querySelector('.tabs [data-pane=hole]').click()`);
  await t.eval(`document.getElementById('holeAdd').click()`); await t.sleep(400);
  await set('job', 'FLOW1'); await t.sleep(300);
  const shapeText = await t.eval(`st.out ? st.out.text : ''`);
  const shapeHbox = await t.eval(`st.out.hbox`), shapeVbox = await t.eval(`st.out.vbox`);
  ok(/^REQ=FIL\r\nJOB=FLOW1\r\n/.test(shapeText) && (shapeText.match(/^DRILLE=/gm) || []).length === 2, 'shape-maker: JOB=FLOW1 と穴 2 つ(両眼)の VCA ができる');

  // 2. vca-ptn-converter: shape-maker の VCA をファイルとして読み込み、作り直した VCA を書き出す
  await go('vca-ptn-converter');
  await load('FLOW1.vca', shapeText);
  await set('keep', '0');
  // 保存のボタンを押して、保存するファイルの名前と中身を受け取る(ダウンロードは止める)
  const saved = sel => t.eval(`new Promise(res => {
    const make = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = click; window.__savedName = this.download; };
    URL.createObjectURL = b => { URL.createObjectURL = make; b.arrayBuffer().then(a => setTimeout(() => res({ name: window.__savedName, body: Array.from(new Uint8Array(a), c => String.fromCharCode(c)).join('') }), 0)); return 'blob:saved'; };
    document.querySelector(${JSON.stringify(sel)}).click();
  })`);
  const ptnVca = await saved('[data-out=vca]'), ptnDxf = await saved('[data-out=dxf]');
  const ptnText = ptnVca.body;
  ok(/^REQ=FIL\r\nJOB=FLOW1\r\n/.test(ptnText), 'ptn-converter: JOB を引き継ぐ');
  ok(lines(ptnText).filter(l => l.startsWith('DRILLE=')).join('|') === lines(shapeText).filter(l => l.startsWith('DRILLE=')).join('|'), 'ptn-converter: DRILLE をそのまま引き継ぐ');
  const names = await t.eval(`({ vca: ${$('n-vca')}.textContent, ptn: ${$('n-ptn')}.textContent, job: ${$('n-job')}.textContent })`);
  ok(names.vca === 'FLOW1.vca' && ptnVca.name === 'FLOW1.vca' && ptnDxf.name === 'FLOW1.dxf' && /\.ptn$/.test(names.ptn) && /\.job$/.test(names.job),
    `ptn-converter: 保存名 ${ptnVca.name} / ${ptnDxf.name} / ${names.ptn} / ${names.job}(VCA は .vca)`);
  ok(!(await t.eval(`document.querySelector('[data-out=vca]').disabled || document.querySelector('[data-out=ptn]').disabled || document.querySelector('[data-out=job]').disabled`)), 'ptn-converter: VCA・PTN・JOB を保存できる');
  ok((await t.eval(`${$('loadmsgs')}.textContent + ${$('outmsgs')}.textContent`)).indexOf('誤り') < 0, 'ptn-converter: 誤りの知らせが無い');
  ok((await t.eval(`${$('outmsgs')}.textContent`)).includes('JOB・FCRV は入らない'), 'ptn-converter: DXF に JOB・FCRV が入らないことを知らせる');

  // 2-2. vca-ptn-converter: 保存した DXF を読み込み直し、VCA を保存する(VCA → DXF → VCA)
  await load(ptnDxf.name, ptnDxf.body);
  ok((await t.eval(`${$('srcinfo')}.textContent`)) === 'FLOW1.dxf(DXF)', 'ptn-converter: 保存した DXF を DXF として読む');
  const npts = (shapeText.match(/^TRCFMT=1;(\d+);/m) || [])[1];
  ok((await t.eval(`${$('nhint')}.textContent`)) === `${npts} 点`, `ptn-converter: DXF から VCA に戻す点数の自動は、元の ${npts} 点`);
  const dxfVca = await saved('[data-out=vca]');
  ok(dxfVca.name === 'FLOW1.vca' && /^REQ=FIL\r\nJOB=\?\r\nDBL=/.test(dxfVca.body) && (dxfVca.body.match(/^DRILLE=[RL];C;/gm) || []).length === 2,
    `ptn-converter: DXF から作った VCA(${dxfVca.name})は JOB=?、穴は両眼に 1 つずつ`);

  // 3. このツール: ptn-converter の書き出しを、4 つの名前(拡張子。.oma は読み込みだけ)で読み込む。DXF を通った VCA も読む
  await go('vca-lens-simulator');
  const cases = [['FLOW1.oma', ptnText, 'FLOW1'], [names.vca, ptnText, 'FLOW1'], [names.ptn, ptnText, 'FLOW1'], [names.job, ptnText, 'FLOW1'], ['FLOW1-dxf.vca', dxfVca.body, '?']];
  for (const [name, text, jobWant] of cases) {
    await load(name, text);
    const spec = await t.eval(`${$('spec')}.textContent`);
    const errs = await t.eval(`[...document.querySelectorAll('#loadMsgs li.e')].map(li => li.textContent).join(' / ')`);
    ok(spec.startsWith('両眼') && !errs, `このツール: ${name} を両眼として読む(${spec.slice(0, 30)}…)${errs ? ' 誤り: ' + errs : ''}`);
    const hbox = await t.eval(`__sim.models.R.hbox`), vbox = await t.eval(`__sim.models.R.vbox`);
    ok(Math.abs(hbox - shapeHbox) <= 0.02 && Math.abs(vbox - shapeVbox) <= 0.02, `このツール: ${name} の玉形 ${hbox.toFixed(3)}×${vbox.toFixed(3)} が shape-maker の ${shapeHbox.toFixed(3)}×${shapeVbox.toFixed(3)} と同じ`);
    ok(await t.eval(`__sim.models.R.drills.length === 1 && __sim.models.L.drills.length === 1`), `このツール: ${name} の穴が右眼・左眼に 1 つずつ`);
    // 保存する厚みの VCA: JOB は読み込んだもの、保存名は JOB(? なら lens)、改行は CR LF
    const th = await saved('#dlVca');
    const stem = jobWant === '?' ? 'lens' : jobWant;
    ok(th.name === `${stem}-thickness.vca` && th.body.startsWith(`REQ=FIL\r\nJOB=${jobWant}\r\n`) && !/[^\r]\n/.test(th.body),
      `このツール: ${name} の厚みの VCA は ${th.name}・JOB=${jobWant}・CR LF`);
    const svg = await saved('#dlSvg'), stl = await saved('#dlStl');
    ok(svg.name === `${stem}-R.svg` && stl.name === `${stem}.stl`, `このツール: ${name} の図面・STL の保存名 ${svg.name} / ${stl.name}`);
  }
  await t.shot('flow-lens');
};
