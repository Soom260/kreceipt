// 보관함과 닉네임을 이 브라우저(localStorage)에 저장하는 파일.
// 저장이 막힌 환경(일부 시크릿 창 등)이 있어 읽기·쓰기를 모두 try/catch 로 감싼다.

import { SIM, LIMITS } from './config.js';
import { decodeReceipt, validateReceipt } from './share.js';

const BOX_KEY = 'kreceipt.box.v1';
const NICK_KEY = 'kreceipt.nick';

let available = null;

// 저장소를 쓸 수 있는지 한 번 시험해 본다
export function isAvailable() {
  if (SIM.nostorage) return false;
  if (available !== null) return available;
  try {
    const k = 'kreceipt.__test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    available = true;
  } catch (e) {
    available = false;
  }
  return available;
}

// 보관함 항목 모양: { key: 링크 코드, kind: 'mine'|'received', data: 영수증, savedAt: 저장 시각(ms), from?: 보관할 때 적은 친구 이름 }
// from 은 내 보관함에만 있고 링크에는 들어가지 않는다.
export function loadBox() {
  if (!isAvailable()) return null;
  try {
    const raw = localStorage.getItem(BOX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    // 손상된 항목은 조용히 빼고 읽는다
    return list.filter((e) => e && typeof e.key === 'string' && (e.kind === 'mine' || e.kind === 'received') && !validateReceipt(e.data));
  } catch (e) {
    return [];
  }
}

function saveBox(list) {
  if (!isAvailable()) return false;
  try {
    localStorage.setItem(BOX_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false; // 저장 공간 부족 등
  }
}

export function hasInBox(key) {
  const list = loadBox();
  return !!(list && list.find((e) => e.key === key));
}

export function findInBox(key) {
  const list = loadBox();
  return (list && list.find((e) => e.key === key)) || null;
}

// 결과: 'added' | 'exists' | 'error'
const cleanFrom = (v) => (typeof v === 'string' ? Array.from(v.trim()).slice(0, LIMITS.nickMax).join('') : '');

export function addToBox(key, kind, data, replaceKey, from) {
  const list = loadBox();
  if (list === null) return 'error';
  let next = replaceKey && replaceKey !== key ? list.filter((e) => e.key !== replaceKey) : list;
  if (next.find((e) => e.key === key)) {
    if (next !== list) saveBox(next);
    return 'exists';
  }
  const entry = { key, kind, data, savedAt: Date.now() };
  if (cleanFrom(from)) entry.from = cleanFrom(from);
  next = next.concat([entry]);
  return saveBox(next) ? 'added' : 'error';
}

export function removeFromBox(key) {
  const list = loadBox();
  if (list === null) return false;
  return saveBox(list.filter((e) => e.key !== key));
}

export function getNick() {
  if (!isAvailable()) return '';
  try { return localStorage.getItem(NICK_KEY) || ''; } catch (e) { return ''; }
}

export function setNick(v) {
  if (!isAvailable()) return;
  try {
    if (v) localStorage.setItem(NICK_KEY, v);
    else localStorage.removeItem(NICK_KEY);
  } catch (e) { /* 저장 못 해도 영수증 만들기에는 지장 없음 */ }
}

// ───────── 내보내기 / 가져오기 ─────────
export function exportBox() {
  const list = loadBox() || [];
  return JSON.stringify({ app: 'kreceipt', format: 1, exportedAt: new Date().toISOString(), items: list }, null, 2);
}

// 결과: { ok:false, msg } 또는 { ok:true, added, skippedSame, skippedBad }
export function importBox(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch (e) {
    return { ok: false, msg: 'JSON 형식이 아니에요. kreceipt에서 내보낸 파일인지 확인해 주세요.' };
  }
  if (!o || o.app !== 'kreceipt' || !Array.isArray(o.items)) {
    return { ok: false, msg: 'kreceipt 보관함 파일이 아니에요. 보관함의 "파일로 내보내기"로 만든 파일을 골라 주세요.' };
  }
  const list = loadBox();
  if (list === null) return { ok: false, msg: '이 브라우저에서는 보관함을 쓸 수 없어요.' };
  let added = 0, skippedSame = 0, skippedBad = 0;
  const next = list.slice();
  for (const e of o.items) {
    // 링크 코드를 다시 풀어 보고, 내용이 같을 때만 받아들인다 (파일을 손으로 고친 경우 대비)
    const dec = e && typeof e.key === 'string' ? decodeReceipt(e.key) : { ok: false };
    if (!dec.ok || (e.kind !== 'mine' && e.kind !== 'received')) { skippedBad++; continue; }
    if (next.find((x) => x.key === e.key)) { skippedSame++; continue; }
    const entry = { key: e.key, kind: e.kind, data: dec.data, savedAt: Number(e.savedAt) || Date.now() };
    if (cleanFrom(e.from)) entry.from = cleanFrom(e.from);
    next.push(entry);
    added++;
  }
  if (added && !saveBox(next)) return { ok: false, msg: '저장하지 못했어요. 브라우저 저장 공간이 부족할 수 있어요.' };
  return { ok: true, added, skippedSame, skippedBad };
}
