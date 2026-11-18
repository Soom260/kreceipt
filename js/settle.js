// 정산 영수증 화면 (#settle): 보관함의 내 영수증 여러 장을 모아 한 장으로 정산한다.
// 기간은 이번 주 · 이번 달 · 지난 달 · 직접 고르기. 친구 영수증과 이전 정산 영수증은 더하지 않는다 (같은 돈이 두 번 들어가지 않게).
// 가게별로 묶어 금액 큰 순으로 담고, 10곳이 넘으면 9곳 + "그 외 N곳" 한 줄.
// 한마디는 사용자가 직접 쓴다. AI(오픈하사)는 정산 아래 소비 분석 카드에서만 쓴다 (api/settle-insight.js).

import { LIMITS, SETTLE_INSIGHT_URL, INSIGHT_TIMEOUT_MS } from './config.js';
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

// 기간의 시작·끝 날짜. 주는 월요일부터, 이번 주·이번 달은 오늘까지 (주: 월요일 시작)
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
  return {
    items, groups, from: a, to: b,
    receipts: entries.length,
    days: new Set(dates).size,
    total: items.reduce((s, [, x]) => s + x, 0),
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
  updateSummary();
}

function updateCounter() {
  const n = charCount($('settle-note').value);
  const c = $('settle-note-count');
  const over = n - LIMITS.messageMax;
  c.textContent = over > 0 ? `${n} / ${LIMITS.messageMax} · ${over}자 넘었어요` : `${n} / ${LIMITS.messageMax}`;
  c.classList.toggle('is-over', over > 0);
}

// ───────── AI 요청 (소비 분석) ─────────
const AI_WHY = {
  limit: 'AI 서버 사용량이 잠깐 찼어요 (1분에 10번까지).',
  timeout: `AI 서버가 ${INSIGHT_TIMEOUT_MS / 1000}초 안에 답하지 않았어요.`,
  offline: '휴대전화(컴퓨터)가 인터넷에 연결되어 있지 않아요.',
  server: 'AI 서버에서 답을 받지 못했어요.',
};

// 우리 서버(Vercel 함수)에 POST. 실패하면 kind(limit·timeout·offline·server·abort)를 붙여 던진다
async function postAI(url, body, timeoutMs, signal) {
  let timedOut = false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw Object.assign(new Error((data && data.code) || 'HTTP ' + res.status), { kind: data && data.code === 'limit' ? 'limit' : 'server' });
    return data;
  } catch (e) {
    if (!e.kind) e.kind = signal.aborted ? 'abort' : timedOut ? 'timeout' : navigator.onLine === false ? 'offline' : 'server';
    throw e;
  } finally {
    clearTimeout(timer);
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
  made = { data, code, saved, kind: range, sum: s, prev: prevSummary(range) };
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
  resetInsight();
}

// ───────── 소비 분석 (정산 영수증 아래 카드) ─────────
// 지난 기간 비교는 이 브라우저에서 바로 계산하고, 분류·코멘트는 AI 버튼을 누를 때만 묻는다.
// 비율·합계는 AI 가 아니라 여기서 계산한다 (AI 는 가게 → 분류 이름표만 붙인다).
const PREV_LABEL = { week: '지난 주 같은 기간', month: '지난 달 같은 기간', last: '그 전 달' };
let insightCtrl = null;

// 비교할 지난 기간 [시작, 끝] (직접 고르기는 비교하지 않음)
function prevBounds(kind) {
  const t = new Date();
  if (kind === 'week') {
    const s = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) - 7);
    return [ymd(s), ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 7))];
  }
  if (kind === 'month') {
    const last = new Date(t.getFullYear(), t.getMonth(), 0).getDate();
    return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth() - 1, Math.min(t.getDate(), last)))];
  }
  if (kind === 'last') return [ymd(new Date(t.getFullYear(), t.getMonth() - 2, 1)), ymd(new Date(t.getFullYear(), t.getMonth() - 1, 0))];
  return null;
}

function prevSummary(kind) {
  const b = prevBounds(kind);
  if (!b) return null;
  const list = (myReceipts() || []).filter((e) => e.data.d >= b[0] && e.data.d <= b[1]);
  const total = list.reduce((s, e) => s + totalOf(e.data), 0);
  return { label: PREV_LABEL[kind], from: b[0], to: b[1], receipts: list.length, total };
}

