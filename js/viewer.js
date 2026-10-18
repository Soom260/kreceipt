// 친구에게 받은 링크(#r=...)를 열었을 때 영수증을 보여 주고 "보관하기"를 처리하는 파일.

import { SIM, SIM_SLOW_MS, REPLY_STICKERS, wait } from './config.js';
import { showLoading, showError, clearState, confetti } from './states.js';
import { decodeReceipt } from './share.js';
import { addToBox, findInBox, isAvailable, getNick } from './storage.js';
import { renderReceipt } from './receipt.js';
import { fillReceiptSong } from './music.js';
import { saveImage } from './maker.js';
import { setupInstaButtons } from './insta.js';
import { warmInstaImages } from './image.js';
import { checkNick, setFieldError, clearFieldError } from './validate.js';
import { receiptId, myReply, sendReply, renderReplies, loadRepliesInto, stickerOf, whyReply } from './reactions.js';

const $ = (id) => document.getElementById(id);
let current = null; // { code, data, id(답장용 번호) }
let sending = false;

// 답장 칸 준비: 내 영수증이면 "받은 답장"만, 친구 영수증이면 스티커 남기기 + 다른 답장
async function setupReplies(isMine) {
  const code = current.code;
  $('reply-title').textContent = isMine ? '받은 답장' : '답장 스티커';
  $('reply-hint').textContent = isMine
    ? '친구들이 이 영수증에 남긴 스티커예요.'
    : '스티커로 보낸 사람에게 마음을 전해요. 링크를 가진 사람은 누구나 답장을 볼 수 있어요.';
  $('reply-send').hidden = isMine;
  $('reply-status').textContent = '';
  $('reply-status').classList.remove('is-error');
  clearFieldError($('reply-name'));
  current.id = await receiptId(code);
  if (!current || current.code !== code) return;
  if (!isMine) {
    if (!$('reply-name').value) $('reply-name').value = getNick();
    renderStickerButtons(myReply(current.id));
  }
  loadRepliesInto({
    code,
    state: $('reply-state'),
    list: $('reply-list'),
    emptyText: isMine ? '링크를 받은 친구가 스티커를 남기면 여기에 보여요.' : '첫 답장을 남겨 보세요.',
  });
}

function renderStickerButtons(picked) {
  $('reply-stickers').replaceChildren(...REPLY_STICKERS.map(([key, emoji, label], k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sticker';
    b.dataset.sticker = key;
    b.style.setProperty('--i', k);
    b.setAttribute('aria-pressed', String(picked === key));
    b.innerHTML = '<span class="sticker__emoji" aria-hidden="true"></span><span class="sticker__label"></span>';
    b.firstChild.textContent = emoji;
    b.lastChild.textContent = label;
    b.addEventListener('click', () => onSticker(key, b));
    return b;
  }));
}

async function onSticker(key, btn) {
  if (!current || !current.id || sending) return;
  const nameInp = $('reply-name');
  const msg = checkNick(nameInp.value);
  if (msg) { setFieldError(nameInp, msg); return; }
  clearFieldError(nameInp);
  const st = $('reply-status');
  st.classList.remove('is-error');
  sending = true;
  $('reply-stickers').querySelectorAll('.sticker').forEach((b) => { b.disabled = true; });
  btn.classList.add('is-sending');
  try {
    const list = await sendReply(current.id, key, nameInp.value.trim());
    renderStickerButtons(key);
    $('reply-state').replaceChildren();
    renderReplies(list, $('reply-list'));
    const s = stickerOf(key);
    st.textContent = `${s[1]} "${s[2]}" 답장을 남겼어요. 다른 스티커를 누르면 바뀌어요.`;
    confetti(18);
  } catch (e) {
    renderStickerButtons(myReply(current.id));
    st.classList.add('is-error');
    st.textContent = `답장을 남기지 못했어요. ${whyReply(e)} 잠시 뒤 다시 눌러 주세요.`;
  } finally {
    sending = false;
  }
}

function setKeepButton(entry) {
  const b = $('keep-btn');
  // 이름 칸은 아직 보관하지 않은 친구 영수증에서만 보인다
  $('from-field').hidden = !!entry;
  if (entry) {
    b.textContent = entry.kind === 'mine' ? '내 보관함에 있어요' : '보관함에 있어요';
    b.setAttribute('aria-disabled', 'true');
  } else {
    b.textContent = '보관하기';
    b.removeAttribute('aria-disabled');
  }
}

