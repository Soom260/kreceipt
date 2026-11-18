// 정산 영수증 화면 (#settle): 보관함의 내 영수증 여러 장을 모아 한 장으로 정산한다.
// 기간은 이번 주 · 이번 달 · 지난 달 · 직접 고르기. 친구 영수증과 이전 정산 영수증은 더하지 않는다 (같은 돈이 두 번 들어가지 않게).
// 가게별로 묶어 금액 큰 순으로 담고, 10곳이 넘으면 9곳 + "그 외 N곳" 한 줄.
// 한마디는 직접 쓰거나, 오픈하사 AI 추천(api/settle-note.js)에서 고른다. AI 가 안 돼도 정산은 만들 수 있다.

import { LIMITS, MOODS, WEATHER, SETTLE_NOTE_URL, AI_TIMEOUT_MS } from './config.js';
import { loadBox, addToBox, getNick, setNick } from './storage.js';
import { renderReceipt, formatDayKo, formatWon, totalOf } from './receipt.js';
import { encodeReceipt, linkFor, shareLink } from './share.js';
import { showLoading, showEmpty, showError, clearState, reportState, confetti } from './states.js';
import { checkMessage, checkNick, setFieldError, clearFieldError, showBlockError, charCount } from './validate.js';
import { saveImage, todayStr } from './maker.js';
import { setupInstaButtons } from './insta.js';
import { warmInstaImages } from './image.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const RANGE_KO = { week: '이번 주', month: '이번 달', last: '지난 달', pick: '고른 영수증' };

let range = 'month';
let picked = new Set();   // 직접 고르기에서 고른 보관함 key
let made = null;          // 만든 정산 영수증 { data, code }
let aiCtrl = null;        // 진행 중인 AI 추천 (다시 누르면 앞의 것을 멈춘다)

// 기간의 시작·끝 날짜. 주는 월요일부터, 이번 주·이번 달은 오늘까지
function bounds(kind) {
  const t = new Date();
  if (kind === 'week') {
    const s = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
    return [ymd(s), ymd(t)];
  }
  if (kind === 'month') return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)];
  return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))];
}

// 정산에 넣을 수 있는 영수증: 내 영수증 중 정산 영수증이 아닌 것, 날짜 최근순
function myReceipts() {
  const all = loadBox();
  if (all === null) return null;
  return all.filter((e) => e.kind === 'mine' && !e.data.p).sort((a, b) => (a.data.d < b.data.d ? 1 : a.data.d > b.data.d ? -1 : b.savedAt - a.savedAt));
}

function chosen(list) {
  if (range === 'pick') return list.filter((e) => picked.has(e.key));
  const [a, b] = bounds(range);
  return list.filter((e) => e.data.d >= a && e.data.d <= b);
}

// 여러 장 → 정산 내용. 가게별로 묶어 금액 큰 순
export function summarize(entries, kind) {
  const by = new Map();
  entries.forEach((e) => e.data.i.forEach(([name, amount]) => {
    const k = name.trim();
    const g = by.get(k) || { name: k, amount: 0, visits: 0 };
    g.amount += amount;
    g.visits += 1;
    by.set(k, g);
  }));
  const groups = [...by.values()].sort((x, y) => y.amount - x.amount || y.visits - x.visits);
  const shown = groups.length > LIMITS.itemsMax ? groups.slice(0, LIMITS.itemsMax - 1) : groups;
  const rest = groups.slice(shown.length);
  // 여러 번 간 곳은 "빵집 ×3" (이름 칸 20자 안에 맞춘다)
  const items = shown.map((g) => {
    const tag = g.visits > 1 ? ` ×${g.visits}` : '';
    return [Array.from(g.name).slice(0, LIMITS.nameMax - tag.length).join('') + tag, g.amount];
  });
  if (rest.length) items.push([`그 외 ${rest.length}곳`, rest.reduce((s, g) => s + g.amount, 0)]);

  const dates = entries.map((e) => e.data.d).sort();
  const [a, b] = kind === 'pick' ? [dates[0], dates[dates.length - 1]] : bounds(kind);
  const count = (pick) => entries.reduce((o, e) => { const k = pick(e.data); if (k) o[k] = (o[k] || 0) + 1; return o; }, {});
  return {
    items, groups, from: a, to: b,
    receipts: entries.length,
    days: new Set(dates).size,
    total: items.reduce((s, [, x]) => s + x, 0),
    moods: count((d) => { const m = d.f && MOODS.find(([k]) => k === d.f); return m && m[2]; }),
    weather: count((d) => d.w && WEATHER[d.w.c] && WEATHER[d.w.c][1]),
  };
}

