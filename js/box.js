// 보관함 화면: 달력(영수증 있는 날 표시) + 그날의 영수증 목록, 내 영수증 / 친구 영수증 탭, 친구별로 보기,
// 내 영수증에 달린 답장 스티커 요약,
// 삭제, 파일로 내보내기·가져오기.

import { showEmpty, showError, clearState } from './states.js';
import { loadBox, removeFromBox, exportBox, importBox } from './storage.js';
import { setFieldError, clearFieldError } from './validate.js';
import { formatDayKo, formatWon, totalOf } from './receipt.js';
import { startSample, todayStr } from './maker.js';
import { receiptId, getReplies, stickerOf } from './reactions.js';

const $ = (id) => document.getElementById(id);
let filter = 'all';          // 'all' | 'mine' | 'received'
let selected = null;         // 고른 날짜 'YYYY-MM-DD' (없으면 모든 날짜)
let month = null;            // 달력에 보이는 달 'YYYY-MM'
let friend = null;           // 친구별로 보기에서 고른 친구 이름 (없으면 모든 친구)
const NO_NAME = '이름 없는 친구';
const FILTER_KO = { all: '전체', mine: '내 영수증', received: '친구 영수증' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n) => String(n).padStart(2, '0');
const kindLabel = (e) => (e.kind === 'mine' ? '내 영수증' : '친구 영수증');
// 친구 이름: 보관할 때 적은 이름 → 링크 안의 보낸 사람 이름
const friendName = (e) => (e.kind === 'mine' ? '' : e.from || e.data.n || '');
const friendKey = (e) => friendName(e) || NO_NAME;

// ───────── 목록 한 장 ─────────
function itemEl(e, k) {
  const li = document.createElement('li');
  li.className = 'box-item';
  li.style.setProperty('--i', Math.min(k, 8));
  const d = e.data;

  const head = document.createElement('div');
  head.className = 'box-item__head';
  const badge = document.createElement('span');
  badge.className = 'badge ' + (e.kind === 'mine' ? 'badge--mine' : 'badge--friend');
  badge.textContent = kindLabel(e);
  const who = document.createElement('span');
  who.className = 'box-item__who';
  who.textContent = friendName(e);
  const date = document.createElement('span');
  date.className = 'box-item__date';
  date.textContent = formatDayKo(d.d);
  head.append(badge, who, date);

  const sum = document.createElement('p');
  sum.className = 'box-item__sum';
  const names = d.i.slice(0, 2).map(([n]) => n).join(', ');
  sum.textContent = `${names}${d.i.length > 2 ? ` 외 ${d.i.length - 2}개` : ''} · ${formatWon(totalOf(d))}원${d.m ? ` · "${d.m}"` : ''}`;

  const label = `${formatDayKo(d.d)} ${kindLabel(e)}${friendName(e) ? ` (${friendName(e)})` : ''}`;
  const btns = document.createElement('div');
  btns.className = 'row-btns';
  const open = document.createElement('a');
  open.className = 'btn btn--small';
  open.href = '#r=' + e.key;
  open.textContent = '열기';
  open.setAttribute('aria-label', `${label} 열기`);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--small btn--danger';
  del.textContent = '삭제';
  del.setAttribute('aria-label', `${label} 삭제`);
  del.addEventListener('click', () => {
    if (!window.confirm(`${label}을(를) 보관함에서 지울까요? 되돌릴 수 없어요.`)) return;
    const ok = removeFromBox(e.key);
    renderBox();
    $('box-count').textContent = ok ? `지웠어요. ${$('box-count').textContent}` : '지우지 못했어요. 다시 시도해 주세요.';
    $('box-list-title').focus();
  });
  btns.append(open, del);
  if (e.kind === 'mine') {
    const rp = document.createElement('p');
    rp.className = 'box-item__replies';
    rp.dataset.key = e.key;
    li.append(head, sum, rp, btns);
  } else {
    li.append(head, sum, btns);
  }
  return li;
}

// ───────── 달력 ─────────
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
}