export async function showReceived(code) {
  const state = $('read-state');
  const body = $('read-body');
  body.hidden = true;
  $('keep-status').textContent = '';
  $('read-title').textContent = '친구 영수증';
  showLoading(state, { where: '친구 영수증', text: '영수증을 펼치는 중…' });
  if (SIM.slow) await wait(SIM_SLOW_MS);
  if (location.hash !== '#r=' + code) return; // 기다리는 사이 다른 화면으로 갔으면 그만

  const res = decodeReceipt(code);
  if (!res.ok) {
    current = null;
    showError(state, {
      where: '친구 영수증',
      what: '영수증 링크가 손상됐어요.',
      why: `링크 일부가 잘렸거나 바뀌었을 수 있어요. (확인된 문제: ${res.reason})`,
      todo: '보낸 사람에게 링크를 다시 받아 보세요. 메신저에서 링크 전체가 복사됐는지도 확인해 주세요.',
      retryLabel: '다시 읽어 보기',
      onRetry: () => showReceived(code),
      actions: [{ label: '내 영수증 만들기', onClick: () => { location.hash = '#make-1'; } }],
    });
    return;
  }

  current = { code, data: res.data, id: null };
  const entry = findInBox(code);
  const who = (entry && entry.from) || res.data.n;
  $('read-title').textContent = entry && entry.kind === 'mine' ? '내 영수증' : who ? `${who}님이 보낸 영수증` : '친구 영수증';
  // 이름 칸: 링크에 보낸 사람 이름이 있으면 미리 채워 둔다 (고칠 수 있음)
  const fromInp = $('from-name');
  clearFieldError(fromInp);
  fromInp.value = res.data.n || '';
  const r = renderReceipt(res.data);
  $('read-receipt').replaceChildren(r);
  setKeepButton(entry);
  clearState(state, '친구 영수증');
  body.hidden = false;
  if (res.data.s) fillReceiptSong(r.querySelector('.receipt__song-slot'), res.data.s);
  warmInstaImages(r);
  setupReplies(!!(entry && entry.kind === 'mine'));
}

export function setupViewer() {
  $('keep-btn').addEventListener('click', () => {
    if (!current) return;
    const st = $('keep-status');
    if ($('keep-btn').getAttribute('aria-disabled') === 'true') {
      st.classList.remove('is-error');
      st.textContent = '이미 보관함에 있어요.';
      return;
    }
    const fromInp = $('from-name');
    const fMsg = checkNick(fromInp.value);
    if (fMsg) { setFieldError(fromInp, fMsg.replace('이름은', '친구 이름은')); return; }
    clearFieldError(fromInp);
    const res = isAvailable() ? addToBox(current.code, 'received', current.data, null, fromInp.value) : 'error';
    if (res === 'error') {
      st.classList.add('is-error');
      st.textContent = '이 브라우저에서는 보관할 수 없어요. "이미지로 저장"으로 남겨 두세요. (시크릿 창이거나 사이트 데이터 저장이 꺼져 있을 수 있어요)';
      return;
    }
    st.classList.remove('is-error');
    const name = fromInp.value.trim();
    st.textContent = res === 'added' ? `${name ? `${name}님의 영수증으로 ` : ''}보관함에 넣었어요. 위쪽 "보관함"에서 다시 볼 수 있어요.` : '이미 보관함에 있어요.';
    if (name) $('read-title').textContent = `${name}님이 보낸 영수증`;
    if (res === 'added') confetti(30);
    setKeepButton(findInBox(current.code));
  });
  setupInstaButtons({
    copyBtn: $('read-sticker'),
    shareBtn: $('read-story'),
    statusEl: $('keep-status'),
    getReceipt: () => $('read-receipt').querySelector('.receipt'),
    getDate: () => (current ? current.data.d : 'receipt'),
  });
  $('read-image').addEventListener('click', () => {
    if (current) saveImage($('read-receipt').querySelector('.receipt'), current.data.d, $('keep-status'), $('read-image'));
  });
}
