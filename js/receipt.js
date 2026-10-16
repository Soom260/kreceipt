// 영수증 한 장을 그리는 파일. 링크에서 꺼낸 데이터(v1 모양)를 받아 HTML 요소로 만든다.
// 노래 블록 자리만 만들어 두고, 노래 정보 채우기는 music.js 가 한다.
// 모양은 개인 홈페이지 kreceipt 카드 그대로. 화면에 나올 때 인쇄되듯 나오고 합계 숫자가 올라간다.

import { MOODS, WEATHER } from './config.js';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const formatWon = (n) => n.toLocaleString('ko-KR');

// "2026-10-14" → "2026-10-14 · WED"
export function formatDay(d) {
  const [y, m, day] = d.split('-').map(Number);
  return `${d} · ${DAYS[new Date(y, m - 1, day).getDay()]}`;
}

// "2026-10-14" → "10월 14일 (수)" (보관함 목록용)
export function formatDayKo(d) {
  const [y, m, day] = d.split('-').map(Number);
  const ko = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, day).getDay()];
  return `${y}. ${m}. ${day}. (${ko})`;
}

export const totalOf = (data) => data.i.reduce((s, [, a]) => s + a, 0);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// 같은 영수증이면 늘 같은 무늬가 나오도록, 내용으로 정한 씨앗값으로 막대를 만든다
function barcode(seedText) {
  let h = 2166136261;
  for (let k = 0; k < seedText.length; k++) { h ^= seedText.charCodeAt(k); h = Math.imul(h, 16777619); }
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  const wrap = el('div', 'receipt__barcode');
  wrap.setAttribute('aria-hidden', 'true');
  let units = 0, bar = true;
  while (units < 110) {
    const w = bar ? 1 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2);
    const i = el('i', bar ? (rand() < 0.12 ? 'blue' : '') : 'gap');
    i.style.flex = `${w} 0 0`;
    wrap.append(i);
    units += w;
    bar = !bar;
  }
  return wrap;
}

// data: 링크 모양 영수증. 돌려주는 값: 영수증 요소 (노래 자리는 .receipt__song-slot)
export function renderReceipt(data, { flat = false, animate = true } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const r = el('article', 'receipt' + (flat ? ' receipt--flat' : '') + (animate && !reduce ? ' is-printing' : ''));
  const total = totalOf(data);
  const mood = data.f && MOODS.find(([k]) => k === data.f);
  const wx = data.w && WEATHER[data.w.c];
  const extra = [
    wx ? `날씨 ${wx[1]} ${data.w.k === 'x' ? '최고 ' : ''}${data.w.t}도` : '',
    mood ? `기분 ${mood[2]}` : '',
  ].filter(Boolean).join(', ');
  r.setAttribute('aria-label', `${data.d} 영수증, ${extra ? extra + ', ' : ''}항목 ${data.i.length}개, 합계 ${formatWon(total)}원`);

  r.append(el('div', 'receipt__brand', 'KRECEIPT'));
  // 날짜 줄: 2026-10-16 · THU · ☀️ 21° · 🥰
  const meta = [formatDay(data.d)];
  if (wx) meta.push(`${wx[0]} ${data.w.t}°`);
  if (mood) meta.push(mood[1]);
  const metaEl = el('div', 'receipt__meta', meta.join(' · '));
  metaEl.setAttribute('aria-hidden', 'true'); // 내용은 영수증 전체 설명(aria-label)에 있음
  r.append(metaEl);
  r.append(el('hr', 'receipt__rule'));

  const list = el('div', 'receipt__items');
  list.setAttribute('role', 'list');
  data.i.forEach(([name, amount]) => {
    const row = el('div', 'receipt__row');
    row.setAttribute('role', 'listitem');
    const amt = el('span', '', formatWon(amount));
    amt.setAttribute('aria-label', `${formatWon(amount)}원`);
    row.append(el('span', '', name), amt);
    list.append(row);
  });
  r.append(list);

  r.append(el('hr', 'receipt__rule'));
  const tot = el('div', 'receipt__total');
  const totNum = el('span', '', formatWon(total));
  tot.append(el('span', '', 'TOTAL'), totNum);
  r.append(tot);
  if (animate && !reduce) countUp(totNum, total);

  if (data.m) r.append(el('p', 'receipt__note', `— ${data.m}`));
  if (data.n) r.append(el('p', 'receipt__from', `FROM ${data.n}`));
  if (data.s) {
    const slot = el('div', 'receipt__song-slot');
    r.append(slot);
  }
  r.append(barcode(JSON.stringify(data)));
  // 줄이 위에서부터 차례로 나타나도록 순서 번호를 붙인다
  [...r.children].forEach((c, k) => c.style.setProperty('--ri', k));
  // 인쇄 모션이 끝나면 표시를 지운다 (이미지 저장 때 모션이 섞이지 않게)
  if (r.classList.contains('is-printing')) setTimeout(() => r.classList.remove('is-printing'), 6500);
  return r;
}

// 합계 숫자가 0부터 올라간다 (화면낭독기는 영수증 전체 설명(aria-label)을 읽는다)
function countUp(node, total) {
  node.textContent = formatWon(0);
  const start = performance.now() + 700;
  const dur = 900;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / dur));
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = formatWon(Math.round(total * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
