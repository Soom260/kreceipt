// 정산 영수증 자동 점검: 기간별 합계, 친구·정산 영수증 빼기, AI 추천(가짜 응답) 성공·한도 초과, "그 외 N곳", 링크 열기, 360px 넘침.
// 쓰는 법: 저장소 폴더에서 `node tools/serve.mjs` 를 켠 뒤, tools 폴더에서 `node check-settle.mjs`
// AI 서버(api/settle-note)는 실제로 부르지 않고 가짜 응답으로 바꿔 끼운다 (하루 사용량 아끼기).
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const results = [];
const record = (name, ok, detail = '') => { results.push(ok); console.log(ok ? '✔' : '✘', name, detail ? '— ' + detail : ''); };
p.on('pageerror', (e) => record('페이지 오류 없음', false, e.message));

let aiMode = 'ok';
let aiBody = null;
await p.route('**/api/settle-note', async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
  aiBody = JSON.parse(route.request().postData() || 'null');
  if (aiMode === 'limit') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'limit' }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, notes: ['빵집이 나를 키운 달', '비 오는 날엔 빵', '다음 달도 잘 먹자'] }) });
});
// 소비 분석: AI 는 가게 → 분류 이름표와 코멘트만 준다 (비율은 화면이 계산)
let insightMode = 'ok';
let insightBody = null;
await p.route('**/api/settle-insight', async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
  insightBody = JSON.parse(route.request().postData() || 'null');
  if (insightMode === 'limit') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'limit' }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, map: { '빵집 모닝': '간식·디저트', 편의점: '편의점·마트', 지하철: '교통' }, comment: '간식·디저트가 73%로 가장 커요.' }) });
});

const pad = (n) => String(n).padStart(2, '0');
const t = new Date();
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = ymd(t);
const FIRST = ymd(new Date(t.getFullYear(), t.getMonth(), 1));
const LAST_MID = ymd(new Date(t.getFullYear(), t.getMonth() - 1, 15));

// 보관함 채우기 (앱의 모듈을 그대로 써서 링크 코드까지 진짜로 만든다)
async function seed(list) {
  await p.goto(BASE + '#home');
  await p.evaluate(async (list) => {
    const share = await import('./js/share.js');
    const storage = await import('./js/storage.js');
    localStorage.clear();
    for (const [kind, data] of list) storage.addToBox(share.encodeReceipt(data), kind, data);
  }, list);
}
const text = (sel) => p.textContent(sel).then((s) => (s || '').replace(/\s+/g, ' ').trim());

await seed([
  ['mine', { v: 1, d: TODAY, i: [['빵집 모닝', 6800], ['편의점', 2700]], f: 'tired', w: { c: 'rain', t: 9, k: 'n' } }],
  ['mine', { v: 1, d: FIRST, i: [['빵집 모닝', 4500], ['지하철', 1450]], f: 'good' }],
  ['mine', { v: 1, d: LAST_MID, i: [['책방', 16000]] }],
  ['received', { v: 1, d: TODAY, n: '민지', i: [['친구카페', 5000]] }],
]);

