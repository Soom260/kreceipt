// 화면 사진 찍기: 아이폰(사파리 엔진 WebKit)과 안드로이드 360px(크롬 엔진)에서 주요 화면을 찍고 가로 넘침을 확인한다.
// 쓰는 법: 저장소 폴더에서 `python -m http.server 8765` 를 켠 뒤, tools 폴더에서 `node shots.mjs`
// 결과: tools/out/shot-<기기>-<화면>.png
import { chromium, webkit, devices } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const targets = [
  { name: 'iphone', engine: webkit, opts: { ...devices['iPhone 13'] } },
  { name: 'android360', engine: chromium, opts: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
];

for (const t of targets) {
  const browser = await t.engine.launch();
  const ctx = await browser.newContext(t.opts);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const snap = async (label) => {
    await p.waitForTimeout(1600); // 모션이 끝날 때까지
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.screenshot({ path: `out/shot-${t.name}-${label}.png`, fullPage: true });
    console.log(`${t.name} ${label}: 가로 넘침 ${over}px`);
  };
  await p.goto(BASE + '#home'); await snap('1-home');
  await p.goto(BASE + '#make-1'); await snap('2-step1');
  await p.tap('#view-make-1 [data-sample="2"]');
  await p.waitForURL(/#make-2/, { timeout: 180000 });
  await p.tap('#rows .tx input[type=checkbox]');
  await snap('3-step2');
  await p.tap('#to-step3');
  await p.waitForURL(/#make-3/);
  await p.fill('#nick', '숨');
  await p.fill('#message', '오늘도 잘 썼다');
  await p.fill('#song-q', 'IU');
  await p.tap('#song-go');
  await p.waitForSelector('#song-results .song, #song-state .state--error, #song-state .state--empty', { timeout: 30000 });
  await snap('4-step3');
  if (await p.$('#song-results .song .pick-btn')) await p.tap('#song-results .song .pick-btn');
  await p.tap('#to-step4');
  await p.waitForURL(/#make-4/);
  await snap('5-step4');
  await p.goto(BASE + '#box'); await snap('6-box');
  await p.goto(BASE + '#r=abc'); await snap('7-broken');
  console.log(errs.length ? `${t.name} 오류: ${errs.join(' | ')}` : `${t.name} 오류 없음`);
  await browser.close();
}
