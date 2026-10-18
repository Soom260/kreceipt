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
  const r = await p.evaluate(() => { const i = document.getElementById('capture-file'); const err = document.getElementById(i.getAttribute('aria-describedby').split(' ').pop()); return { f: document.activeElement.id, inv: i.getAttribute('aria-invalid'), msg: err?.className === 'field-error' ? err.textContent : '' }; });
  record('PDF 파일: 상자 아래 안내·초점', r.f === 'capture-file' && r.inv === 'true' && !!r.msg, r.msg);
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

// 12) 2단계 행: 금액·시간 칸이 겹치지 않고 카드 안에 들어가는지 (360px)
{
  const p = await newPage();
  await p.goto(BASE + '#home');
  await p.click('#view-home [data-manual]');
  await p.waitForSelector('#rows .tx');
  const r = await p.evaluate(() => {
    const li = document.querySelector('#rows .tx');
    const a = li.querySelector('.tx__cell--amount').getBoundingClientRect();
    const t = li.querySelector('.tx__cell--time').getBoundingClientRect();
    const box = li.getBoundingClientRect();
    return { overlap: a.right > t.left + 0.5, inside: t.right <= box.right + 0.5, del: !!li.querySelector('.icon-btn') };
  });
  record('2단계 행: 금액·시간 겹침 없음, 지우기 버튼 없음', !r.overlap && r.inside && !r.del, JSON.stringify(r));
  await p.context().close();
}

