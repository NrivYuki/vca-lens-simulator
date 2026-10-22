// シミュレータの画面検査
module.exports = async (t) => {
  const ok = (cond, msg) => t.log((cond ? 'OK   ' : 'NG   ') + msg);
  const $ = id => `document.getElementById(${JSON.stringify(id)})`;
  const set = async (id, v) => t.eval(`(() => { const e = ${$(id)}; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('change', {bubbles:true})); e.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  const click = async sel => t.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const text = id => t.eval(`${$(id)}.textContent`);
  const visiblePanes = () => t.eval(`[...document.querySelectorAll('[role=tabpanel]')].filter(p => !p.hidden).map(p => p.id).join(',')`);
  const overflowX = () => t.eval(`document.documentElement.scrollWidth - innerWidth`);

  // 1. はじめの表示
  ok((await text('spec')).startsWith('両眼／玉形'), '上の帯に条件が出る: ' + await text('spec'));
  ok((await text('sum')).includes('中心厚'), '下の帯に結果が出る: ' + await text('sum'));
  ok(await visiblePanes() === 'pane-shape', 'はじめは玉形のタブだけ見える');
  await t.shot('01-start');

  // 2. タブ
  for (const p of ['rx', 'lens', 'res', 'tol', 'vca', 'shape']) {
    await click(`.tabs [data-pane=${p}]`);
    const v = await visiblePanes();
    const sel = await t.eval(`document.querySelector('.tabs [aria-selected=true]').dataset.pane`);
    ok(v === 'pane-' + p && sel === p, `タブ ${p} を押すとその面だけ見える（${v}）`);
  }
  await t.eval(`document.querySelector('.tabs [data-pane=shape]').focus(); document.querySelector('.tabs [data-pane=shape]').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))`);
  ok(await visiblePanes() === 'pane-rx', '右矢印キーで次のタブ');
  ok(await t.eval(`[...document.querySelectorAll('.tabs [role=tab]')].every(b => b.tabIndex === (b.getAttribute('aria-selected') === 'true' ? 0 : -1) && document.getElementById(b.getAttribute('aria-controls'))?.getAttribute('aria-labelledby') === b.id)`), 'タブは選んだものだけ Tab キーで止まり、中身の面と結び付いている');
  await t.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}))`);
  await t.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}))`);
  ok(await visiblePanes() === 'pane-vca', '左矢印キーで前のタブ（端から最後へ回る）');
  ok((await t.eval(`${$('vcaOut')}.value`)).includes('CTHICK='), 'VCA のタブに厚みのレコードが出る');
  await t.shot('02-tab-vca');

  // 3. 結果のタブ（隠れていたグラフが描けているか）
  await click('.tabs [data-pane=res]');
  ok(await t.eval(`${$('graph')}.querySelectorAll('polyline').length`) === 2, '結果のタブに左右のグラフ');
  ok(await t.eval(`${$('resBody')}.rows.length`) >= 9, '結果の表');
  await t.shot('03-tab-res');
  await click('.tabs [data-pane=tol]');
  ok(await t.eval(`${$('tolBody')}.rows.length`) === 7, '許容差の表');

  // 4. サンプルを順に読み込む
  for (const s of ['frame-right', 'frame-uneven', 'frame-3d', 'frame-rimless', 'frame-both']) {
    await set('sample', s); await t.sleep(800);
    t.log(`     ${s}: spec=${await text('spec')} / sum=${await text('sum')}`);
  }
  await set('sample', 'frame-right'); await t.sleep(800);
  ok((await text('loadMsgs')).includes('左右反転'), '右眼だけのファイルは左眼を左右反転して作ると知らせる');
  ok((await text('spec')).startsWith('両眼'), '右眼だけのファイルでも左右反転した左眼と合わせて「両眼」');
  await set('eyes', 'R'); await t.sleep(400);
  ok(await t.eval(`${$('eyes')}.value`) === 'R', '眼の切り替え（右眼だけ表示）');
  await t.shot('04-right-only');
  await set('eyes', 'RL'); await t.sleep(400);
  await set('sample', 'frame-both'); await t.sleep(800);

  // 5. 設定を変えると上の帯が変わる
  await click('.tabs [data-pane=lens]');
  await set('edge', 'flat'); await t.sleep(400);
  ok((await text('spec')).includes('平'), '縁の加工を変えると上の帯が変わる: ' + await text('spec'));
  await set('edge', 'bevel'); await t.sleep(400);
  await click('.tabs [data-pane=rx]');
  await set('dbl', '20'); await t.sleep(400);
  ok((await text('spec')).includes('DBL 20'), 'DBL を変えると上の帯が変わる');
  await set('dbl', '18'); await t.sleep(400);

  // 5b. フレーム基準：OCHT を変えても、3D の縁の面（ヤゲンの山）はまっすぐ立ったまま
  const edgeSlope = () => t.eval(`(() => { const { models, lensRoot, THREE } = window.simInspect; lensRoot.updateMatrixWorld(true);
    return lensRoot.children.map((g, k) => { const lens = g.children[0], m = models[lens.children[0].userData.eye];
      // 縁の点を画面の座標に直し、z を y に当てはめた傾き（度）を返す
      let sy = 0, sz = 0, syy = 0, syz = 0, n = 0;
      for (const e of m.edge) { const p = new THREE.Vector3(e.x, e.y, e.zApex ?? e.zGroove ?? (e.zf + e.zb) / 2).applyMatrix4(lens.matrixWorld); sy += p.y; sz += p.z; syy += p.y * p.y; syz += p.y * p.z; n++; }
      return Math.atan((n * syz - sy * sz) / (n * syy - sy * sy)) * 180 / Math.PI; }); })()`);
  await click('.tabs [data-pane=rx]');
  for (const h of ['21', '17', '25']) {
    await set('R-ocht', h); await set('L-ocht', h); await t.sleep(400);
    const sl = await edgeSlope();
    ok(sl.every(v => Math.abs(v) < 0.05), `OCHT ${h} でも縁の面が立っている（傾き ${sl.map(v => v.toFixed(3)).join(' / ')}°）`);
  }
  await set('R-ocht', '17'); await set('L-ocht', '17'); await t.sleep(300);
  await click('#views [data-v=right]'); await t.sleep(300); await t.shot('05b-ocht17-side');
  await t.eval(`(() => { const e = ${$('worn')}; e.checked = true; e.dispatchEvent(new Event('change', {bubbles:true})); })()`); await t.sleep(300);
  const worn = await edgeSlope();
  ok(worn.every(v => Math.abs(v - 9) < 0.5), `装用状態では前傾角 9° だけ上端が手前に傾く（そり角 5° の分わずかに小さく見える）（${worn.map(v => v.toFixed(2)).join(' / ')}°）`);
  await t.eval(`(() => { const e = ${$('worn')}; e.checked = false; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await set('R-ocht', '21'); await set('L-ocht', '21'); await click('#views [data-v=iso]'); await t.sleep(300);

  // 6. リム
  for (const r of ['cell', '', 'metal']) { await set('rim', r); await t.sleep(300); await t.shot('06-rim-' + (r || 'none')); }

  // 7. 断面・ヤゲン確認・装用状態
  for (const c of ['h', 'v', 'radial', '']) { await set('clip', c); await t.sleep(300); }
  await t.shot('07-clip-off');
  await click('#bevelSpin'); await t.sleep(1200); await t.shot('07-bevelspin'); await click('#bevelSpin');
  await t.eval(`(() => { const e = ${$('worn')}; e.checked = true; e.dispatchEvent(new Event('change', {bubbles:true})); })()`); await t.sleep(300);
  await t.shot('07-worn');
  await t.eval(`(() => { const e = ${$('worn')}; e.checked = false; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);

  // 8. 三面図
  await click('#tab2d'); await t.sleep(800);
  ok(await t.eval(`!!${$('sheet')}.querySelector('svg')`), '三面図が描ける');
  ok(await t.eval(`getComputedStyle(document.querySelector('.g2d')).display !== 'none'`), '三面図のときは表示の倍率が見える');
  await t.shot('08-2d');
  await click('#tab3d'); await t.sleep(500);

  // 9. 書き出し（印刷以外）
  for (const b of ['dlStl', 'dlSvg', 'dlDxf', 'dlVca']) { await click('#' + b); await t.sleep(300); }
  ok(true, '書き出しのボタンを押しても例外が出ない（下の PROBLEMS を見る）');

  // 9b. 縁の加工・位置の決め方・素材・プリズムの表し方をすべて切り替える
  await click('.tabs [data-pane=lens]');
  for (const ed of ['bevel', 'mini', 'groove', 'flat', 'bevel']) {
    await set('edge', ed); await t.sleep(200);
    const rows = await t.eval(`['modeRow','mRow','cRow','hRow','gRow'].map(id => getComputedStyle(${'document.getElementById(id)'}).display !== 'none' ? id : '').filter(Boolean).join(',')`);
    t.log(`     縁 ${ed}: 見える行 ${rows}`);
    for (const bm of ['percent', 'front', 'back', 'half', 'frame']) { await set('bevelMode', bm); await t.sleep(120); }
  }
  await set('bevelMode', 'percent');
  const mats = await t.eval(`[...${$('mat')}.options].map(o => o.value)`);
  for (const m of mats) { await set('mat', m); await t.sleep(150); }
  ok(mats.length >= 3, `素材 ${mats.length} 種類を切り替えても例外なし`);
  await set('mat', '1.60'); await t.sleep(200);
  await click('.tabs [data-pane=rx]');
  await set('prismMode', 'hv'); await t.sleep(200); await set('prismMode', '360'); await t.sleep(200);
  ok(true, 'プリズムの表し方の切り替え');

  // 9c. 平行投影・視点・厚みを測る
  await click('#ortho'); await t.sleep(300); await click('#ortho');
  for (const v of ['front', 'top', 'right', 'left', 'bottom', 'back', 'iso']) await click(`#views [data-v=${v}]`);
  await click('#views [data-v=front]'); await t.sleep(300);
  await click('#resetTilt'); await t.sleep(300);
  // 画面を格子状にクリックして、レンズに当たったところで止める
  await t.eval(`(() => { const c = document.querySelector('#v3d canvas'), r = c.getBoundingClientRect(), pr = document.getElementById('probe');
    for (let fy = 0.3; fy <= 0.7; fy += 0.05) for (let fx = 0.2; fx <= 0.8; fx += 0.05) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      for (const type of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1, isPrimary: true }));
      if (pr.style.display === 'block') return; } })()`);
  await t.sleep(300);
  const probe = await t.eval(`[getComputedStyle(${$('probe')}).display, ${$('probe')}.textContent]`);
  ok(probe[0] !== 'none', '3D をクリックすると厚みが出る: ' + probe[1]);
  await t.shot('09-probe');

  // 9d. 三面図の倍率
  await click('#tab2d'); await t.sleep(500);
  for (const z of ['100', '150', '200', 'fit']) { await set('zoom', z); await t.sleep(200); }
  ok(true, '三面図の倍率の切り替え');
  await click('#tab3d'); await t.sleep(300);

  // 10. ダークモード
  await t.emulate(1280, 800, true); await t.sleep(800);
  await t.shot('10-dark');
  await t.emulate(1280, 800, false); await t.sleep(500);

  // 11. 狭い画面
  for (const w of [375, 768, 1024]) {
    await t.emulate(w, 800); await t.sleep(800);
    const o = await overflowX();
    ok(o <= 0, `幅 ${w}px で横にはみ出さない（${o}px）`);
    await t.shot('11-w' + w);
  }
  await t.emulate(1280, 800); await t.sleep(500);
};
