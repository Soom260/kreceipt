// "영수증 만들기" 4단계를 연결하는 파일.
// 1 가져오기(캡처·샘플·직접 입력) → 2 확인하고 고르기 → 3 한마디와 노래 → 4 완성·공유

import { LIMITS } from './config.js';
import { showLoading, updateLoading, showEmpty, showError, clearState, reportState, confetti } from './states.js';
import { checkFile, checkName, parseAmount, checkTime, normalizeTime, checkMessage, checkNick, checkSelection, setFieldError, clearFieldError, showBlockError, charCount } from './validate.js';
import { recognizeImage } from './ocr.js';
import { parseTransactions } from './parse.js';
import { setupSongPicker, fillReceiptSong, stopPreview } from './music.js';
import { buildReceipt, encodeReceipt, linkFor, shareLink } from './share.js';
import { addToBox, getNick, setNick } from './storage.js';
import { renderReceipt, formatDayKo } from './receipt.js';
import { makeReceiptImage, downloadImage } from './image.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
export const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };

// 만드는 중인 영수증 (새로고침하면 사라진다)
let draft = null;
let rowSeq = 0;
function newDraft() {
  return { rows: null, date: todayStr(), dayNote: '', items: null, song: null, data: null, code: null, savedKey: null };
}
draft = newDraft();

const newRow = (o = {}) => ({ id: ++rowSeq, name: '', amountRaw: '', time: '', date: null, checked: false, ...o });

let busy = false;

// ───────── 1단계: 가져오기 ─────────
function setBusy(on) {
  busy = on;
  document.querySelectorAll('#view-make-1 button, #view-home [data-sample], #view-home [data-manual]').forEach((b) => { b.disabled = on; });
  $('capture-file').disabled = on;
}

async function runOcr(image, { sampleSrc } = {}) {
  if (busy) return;
  const box = $('ocr-state');
  const preview = $('sample-preview');
  preview.hidden = !sampleSrc;
  if (sampleSrc) {
    $('sample-preview-img').src = sampleSrc;
    $('sample-preview-img').alt = '읽고 있는 샘플 결제내역 캡처 (가상 데이터)';
  }
  setBusy(true);
  showLoading(box, { where: '캡처 읽기', text: '글자 인식을 준비하는 중…', progress: true });
  box.scrollIntoView({ block: 'nearest' });
  let text = '';
  try {
    text = await recognizeImage(image, (msg, ratio) => updateLoading(box, msg, ratio));
  } catch (e) {
    setBusy(false);
    showError(box, {
      where: '캡처 읽기',
      what: '캡처를 읽지 못했어요.',
      why: '글자 인식 도구나 한국어 데이터를 받아 오지 못했어요. 인터넷 연결이 불안정하거나, 브라우저가 이 기능을 지원하지 않을 수 있어요.',
      todo: '다시 시도해 주세요. 계속 안 되면 캡처 없이 직접 입력할 수 있어요.',
      onRetry: () => runOcr(image, { sampleSrc }),
      actions: [{ label: '직접 입력하기', onClick: startManual }],
    });
    return;
  }
  setBusy(false);
  const found = parseTransactions(text, todayStr());
  text = ''; // 원본 인식 글자는 바로 버린다 (잔액·계좌 등이 섞여 있음)

  if (!found.length) {
    showEmpty(box, {
      where: '캡처 읽기',
      title: '캡처에서 결제내역을 찾지 못했어요.',
      desc: '가게 이름과 "-4,500원" 같은 금액이 함께 보이는 거래 목록 화면인지 확인해 주세요. 글자가 작으면 화면을 확대해서 캡처하면 더 잘 읽혀요.',
      actions: [
        { label: '직접 입력하기', onClick: startManual, primary: true },
        { label: '샘플 캡처로 해보기', onClick: () => startSample(1) },
        { label: '다른 캡처 고르기', onClick: () => $('capture-file').focus() },
      ],
    });
    return;
  }

  clearState(box, '캡처 읽기');
  preview.hidden = true;
  draft = newDraft();
  draft.rows = found.slice(0, LIMITS.rowsMax).map((t) => newRow({ name: t.name, amountRaw: String(t.amount), time: t.time, date: t.date }));
  // 캡처에 오늘 날짜가 없으면 캡처에 있는 가장 최근 날짜로 맞춘다
  const dates = [...new Set(found.map((t) => t.date).filter(Boolean))].sort().reverse();
  if (dates.length && !dates.includes(draft.date)) {
    draft.date = dates[0];
    draft.dayNote = `캡처에 있는 날짜(${formatDayKo(dates[0])})로 맞췄어요.`;
  }
  if (dates.length > 1) draft.dayNote += ` 캡처에 다른 날짜도 있어요: ${dates.filter((d) => d !== draft.date).map(formatDayKo).join(', ')}`;
  draft.dayNote += ` 거래 ${found.length}건을 읽었어요.`;
  location.hash = '#make-2';
}