// 13) 친구 영수증 이름 저장 + 보관함 라벨 + 달력 표시
{
  const p = await newPage();
  await p.goto(BASE + '#home');
  const mk = (o) => p.evaluate((o) => window.LZString.compressToEncodedURIComponent(JSON.stringify(o)), o);
  const friend = await mk({ v: 1, d: '2026-10-09', n: '민지', i: [['붕어빵', 2000]] });
  const friend2 = await mk({ v: 1, d: '2026-10-09', i: [['꽃', 12000]] });
  await p.goto(BASE + '#r=' + friend);
  await p.waitForSelector('#read-body:not([hidden])');
  record('친구 영수증: 이름 칸에 보낸 사람 이름 미리 채움', (await p.inputValue('#from-name')) === '민지');
  await p.fill('#from-name', '가나다라마바사아자차카');
  await p.click('#keep-btn');
  record('친구 이름 11자: 안내·초점', await p.evaluate(() => document.activeElement.id === 'from-name' && document.getElementById('from-name').getAttribute('aria-invalid') === 'true'));
  await p.fill('#from-name', '민지');
  await p.click('#keep-btn');
  record('친구 이름으로 보관', /민지님의 영수증으로/.test(await p.textContent('#keep-status')));
  await p.goto(BASE + '#r=' + friend2);
  await p.waitForSelector('#read-body:not([hidden])');
  await p.fill('#from-name', '하늘');
  await p.click('#keep-btn');
  // 내 영수증 하나 (직접 입력)
  await p.goto(BASE + '#home');
  await p.click('#view-home [data-manual]');
  await p.fill('#day-date', '2026-10-09');
  await p.fill('#rows .tx__cell--name input', '김밥');
  await p.fill('#rows .tx__cell--amount input', '3500');
  await p.click('#to-step3');
  await p.click('#to-step4');
  await p.waitForURL(/#make-4/);
  await p.click('.top nav a[href="#box"]');
  await p.waitForSelector('#box-list .box-item');
  const badges = await p.$$eval('#box-list .box-item', (els) => els.map((e) => e.querySelector('.badge').textContent + ' ' + e.querySelector('.box-item__who').textContent));
  record('전체 탭에 [내 영수증]/[친구 영수증] 라벨과 친구 이름', badges.includes('내 영수증 ') && badges.includes('친구 영수증 민지') && badges.includes('친구 영수증 하늘'), badges.join(' / '));
  const day = await p.getAttribute('#cal [data-day="2026-10-09"]', 'aria-label');
  record('달력: 10월 9일에 내 1장·친구 2장 표시', /내 영수증 1장, 친구 영수증 2장/.test(day || ''), day);
  record('달력: 파란 점·분홍 하트', (await p.$$('#cal [data-day="2026-10-09"] .mark--mine')).length === 1 && (await p.$$('#cal [data-day="2026-10-09"] .mark--friend')).length === 1);
  await shot(p, 'box-calendar');
  await p.click('#cal [data-day="2026-10-09"]');
  record('날짜 누르면 그날 목록 3장 + 제목', (await p.$$('#box-list .box-item')).length === 3 && /10\. 9\./.test(await p.textContent('#box-list-title')));
  await p.click('#view-box .tab[data-filter="received"]');
  record('친구 탭: 2장, 달력 표시도 친구만', (await p.$$('#box-list .box-item')).length === 2 && (await p.$$('#cal .mark--mine')).length === 0);
  record('360px 보관함(달력) 가로 넘침 없음', (await overflow(p)) <= 0);
  await shot(p, 'box-calendar-selected');
  await p.context().close();
}

// 14) 휴대전화 흉내(터치·모바일): 시간 칸이 화면 안에, 잘못된 시간 안내, fetch 가 막혀도 노래 검색(JSONP), 이미지 저장 창
{
  const { devices } = await import('playwright');
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => record('페이지 오류 없음(모바일)', false, e.message));
  // fetch 로 가는 iTunes 요청만 막는다 (폰에서 fetch 만 막히는 상황 흉내)
  await p.route('**/itunes.apple.com/**', (route) => (route.request().resourceType() === 'fetch' ? route.abort('failed') : route.continue()));
  await p.goto(BASE + '#home');
  await p.tap('#view-home [data-manual]');
  await p.waitForSelector('#rows .tx');
  const r = await p.evaluate(() => {
    const t = document.querySelector('#rows .tx__cell--time input').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    return { right: Math.round(t.right), mainRight: Math.round(main.right), vw: innerWidth };
  });
  record('모바일: 시간 칸이 화면·본문 안에 있음', r.right <= r.mainRight && r.right <= r.vw, JSON.stringify(r));
  await p.fill('#rows .tx__cell--name input', '김밥');
  await p.fill('#rows .tx__cell--amount input', '3500');
  await p.fill('#rows .tx__cell--time input', '25:00');
  await p.tap('#to-step3');
  record('시간 "25:00": 안내·초점', await p.evaluate(() => document.activeElement.closest('.tx__cell--time') !== null && /14:30처럼/.test(document.querySelector('.tx__cell--time .field-error')?.textContent || '')));
  await p.fill('#rows .tx__cell--time input', '1430');
  await p.tap('#rows .tx__cell--name input'); // 칸을 떠나면 14:30 으로 맞춤
  record('시간 "1430" → "14:30"', (await p.inputValue('#rows .tx__cell--time input')) === '14:30');
  await p.tap('#to-step3');
  await p.waitForURL(/#make-3/);
  await p.fill('#song-q', 'IU');
  await p.tap('#song-go');
  await p.waitForSelector('#song-results .song, #song-state .state--error', { timeout: 20000 });
  const n = await p.$$eval('#song-results .song', (e) => e.length);
  record('fetch 가 막혀도 JSONP 로 노래 검색', n > 0, n ? `${n}곡` : await p.textContent('#song-state'));
  if (n) await p.tap('#song-results .song .pick-btn');
  await p.tap('#to-step4');
  await p.waitForURL(/#make-4/);
  await p.tap('#save-image');
  await p.waitForSelector('#img-dialog[open] #img-dialog-img[src^="data:image/png"]', { timeout: 20000 });
  record('모바일 이미지 저장: 꾹 눌러 저장하는 창', true, await p.textContent('#share-status'));
  await shot(p, 'mobile-image-dialog');
  await p.tap('#img-dialog-close');
  record('창 닫으면 초점이 저장 버튼으로', await p.evaluate(() => !document.getElementById('img-dialog').open && document.activeElement.id === 'save-image'));
  await ctx.close();
}

// 15) 오늘의 기분 + 그날의 날씨 (위치 허용 / 지역 고르기 / 위치 거부)
{
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, geolocation: { latitude: 37.5973, longitude: 127.0588 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => record('페이지 오류 없음(날씨)', false, e.message));
  await p.goto(BASE + '#home');
  await p.click('#view-home [data-manual]');
  await p.fill('#day-date', today);
  await p.fill('#rows .tx__cell--name input', '김밥');
  await p.fill('#rows .tx__cell--amount input', '3500');
  await p.click('#to-step3');
  await p.waitForURL(/#make-3/);
  await p.click('.mood[data-mood="love"]');
  record('기분 고르기: 누른 것만 선택됨', (await p.getAttribute('.mood[data-mood="love"]', 'aria-pressed')) === 'true' && (await p.$$('.mood[aria-pressed="true"]')).length === 1);
  await p.click('.mood[data-mood="love"]');
  record('기분 다시 누르면 선택 풀림', (await p.$$('.mood[aria-pressed="true"]')).length === 0);
  await p.click('.mood[data-mood="love"]');
  await p.click('#weather-gps');
  await p.waitForSelector('#weather-picked:not([hidden]), #weather-state .state--error, #weather-state .state--empty', { timeout: 20000 });
  const picked = await p.textContent('#weather-picked');
  record('위치 허용: 오늘 날씨(지금 기온) 표시', /°/.test(picked) && /지금 기온/.test(picked), picked.replace(/\s+/g, ' ').trim());
  await shot(p, 'weather-picked');
  await p.click('#to-step4');
  await p.waitForURL(/#make-4/);
  const meta = await p.textContent('#my-receipt .receipt__meta');
  record('영수증 날짜 줄: 날짜 · 요일 · 날씨 · 기분', /·.*°.*🥰/.test(meta), meta);
  const label = await p.getAttribute('#my-receipt .receipt', 'aria-label');
  record('화면낭독기 설명에 날씨·기분', /날씨 .*도/.test(label) && /기분 설렘/.test(label), label);
  // 링크로 열어도 같은 줄 (서버를 다시 부르지 않음)
  await p.click('#share-link');
  await p.waitForTimeout(400);
  const code = await p.evaluate(() => {
    const c = document.querySelector('#my-receipt .receipt');
    return c ? location.hash : '';
  });
  await shot(p, 'weather-receipt');
  await ctx.close();

  // 지역 고르기 + 지난 날짜
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '#home');
  await p2.click('#view-home [data-manual]');
  await p2.fill('#day-date', '2026-10-10');
  await p2.fill('#rows .tx__cell--name input', '김밥');
  await p2.fill('#rows .tx__cell--amount input', '3500');
  await p2.click('#to-step3');
  await p2.selectOption('#weather-region', '159');
  await p2.waitForSelector('#weather-picked:not([hidden]), #weather-state .state--error, #weather-state .state--empty', { timeout: 20000 });
  const pk2 = await p2.textContent('#weather-picked');
  record('지역 고르기(부산)·지난 날짜: 그날 최고 기온', /부산/.test(pk2) && /최고 기온/.test(pk2), pk2.replace(/\s+/g, ' ').trim());
  // 날짜를 바꾸면 날씨가 빠짐
  await p2.click('#view-make-3 .cta a');
  await p2.fill('#day-date', '2026-10-11');
  await p2.click('#to-step3');
  await p2.waitForURL(/#make-3/);
  await p2.waitForSelector('#weather-state .state--empty');
  record('영수증 날짜를 바꾸면 날씨를 빼고 안내', /날짜가 바뀌어서/.test(await p2.textContent('#weather-state')) && (await p2.isHidden('#weather-picked')));
  await ctx2.close();

  // 위치 거부
  const ctx3 = await browser.newContext({ viewport: { width: 360, height: 780 }, permissions: [] });
  const p3 = await ctx3.newPage();
  await p3.goto(BASE + '#home');
  await p3.click('#view-home [data-manual]');
  await p3.fill('#rows .tx__cell--name input', '김밥');
  await p3.fill('#rows .tx__cell--amount input', '3500');
  await p3.click('#to-step3');
  await p3.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, err) => err({ code: 1, message: 'denied' }); });
  await p3.click('#weather-gps');
  await p3.waitForSelector('#weather-state .state--error', { timeout: 10000 });
  record('위치 거부: 무슨 일·왜·할 일 + 지역 고르기', /허용하지 않았어요/.test(await p3.textContent('#weather-state')) && /지역 고르기/.test(await p3.textContent('#weather-state')));
  record('360px 3단계(기분·날씨) 가로 넘침 없음', (await overflow(p3)) <= 0);
  await shot(p3, 'weather-denied');
  await ctx3.close();

  // ?sim=error: 날씨 실패해도 영수증은 만들어짐
  const ctx4 = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const p4 = await ctx4.newPage();
  await p4.goto(BASE + '?sim=error#home');
  await p4.click('#view-home [data-manual]');
  await p4.fill('#rows .tx__cell--name input', '김밥');
  await p4.fill('#rows .tx__cell--amount input', '3500');
  await p4.click('#to-step3');
  await p4.selectOption('#weather-region', '108');
  await p4.waitForSelector('#weather-state .state--error', { timeout: 10000 });
  await p4.click('#to-step4');
  await p4.waitForURL(/#make-4/);
  record('sim=error: 날씨 오류 + 영수증은 그대로 만들어짐', true);
  await ctx4.close();
}

// 16) 답장 스티커(B) + 친구별로 보기(A)
{
  const run = Date.now().toString(36);
  const A = await browser.newContext({ viewport: { width: 360, height: 780 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pa = await A.newPage();
  pa.on('pageerror', (e) => record('페이지 오류 없음(답장)', false, e.message));
  await pa.goto(BASE + '#home');
  await pa.click('#view-home [data-manual]');
  await pa.fill('#rows .tx__cell--name input', '붕어빵');
  await pa.fill('#rows .tx__cell--amount input', '2000');
  await pa.click('#to-step3');
  await pa.fill('#nick', '숨');
  await pa.fill('#message', '점검 ' + run);
  await pa.click('#to-step4');
  await pa.waitForURL(/#make-4/);
  await pa.waitForSelector('#my-replies-state .state--empty, #my-replies-state .state--error', { timeout: 15000 });
  record('4단계 받은 답장: 처음엔 빈 결과 안내', /아직 답장이 없어요/.test(await pa.textContent('#my-replies-state')));
  await pa.click('#share-link');
  await pa.waitForTimeout(400);
  const link = await pa.evaluate(() => navigator.clipboard.readText());

  const B = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const pb = await B.newPage();
  pb.on('pageerror', (e) => record('페이지 오류 없음(답장 받는 쪽)', false, e.message));
  await pb.goto(link);
  await pb.waitForSelector('#reply-stickers .sticker');
  record('친구 영수증: 답장 스티커 6개', (await pb.$$('#reply-stickers .sticker')).length === 6);
  await pb.fill('#reply-name', '가나다라마바사아자차카');
  await pb.click('#reply-stickers .sticker[data-sticker="lol"]');
  record('답장 이름 11자: 칸 아래 안내·초점', await pb.evaluate(() => document.activeElement.id === 'reply-name' && document.getElementById('reply-name').getAttribute('aria-invalid') === 'true'));
  await pb.fill('#reply-name', '민지');
  await pb.click('#reply-stickers .sticker[data-sticker="lol"]');
  await pb.waitForSelector('#reply-list .reply', { timeout: 15000 });
  record('스티커 보내면 목록에 내 답장', /민지 · ㅋㅋㅋ/.test(await pb.textContent('#reply-list')));
  await pb.click('#reply-stickers .sticker[data-sticker="yum"]');
  await pb.waitForFunction(() => /맛있겠다/.test(document.getElementById('reply-list').textContent), null, { timeout: 15000 });
  record('다른 스티커를 누르면 바뀜(하나만)', (await pb.$$('#reply-list .reply')).length === 1 && (await pb.getAttribute('#reply-stickers .sticker[data-sticker="yum"]', 'aria-pressed')) === 'true');
  await shot(pb, 'reply-sent');
  await pb.fill('#from-name', '민지');
  await pb.click('#keep-btn');
  // 두 번째 친구 영수증
  const other = await pb.evaluate((r) => window.LZString.compressToEncodedURIComponent(JSON.stringify({ v: 1, d: '2026-10-11', n: '하늘', i: [['꽃', 12000]], m: '점검2 ' + r })), run);
  await pb.goto(link.split('#')[0] + '#r=' + other);
  await pb.waitForSelector('#read-body:not([hidden])');
  await pb.click('#keep-btn');
  await pb.goto(link.split('#')[0] + '#box');
  await pb.waitForSelector('#friend-chips:not([hidden]) .friend-chip');
  const chips = await pb.$$eval('#friend-chips .friend-chip', (e) => e.map((x) => x.textContent));
  record('친구별 칩: 모든 친구·민지·하늘', chips.length === 3 && chips.some((c) => /민지/.test(c)) && chips.some((c) => /하늘/.test(c)), chips.join(' / '));
  await pb.click('#friend-chips .friend-chip:has-text("하늘")');
  record('친구 칩 누르면 그 친구 영수증만 + 친구 탭', (await pb.$$('#box-list .box-item')).length === 1 && (await pb.getAttribute('#view-box .tab[data-filter="received"]', 'aria-pressed')) === 'true' && /하늘님 영수증/.test(await pb.textContent('#box-count')));
  record('360px 보관함(친구 칩) 가로 넘침 없음', (await overflow(pb)) <= 0);
  await shot(pb, 'box-friends');

  // 보낸 사람: 새로고침하면 답장이 보이고, 보관함 카드에 요약
  await pa.click('#my-replies-refresh');
  await pa.waitForSelector('#my-replies-list .reply', { timeout: 15000 });
  record('보낸 사람 4단계: 받은 답장 보임', /민지 · 맛있겠다/.test(await pa.textContent('#my-replies-list')));
  await pa.click('.top nav a[href="#box"]');
  await pa.waitForFunction(() => /받은 답장/.test(document.querySelector('#box-list .box-item__replies')?.textContent || ''), null, { timeout: 15000 });
  record('보관함 내 영수증 카드: 답장 요약', /😋 1/.test(await pa.textContent('#box-list .box-item__replies')), await pa.textContent('#box-list .box-item__replies'));
  await shot(pa, 'box-reply-summary');
  // 내 영수증을 링크로 열면 스티커 대신 받은 답장만
  await pa.goto(link);
  await pa.waitForSelector('#reply-list .reply', { timeout: 15000 });
  record('내 영수증 화면: 스티커 칸 숨김, 받은 답장 보임', (await pa.isHidden('#reply-send')) && /받은 답장/.test(await pa.textContent('#reply-title')));
  await A.close();
  await B.close();

  // ?sim=error: 답장 실패 안내
  const C = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const pc = await C.newPage();
  await pc.goto(BASE.replace(/\/?$/, '/') + '?sim=error#r=' + other);
  await pc.waitForSelector('#reply-state .state--error', { timeout: 15000 });
  record('sim=error: 답장 불러오기 오류 + 다시 시도', /다시 시도/.test(await pc.textContent('#reply-state')));
  await C.close();
}

// 17) 인스타 스토리: 스티커로 복사(투명 PNG) / 스토리로 보내기(1080×1920) / 공유 창이 없을 때
{
  const { writeFileSync } = await import('node:fs');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => record('페이지 오류 없음(인스타)', false, e.message));
  // 공유 창 흉내: 넘겨받은 파일을 기억해 둔다
  await p.addInitScript(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => { window.__shared = d.files[0]; };
  });
  await p.goto(BASE + '#home');
  await p.click('#view-home [data-manual]');
  await p.fill('#rows .tx__cell--name input', '아메리카노 ×2');
  await p.fill('#rows .tx__cell--amount input', '9000');
  await p.click('#to-step3');
  await p.click('.mood[data-mood="good"]');
  await p.fill('#message', '오늘도 잘 썼다');
  await p.click('#to-step4');
  await p.waitForURL(/#make-4/);
  await p.waitForTimeout(3500); // 미리 만들어 두기 끝날 때까지

  await p.click('#copy-sticker');
  await p.waitForTimeout(1200);
  const clip = await p.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const it = items.find((i) => i.types.includes('image/png'));
    if (!it) return { ok: false, types: items.map((i) => i.types.join(',')) };
    const blob = await it.getType('image/png');
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const corner = g.getImageData(2, 2, 1, 1).data[3];
    const center = g.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data[3];
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    return { ok: true, w: bmp.width, h: bmp.height, corner, center, bytes };
  });
  record('스티커로 복사: 클립보드에 PNG, 모서리 투명·가운데 불투명', clip.ok && clip.corner === 0 && clip.center === 255, clip.ok ? `${clip.w}×${clip.h}, 모서리 알파 ${clip.corner}` : JSON.stringify(clip));
  if (clip.ok) writeFileSync('out/insta-sticker.png', Buffer.from(clip.bytes));
  record('스티커 복사 안내 문구', /스티커를 복사했어요/.test(await p.textContent('#share-status')));

  await p.click('#share-story');
  await p.waitForFunction(() => window.__shared, null, { timeout: 15000 });
  const shared = await p.evaluate(async () => {
    const f = window.__shared;
    const bmp = await createImageBitmap(f);
    return { name: f.name, type: f.type, w: bmp.width, h: bmp.height, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) };
  });
  record('스토리로 보내기: 공유 창에 1080×1920 PNG', shared.type === 'image/png' && shared.w === 1080 && shared.h === 1920, `${shared.name} ${shared.w}×${shared.h}`);
  writeFileSync('out/insta-story.png', Buffer.from(shared.bytes));

  // 공유 창이 없는 브라우저: 스토리 이미지를 창에 띄움
  await p.evaluate(() => { navigator.canShare = undefined; navigator.share = undefined; });
  await p.click('#share-story');
  await p.waitForSelector('#img-dialog[open] #img-dialog-img[src^="blob:"]', { timeout: 15000 });
  record('공유 창 없으면 스토리 이미지 창', /스토리 이미지/.test(await p.textContent('#img-dialog-title')));
  await p.click('#img-dialog-close');
  record('360px~390px 4단계 인스타 버튼 줄 가로 넘침 없음', (await overflow(p)) <= 0);
  await ctx.close();
}

await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} 통과`);
