// 샘플 캡처(assets/samples)와 링크 미리보기 이미지(assets/og.png)를 만드는 스크립트.
// 쓰는 법: tools 폴더에서 `npm i` 후 `node make-assets.mjs`
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const browser = await chromium.launch();

for (const n of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(here, `sample-${n}.html`)).href);
  await page.screenshot({ path: path.join(root, `assets/samples/sample-${n}.png`), fullPage: true });
  await page.close();
}
const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.goto(pathToFileURL(path.join(here, 'og.html')).href);
await og.screenshot({ path: path.join(root, 'assets/og.png') });
await browser.close();
console.log('완료: assets/samples/sample-1.png, sample-2.png, assets/og.png');
