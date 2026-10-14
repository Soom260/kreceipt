// 화면 상태·잘못된 입력·360px 가로 넘침 자동 점검. 캡처는 tools/out/ 에 저장된다.
// 쓰는 법: 저장소 폴더에서 `python -m http.server 8765` 를 켠 뒤, tools 폴더에서 `node check-states.mjs`
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const browser = await chromium.launch();
const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(ok ? '✔' : '✘', name, detail ? '— ' + detail : ''); };

async function newPage(width = 360) {
  const ctx = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => record('페이지 오류 없음', false, e.message));
  return page;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (page, name) => page.screenshot({ path: `out/${name}.png`, fullPage: true });

// 1) ?sim=error — OCR 실패
{
  const p = await newPage();
  await p.goto(BASE + '?sim=error&debug=1#make-1');
  await p.click('#view-make-1 [data-sample="1"]');
  await p.waitForSelector('#ocr-state .state--error');
  const txt = await p.textContent('#ocr-state');
  record('sim=error: OCR 오류에 무슨 일·왜·할 일·다시 시도', /무슨 일/.test(txt) && /왜/.test(txt) && /할 일/.test(txt) && /다시 시도/.test(txt));
  await shot(p, 'state-ocr-error');
  // 직접 입력으로 넘어가 노래 검색 실패
  await p.getByRole('button', { name: '직접 입력하기', exact: true }).click();
  await p.fill('#rows .tx__cell--name input', '아메리카노 ×2');
  await p.fill('#rows .tx__cell--amount input', '9000');
  await p.click('#to-step3');
  await p.fill('#song-q', '밤편지');
  await p.waitForSelector('#song-state .state--error', { timeout: 10000 });
  record('sim=error: 노래 검색 오류 + 다시 시도', /다시 시도/.test(await p.textContent('#song-state')));
  await shot(p, 'state-song-error');
  record('debug 칩 표시', /지금 화면 상태/.test(await p.textContent('#debug-chip')));
  await p.context().close();
}

// 2) ?sim=empty — 인식 결과 없음 / 노래 결과 없음
{
  const p = await newPage();
  await p.goto(BASE + '?sim=empty#make-1');
  await p.click('#view-make-1 [data-sample="1"]');
  await p.waitForSelector('#ocr-state .state--empty');
  const t = await p.textContent('#ocr-state');
  record('sim=empty: 캡처 빈 결과 + 행동 버튼', /찾지 못했어요/.test(t) && /직접 입력하기/.test(t));
  await shot(p, 'state-ocr-empty');
  await p.getByRole('button', { name: '직접 입력하기', exact: true }).first().click();
  await p.fill('#rows .tx__cell--name input', '김밥');
  await p.fill('#rows .tx__cell--amount input', '3500');
  await p.click('#to-step3');
  await p.fill('#song-q', 'zzzz');
  await p.waitForSelector('#song-state .state--empty', { timeout: 10000 });
  record('sim=empty: 노래 빈 결과 + 다른 검색어 버튼', /다른 검색어/.test(await p.textContent('#song-state')));
  await p.context().close();
}

// 3) ?sim=slow — 로딩 상태(회색 자리)가 보이는지
{
  const p = await newPage();
  await p.goto(BASE + '?sim=slow#make-1');
  await p.click('#view-make-1 [data-sample="1"]');
  await p.waitForSelector('#ocr-state .state--loading .skeleton');
  record('sim=slow: OCR 로딩 + 회색 자리 + aria-busy', (await p.getAttribute('#ocr-state', 'aria-busy')) === 'true');
  await shot(p, 'state-ocr-loading');
  await p.context().close();
}

// 4) 손상된 링크
{
  const p = await newPage();
  await p.goto(BASE + '#r=abc123');
  await p.waitForSelector('#read-state .state--error');
  const t = await p.textContent('#read-state');
  record('손상된 링크: 오류 안내 + 내 영수증 만들기', /손상됐어요/.test(t) && /내 영수증 만들기/.test(t));
  await shot(p, 'state-broken-link');
  // 압축은 맞지만 내용이 규칙 밖(금액 0원)
  const bad = await p.evaluate(() => window.LZString.compressToEncodedURIComponent(JSON.stringify({ v: 1, d: '2026-10-14', i: [['김밥', 0]] })));
  await p.goto(BASE + '#r=' + bad);
  await p.waitForSelector('#read-state .state--error');
  record('규칙 밖 링크(금액 0원): 오류', /금액이 범위/.test(await p.textContent('#read-state')));
  const v2 = await p.evaluate(() => window.LZString.compressToEncodedURIComponent(JSON.stringify({ v: 2, d: '2026-10-14', i: [['김밥', 100]] })));
  await p.goto(BASE + '#r=' + v2);
  await p.waitForSelector('#read-state .state--error');
  record('버전 다른 링크(v:2): 오류', /버전/.test(await p.textContent('#read-state')));
  await p.context().close();
}

// 5) ?sim=nostorage — 보관함 사용 불가
{
  const p = await newPage();
  await p.goto(BASE + '?sim=nostorage#box');
  await p.waitForSelector('#box-state .state--error');
  record('sim=nostorage: 보관함 오류 안내', /열 수 없어요/.test(await p.textContent('#box-state')));
  await shot(p, 'state-box-error');
  await p.context().close();
}

