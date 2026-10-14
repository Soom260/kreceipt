// 핵심 흐름 자동 점검: 샘플 캡처 → 고르기 → 한마디·노래 → 영수증 → 링크 열기 → 보관 → 보관함
// 쓰는 법: 저장소 폴더에서 `python -m http.server 8765` 를 켠 뒤, tools 폴더에서 `node check-flow.mjs`
// 다른 주소를 시험하려면: BASE=https://soom260.github.io/kreceipt/ node check-flow.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const log = (...a) => console.log('·', ...a);
const t0 = Date.now();

await page.goto(BASE + '#home');
await page.getByRole('button', { name: '샘플 캡처로 해보기' }).first().click();
log('샘플 읽기 시작');
await page.waitForURL(/#make-2/, { timeout: 180000 });
log(`2단계 도착 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
const rows = await page.$$eval('#rows .tx', (els) => els.map((li) => {
  const [name, amt, time] = li.querySelectorAll('input:not([type=checkbox])');
  return `${name.value} | ${amt.value} | ${time.value}`;
}));
log('읽은 거래:\n   ' + rows.join('\n   '));
log('날짜:', await page.inputValue('#day-date'), '/', await page.textContent('#day-note'));

// 앞의 세 개 고르기
const boxes = await page.$$('#rows .tx input[type=checkbox]');
for (const b of boxes.slice(0, 3)) await b.check();
await page.click('#to-step3');
await page.waitForURL(/#make-3/);

await page.fill('#nick', '숨');
await page.fill('#message', '오늘도 잘 썼다');
await page.fill('#song-q', 'IU');
await page.waitForSelector('#song-results .song, #song-state .state', { timeout: 15000 });
const songCount = await page.$$eval('#song-results .song', (e) => e.length);
log('노래 검색 결과', songCount, '곡');
if (songCount) await page.click('#song-results .song .pick-btn');
await page.click('#to-step4');
await page.waitForURL(/#make-4/);
log('저장 상태:', await page.textContent('#my-save-status'));
await page.screenshot({ path: 'out/flow-4-receipt.png', fullPage: true });

await page.click('#share-link');
await page.waitForTimeout(500);
log('공유 상태:', await page.textContent('#share-status'));
const link = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
log('링크 길이:', link.length, link.slice(0, 80) + '…');

// 받는 사람: 새 브라우저(보관함이 빈 상태)에서 링크 열기
const ctx2 = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push('p2 pageerror: ' + e.message));
await p2.goto(link);
await p2.waitForSelector('#read-body:not([hidden])');
log('받은 화면 제목:', await p2.textContent('#read-title'));
await p2.waitForTimeout(2500);
log('노래 블록:', (await p2.textContent('#read-receipt .receipt__song-slot').catch(() => '(없음)'))?.replace(/\s+/g, ' '));
await p2.screenshot({ path: 'out/flow-7-received.png', fullPage: true });
await p2.click('#keep-btn');
log('보관 상태:', await p2.textContent('#keep-status'));
await p2.goto(link.split('#')[0] + '#box');
await p2.waitForSelector('#box-list .box-item');
log('보관함:', await p2.textContent('#box-count'));
await p2.screenshot({ path: 'out/flow-9-box.png', fullPage: true });

// 이미지 저장 (보낸 사람 화면)
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('#save-image')]);
log('이미지 저장:', dl ? dl.suggestedFilename() : '(다운로드 없음)', '/', await page.textContent('#share-status'));
if (dl) await dl.saveAs('out/' + dl.suggestedFilename());

console.log(errors.length ? '\n오류:\n' + errors.join('\n') : '\n브라우저 오류 없음');
await browser.close();