export async function startSample(n) {
  if (location.hash !== '#make-1') {
    location.hash = '#make-1';
    await new Promise((r) => setTimeout(r, 0)); // 화면 전환이 먼저 끝나게
  }
  const src = `assets/samples/sample-${n}.png`;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    runOcr(await res.blob(), { sampleSrc: src });
  } catch (e) {
    showError($('ocr-state'), {
      where: '샘플 불러오기',
      what: '샘플 캡처를 불러오지 못했어요.',
      why: '인터넷 연결이 끊겼을 수 있어요.',
      todo: '연결을 확인하고 다시 시도하거나, 직접 입력해 주세요.',
      onRetry: () => startSample(n),
      actions: [{ label: '직접 입력하기', onClick: startManual }],
    });
  }
}

export function startManual() {
  draft = newDraft();
  draft.rows = [newRow({ checked: true })];
  draft.dayNote = '';
  focusFirstField = true; // 화면이 바뀐 뒤 제목 대신 첫 입력칸으로 초점
  location.hash = '#make-2';
}

// 화면 전환 뒤 초점을 줄 곳 (없으면 app.js 가 제목에 초점을 준다)
let focusFirstField = false;
export function takeFocusTarget() {
  if (!focusFirstField) return null;
  focusFirstField = false;
  return document.querySelector('#rows .tx input[type=text]');
}

function setupStep1() {
  const file = $('capture-file');
  // 고른 파일 이름을 상자에 보여 준다
  file.addEventListener('change', () => {
    clearFieldError(file);
    const f = file.files[0];
    $('capture-name').textContent = f ? f.name : '캡처 이미지 고르기';
    file.closest('.upload').classList.toggle('has-file', !!f);
  });
  $('capture-read').addEventListener('click', () => {
    const f = file.files[0];
    const msg = checkFile(f);
    if (msg) { setFieldError(file, msg, { after: $('capture-label') }); return; }
    clearFieldError(file);
    runOcr(f);
  });
}

// ───────── 2단계: 확인하고 고르기 ─────────
const visibleRows = () => draft.rows.filter((r) => !r.date || r.date === draft.date);

function updateCount() {
  const vis = visibleRows();
  const picked = vis.filter((r) => r.checked).length;
  $('rows-count').textContent = vis.length ? `이 날짜의 항목 ${vis.length}개 · ${picked}개 골랐어요 (최대 ${LIMITS.itemsMax}개)` : '';
}

function rowEl(r, idx) {
  const li = document.createElement('li');
  li.className = 'tx' + (r.checked ? ' is-checked' : '');
  li.dataset.id = r.id;
  li.style.setProperty('--i', Math.min(idx, 10)); // 차례로 떠오르는 모션 순서

  const ck = document.createElement('label');
  ck.className = 'tx__check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = r.checked;
  const ckText = document.createElement('span');
  ckText.className = 'sr-only';
  const setCkLabel = () => { ckText.textContent = `${r.name || `${idx + 1}번째 항목`} 영수증에 넣기`; };
  setCkLabel();
  ck.append(cb, ckText);
  cb.addEventListener('change', () => {
    r.checked = cb.checked;
    li.classList.toggle('is-checked', r.checked);
    showBlockError($('rows-error'), '');
    updateCount();
  });

  const fields = document.createElement('div');
  fields.className = 'tx__fields';

  const mk = (cls, label, value, attrs = {}) => {
    const cell = document.createElement('div');
    cell.className = 'tx__cell ' + cls;
    const id = `row${r.id}-${cls}`;
    const lab = document.createElement('label');
    lab.className = 'sr-only';
    lab.htmlFor = id;
    lab.textContent = label;
    const inp = document.createElement('input');
    inp.id = id;
    inp.className = 'input';
    inp.value = value;
    Object.entries(attrs).forEach(([k, v]) => inp.setAttribute(k, v));
    cell.append(lab, inp);
    return { cell, inp };
  };

  const name = mk('tx__cell--name', `${idx + 1}번째 항목 이름 (가게명)`, r.name, { type: 'text', placeholder: '가게 이름 · 예: 아메리카노 ×2', autocomplete: 'off' });
  name.inp.addEventListener('input', () => { r.name = name.inp.value; setCkLabel(); if (name.inp.getAttribute('aria-invalid')) clearFieldError(name.inp); });

  const line = document.createElement('div');
  line.className = 'tx__line';
  const amt = mk('tx__cell--amount', `${idx + 1}번째 항목 금액 (원)`, r.amountRaw, { type: 'text', inputmode: 'numeric', placeholder: '금액', autocomplete: 'off' });
  amt.inp.classList.add('tx__amount');
  amt.inp.addEventListener('input', () => { r.amountRaw = amt.inp.value; if (amt.inp.getAttribute('aria-invalid')) clearFieldError(amt.inp); });
  // 시간은 type="time" 대신 글자 칸을 쓴다: 휴대전화의 시간 입력칸은 폭이 줄지 않아 화면 밖으로 빠져나간다
  const tm = mk('tx__cell--time', `${idx + 1}번째 항목 시간 (선택, 예: 14:30)`, r.time, { type: 'text', inputmode: 'numeric', placeholder: '시간 14:30', autocomplete: 'off', maxlength: '5' });
  tm.inp.addEventListener('input', () => { r.time = tm.inp.value; if (tm.inp.getAttribute('aria-invalid')) clearFieldError(tm.inp); });
  // "1430" 처럼 적으면 칸을 떠날 때 "14:30" 으로 맞춰 준다
  tm.inp.addEventListener('blur', () => { const t = normalizeTime(tm.inp.value); if (t !== null) { tm.inp.value = t; r.time = t; } });

  // 지우기 버튼은 두지 않는다: 영수증에 넣지 않을 항목은 체크만 풀면 된다
  line.append(amt.cell, tm.cell);
  fields.append(name.cell, line);
  li.append(ck, fields);
  return li;
}

