// 영수증 데이터를 링크 주소(#r=...)에 담고 꺼내는 파일. 서버 없이 공유하는 방법.
// # 뒤 내용은 브라우저가 서버로 보내지 않으므로, 영수증은 어떤 서버에도 저장되지 않는다.
//
// 링크에 담는 모양 (v1):
// { v:1, d:"2026-10-14", n:"숨", i:[["아메리카노 ×2", 9000], ...], m:"오늘도 잘 썼다", s:{ id:123, t:"곡명", a:"가수", p:"dz" } }
// s.p 는 노래 출처: 없으면 iTunes, "dz" 면 Deezer
// f 는 오늘의 기분 (예: "love"), w 는 그날 날씨 { c: "sun", t: 21, k: "n"(지금)|"x"(최고) } — 위치는 담지 않는다
// 금융기관명·계좌·잔액·원본 인식 글자는 절대 담지 않는다.

import { LIMITS, MOODS, WEATHER } from './config.js';
import { charCount } from './validate.js';

const LZ = () => window.LZString;
const SCHEMA_VERSION = 1;

// 사용자가 고른 내용만 골라 링크용 객체로 만든다 (빈 값은 빼서 링크를 짧게)
export function buildReceipt({ date, nick, items, message, song, mood, weather }) {
  const r = { v: SCHEMA_VERSION, d: date, i: items.map((it) => [it.name.trim(), it.amount]) };
  if (nick && nick.trim()) r.n = nick.trim();
  if (message && message.trim()) r.m = message.trim();
  if (mood) r.f = mood;
  if (weather) r.w = { c: weather.c, t: weather.t, k: weather.kind === 'max' ? 'x' : 'n' };
  if (song) {
    r.s = { id: song.id, t: song.title, a: song.artist };
    if (song.src === 'dz') r.s.p = 'dz';
  }
  return r;
}

export function encodeReceipt(r) {
  return LZ().compressToEncodedURIComponent(JSON.stringify(r));
}

export function linkFor(code) {
  return location.origin + location.pathname + '#r=' + code;
}

// 링크 내용 검사. 문제가 있으면 이유를 돌려준다 (화면에는 "손상됐어요"로 안내)
export function validateReceipt(o) {
  const isStr = (x) => typeof x === 'string';
  if (!o || typeof o !== 'object' || Array.isArray(o)) return '형식이 영수증이 아님';
  if (o.v !== SCHEMA_VERSION) return `지원하지 않는 버전(${String(o.v)})`;
  if (!isStr(o.d) || !/^\d{4}-\d{2}-\d{2}$/.test(o.d) || Number.isNaN(Date.parse(o.d))) return '날짜가 올바르지 않음';
  if (!Array.isArray(o.i) || o.i.length < LIMITS.itemsMin || o.i.length > LIMITS.itemsMax) return '항목 수가 범위를 벗어남';
  for (const it of o.i) {
    if (!Array.isArray(it) || it.length !== 2) return '항목 모양이 올바르지 않음';
    const [name, amount] = it;
    const n = isStr(name) ? charCount(name.trim()) : 0;
    if (n < LIMITS.nameMin || n > LIMITS.nameMax) return '항목 이름 길이가 범위를 벗어남';
    if (!Number.isInteger(amount) || amount < LIMITS.amountMin || amount > LIMITS.amountMax) return '금액이 범위를 벗어남';
  }
  if (o.n !== undefined && (!isStr(o.n) || charCount(o.n) > LIMITS.nickMax)) return '이름이 올바르지 않음';
  if (o.m !== undefined && (!isStr(o.m) || charCount(o.m) > LIMITS.messageMax)) return '한마디가 올바르지 않음';
  if (o.f !== undefined && !MOODS.some(([k]) => k === o.f)) return '기분 정보가 올바르지 않음';
  if (o.w !== undefined) {
    const w = o.w;
    if (!w || !WEATHER[w.c] || !Number.isInteger(w.t) || w.t < -60 || w.t > 60 || (w.k !== 'n' && w.k !== 'x')) return '날씨 정보가 올바르지 않음';
  }
  if (o.s !== undefined) {
    const s = o.s;
    if (!s || !Number.isInteger(s.id) || s.id <= 0 || !isStr(s.t) || !isStr(s.a) || s.t.length > 200 || s.a.length > 200 || (s.p !== undefined && s.p !== 'dz')) return '노래 정보가 올바르지 않음';
  }
  return '';
}

// 링크 코드 → { ok, data } 또는 { ok:false, reason }
export function decodeReceipt(code) {
  if (!code) return { ok: false, reason: '링크에 영수증 내용이 없음' };
  if (code.length > LIMITS.linkMax * 2) return { ok: false, reason: '링크가 너무 김' };
  let json = null;
  try {
    json = LZ().decompressFromEncodedURIComponent(code);
  } catch (e) {
    json = null;
  }
  if (!json) return { ok: false, reason: '압축을 풀 수 없음' };
  let o;
  try {
    o = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: '내용을 읽을 수 없음' };
  }
  const reason = validateReceipt(o);
  if (reason) return { ok: false, reason };
  return { ok: true, data: o };
}

// 공유: 공유 시트(Web Share API) → 안 되면 클립보드 복사 → 그것도 안 되면 직접 복사
// 결과: 'shared' | 'cancelled' | 'copied' | 'manual'
export async function shareLink(url, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'kreceipt', text, url });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // 공유 시트가 막힌 경우 아래 복사로 넘어간다
    }
  }
  return (await copyText(url)) ? 'copied' : 'manual';
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 아래 방식으로 다시 시도 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}
