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

// ───────── 인스타 스토리용 이미지 ─────────
// sticker: 배경이 투명한 영수증 (스토리 사진 위에 스티커로 붙이기용)
// story:   스토리 크기(1080×1920) 연분홍 바탕 가운데 영수증
// 화면의 영수증을 복제해 화면 밖에 잠깐 놓고 그린다. 결과는 영수증 요소에 기억해 두어,
// 버튼을 누르는 순간 바로 공유 창을 열 수 있게 한다 (휴대전화는 누른 직후에만 공유 창을 허락함).
function buildStage(receiptEl, kind) {
  const stage = document.createElement('div');
  stage.className = `export-stage export-stage--${kind}`;
  stage.setAttribute('aria-hidden', 'true');
  const clone = receiptEl.cloneNode(true);
  clone.classList.remove('is-printing');
  clone.classList.add('receipt--export');
  clone.removeAttribute('aria-label');
  // 합계가 올라가는 중에 복제해도 마지막 숫자로
  const tot = clone.querySelector('.receipt__total span:last-child');
  if (tot && tot.dataset.final) tot.textContent = tot.dataset.final;
  stage.append(clone);
  if (kind === 'story') {
    const tag = document.createElement('p');
    tag.className = 'export-stage__tag';
    tag.textContent = 'KRECEIPT';
    stage.append(tag);
  }
  document.body.append(stage);
  return stage;
}

async function renderStage(receiptEl, kind) {
  const lib = await loadLib();
  const stage = buildStage(receiptEl, kind);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // 무대는 화면 밖(left:-10000px)에 있지만, 그림 안에서는 제자리에 그려야 한다
  const opts = { pixelRatio: 3, skipFonts: true, imagePlaceholder: BLANK, filter: baseFilter, style: { position: 'static', left: '0', top: '0' } };
  try {
    try {
      return await lib.toBlob(stage, opts);
    } catch (e) {
      return await lib.toBlob(stage, { ...opts, filter: noImgFilter }); // 앨범 커버를 못 그리면 빼고
    }
  } finally {
    stage.remove();
  }
}

// 같은 영수증이면 한 번만 만든다
export function getInstaImage(receiptEl, kind) {
  receiptEl._insta = receiptEl._insta || {};
  if (!receiptEl._insta[kind]) {
    receiptEl._insta[kind] = renderStage(receiptEl, kind).then((b) => {
      if (!b) throw new Error('empty');
      return b;
    });
    receiptEl._insta[kind].catch(() => { delete receiptEl._insta[kind]; });
  }
  return receiptEl._insta[kind];
}

// 영수증이 다 나온 뒤 미리 만들어 둔다 (실패해도 조용히 — 누를 때 다시 만든다)
// 노래 칸이 아직 불러오는 중이면 조금 기다렸다가 만든다 (최대 약 10초)
export function warmInstaImages(receiptEl) {
  let tries = 0;
  const go = () => {
    if (!receiptEl.isConnected) return;
    const songLoading = receiptEl.querySelector('.receipt__song-slot[aria-busy="true"]') ||
      (receiptEl.querySelector('.receipt__song-slot') && !receiptEl.querySelector('.receipt__song'));
    if (songLoading && ++tries < 16) { setTimeout(go, 500); return; }
    getInstaImage(receiptEl, 'story').catch(() => {});
    getInstaImage(receiptEl, 'sticker').catch(() => {});
  };
  setTimeout(go, 2600);
}