function renderRows() {
  const list = $('rows');
  const state = $('rows-state');
  const vis = visibleRows();
  list.replaceChildren(...vis.map(rowEl));
  updateCount();
  if (vis.length) { clearState(state, '거래 목록'); return; }

  const others = [...new Set(draft.rows.map((r) => r.date).filter((d) => d && d !== draft.date))].sort().reverse();
  if (others.length) {
    showEmpty(state, {
      where: '거래 목록',
      title: `${formatDayKo(draft.date)}에는 캡처에서 읽은 거래가 없어요.`,
      desc: '캡처에 있는 다른 날짜로 바꾸거나, 이 날짜의 항목을 직접 적어 주세요.',
      actions: others.slice(0, 3).map((d) => ({ label: `${formatDayKo(d)}로 바꾸기`, onClick: () => setDate(d) }))
        .concat([{ label: '이 날짜에 직접 입력하기', onClick: addRow }]),
    });
  } else {
    showEmpty(state, {
      where: '거래 목록',
      title: '아직 항목이 없어요.',
      desc: '항목을 직접 적거나, 샘플 캡처로 해 볼 수 있어요.',
      actions: [{ label: '항목 추가하기', onClick: addRow, primary: true }, { label: '샘플 캡처로 해보기', onClick: () => startSample(1) }],
    });
  }
}

function setDate(d) {
  draft.date = d;
  $('day-date').value = d;
  clearFieldError($('day-date'));
  renderRows();
  $('day-note').textContent = `${formatDayKo(d)}로 바꿨어요.`;
  $('day-date').focus();
}

function addRow() {
  if (draft.rows.length >= LIMITS.rowsMax) {
    showBlockError($('rows-error'), `항목은 ${LIMITS.rowsMax}개까지 추가할 수 있어요. 이미 있는 빈 칸을 채워 써 주세요.`);
    return;
  }
  draft.rows.push(newRow({ checked: true }));
  renderRows();
  const inputs = document.querySelectorAll('#rows .tx__cell--name input');
  inputs[inputs.length - 1]?.focus();
}

