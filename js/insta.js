// 인스타 스토리로 나누기 — "스티커로 복사"와 "인스타 스토리로 보내기" 버튼, 그리고 이미지 창.
// 웹 페이지는 인스타 앱의 공식 스토리 공유 통로를 쓸 수 없어서(앱 전용),
//   ① 투명 배경 영수증을 클립보드에 복사 → 인스타 스토리 편집 화면에서 붙여넣기(스티커)
//   ② 휴대전화 공유 창에 스토리 크기 이미지를 넘김 → Instagram → 스토리
// 두 가지 길을 쓴다. 둘 다 안 되는 기기는 이미지를 창에 띄워 꾹 눌러 복사·저장하게 한다.

import { getInstaImage } from './image.js';

const $ = (id) => document.getElementById(id);
const isKakao = () => /KAKAOTALK/i.test(navigator.userAgent);

// ───────── 이미지 창 (꾹 눌러 저장·복사) ─────────
export function openImageDialog(url, filename, trigger, { title, hint } = {}) {
  const dlg = $('img-dialog');
  $('img-dialog-title').textContent = title || '이미지를 꾹 눌러 저장해 주세요';
  $('img-dialog-hint').textContent = hint || '이미지를 길게 누른 뒤 "이미지 다운로드"(안드로이드) 또는 "사진에 저장"(아이폰)을 고르세요.';
  $('img-dialog-img').src = url;
  $('img-dialog-download').href = url;
  $('img-dialog-download').setAttribute('download', filename);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  $('img-dialog-close').focus();
  dlg.onclose = () => {
    const src = $('img-dialog-img').src;
    $('img-dialog-img').removeAttribute('src');
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    trigger?.focus();
  };
}

export function setupImageDialog() {
  const dlg = $('img-dialog');
  const close = () => { if (dlg.close) dlg.close(); else { dlg.removeAttribute('open'); dlg.onclose?.(); } };
  $('img-dialog-close').addEventListener('click', close);
  // 이미지 바깥(어두운 배경)을 누르면 닫기
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
}

function say(statusEl, msg, isError = false) {
  statusEl.classList.toggle('is-error', isError);
  statusEl.textContent = '';
  statusEl.textContent = msg;
}

// ───────── ① 스티커로 복사 ─────────
async function copySticker(receiptEl, filename, statusEl, trigger) {
  if (isKakao()) {
    say(statusEl, '카카오톡 안에서는 복사가 막혀 있을 수 있어요. 위쪽 "외부 브라우저로 열기"로 연 뒤 다시 눌러 주세요.', true);
  }
  const blobPromise = getInstaImage(receiptEl, 'sticker');
  // 사파리는 누른 순간에 ClipboardItem 을 만들어야 해서, 이미지(Promise)를 그대로 넘긴다
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      say(statusEl, '스티커를 복사했어요. 인스타 스토리 편집 화면에서 "붙여넣기"(아이폰은 아래 "스티커 추가")를 눌러 주세요.');
      return;
    } catch (e) {
      // 일부 크롬은 Promise 대신 다 만든 이미지를 받아야 한다
      try {
        const blob = await blobPromise;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        say(statusEl, '스티커를 복사했어요. 인스타 스토리 편집 화면에서 붙여넣기 해 주세요.');
        return;
      } catch (e2) { /* 아래 창으로 대신 */ }
    }
  }
  // 복사가 안 되는 기기: 투명 이미지를 띄워 꾹 눌러 "복사"하게 한다
  try {
    const blob = await blobPromise;
    openImageDialog(URL.createObjectURL(blob), filename, trigger, {
      title: '스티커를 꾹 눌러 복사해 주세요',
      hint: '이미지를 길게 누른 뒤 "복사"를 고르고, 인스타 스토리 편집 화면에서 붙여넣기 하세요. 복사가 없으면 저장한 뒤 스티커(사진)로 넣어 주세요.',
    });
    say(statusEl, '자동 복사가 안 되는 브라우저라 스티커 이미지를 띄웠어요.');
  } catch (e) {
    say(statusEl, '스티커 이미지를 만들지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', true);
  }
}

// ───────── ② 인스타 스토리로 보내기 (공유 창) ─────────
async function shareStory(receiptEl, filename, statusEl, trigger) {
  let blob;
  try {
    blob = await getInstaImage(receiptEl, 'story');
  } catch (e) {
    say(statusEl, '스토리 이미지를 만들지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', true);
    return;
  }
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      say(statusEl, '공유 창을 열었어요. Instagram → 스토리를 골라 주세요.');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // 사용자가 닫음
      if (e.name === 'NotAllowedError') {
        // 이미지를 만드는 사이 "방금 누름" 시간이 지난 경우. 이제 이미지가 준비됐으니 한 번 더 누르면 된다
        say(statusEl, '이미지가 준비됐어요. "인스타 스토리로 보내기"를 한 번 더 눌러 주세요.');
        return;
      }
    }
  }
  // 공유 창이 없는 기기(PC 등): 스토리 크기 이미지를 띄운다
  openImageDialog(URL.createObjectURL(blob), filename, trigger, {
    title: '스토리 이미지를 저장해 주세요',
    hint: '이 브라우저는 공유 창을 열 수 없어요. 이미지를 저장한 뒤 인스타 스토리에서 골라 주세요.',
  });
  say(statusEl, '공유 창을 열 수 없는 브라우저라 스토리 이미지를 띄웠어요.');
}

// 버튼 연결. getReceipt: 지금 화면의 영수증 요소, getDate: 영수증 날짜
export function setupInstaButtons({ copyBtn, shareBtn, statusEl, getReceipt, getDate }) {
  copyBtn.addEventListener('click', () => {
    const r = getReceipt();
    if (r) copySticker(r, `kreceipt-sticker-${getDate()}.png`, statusEl, copyBtn);
  });
  shareBtn.addEventListener('click', () => {
    const r = getReceipt();
    if (r) shareStory(r, `kreceipt-story-${getDate()}.png`, statusEl, shareBtn);
  });
}
