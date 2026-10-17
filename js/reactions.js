// 답장 스티커 — 받은 사람이 스티커를 남기고, 보낸 사람이 모아 보는 파일.
// 서버에는 영수증 내용 대신 "링크로 만든 해시 번호"만 보낸다. 같은 링크를 가진 사람만 같은 번호를 만들 수 있다.

import { API_BASE, API_TIMEOUT_MS, REPLY_STICKERS, SIM, SIM_SLOW_MS, wait } from './config.js';
import { showLoading, showEmpty, showError, clearState } from './states.js';

const DEV_KEY = 'kreceipt.dev';
const SENT_KEY = 'kreceipt.replied';
let memDev = null;

// 링크 코드 → 영수증 번호 (SHA-256 앞 32자)
export async function receiptId(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// 이 기기의 무작위 번호 (같은 기기가 스티커를 바꾸면 덮어쓰기 위해). 개인을 알아볼 수 없는 값
function deviceId() {
  try {
    let d = localStorage.getItem(DEV_KEY);
    if (!d) {
      d = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEV_KEY, d);
    }
    return d;
  } catch (e) {
    if (!memDev) memDev = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return memDev;
  }
}

// 내가 이 영수증에 보낸 스티커 (버튼에 표시용)
export function myReply(id) {
  try { return (JSON.parse(localStorage.getItem(SENT_KEY) || '{}'))[id] || null; } catch (e) { return null; }
}
function rememberReply(id, s) {
  try {
    const m = JSON.parse(localStorage.getItem(SENT_KEY) || '{}');
    m[id] = s;
    localStorage.setItem(SENT_KEY, JSON.stringify(m));
  } catch (e) { /* 기억 못 해도 보내기에는 지장 없음 */ }
}

async function call(path, init) {
  if (SIM.slow) await wait(SIM_SLOW_MS);
  if (SIM.error) throw Object.assign(new Error('sim-error'), { kind: 'network' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw Object.assign(new Error((data && data.message) || 'HTTP ' + res.status), { kind: (data && data.code) || 'server' });
    return data;
  } catch (e) {
    if (!e.kind) e.kind = e.name === 'AbortError' ? 'timeout' : navigator.onLine === false ? 'offline' : 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function getReplies(id) {
  if (SIM.empty) return [];
  return (await call(`/reactions?id=${id}`)).reactions || [];
}

export async function sendReply(id, sticker, name) {
  const data = await call('/reactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, s: sticker, n: name || '', dev: deviceId() }),
  });
  rememberReply(id, sticker);
  return data.reactions || [];
}

export const stickerOf = (key) => REPLY_STICKERS.find(([k]) => k === key);

const WHY = {
  offline: '인터넷에 연결되어 있지 않아요.',
  timeout: '답장 서버가 제때 답하지 않았어요.',
  full: '이 영수증에는 답장이 가득 찼어요.',
  network: '답장 서버에 연결하지 못했어요.',
};
export const whyReply = (e) => (e.kind === 'full' ? WHY.full : WHY[e.kind] || e.message || WHY.network);

// 답장 목록 그리기 (스티커 · 이름 · 언제)
export function renderReplies(list, ul) {
  const fmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  ul.replaceChildren(...list.slice().sort((a, b) => b.t - a.t).map((r, k) => {
    const st = stickerOf(r.s);
    const li = document.createElement('li');
    li.className = 'reply';
    li.style.setProperty('--i', Math.min(k, 8));
    li.innerHTML = '<span class="reply__emoji" aria-hidden="true"></span><span class="reply__text"><b></b><small></small></span>';
    li.querySelector('.reply__emoji').textContent = st ? st[1] : '💬';
    li.querySelector('b').textContent = `${r.n || '친구'} · ${st ? st[2] : ''}`;
    li.querySelector('small').textContent = fmt.format(new Date(r.t));
    return li;
  }));
}

// "받은 답장" 칸 불러오기 (보낸 사람 쪽 화면에서 씀)
export async function loadRepliesInto({ code, state, list, emptyText }) {
  showLoading(state, { where: '받은 답장', text: '답장을 불러오는 중…' });
  list.replaceChildren();
  try {
    const replies = await getReplies(await receiptId(code));
    if (!replies.length) {
      showEmpty(state, { where: '받은 답장', title: '아직 답장이 없어요.', desc: emptyText, actions: [] });
      return replies;
    }
    clearState(state, '받은 답장');
    renderReplies(replies, list);
    return replies;
  } catch (e) {
    showError(state, {
      where: '받은 답장',
      what: '답장을 불러오지 못했어요.',
      why: whyReply(e),
      todo: '잠시 뒤 다시 시도해 주세요. 영수증은 그대로 볼 수 있어요.',
      onRetry: () => loadRepliesInto({ code, state, list, emptyText }),
    });
    return null;
  }
}