function renderCompare() {
  const p = made.prev;
  const el = $('insight-compare');
  el.hidden = !p;
  if (!p) return;
  const short = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8))}`; // "2026-10-01" → "10.1"
  const when = `${PREV_LABEL[made.kind]}(${short(p.from)}~${short(p.to)})`;
  if (!p.total) { el.textContent = `${when}에는 내 영수증이 없어서 비교할 수 없어요.`; return; }
  const diff = made.sum.total - p.total;
  const pct = Math.round((Math.abs(diff) / p.total) * 100);
  el.textContent = diff === 0
    ? `${when}과 똑같이 ${formatWon(p.total)}원 썼어요.`
    : `${when}보다 ${formatWon(Math.abs(diff))}원 ${diff > 0 ? '더' : '덜'} 썼어요 (${diff > 0 ? '+' : '−'}${pct}%).`;
}

function resetInsight() {
  if (insightCtrl) insightCtrl.abort();
  insightCtrl = null;
  clearState($('insight-state'));
  $('insight-bars').hidden = true;
  $('insight-bars').replaceChildren();
  $('insight-comment').hidden = true;
  $('insight-ai').hidden = false;
  $('insight-ai').disabled = false;
  renderCompare();
}

// 가게 → 분류 이름표로 분류별 합계를 만든다 (이름표가 없는 가게는 기타)
function byCategory(groups, map) {
  const cats = new Map();
  groups.forEach((g) => {
    const c = (map && map[g.name]) || '기타';
    const x = cats.get(c) || { cat: c, amount: 0, shops: [] };
    x.amount += g.amount;
    x.shops.push(g.name);
    cats.set(c, x);
  });
  const total = groups.reduce((s, g) => s + g.amount, 0);
  return [...cats.values()].sort((a, b) => b.amount - a.amount).map((x) => ({ ...x, share: (x.amount / total) * 100 }));
}

function renderBars(cats) {
  const ul = $('insight-bars');
  ul.replaceChildren(...cats.map((c) => {
    const li = document.createElement('li');
    li.className = 'insight-bar';
    const pct = c.share < 1 ? '1% 미만' : `${Math.round(c.share)}%`;
    li.innerHTML = '<span class="insight-bar__head"><b></b><span class="insight-bar__val"></span></span><span class="insight-bar__track" aria-hidden="true"><i></i></span><small></small>';
    li.querySelector('b').textContent = c.cat;
    li.querySelector('.insight-bar__val').textContent = `${pct} · ${formatWon(c.amount)}원`;
    li.querySelector('i').style.width = `${Math.max(c.share, 1.5)}%`;
    li.querySelector('small').textContent = c.shops.join(', ');
    return li;
  }));
  ul.hidden = false;
}

async function analyze() {
  if (!made) return;
  resetInsight();
  const my = (insightCtrl = new AbortController());
  $('insight-ai').disabled = true;
  showLoading($('insight-state'), { where: '소비 분석', text: 'AI가 가게를 나누고 분석하는 중… (20초쯤 걸릴 수 있어요)' });
  const p = made.prev;
  const body = {
    period: RANGE_KO[made.kind],
    shops: made.sum.groups.slice(0, 40).map((g) => [Array.from(g.name).slice(0, LIMITS.nameMax).join(''), g.amount, g.visits]),
    prev: p && p.total ? { label: p.label, total: p.total } : null,
  };
  try {
    const data = await postAI(SETTLE_INSIGHT_URL, body, INSIGHT_TIMEOUT_MS, my.signal);
    if (my !== insightCtrl) return;
    clearState($('insight-state'), '소비 분석');
    $('insight-ai').hidden = true;
    renderBars(byCategory(made.sum.groups, data.map));
    const cm = $('insight-comment');
    cm.textContent = data.comment || '';
    cm.hidden = !data.comment;
  } catch (e) {
    if (e.kind === 'abort' || my !== insightCtrl) return;
    $('insight-ai').disabled = false;
    showError($('insight-state'), {
      where: '소비 분석',
      what: '분석하지 못했어요.',
      why: AI_WHY[e.kind] || AI_WHY.server,
      todo: e.kind === 'limit' ? '1분쯤 뒤에 다시 눌러 주세요. 정산 영수증은 그대로 쓸 수 있어요.' : '다시 눌러 주세요. 정산 영수증은 그대로 쓸 수 있어요.',
      retryLabel: '다시 분석하기',
      onRetry: analyze,
    });
  }
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
  $('settle-make').addEventListener('click', make);
  $('settle-again').addEventListener('click', backToForm);
  $('insight-ai').addEventListener('click', analyze);
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
