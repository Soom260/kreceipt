// 화면의 영수증을 PNG 이미지로 저장하는 파일 (html-to-image, 처음 누를 때만 불러온다).
// 앨범 커버를 그리지 못하면 커버 없이 다시 저장한다.

import { CDN } from './config.js';

function loadLib() {
  return new Promise((resolve, reject) => {
    if (window.htmlToImage) return resolve(window.htmlToImage);
    const s = document.createElement('script');
    s.src = CDN.htmlToImage;
    s.integrity = CDN.htmlToImageSri;
    s.crossOrigin = 'anonymous';
    s.onload = () => (window.htmlToImage ? resolve(window.htmlToImage) : reject(new Error('lib-missing')));
    s.onerror = () => reject(new Error('lib-load-failed'));
    document.head.append(s);
  });
}

// 버튼·링크·오류 문구는 이미지에 넣지 않는다
const baseFilter = (node) => !(node.tagName === 'BUTTON' || node.tagName === 'A' || (node.classList && node.classList.contains('receipt__song-err')));
const noImgFilter = (node) => baseFilter(node) && node.tagName !== 'IMG';

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 영수증 요소 → PNG 데이터 주소. 결과: { url, noCover } 또는 null(실패)
export async function makeReceiptImage(receiptEl) {
  let lib;
  try {
    lib = await loadLib();
  } catch (e) {
    return null;
  }
  const opts = {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    skipFonts: true, // 웹글꼴을 넣으면 한글 글꼴 파일이 너무 많아 느려진다 → 기기 글꼴로 그림
    imagePlaceholder: BLANK,
    style: { transform: 'none', boxShadow: 'none', margin: '0' },
  };
  // 이미지 안에서는 웹글꼴 대신 기기 글꼴로 그려지므로, 화면도 잠깐 같은 글꼴로 바꿔 줄바꿈 위치를 맞춘다
  receiptEl.classList.add('receipt--export');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return { url: await lib.toPng(receiptEl, { ...opts, filter: baseFilter }), noCover: false };
  } catch (e) {
    try {
      return { url: await lib.toPng(receiptEl, { ...opts, filter: noImgFilter }), noCover: true };
    } catch (e2) {
      return null;
    }
  } finally {
    receiptEl.classList.remove('receipt--export');
  }
}

// PC: 파일로 내려받기
export function downloadImage(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}