// ───────── 화면 그리기 ─────────
function renderRanges() {
  $('range-grid').querySelectorAll('.range').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
}

function pickItem(e) {
  const li = document.createElement('li');
  const id = 'pick-' + e.key.slice(0, 12).replace(/[^\w]/g, '') + '-' + Math.abs(hash(e.key));
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.id = id;
  inp.checked = picked.has(e.key);
  inp.addEventListener('change', () => {
    if (inp.checked) picked.add(e.key); else picked.delete(e.key);
    li.classList.toggle('is-checked', inp.checked);
    updateSummary();
  });
  const label = document.createElement('label');
  label.htmlFor = id;
  const d = e.data;
  const names = d.i.slice(0, 2).map(([n]) => n).join(', ');
  label.innerHTML = '<b></b><small></small>';
  label.firstChild.textContent = formatDayKo(d.d);
  label.lastChild.textContent = `${names}${d.i.length > 2 ? ` 외 ${d.i.length - 2}개` : ''} · ${formatWon(totalOf(d))}원`;
  li.className = 'pick-item' + (inp.checked ? ' is-checked' : '');
  li.append(inp, label);
  return li;
}

function hash(s) { let h = 0; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0; return h; }

// 고른 기간에 맞춰 장수·합계 안내와 빈 결과를 보여 준다
function updateSummary() {
  const list = myReceipts();
  const state = $('settle-state');
  const note = $('range-note');
  $('pick-box').hidden = range !== 'pick';
  if (list === null) {
    note.textContent = '';
    showError(state, {
      where: '정산',
      what: '보관함을 열 수 없어요.',
      why: '이 브라우저는 저장 공간을 쓸 수 없게 막혀 있어요. 시크릿 창이거나 사이트 데이터 저장이 꺼져 있을 수 있어요.',
      todo: '일반 창에서 다시 열어 주세요.',
      onRetry: () => enterSettle(),
    });
    return null;
  }
  if (!list.length) {
    note.textContent = '';
    showEmpty(state, {
      where: '정산',
      title: '정산할 내 영수증이 아직 없어요.',
      desc: '영수증을 만들면 보관함에 모이고, 여기서 한 장으로 정산할 수 있어요.',
      actions: [{ label: '영수증 만들기', onClick: () => { location.hash = '#make-1'; }, primary: true }],
    });
    return null;
  }
  const entries = chosen(list);
  if (!entries.length) {
    note.textContent = '';
    if (range === 'pick') {
      clearState(state, '정산');
      note.textContent = '정산에 넣을 영수증을 골라 주세요.';
    } else {
      const [a, b] = bounds(range);
      showEmpty(state, {
        where: '정산',
        title: `${RANGE_KO[range]}(${formatDayKo(a)} ~ ${formatDayKo(b)})에는 내 영수증이 없어요.`,
        desc: '다른 기간을 고르거나, 영수증을 직접 골라 보세요.',
        actions: [{ label: '직접 고르기', onClick: () => setRange('pick') }],
      });
    }
    return null;
  }
  clearState(state, '정산');
  showBlockError($('settle-error'), ''); // 고를 것이 생기면 "골라 주세요" 안내를 지운다
  const s = summarize(entries, range);
  note.textContent = `${formatDayKo(s.from)} ~ ${formatDayKo(s.to)} · 영수증 ${s.receipts}장 · ${s.days}일 · 합계 ${formatWon(s.total)}원`;
  return s;
}

function setRange(r) {
  range = r;
  renderRanges();
  if (r === 'pick') {
    const list = myReceipts() || [];
    $('pick-list').replaceChildren(...list.map(pickItem));
  }
  resetNotes();
  updateSummary();
}

function updateCounter() {
  const n = charCount($('settle-note').value);
  const c = $('settle-note-count');
  const over = n - LIMITS.messageMax;
  c.textContent = over > 0 ? `${n} / ${LIMITS.messageMax} · ${over}자 넘었어요` : `${n} / ${LIMITS.messageMax}`;
  c.classList.toggle('is-over', over > 0);
}

