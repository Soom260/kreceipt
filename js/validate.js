// 입력 검증 규칙과 "입력칸 바로 아래 안내"를 다루는 파일.
// 규칙의 숫자는 config.js 의 LIMITS 에서 가져온다.

import { LIMITS, FILE_TYPES } from './config.js';
import { reportState } from './states.js';

const won = (n) => n.toLocaleString('ko-KR');
// 한글·이모지도 한 글자로 센다
export const charCount = (s) => Array.from(s || '').length;

// 캡처 파일: 이미지(png/jpg/webp)만, 10MB 이하
export function checkFile(file) {
  if (!file) return '읽을 캡처 이미지를 먼저 골라 주세요.';
  if (!FILE_TYPES[file.type]) {
    const ext = (file.name.split('.').pop() || '알 수 없음').toUpperCase();
    return `이미지 파일(PNG·JPG·WEBP)만 올릴 수 있어요. 지금 파일: ${ext}`;
  }
  const mb = file.size / (1024 * 1024);
  if (mb > LIMITS.fileMaxMB) {
    return `${LIMITS.fileMaxMB}MB 이하 이미지만 올릴 수 있어요. 지금 파일: ${mb.toFixed(1)}MB`;
  }
  return '';
}

// 항목 이름: 1–20자
export function checkName(v) {
  const t = (v || '').trim();
  const n = charCount(t);
  if (n < LIMITS.nameMin) return '항목 이름을 적어 주세요.';
  if (n > LIMITS.nameMax) return `항목 이름은 ${LIMITS.nameMin}–${LIMITS.nameMax}자로 적어 주세요. 지금 ${n}자입니다.`;
  return '';
}

// 금액: 쉼표·'원'은 허용하고 숫자만 남긴다. 1 이상 상한 이하의 정수
export function parseAmount(raw) {
  const t = String(raw ?? '').replace(/[,\s원]/g, '');
  if (t === '') return { msg: '금액을 적어 주세요. 예: 4500' };
  if (!/^\d+$/.test(t)) return { msg: '금액은 숫자로만 적어 주세요. 예: 4500' };
  const value = Number(t);
  if (value < LIMITS.amountMin) return { msg: `금액은 ${won(LIMITS.amountMin)}원 이상이어야 해요.` };
  if (value > LIMITS.amountMax) return { msg: `금액은 ${won(LIMITS.amountMax)}원까지 적을 수 있어요.` };
  return { msg: '', value };
}

export function checkMessage(v) {
  const n = charCount(v);
  if (n > LIMITS.messageMax) return `한마디는 ${LIMITS.messageMax}자까지 쓸 수 있어요. 지금 ${n}자입니다.`;
  return '';
}

export function checkNick(v) {
  const n = charCount((v || '').trim());
  if (n > LIMITS.nickMax) return `이름은 ${LIMITS.nickMax}자까지 쓸 수 있어요. 지금 ${n}자입니다.`;
  return '';
}

export function checkSelection(count) {
  if (count < LIMITS.itemsMin) return '공유할 항목을 하나 이상 골라 주세요.';
  if (count > LIMITS.itemsMax) return `한 영수증에는 ${LIMITS.itemsMax}개까지 넣을 수 있어요. 지금 ${count}개를 골랐어요.`;
  return '';
}

// ───────── 안내 표시 ─────────
// 입력칸 바로 아래에 안내를 붙이고, aria-invalid·aria-describedby 를 연결한다.
// 입력값은 건드리지 않는다(유지). focus=true 면 그 입력칸으로 초점을 옮긴다.
let seq = 0;
export function setFieldError(input, msg, { focus = true, after = input } = {}) {
  let errEl = input._errEl;
  if (!errEl) {
    errEl = document.createElement('p');
    errEl.className = 'field-error';
    errEl.id = (input.id || 'f') + '-err-' + (++seq);
    after.insertAdjacentElement('afterend', errEl);
    input._errEl = errEl;
  }
  errEl.textContent = msg;
  input.setAttribute('aria-invalid', 'true');
  const ids = (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
  if (!ids.includes(errEl.id)) ids.push(errEl.id);
  input.setAttribute('aria-describedby', ids.join(' '));
  if (focus) input.focus();
  reportState(input.id || '입력칸', 'invalid');
}

export function clearFieldError(input) {
  const errEl = input._errEl;
  input.removeAttribute('aria-invalid');
  if (!errEl) return;
  const ids = (input.getAttribute('aria-describedby') || '').split(' ').filter((id) => id && id !== errEl.id);
  if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
  else input.removeAttribute('aria-describedby');
  errEl.remove();
  input._errEl = null;
}

// 입력칸이 아닌 묶음(거래 목록, 만들기 버튼 등)에 붙는 안내 문단
export function showBlockError(p, msg) {
  p.textContent = msg;
  p.hidden = !msg;
  if (msg) p.setAttribute('role', 'alert');
  else p.removeAttribute('role');
}