// 보관함 → 정산 버튼
await p.goto(BASE + '#box');
await p.click('#settle-open');
await p.waitForURL(/#settle/);
await p.waitForFunction(() => document.getElementById('range-note').textContent.length > 0); // 새 파일을 처음 받을 때 늦게 그려질 수 있음
let note = await text('#range-note');
record('이번 달: 내 영수증 2장만 (지난 달·친구 영수증 빼기)', /영수증 2장/.test(note) && /15,450원/.test(note), note);

// AI 추천 (성공)
await p.click('#note-ai');
await p.waitForSelector('#note-chips .note-chip');
const chips = await p.$$eval('#note-chips .note-chip', (b) => b.map((x) => x.textContent));
record('AI 추천 3개가 보임', chips.length === 3, chips.join(' / '));
record('AI 에 보낸 내용: 이름·캡처 없이 가게·금액·기분', aiBody && aiBody.receipts === 2 && aiBody.top[0][0] === '빵집 모닝' && aiBody.top[0][2] === 2 && aiBody.moods['피곤'] === 1 && !('n' in aiBody) && !JSON.stringify(aiBody).includes('민지'), JSON.stringify(aiBody));
await p.click('#note-chips .note-chip:nth-child(2)');
record('추천을 누르면 한마디 칸에 들어감', (await p.inputValue('#settle-note')) === '비 오는 날엔 빵');

// 만들기
await p.fill('#settle-nick', '숨');
await p.click('#settle-make');
await p.waitForSelector('#settle-receipt .receipt');
// 가게 이름 칸과 금액 칸을 띄어서 읽는다
const rowTexts = (r) => r.map((x) => [...x.children].map((c) => c.textContent).join(' '));
const rows = await p.$$eval('#settle-receipt .receipt__row', rowTexts);
const total = await p.getAttribute('#settle-receipt .receipt__total span:last-child', 'data-final');
const metas = await p.$$eval('#settle-receipt .receipt__meta', (r) => r.map((x) => x.textContent));
record('가게별로 묶고 금액 큰 순 (빵집 모닝 ×2)', rows[0] === '빵집 모닝 ×2 11,300' && rows.length === 3, rows.join(' | '));
record('합계 15,450', total === '15,450', total);
record('날짜 줄은 기간, 아래 정산 줄', metas[0] === `${FIRST} ~ ${TODAY}` && metas[1] === '정산 · 영수증 2장', metas.join(' | '));
record('한마디·이름이 영수증에', /비 오는 날엔 빵/.test(await text('#settle-receipt .receipt__note')) && /숨/.test(await text('#settle-receipt .receipt__from')));
const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
record('360px 가로 넘침 없음 (결과)', over <= 0, `${over}px`);

// 소비 분석 카드
const cmp = await text('#insight-compare');
record('지난 달 같은 기간과 비교 (바로 계산)', /지난 달 같은 기간/.test(cmp) && /(더|덜) 썼어요|비교할 수 없어요|똑같이/.test(cmp), cmp);
insightMode = 'limit';
await p.click('#insight-ai');
await p.waitForSelector('#insight-state .state--error');
record('분석 한도 초과: 안내 + 다시 버튼', /1분에 10번/.test(await text('#insight-state')) && (await p.isEnabled('#insight-ai')));
insightMode = 'ok';
await p.click('#insight-ai');
await p.waitForSelector('#insight-bars:not([hidden]) .insight-bar');
const bars = await p.$$eval('#insight-bars .insight-bar', (r) => r.map((x) => `${x.querySelector('b').textContent} ${x.querySelector('.insight-bar__val').textContent}`));
record('분류별 막대: 금액 큰 순, 비율은 화면이 계산', bars.length === 3 && bars[0] === '간식·디저트 73% · 11,300원' && bars[2] === '교통 9% · 1,450원', bars.join(' | '));
record('AI 코멘트 표시', /73%/.test(await text('#insight-comment')));
record('분석에 보낸 내용: 가게·금액·횟수만 (이름 없음)', insightBody && insightBody.shops.length === 3 && insightBody.shops[0][0] === '빵집 모닝' && !JSON.stringify(insightBody).includes('숨'), JSON.stringify(insightBody));
await p.waitForTimeout(1200);
await p.screenshot({ path: 'out/settle-result.png', fullPage: true });

// 보관함에 "정산" 표시로 들어감, 다시 정산해도 정산 영수증은 안 더함
await p.goto(BASE + '#box');
const settleItems = await p.$$eval('#box-list .badge--settle', (b) => b.length);
record('보관함에 정산 표시로 저장', settleItems === 1);
await p.click('#settle-open');
note = await text('#range-note');
record('다시 정산해도 정산 영수증은 빼고 2장', /영수증 2장/.test(note), note);

// 지난 달 · 직접 고르기
await p.click('.range[data-range="last"]');
note = await text('#range-note');
record('지난 달: 1장 16,000원', /영수증 1장/.test(note) && /16,000원/.test(note), note);
await p.click('.range[data-range="pick"]');
const pickCount = await p.$$eval('#pick-list .pick-item', (r) => r.length);
record('직접 고르기 목록: 내 영수증 3장 (친구·정산 빼고)', pickCount === 3, String(pickCount));
await p.click('#settle-make');
record('하나도 안 고르고 만들면 안내', /하나 이상 골라/.test(await text('#settle-error')));
await p.check('#pick-list .pick-item:nth-child(1) input');
await p.check('#pick-list .pick-item:nth-child(3) input');
note = await text('#range-note');
record('고른 2장: 25,500원', /영수증 2장/.test(note) && /25,500원/.test(note), note);
await p.screenshot({ path: 'out/settle-form.png', fullPage: true });

// AI 한도 초과
aiMode = 'limit';
await p.click('#note-ai');
await p.waitForSelector('#note-state .state--error');
record('AI 한도 초과: 이유·할 일 안내', /1분에 10번/.test(await text('#note-state')) && /직접 적어도/.test(await text('#note-state')), await text('#note-state'));
record('AI 실패해도 만들 수 있음', await (async () => { await p.click('#settle-make'); await p.waitForSelector('#settle-receipt .receipt'); return true; })());

// 링크로 연 정산 영수증
const code = await p.evaluate(() => JSON.parse(localStorage.getItem('kreceipt.box.v1')).filter((e) => e.data.p).pop().key);
await p.goto(BASE + '#r=' + code);
await p.waitForSelector('#read-receipt .receipt');
record('링크로 열면 "정산 영수증" 제목', /정산 영수증/.test(await text('#read-title')), await text('#read-title'));

// 10곳 넘으면 9곳 + 그 외
await seed([
  ['mine', { v: 1, d: TODAY, i: [['가', 9000], ['나', 8000], ['다', 7000], ['라', 6000], ['마', 5000], ['바', 4000]] }],
  ['mine', { v: 1, d: FIRST, i: [['사', 3000], ['아', 2000], ['자', 1000], ['차', 900], ['카', 800], ['타', 700]] }],
]);
await p.goto(BASE + '#settle');
await p.click('.range[data-range="month"]');
await p.click('#settle-make');
await p.waitForSelector('#settle-receipt .receipt');
const rows2 = await p.$$eval('#settle-receipt .receipt__row', rowTexts);
record('12곳 → 9곳 + "그 외 3곳"', rows2.length === 10 && rows2[9] === '그 외 3곳 2,400', rows2.slice(-2).join(' | '));

// 빈 보관함
await seed([]);
await p.goto(BASE + '#settle');
record('보관함이 비면 안내와 만들기 버튼', /정산할 내 영수증이 아직 없어요/.test(await text('#settle-state')));

await browser.close();
const okN = results.filter(Boolean).length;
console.log(`\n${okN}/${results.length} 통과`);
process.exit(okN === results.length ? 0 : 1);