function renderCalendar(entries) {
  const cal = $('cal');
  // 날짜별 장 수 { 'YYYY-MM-DD': { mine, friend } }
  const byDay = {};
  entries.forEach((e) => {
    const c = byDay[e.data.d] || (byDay[e.data.d] = { mine: 0, friend: 0 });
    if (e.kind === 'mine') c.mine++; else c.friend++;
  });

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const today = todayStr();

  const head = document.createElement('div');
  head.className = 'cal__head';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'cal__nav';
  prev.textContent = '‹';
  prev.setAttribute('aria-label', '이전 달');
  prev.addEventListener('click', () => { month = shiftMonth(month, -1); renderBox({ keepFocus: '.cal__nav:first-of-type' }); });
  const title = document.createElement('h2');
  title.className = 'cal__title';
  title.id = 'cal-title';
  title.textContent = `${y}년 ${m}월`;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'cal__nav';
  next.textContent = '›';
  next.setAttribute('aria-label', '다음 달');
  next.addEventListener('click', () => { month = shiftMonth(month, 1); renderBox({ keepFocus: '.cal__nav:last-of-type' }); });
  head.append(prev, title, next);

  const table = document.createElement('table');
  table.className = 'cal__grid';
  table.setAttribute('aria-labelledby', 'cal-title');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  WEEK.forEach((w) => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = w; hr.append(th); });
  thead.append(hr);
  const tbody = document.createElement('tbody');
  let tr = document.createElement('tr');
  for (let k = 0; k < first; k++) tr.append(document.createElement('td'));
  let monthCount = 0;
  for (let d = 1; d <= days; d++) {
    const key = `${month}-${pad(d)}`;
    const c = byDay[key];
    const td = document.createElement('td');
    const dow = (first + d - 1) % 7;
    let cell;
    if (c) {
      monthCount += c.mine + c.friend;
      cell = document.createElement('button');
      cell.type = 'button';
      cell.setAttribute('aria-pressed', String(selected === key));
      const parts = [];
      if (c.mine) parts.push(`내 영수증 ${c.mine}장`);
      if (c.friend) parts.push(`친구 영수증 ${c.friend}장`);
      cell.setAttribute('aria-label', `${m}월 ${d}일 ${WEEK[dow]}요일${key === today ? ' 오늘' : ''}, ${parts.join(', ')}`);
      cell.addEventListener('click', () => {
        selected = selected === key ? null : key; // 같은 날을 다시 누르면 선택 풀기
        renderBox({ keepFocus: `[data-day="${key}"]` });
      });
    } else {
      cell = document.createElement('span');
    }
    cell.className = 'cal__day' + (c ? ' has' : '') + (key === today ? ' is-today' : '') + (dow === 0 ? ' is-sun' : '');
    cell.dataset.day = key;
    const num = document.createElement('span');
    num.className = 'cal__num';
    num.textContent = d;
    cell.append(num);
    if (c) {
      const marks = document.createElement('span');
      marks.className = 'cal__marks';
      marks.setAttribute('aria-hidden', 'true');
      if (c.mine) { const s = document.createElement('span'); s.className = 'mark mark--mine'; marks.append(s); }
      if (c.friend) { const s = document.createElement('span'); s.className = 'mark mark--friend'; marks.append(s); }
      cell.append(marks);
    }
    td.append(cell);
    tr.append(td);
    if (dow === 6) { tbody.append(tr); tr = document.createElement('tr'); }
  }
  if (tr.children.length) tbody.append(tr);
  table.append(thead, tbody);

  const note = document.createElement('p');
  note.className = 'cal__note';
  note.textContent = monthCount ? `이 달에 ${monthCount}장` : '이 달에는 영수증이 없어요';
  cal.replaceChildren(head, table, note);
}

