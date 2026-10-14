// 영수증 한 장을 그리는 파일. 링크에서 꺼낸 데이터(v1 모양)를 받아 HTML 요소로 만든다.
// 노래 블록 자리만 만들어 두고, 노래 정보 채우기는 music.js 가 한다.

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
export function renderReceipt(data, { flat = false } = {}) {
  const r = el('article', 'receipt' + (flat ? ' receipt--flat' : ''));
  const total = totalOf(data);
  r.setAttribute('aria-label', `${data.d} 영수증, 항목 ${data.i.length}개, 합계 ${formatWon(total)}원`);

  r.append(el('div', 'receipt__brand', 'KRECEIPT'));
  r.append(el('div', 'receipt__meta', formatDay(data.d)));
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
  tot.append(el('span', '', 'TOTAL'), el('span', '', formatWon(total)));
  r.append(tot);

  if (data.m) r.append(el('p', 'receipt__note', `— ${data.m}`));
  if (data.n) r.append(el('p', 'receipt__from', `FROM ${data.n}`));
  if (data.s) {
    const slot = el('div', 'receipt__song-slot');
    r.append(slot);
  }
  r.append(barcode(JSON.stringify(data)));
  return r;
}