// ───────── AI 한마디 추천 ─────────
function resetNotes() {
  if (aiCtrl) aiCtrl.abort();
  $('note-chips').replaceChildren();
  clearState($('note-state'));
}

const AI_WHY = {
  limit: 'AI 서버 사용량이 잠깐 찼어요 (1분에 10번까지).',
  timeout: `AI 서버가 ${AI_TIMEOUT_MS / 1000}초 안에 답하지 않았어요.`,
  offline: '휴대전화(컴퓨터)가 인터넷에 연결되어 있지 않아요.',
  server: 'AI 서버에서 한마디를 받지 못했어요.',
};

async function fetchNotes(s, signal) {
  const body = {
    period: RANGE_KO[range],
    receipts: s.receipts,
    days: s.days,
    total: s.total,
    top: s.groups.slice(0, 10).map((g) => [Array.from(g.name).slice(0, LIMITS.nameMax).join(''), g.amount, g.visits]),
    moods: s.moods,
    weather: s.weather,
  };
  let timedOut = false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, AI_TIMEOUT_MS);
  signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(SETTLE_NOTE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok || !Array.isArray(data.notes) || !data.notes.length) {
      throw Object.assign(new Error((data && data.code) || 'HTTP ' + res.status), { kind: data && data.code === 'limit' ? 'limit' : 'server' });
    }
    return data.notes;
  } catch (e) {
    if (!e.kind) e.kind = signal.aborted ? 'abort' : timedOut ? 'timeout' : navigator.onLine === false ? 'offline' : 'server';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function recommend() {
  const s = updateSummary();
  if (!s) { $('range-note').focus?.(); return; }
  resetNotes();
  const my = (aiCtrl = new AbortController());
  const btn = $('note-ai');
  btn.disabled = true;
  showLoading($('note-state'), { where: '정산 한마디', text: 'AI가 한마디를 고르는 중… (10초쯤 걸릴 수 있어요)', kind: 'song' });
  try {
    const notes = await fetchNotes(s, my.signal);
    if (my !== aiCtrl) return;
    clearState($('note-state'), '정산 한마디');
    $('note-chips').replaceChildren(...notes.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'note-chip';
      b.setAttribute('aria-pressed', 'false');
      b.textContent = t;
      b.addEventListener('click', () => {
        $('note-chips').querySelectorAll('.note-chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        $('settle-note').value = t;
        clearFieldError($('settle-note'));
        updateCounter();
      });
      return b;
    }));
    $('note-chips').querySelector('.note-chip')?.focus();
  } catch (e) {
    if (e.kind === 'abort' || my !== aiCtrl) return;
    showError($('note-state'), {
      where: '정산 한마디',
      what: '한마디를 추천받지 못했어요.',
      why: AI_WHY[e.kind] || AI_WHY.server,
      todo: e.kind === 'limit' ? '1분쯤 뒤에 다시 눌러 주세요. 한마디는 직접 적어도 돼요.' : '다시 눌러 보거나, 한마디를 직접 적어 주세요.',
      retryLabel: '다시 추천받기',
      onRetry: recommend,
    });
  } finally {
    if (my === aiCtrl) { btn.disabled = false; aiCtrl = null; }
  }
}

// ───────── 정산 영수증 만들기 ─────────
function make() {
  const s = updateSummary();
  const err = $('settle-error');
  if (!s) {
    showBlockError(err, range === 'pick' ? '정산에 넣을 영수증을 하나 이상 골라 주세요.' : '이 기간에는 정산할 영수증이 없어요. 다른 기간을 골라 주세요.');
    reportState('정산 만들기', 'invalid');
    return;
  }
  const nick = $('settle-nick');
  const msg = $('settle-note');
  const nMsg = checkNick(nick.value);
  const mMsg = checkMessage(msg.value);
  if (nMsg) setFieldError(nick, nMsg, { focus: false }); else clearFieldError(nick);
  if (mMsg) setFieldError(msg, mMsg, { focus: false }); else clearFieldError(msg);
  if (nMsg || mMsg) { (mMsg ? msg : nick).focus(); return; }
  const big = s.items.find(([, a]) => a > LIMITS.amountMax);
  if (big) {
    showBlockError(err, `"${big[0]}" 금액이 한 줄 최대(${formatWon(LIMITS.amountMax)}원)를 넘어요. 기간을 줄이거나 영수증을 직접 골라 주세요.`);
    return;
  }

  const data = { v: 1, d: s.to, p: { a: s.from, c: s.receipts, k: range }, i: s.items };
  if (nick.value.trim()) data.n = nick.value.trim();
  if (msg.value.trim()) data.m = msg.value.trim();
  const code = encodeReceipt(data);
  if (code.length > LIMITS.linkMax) {
    showBlockError(err, `링크가 너무 길어져요 (지금 ${code.length.toLocaleString()}자). 한마디를 짧게 해 주세요.`);
    return;
  }
  showBlockError(err, '');
  setNick(nick.value.trim());
  const saved = addToBox(code, 'mine', data, made && made.code);
  made = { data, code, saved };
  showResult(true);
}

