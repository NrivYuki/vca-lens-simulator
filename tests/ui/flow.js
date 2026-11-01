// 3 つのツールの画面をつないだ検査(隣に vca-shape-maker・vca-ptn-converter があるとき)
//   node tests/ui/cdp.js ../vca-shape-maker/index.html tests/ui/flow.js
// vca-shape-maker の画面で形と穴を作る → その VCA をファイルとして vca-ptn-converter の画面に読み込む →
// 書き出す VCA を .vca・.oma・.ptn・.job の名前でこのツールの画面に読み込む、の流れで、形・穴・JOB が保たれるかを確かめる
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
  const shapeHbox = await t.eval(`st.out.hbox`);
  ok(/^REQ=FIL\r\nJOB=FLOW1\r\n/.test(shapeText) && (shapeText.match(/^DRILLE=/gm) || []).length === 2, 'shape-maker: JOB=FLOW1 と穴 2 つ(両眼)の VCA ができる');

  // 2. vca-ptn-converter: shape-maker の VCA をファイルとして読み込み、作り直した VCA を書き出す
  await go('vca-ptn-converter');
  await load('FLOW1.vca', shapeText);
  await set('keep', '0');
  // 画面の書き出しの中身(テキスト欄は改行が LF になるので、書き出すときの CR LF に戻す)
  const ptnText = (await t.eval(`${$('outText')}.value`)).replace(/\r?\n/g, '\r\n');
  ok(/^REQ=FIL\r\nJOB=FLOW1\r\n/.test(ptnText), 'ptn-converter: JOB を引き継ぐ');
  ok(lines(ptnText).filter(l => l.startsWith('DRILLE=')).join('|') === lines(shapeText).filter(l => l.startsWith('DRILLE=')).join('|'), 'ptn-converter: DRILLE をそのまま引き継ぐ');
  const names = await t.eval(`({ vca: ${$('n-vca')}.textContent, ptn: ${$('n-ptn')}.textContent, job: ${$('n-job')}.textContent })`);
  ok(/\.oma$/.test(names.vca) && /\.ptn$/.test(names.ptn) && /\.job$/.test(names.job), `ptn-converter: 保存名 ${names.vca} / ${names.ptn} / ${names.job}`);
  ok(!(await t.eval(`document.querySelector('[data-out=vca]').disabled || document.querySelector('[data-out=ptn]').disabled || document.querySelector('[data-out=job]').disabled`)), 'ptn-converter: VCA・PTN・JOB を保存できる');
  ok((await t.eval(`${$('loadmsgs')}.textContent + ${$('outmsgs')}.textContent`)).indexOf('誤り') < 0, 'ptn-converter: 誤りの知らせが無い');

  // 3. このツール: ptn-converter の書き出しを、4 つの名前(拡張子)で読み込む
  await go('vca-lens-simulator');
  for (const name of ['FLOW1.vca', names.vca, names.ptn, names.job]) {
    await load(name, ptnText);
    const spec = await t.eval(`${$('spec')}.textContent`);
    const errs = await t.eval(`[...document.querySelectorAll('#loadMsgs li.e')].map(li => li.textContent).join(' / ')`);
    ok(spec.startsWith('両眼') && !errs, `このツール: ${name} を両眼として読む(${spec.slice(0, 30)}…)${errs ? ' 誤り: ' + errs : ''}`);
    const hbox = await t.eval(`__sim.models.R.hbox`);
    ok(Math.abs(hbox - shapeHbox) <= 0.02, `このツール: ${name} の玉形幅 ${hbox.toFixed(3)} が shape-maker の ${shapeHbox.toFixed(3)} と同じ`);
    ok(await t.eval(`__sim.models.R.drills.length === 1 && __sim.models.L.drills.length === 1`), `このツール: ${name} の穴が右眼・左眼に 1 つずつ`);
    const out = await t.eval(`${$('vcaOut')}.value`);
    ok(/^REQ=FIL\r?\nJOB=FLOW1\r?\n/.test(out), `このツール: ${name} の厚みの VCA は JOB=FLOW1`);
  }
  await t.shot('flow-lens');
};