function toStep3() {
  const dateInp = $('day-date');
  if (!dateInp.value) { setFieldError(dateInp, '날짜를 골라 주세요.'); return; }

  const picked = visibleRows().filter((r) => r.checked);
  const selMsg = checkSelection(picked.length);
  if (selMsg) {
    showBlockError($('rows-error'), selMsg);
    (document.querySelector('#rows .tx input[type=checkbox]') || $('row-add')).focus();
    reportState('항목 고르기', 'invalid');
    return;
  }
  showBlockError($('rows-error'), '');

  // 고른 항목만 검사. 잘못된 칸마다 안내를 붙이고 첫 칸으로 초점
  let first = null;
  const items = [];
  picked.forEach((r) => {
    const nameInp = $(`row${r.id}-tx__cell--name`);
    const amtInp = $(`row${r.id}-tx__cell--amount`);
    const nMsg = checkName(r.name);
    if (nMsg) { setFieldError(nameInp, nMsg, { focus: false }); first = first || nameInp; } else clearFieldError(nameInp);
    const a = parseAmount(r.amountRaw);
    if (a.msg) { setFieldError(amtInp, a.msg, { focus: false }); first = first || amtInp; } else clearFieldError(amtInp);
    const timeInp = $(`row${r.id}-tx__cell--time`);
    const tMsg = checkTime(r.time);
    if (tMsg) { setFieldError(timeInp, tMsg, { focus: false }); first = first || timeInp; } else clearFieldError(timeInp);
    items.push({ name: r.name.trim(), amount: a.value });
  });
  if (first) { first.focus(); return; }

  draft.items = items;
  location.hash = '#make-3';
}

function setupStep2() {
  $('day-date').addEventListener('change', (e) => {
    if (!e.target.value) return;
    draft.date = e.target.value;
    clearFieldError(e.target);
    $('day-note').textContent = '';
    renderRows();
  });
  $('row-add').addEventListener('click', addRow);
  $('to-step3').addEventListener('click', toStep3);
}

// ───────── 3단계: 한마디와 노래 ─────────
let picker = null;

function updateCounter() {
  const n = charCount($('message').value);
  const c = $('message-count');
  const over = n - LIMITS.messageMax;
  c.textContent = over > 0 ? `${n} / ${LIMITS.messageMax} · ${over}자 넘었어요` : `${n} / ${LIMITS.messageMax}`;
  c.classList.toggle('is-over', over > 0);
}

function toStep4() {
  const nick = $('nick');
  const msg = $('message');
  const nMsg = checkNick(nick.value);
  const mMsg = checkMessage(msg.value);
  if (nMsg) setFieldError(nick, nMsg, { focus: false }); else clearFieldError(nick);
  if (mMsg) setFieldError(msg, mMsg, { focus: false }); else clearFieldError(msg);
  if (nMsg || mMsg) { (nMsg ? nick : msg).focus(); return; }

  const data = buildReceipt({ date: draft.date, nick: nick.value, items: draft.items, message: msg.value, song: draft.song });
  const code = encodeReceipt(data);
  if (code.length > LIMITS.linkMax) {
    showBlockError($('make-error'), `링크가 너무 길어져요 (지금 ${code.length.toLocaleString()}자, 최대 ${LIMITS.linkMax.toLocaleString()}자). 이전 단계에서 항목 수를 줄이거나, 항목 이름·한마디를 짧게 해 주세요.`);
    msg.focus();
    reportState('영수증 만들기', 'invalid');
    return;
  }
  showBlockError($('make-error'), '');
  setNick(nick.value.trim());

  // 보관함에 자동 저장 (고쳐서 다시 만들면 이전 것을 바꿔 끼운다)
  const result = addToBox(code, 'mine', data, draft.savedKey);
  if (result !== 'error') draft.savedKey = code;
  draft.saveResult = result;
  draft.data = data;
  draft.code = code;
  draft.celebrate = true; // 새로 만든 때만 축하 효과
  location.hash = '#make-4';
}

function setupStep3() {
  $('message').addEventListener('input', () => { updateCounter(); if ($('message').getAttribute('aria-invalid')) clearFieldError($('message')); });
  $('nick').addEventListener('input', () => { if ($('nick').getAttribute('aria-invalid')) clearFieldError($('nick')); });
  picker = setupSongPicker({
    form: $('song-form'),
    input: $('song-q'),
    stateBox: $('song-state'),
    list: $('song-results'),
    pickedBox: $('song-picked'),
    onPick: (s) => { draft.song = s; },
    getPicked: () => draft.song,
  });
  $('to-step4').addEventListener('click', toStep4);
}

// ───────── 4단계: 완성·공유 ─────────
function renderStep4() {
  const stage = $('my-receipt');
  const r = renderReceipt(draft.data);
  stage.replaceChildren(r);
  if (draft.data.s) fillReceiptSong(r.querySelector('.receipt__song-slot'), draft.data.s, draft.song);

  const st = $('my-save-status');
  st.classList.toggle('is-error', draft.saveResult === 'error');
  st.textContent = {
    added: '보관함에 저장했어요.',
    exists: '보관함에 이미 있는 영수증이에요.',
    error: '이 브라우저에서는 보관할 수 없어요. 링크를 보내거나 이미지로 저장해 두세요.',
  }[draft.saveResult] || '';

  $('share-status').textContent = '';
  $('manual-copy').hidden = true;
  reportState('완성된 영수증', 'ok');
  if (draft.celebrate) { draft.celebrate = false; setTimeout(() => confetti(), 900); }
}