// 6) 빈 보관함
{
  const p = await newPage();
  await p.goto(BASE + '#box');
  await p.waitForSelector('#box-state .state--empty');
  record('빈 보관함: 문장 + 만들기 버튼', /비어 있어요/.test(await p.textContent('#box-state')));
  await shot(p, 'state-box-empty');
  await p.context().close();
}

// 7) 잘못된 입력: 안내 위치·입력값 유지·초점
{
  const p = await newPage();
  await p.goto(BASE + '#home');
  await p.click('#view-home [data-manual]');
  await p.waitForSelector('#rows .tx');
  // 이름 21자, 금액 문자
  const longName = '가'.repeat(21);
  await p.fill('#rows .tx__cell--name input', longName);
  await p.fill('#rows .tx__cell--amount input', '사천오백');
  await p.click('#to-step3');
  const nameInp = '#rows .tx__cell--name input';
  const st = await p.evaluate((sel) => {
    const i = document.querySelector(sel);
    const err = document.getElementById(i.getAttribute('aria-describedby').split(' ').pop());
    return { invalid: i.getAttribute('aria-invalid'), focused: document.activeElement === i, value: i.value, msg: err && err.textContent, after: i.nextElementSibling === err };
  }, nameInp);
  record('항목 21자: 칸 아래 안내·값 유지·초점', st.invalid === 'true' && st.focused && st.value === longName && st.after, st.msg);
  const amt = await p.evaluate(() => { const i = document.querySelector('#rows .tx__cell--amount input'); return { inv: i.getAttribute('aria-invalid'), v: i.value, msg: i.nextElementSibling?.textContent }; });
  record('금액 "사천오백": 안내·값 유지', amt.inv === 'true' && amt.v === '사천오백', amt.msg);
  await shot(p, 'invalid-row');
  // 20자 / 금액 상한은 통과
  await p.fill(nameInp, '가'.repeat(20));
  await p.fill('#rows .tx__cell--amount input', '10000000');
  await p.click('#to-step3');
  record('항목 20자 + 금액 10,000,000원: 통과', /#make-3/.test(p.url()));
  // 한마디 61자
  await p.fill('#message', '하'.repeat(61));
  await p.click('#to-step4');
  const m = await p.evaluate(() => ({ f: document.activeElement.id, v: document.getElementById('message').value.length, c: document.getElementById('message-count').textContent }));
  record('한마디 61자: 안내·초점·값 유지', m.f === 'message' && m.v === 61, m.c);
  await p.fill('#message', '하'.repeat(60));
  await p.click('#to-step4');
  await p.waitForURL(/#make-4/);
  record('한마디 60자: 통과', true);
  // 360px 가로 넘침 (긴 이름 영수증)
  record('360px 완성 화면 가로 넘침 없음', (await overflow(p)) <= 0, `넘침 ${await overflow(p)}px`);
  await shot(p, 'mobile-receipt-long');
  await p.context().close();
}

// 8) 항목 선택 0개 / 11개
{
  const p = await newPage();
  await p.goto(BASE + '#home');
  await p.click('#view-home [data-manual]');
  await p.waitForSelector('#rows .tx');
  await p.uncheck('#rows .tx input[type=checkbox]');
  await p.click('#to-step3');
  record('선택 0개: 안내', /하나 이상/.test(await p.textContent('#rows-error')));
  for (let k = 0; k < 10; k++) await p.click('#row-add');
  const boxes = await p.$$('#rows .tx input[type=checkbox]');
  for (const b of boxes) await b.check();
  await p.click('#to-step3');
  record('선택 11개: 안내', /10개까지/.test(await p.textContent('#rows-error')), await p.textContent('#rows-error'));
  record('360px 2단계(11행) 가로 넘침 없음', (await overflow(p)) <= 0);
  await shot(p, 'mobile-rows');
  await p.context().close();
}

// 9) 잘못된 파일
{
  const p = await newPage();
  await p.goto(BASE + '#make-1');
  await p.setInputFiles('#capture-file', { name: '명세서.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await p.click('#capture-read');
  const r = await p.evaluate(() => ({ f: document.activeElement.id, inv: document.getElementById('capture-file').getAttribute('aria-invalid'), msg: document.querySelector('#capture-file + .field-error')?.textContent }));
  record('PDF 파일: 칸 아래 안내·초점', r.f === 'capture-file' && r.inv === 'true', r.msg);
  await p.click('#capture-read'); // 파일 그대로 다시 눌러도 같은 안내
  await shot(p, 'invalid-file');
  await p.context().close();
}

// 10) 화면별 360px 가로 넘침
{
  const p = await newPage();
  for (const h of ['#home', '#make-1', '#box', '#r=abc']) {
    await p.goto(BASE + h);
    await p.waitForTimeout(300);
    const o = await overflow(p);
    record(`360px ${h} 가로 넘침 없음`, o <= 0, `넘침 ${o}px`);
  }
  await shot(p, 'mobile-home');
  await p.context().close();
}

// 11) 키보드 초점이 보이는지 (Tab 으로 첫 버튼까지)
{
  const p = await newPage();
  await p.goto(BASE + '#home');
  for (let k = 0; k < 4; k++) await p.keyboard.press('Tab');
  const o = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${document.activeElement.textContent.trim()} / outline ${s.outlineStyle} ${s.outlineWidth}`; });
  record('Tab 초점 테두리 보임', /solid 3px/.test(o), o);
  await shot(p, 'keyboard-focus');
  await p.context().close();
}

await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} 통과`);