function showResult(celebrate) {
  $('settle-form').hidden = true;
  $('settle-result').hidden = false;
  const r = renderReceipt(made.data);
  $('settle-receipt').replaceChildren(r);
  const st = $('settle-save-status');
  st.classList.toggle('is-error', made.saved === 'error');
  st.textContent = {
    added: '정산 영수증을 보관함에 저장했어요.',
    exists: '보관함에 이미 있는 정산 영수증이에요.',
    error: '이 브라우저에서는 보관할 수 없어요. 링크를 보내거나 이미지로 저장해 두세요.',
  }[made.saved] || '';
  $('settle-share-status').textContent = '';
  $('settle-manual').hidden = true;
  $('settle-title').textContent = '정산 영수증이 나왔어요';
  $('settle-title').focus();
  window.scrollTo(0, 0);
  reportState('정산 영수증', 'ok');
  if (celebrate) setTimeout(() => confetti(), 900);
  warmInstaImages(r);
}

function backToForm() {
  $('settle-result').hidden = true;
  $('settle-form').hidden = false;
  $('settle-title').textContent = '정산 영수증';
  $('settle-title').focus();
}

// 주소가 #settle 로 바뀔 때 app.js 가 부른다
export function enterSettle() {
  backToForm();
  made = null;
  if (!$('settle-nick').value) $('settle-nick').value = getNick();
  // 지난 고르기에서 보관함에서 지워진 영수증은 뺀다
  const keys = new Set((myReceipts() || []).map((e) => e.key));
  picked = new Set([...picked].filter((k) => keys.has(k)));
  showBlockError($('settle-error'), '');
  setRange(range);
  updateCounter();
}

export function setupSettle() {
  $('range-grid').querySelectorAll('.range').forEach((b) => b.addEventListener('click', () => setRange(b.dataset.range)));
  $('settle-note').addEventListener('input', () => { updateCounter(); clearFieldError($('settle-note')); });
  $('note-ai').addEventListener('click', recommend);
  $('settle-make').addEventListener('click', make);
  $('settle-again').addEventListener('click', backToForm);
  $('settle-link').addEventListener('click', async () => {
    if (!made) return;
    const url = linkFor(made.code);
    const st = $('settle-share-status');
    st.classList.remove('is-error');
    st.textContent = '';
    const who = made.data.n ? `${made.data.n}의` : '';
    const res = await shareLink(url, `${who} 정산 영수증이 도착했어요`.trim());
    if (res === 'shared') st.textContent = '공유했어요.';
    else if (res === 'copied') st.textContent = '링크를 복사했어요. 메신저 대화창에 붙여 넣어 보내 주세요.';
    else if (res === 'manual') {
      st.classList.add('is-error');
      st.textContent = '자동으로 복사하지 못했어요. 아래 주소를 직접 복사해 주세요.';
      $('settle-manual').hidden = false;
      $('settle-manual-link').value = url;
      $('settle-manual-link').focus();
      $('settle-manual-link').select();
    }
  });
  $('settle-image').addEventListener('click', () => {
    if (made) saveImage($('settle-receipt').querySelector('.receipt'), `정산-${made.data.d}`, $('settle-share-status'), $('settle-image'));
  });
  setupInstaButtons({
    copyBtn: $('settle-sticker'),
    shareBtn: $('settle-story'),
    statusEl: $('settle-share-status'),
    getReceipt: () => $('settle-receipt').querySelector('.receipt'),
    getDate: () => (made ? `정산-${made.data.d}` : todayStr()),
  });
}