// ───────── 친구별로 보기 (받을 때 적은 이름으로 묶음) ─────────
function renderFriendChips(all) {
  const box = $('friend-chips');
  const counts = new Map();
  all.filter((e) => e.kind === 'received').forEach((e) => counts.set(friendKey(e), (counts.get(friendKey(e)) || 0) + 1));
  if (friend && !counts.has(friend)) friend = null;
  box.hidden = !counts.size || filter === 'mine';
  if (box.hidden) { box.replaceChildren(); return; }
  const chip = (label, value, n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'friend-chip';
    b.setAttribute('aria-pressed', String(friend === value));
    b.textContent = label;
    if (n) {
      const c = document.createElement('span');
      c.className = 'friend-chip__n';
      c.textContent = n;
      c.setAttribute('aria-label', `${n}장`);
      b.append(c);
    }
    b.addEventListener('click', () => {
      friend = friend === value ? null : value;
      if (friend) filter = 'received'; // 친구를 고르면 친구 영수증 탭으로
      selected = null;
      renderBox({ keepFocus: null });
      ($('friend-chips').querySelector('[aria-pressed="true"]') || $('friend-chips').firstChild)?.focus();
    });
    return b;
  };
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  box.replaceChildren(chip('모든 친구', null, 0), ...names.map(([name, n]) => chip(name, name, n)));
}

// 내 영수증 카드에 답장 요약 (😂🥹 2) — 화면에 보이는 것만, 실패하면 조용히 비워 둔다
async function fillReplySummaries() {
  const slots = [...document.querySelectorAll('#box-list .box-item__replies')].slice(0, 20);
  await Promise.all(slots.map(async (slot) => {
    try {
      const list = await getReplies(await receiptId(slot.dataset.key));
      if (!slot.isConnected) return;
      if (!list.length) { slot.textContent = '아직 받은 답장이 없어요'; slot.classList.add('is-empty'); return; }
      const emojis = [...new Set(list.map((r) => (stickerOf(r.s) || [, '💬'])[1]))].join('');
      slot.textContent = `💬 받은 답장 ${emojis} ${list.length}`;
      slot.setAttribute('aria-label', `받은 답장 ${list.length}개`);
    } catch (e) {
      slot.textContent = '';
    }
  }));
}

// ───────── 화면 그리기 ─────────
// reset: 보관함 화면에 새로 들어올 때 → 가장 최근 달, 날짜 선택 없음
export function renderBox({ keepFocus, reset } = {}) {
  if (reset) { month = null; selected = null; friend = null; }
  const state = $('box-state');
  const list = $('box-list');
  document.querySelectorAll('#view-box .tab').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.filter === filter)));
  document.querySelector('#view-box .tabs').dataset.active = filter; // 흰 알약이 고른 탭으로 미끄러진다

  const all = loadBox();
  if (all === null) {
    list.replaceChildren();
    $('cal').replaceChildren();
    $('box-count').textContent = '';
    showError(state, {
      where: '보관함',
      what: '보관함을 열 수 없어요.',
      why: '이 브라우저는 저장 공간을 쓸 수 없게 막혀 있어요. 시크릿 창이거나 사이트 데이터 저장이 꺼져 있을 수 있어요.',
      todo: '일반 창에서 다시 열어 주세요. 영수증은 "이미지로 저장"으로 남겨 둘 수 있어요.',
      onRetry: () => renderBox(),
    });
    return;
  }

  renderFriendChips(all);
  const byTab = all.filter((e) => (filter === 'all' || e.kind === filter) && (!friend || (e.kind === 'received' && friendKey(e) === friend)));
  // 처음 열 때는 가장 최근 영수증이 있는 달 (없으면 이번 달)
  if (!month) {
    const latest = all.map((e) => e.data.d).sort().pop();
    month = (latest || todayStr()).slice(0, 7);
  }
  renderCalendar(byTab);

  const shown = byTab
    .filter((e) => !selected || e.data.d === selected)
    // 날짜 최근순 → 같은 날은 내 영수증 먼저 → 저장 최근순
    .sort((a, b) => (a.data.d !== b.data.d ? (a.data.d < b.data.d ? 1 : -1) : a.kind !== b.kind ? (a.kind === 'mine' ? -1 : 1) : b.savedAt - a.savedAt));
  list.replaceChildren(...shown.map(itemEl));
  fillReplySummaries();

  $('box-list-title').textContent = selected ? `${formatDayKo(selected)}의 영수증` : '모든 날짜';
  $('box-list-title').tabIndex = -1;
  $('cal-clear').hidden = !selected;
  $('box-count').textContent = shown.length ? `${friend ? `${friend}님 영수증` : FILTER_KO[filter]} ${shown.length}장${selected ? '' : ' · 최근 날짜순'}` : '';

  if (keepFocus) document.querySelector(`#cal ${keepFocus}`)?.focus();

  if (shown.length) { clearState(state, '보관함'); return; }
  if (!all.length) {
    showEmpty(state, {
      where: '보관함',
      title: '보관함이 비어 있어요.',
      desc: '영수증을 만들거나, 친구에게 받은 링크에서 "보관하기"를 누르면 여기에 모여요.',
      actions: [
        { label: '영수증 만들기', onClick: () => { location.hash = '#make-1'; }, primary: true },
        { label: '샘플 캡처로 해보기', onClick: () => startSample(1) },
      ],
    });
    return;
  }
  const what = friend ? `${friend}님 영수증이` : filter === 'mine' ? '내 영수증이' : filter === 'received' ? '친구 영수증이' : '영수증이';
  const actions = [];
  if (selected) actions.push({ label: '모든 날짜 보기', onClick: () => { selected = null; renderBox(); } });
  if (friend) actions.push({ label: '모든 친구 보기', onClick: () => { friend = null; renderBox(); } });
  if (filter !== 'all') actions.push({ label: '전체 보기', onClick: () => { filter = 'all'; friend = null; renderBox(); } });
  if (filter === 'mine') actions.push({ label: '영수증 만들기', onClick: () => { location.hash = '#make-1'; } });
  showEmpty(state, {
    where: '보관함',
    title: selected ? `${formatDayKo(selected)}에는 ${what} 없어요.` : `${what} 아직 없어요.`,
    desc: filter === 'received' ? '친구에게 받은 링크를 열고 "보관하기"를 눌러 보세요.' : filter === 'mine' ? '영수증을 만들면 자동으로 여기에 보관돼요.' : '',
    actions,
  });
}

