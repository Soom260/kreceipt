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

// 내용으로 정한 씨앗값 → 늘 같은 숫자 (승차권 좌석 번호 등)
function seedOf(text) {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 영수증·승차권·카세트가 같이 쓰는 것: 기분·날씨·합계, 화면낭독기용 설명
function common(data) {
  const total = totalOf(data);
  const mood = data.f && MOODS.find(([k]) => k === data.f);
  const wx = data.w && WEATHER[data.w.c];
  const extra = [
    wx ? `날씨 ${wx[1]} ${data.w.k === 'x' ? '최고 ' : ''}${data.w.t}도` : '',
    mood ? `기분 ${mood[2]}` : '',
  ].filter(Boolean).join(', ');
  return { total, mood, wx, extra };
}

// 합계 숫자 (이미지로 만들 때 쓰는 마지막 숫자를 함께 적어 둔다)
function totalRow(label, total, animate) {
  const tot = el('div', 'receipt__total');
  const totNum = el('span', '', formatWon(total));
  totNum.dataset.final = formatWon(total);
  tot.append(el('span', '', label), totNum);
  if (animate) countUp(totNum, total);
  return tot;
}

function itemRows(items, cls = '') {
  const list = el('div', 'receipt__items' + (cls ? ' ' + cls : ''));
  list.setAttribute('role', 'list');
  items.forEach(([name, amount], k) => {
    const row = el('div', 'receipt__row');
    row.setAttribute('role', 'listitem');
    const amt = el('span', '', formatWon(amount));
    amt.setAttribute('aria-label', `${formatWon(amount)}원`);
    const nm = el('span', '', name);
    if (cls === 'cs__tracks') nm.prepend(el('b', 'cs__no', String(k + 1).padStart(2, '0')));
    row.append(nm, amt);
    list.append(row);
  });
  return list;
}

function finish(r) {
  // 줄이 위에서부터 차례로 나타나도록 순서 번호를 붙인다
  [...r.children].forEach((c, k) => c.style.setProperty('--ri', k));
  // 인쇄 모션이 끝나면 표시를 지운다 (이미지 저장 때 모션이 섞이지 않게)
  if (r.classList.contains('is-printing')) setTimeout(() => r.classList.remove('is-printing'), 6500);
  return r;
}

// data: 링크 모양 영수증. 돌려주는 값: 영수증 요소 (노래 자리는 .receipt__song-slot)
// data.y 가 "t" 면 승차권, "c" 면 카세트 모양으로 그린다 (정산 영수증은 늘 영수증)
export function renderReceipt(data, opts = {}) {
  if (!data.p && data.y === 't') return renderTicket(data, opts);
  if (!data.p && data.y === 'c') return renderCassette(data, opts);
  return renderPlain(data, opts);
}

function renderPlain(data, { flat = false, animate = true } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const r = el('article', 'receipt' + (flat ? ' receipt--flat' : '') + (animate && !reduce ? ' is-printing' : ''));
  const { total, mood, wx, extra } = common(data);
  const what = data.p ? `${data.p.a}부터 ${data.d}까지 정산 영수증, 영수증 ${data.p.c}장 모음` : `${data.d} 영수증`;
  r.setAttribute('aria-label', `${what}, ${extra ? extra + ', ' : ''}항목 ${data.i.length}개, 합계 ${formatWon(total)}원`);

  r.append(el('div', 'receipt__brand', 'KRECEIPT'));
  // 날짜 줄: 2026-10-16 · THU · ☀️ 21° · 🥰 (정산 영수증은 2026-11-01 ~ 2026-11-18)
  const meta = [data.p ? `${data.p.a} ~ ${data.d}` : formatDay(data.d)];
  if (wx) meta.push(`${wx[0]} ${data.w.t}°`);
  if (mood) meta.push(mood[1]);
  const metaEl = el('div', 'receipt__meta', meta.join(' · '));
  metaEl.setAttribute('aria-hidden', 'true'); // 내용은 영수증 전체 설명(aria-label)에 있음
  r.append(metaEl);
  if (data.p) {
    const sub = el('div', 'receipt__meta', `정산 · 영수증 ${data.p.c}장`);
    sub.setAttribute('aria-hidden', 'true');
    r.append(sub);
  }
  r.append(el('hr', 'receipt__rule'));
  r.append(itemRows(data.i));
  r.append(el('hr', 'receipt__rule'));
  r.append(totalRow('TOTAL', total, animate && !reduce));

  if (data.m) r.append(el('p', 'receipt__note', `— ${data.m}`));
  if (data.n) r.append(el('p', 'receipt__from', `FROM ${data.n}`));
  if (data.s) r.append(el('div', 'receipt__song-slot'));
  r.append(barcode(JSON.stringify(data)));
  return finish(r);
}

// ───────── 승차권 ─────────
// 첫 결제 → 마지막 결제를 출발·도착으로, 사이 결제는 경유지로. 모든 항목에 시간이 있으면 시간 순서로 줄 세운다.
// 기분은 객실, 좌석·호차는 내용으로 정한 번호(같은 영수증이면 늘 같음).
function renderTicket(data, { flat = false, animate = true } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const r = el('article', 'receipt receipt--ticket' + (flat ? ' receipt--flat' : '') + (animate && !reduce ? ' is-printing' : ''));
  const { total, mood, wx, extra } = common(data);
  const times = data.h || data.i.map(() => '');
  // 모든 항목에 시간이 있으면 시간 순서로 (은행 앱은 최근 거래가 위에 오기도 해서), 하나라도 없으면 고른 순서 그대로
  const order = data.i.map((_, k) => k);
  if (times.every(Boolean)) order.sort((a, b) => (times[a] < times[b] ? -1 : times[a] > times[b] ? 1 : a - b));
  const items = order.map((k) => data.i[k]);
  const tms = order.map((k) => times[k]);
  const from = items.length > 1 ? items[0][0] : '집';
  const to = items[items.length - 1][0];
  const depT = items.length > 1 ? tms[0] : '';
  const arrT = tms[tms.length - 1];
  const seed = seedOf(JSON.stringify(data));
  const car = 1 + (seed % 8);
  const seat = `${1 + ((seed >>> 3) % 15)}${'ABCD'[(seed >>> 7) % 4]}`;
  const cabin = mood ? `${mood[2]}실` : '일반실';

  r.setAttribute('aria-label', `${data.d} 승차권, ${from}에서 ${to}까지${items.length > 2 ? `, 경유 ${items.length - 2}곳` : ''}, ${extra ? extra + ', ' : ''}항목 ${items.length}개, 운임 합계 ${formatWon(total)}원`);

  const main = el('div', 'tk__main');
  const head = el('div', 'tk__head');
  head.append(el('span', 'tk__brand', 'KRECEIPT'), el('span', 'tk__kind', '승차권 · TICKET'));
  head.setAttribute('aria-hidden', 'true');
  main.append(head);

  const meta = [formatDay(data.d)];
  if (wx) meta.push(`${wx[0]} ${data.w.t}°`);
  const metaEl = el('div', 'tk__date', meta.join(' · '));
  metaEl.setAttribute('aria-hidden', 'true');
  main.append(metaEl);

  const route = el('div', 'tk__route');
  route.setAttribute('aria-hidden', 'true');
  const stop = (label, name, time, end) => {
    const s = el('div', 'tk__stop' + (end ? ' tk__stop--end' : ''));
    s.append(el('small', '', label), el('b', '', name));
    if (time) s.append(el('span', 'tk__time', time));
    return s;
  };
  const arrow = el('div', 'tk__arrow');
  arrow.append(el('i'), el('small', '', items.length > 2 ? `경유 ${items.length - 2}` : '직행'));
  route.append(stop('출발', from, depT, false), arrow, stop('도착', to, arrT, true));
  main.append(route);

  const info = el('div', 'tk__info');
  info.setAttribute('aria-hidden', 'true');
  [['호차', `${car}호차`], ['좌석', seat], ['객실', cabin]].forEach(([k, v]) => {
    const c = el('div', '');
    c.append(el('small', '', k), el('b', '', v));
    info.append(c);
  });
  main.append(info);

  main.append(el('hr', 'receipt__rule'));
  const list = itemRows(items, 'tk__items');
  [...list.children].forEach((row, k) => { if (tms[k]) row.firstChild.prepend(el('em', 'tk__t', tms[k])); });
  main.append(list);
  main.append(el('hr', 'receipt__rule'));
  main.append(totalRow('운임 합계', total, animate && !reduce));
  r.append(main);

  const perf = el('div', 'tk__perf');
  perf.setAttribute('aria-hidden', 'true');
  r.append(perf);

  const stub = el('div', 'tk__stub');
  if (data.m) stub.append(el('p', 'receipt__note tk__note', data.m));
  if (data.n) stub.append(el('p', 'receipt__from', `승객 ${data.n}`));
  if (data.s) stub.append(el('div', 'receipt__song-slot'));
  stub.append(barcode(JSON.stringify(data)));
  r.append(stub);
  return finish(r);
}

// ───────── 카세트 ─────────
// 위는 카세트 테이프(라벨에 오늘의 노래), 아래는 테이프 속지처럼 결제내역을 트랙 목록으로.
// 노래가 없으면 한마디를, 그것도 없으면 "오늘의 믹스테이프"를 라벨에 적는다.
function renderCassette(data, { flat = false, animate = true } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const r = el('article', 'receipt receipt--cassette' + (flat ? ' receipt--flat' : '') + (animate && !reduce ? ' is-printing' : ''));
  const { total, mood, wx, extra } = common(data);
  const title = data.s ? data.s.t : data.m || '오늘의 믹스테이프';
  const sub = data.s ? data.s.a : data.n ? `${data.n}의 테이프` : 'KRECEIPT';
  r.setAttribute('aria-label', `${data.d} 카세트 영수증, ${data.s ? `노래 ${data.s.t} ${data.s.a}, ` : ''}${extra ? extra + ', ' : ''}항목 ${data.i.length}개, 합계 ${formatWon(total)}원`);

  const shell = el('div', 'cs__shell');
  shell.setAttribute('aria-hidden', 'true');
  const label = el('div', 'cs__label');
  const top = el('div', 'cs__top');
  top.append(el('span', 'cs__side', 'A'), el('span', '', 'KRECEIPT'), el('span', '', `C-${Math.min(999, Math.max(1, Math.round(total / 1000)))}`));
  label.append(top, el('div', 'cs__title', title), el('div', 'cs__sub', sub), el('div', 'cs__stripes'));
  const win = el('div', 'cs__window');
  win.append(el('i', 'cs__reel'), el('span', 'cs__tape'), el('i', 'cs__reel'));
  label.append(win);
  shell.append(label);
  const foot = el('div', 'cs__foot');
  foot.append(el('i'), el('i'), el('i'), el('i'));
  shell.append(foot);
  r.append(shell);

  const card = el('div', 'cs__card');
  const meta = [formatDay(data.d)];
  if (wx) meta.push(`${wx[0]} ${data.w.t}°`);
  if (mood) meta.push(mood[1]);
  const head = el('div', 'cs__head');
  head.append(el('span', '', 'TRACKLIST'), el('span', '', meta.join(' · ')));
  head.setAttribute('aria-hidden', 'true');
  card.append(head);
  card.append(itemRows(data.i, 'cs__tracks'));
  card.append(el('hr', 'receipt__rule'));
  card.append(totalRow('TOTAL', total, animate && !reduce));
  if (data.m && data.s) card.append(el('p', 'receipt__note', `— ${data.m}`));
  if (data.n) card.append(el('p', 'receipt__from', `FROM ${data.n}`));
  if (data.s) card.append(el('div', 'receipt__song-slot'));
  r.append(card);
  return finish(r);
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