function setupStep4() {
  $('share-link').addEventListener('click', async () => {
    const url = linkFor(draft.code);
    const st = $('share-status');
    st.classList.remove('is-error');
    st.textContent = '';
    const who = draft.data.n ? `${draft.data.n}의` : '오늘의';
    const res = await shareLink(url, `${who} 영수증이 도착했어요`);
    if (res === 'shared') st.textContent = '공유했어요.';
    else if (res === 'copied') st.textContent = '링크를 복사했어요. 메신저 대화창에 붙여 넣어 보내 주세요.';
    else if (res === 'manual') {
      st.classList.add('is-error');
      st.textContent = '자동으로 복사하지 못했어요. 아래 주소를 직접 복사해 주세요.';
      $('manual-copy').hidden = false;
      $('manual-link').value = url;
      $('manual-link').focus();
      $('manual-link').select();
    }
  });
  $('save-image').addEventListener('click', () => saveImage($('my-receipt').querySelector('.receipt'), draft.data.d, $('share-status'), $('save-image')));
  $('new-receipt').addEventListener('click', () => {
    stopPreview();
    draft = newDraft();
    $('message').value = '';
    $('song-q').value = '';
    $('song-results').replaceChildren();
    clearState($('song-state'));
    updateCounter();
    picker.renderPicked();
    location.hash = '#make-1';
  });
}

// 이미지로 저장 (친구 영수증 화면에서도 쓴다)
// 휴대전화(손가락 터치)는 내려받기가 잘 안 돼서, 이미지를 창에 띄워 꾹 눌러 저장하게 한다.
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

export async function saveImage(receiptEl, date, statusEl, trigger) {
  statusEl.classList.remove('is-error');
  statusEl.textContent = '이미지를 만드는 중…';
  const img = await makeReceiptImage(receiptEl);
  if (!img) {
    statusEl.classList.add('is-error');
    statusEl.textContent = '이미지를 만들지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. 화면 캡처로 남겨도 돼요.';
    return;
  }
  const filename = `kreceipt-${date}.png`;
  const cover = img.noCover ? ' (앨범 커버는 빠졌어요)' : '';
  if (isTouch()) {
    openImageDialog(img.url, filename, trigger);
    statusEl.textContent = `이미지를 띄웠어요. 꾹 눌러 저장해 주세요.${cover}`;
  } else {
    downloadImage(img.url, filename);
    statusEl.textContent = `이미지를 저장했어요. 다운로드 폴더를 확인해 주세요.${cover}`;
  }
}

function openImageDialog(url, filename, trigger) {
  const dlg = $('img-dialog');
  $('img-dialog-img').src = url;
  $('img-dialog-download').href = url;
  $('img-dialog-download').setAttribute('download', filename);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  $('img-dialog-close').focus();
  dlg.onclose = () => { $('img-dialog-img').removeAttribute('src'); trigger?.focus(); };
}

function setupImageDialog() {
  const dlg = $('img-dialog');
  const close = () => { if (dlg.close) dlg.close(); else { dlg.removeAttribute('open'); dlg.onclose?.(); } };
  $('img-dialog-close').addEventListener('click', close);
  // 이미지 바깥(어두운 배경)을 누르면 닫기
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
}

// ───────── 단계 들어가기 (주소가 바뀔 때 app.js 가 부른다) ─────────
// 돌려주는 값: 보여 줄 단계 번호 (앞 단계가 안 끝났으면 1로 돌려보냄)
export function enterStep(n) {
  if (n >= 2 && !draft.rows) return 1;
  if (n >= 3 && !draft.items) return 2;
  if (n >= 4 && !draft.data) return 3;

  if (n === 1) {
    if (!busy) clearState($('ocr-state'));
    $('sample-preview').hidden = !busy;
  }
  if (n === 2) {
    $('day-date').value = draft.date;
    $('day-date').max = todayStr();
    $('day-note').textContent = draft.dayNote || '';
    showBlockError($('rows-error'), '');
    renderRows();
  }
  if (n === 3) {
    if (!$('nick').value) $('nick').value = getNick();
    updateCounter();
    picker.renderPicked();
  }
  if (n === 4) renderStep4();
  return n;
}

export function setupMaker() {
  setupStep1();
  setupStep2();
  setupStep3();
  setupStep4();
  setupImageDialog();
}