export function setupBox() {
  document.querySelectorAll('#view-box .tab').forEach((t) => {
    t.addEventListener('click', () => { filter = t.dataset.filter; friend = null; renderBox(); });
  });
  $('cal-clear').addEventListener('click', () => { selected = null; renderBox(); $('box-list-title').focus(); });

  $('export-btn').addEventListener('click', () => {
    const st = $('backup-status');
    st.classList.remove('is-error');
    const list = loadBox();
    if (list === null) { st.classList.add('is-error'); st.textContent = '이 브라우저에서는 보관함을 쓸 수 없어요.'; return; }
    if (!list.length) { st.textContent = '내보낼 영수증이 아직 없어요.'; return; }
    const blob = new Blob([exportBox()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kreceipt-보관함-${todayStr()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    st.textContent = `${list.length}장을 파일로 내보냈어요. 다운로드 폴더를 확인해 주세요.`;
  });

  const inp = $('import-file');
  inp.addEventListener('change', async () => {
    const st = $('backup-status');
    st.textContent = '';
    st.classList.remove('is-error');
    clearFieldError(inp);
    const f = inp.files[0];
    if (!f) return;
    if (!/\.json$/i.test(f.name)) {
      setFieldError(inp, `.json 파일만 가져올 수 있어요. 지금 파일: ${f.name.split('.').pop().toUpperCase()}`);
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setFieldError(inp, '파일이 너무 커요 (2MB 이하). kreceipt에서 내보낸 파일인지 확인해 주세요.');
      return;
    }
    const res = importBox(await f.text());
    if (!res.ok) { setFieldError(inp, res.msg); return; }
    const skipped = [];
    if (res.skippedSame) skipped.push(`이미 있던 ${res.skippedSame}장`);
    if (res.skippedBad) skipped.push(`형식이 맞지 않는 ${res.skippedBad}장`);
    st.textContent = `${res.added}장을 가져왔어요.${skipped.length ? ` (${skipped.join(', ')}은 건너뛰었어요)` : ''}`;
    inp.value = '';
    renderBox();
  });
}
