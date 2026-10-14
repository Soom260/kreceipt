// 보관함 화면: 내 영수증 / 받은 영수증 목록, 삭제, 파일로 내보내기·가져오기.

import { showEmpty, showError, clearState } from './states.js';
import { loadBox, removeFromBox, exportBox, importBox } from './storage.js';
import { setFieldError, clearFieldError } from './validate.js';
import { formatDayKo, formatWon, totalOf } from './receipt.js';
import { startSample, todayStr } from './maker.js';

const $ = (id) => document.getElementById(id);
let filter = 'all';
const FILTER_KO = { all: '전체', mine: '내 영수증', received: '받은 영수증' };

function itemEl(e) {
  const li = document.createElement('li');
  li.className = 'box-item';
  const d = e.data;
  const head = document.createElement('div');
  head.className = 'box-item__head';
  const date = document.createElement('span');
  date.className = 'box-item__date';
  date.textContent = formatDayKo(d.d);
  const kind = document.createElement('span');
  kind.className = 'box-item__kind';
  kind.textContent = e.kind === 'mine' ? '내 영수증' : `${d.n || '이름 없는 친구'}에게 받음`;
  head.append(date, kind);

  const sum = document.createElement('p');
  sum.className = 'box-item__sum';
  const names = d.i.slice(0, 2).map(([n]) => n).join(', ');
  sum.textContent = `${names}${d.i.length > 2 ? ` 외 ${d.i.length - 2}개` : ''} · ${formatWon(totalOf(d))}원${d.m ? ` · "${d.m}"` : ''}`;

  const btns = document.createElement('div');
  btns.className = 'row-btns';
  const open = document.createElement('a');
  open.className = 'btn btn--small';
  open.href = '#r=' + e.key;
  open.textContent = '열기';
  open.setAttribute('aria-label', `${formatDayKo(d.d)} ${kind.textContent} 열기`);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--small btn--danger';
  del.textContent = '삭제';
  del.setAttribute('aria-label', `${formatDayKo(d.d)} ${kind.textContent} 삭제`);
  del.addEventListener('click', () => {
    if (!window.confirm(`${formatDayKo(d.d)} 영수증을 보관함에서 지울까요? 되돌릴 수 없어요.`)) return;
    const ok = removeFromBox(e.key);
    renderBox();
    const st = $('backup-status');
    $('box-count').textContent = ok ? `지웠어요. ${$('box-count').textContent}` : '지우지 못했어요. 다시 시도해 주세요.';
    st.textContent = '';
    $('box-title').focus();
  });
  btns.append(open, del);
  li.append(head, sum, btns);
  return li;
}

export function renderBox() {
  const state = $('box-state');
  const list = $('box-list');
  document.querySelectorAll('#view-box .tab').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.filter === filter)));

  const all = loadBox();
  if (all === null) {
    list.replaceChildren();
    $('box-count').textContent = '';
    showError(state, {
      where: '보관함',
      what: '보관함을 열 수 없어요.',
      why: '이 브라우저는 저장 공간을 쓸 수 없게 막혀 있어요. 시크릿 창이거나 사이트 데이터 저장이 꺼져 있을 수 있어요.',
      todo: '일반 창에서 다시 열어 주세요. 영수증은 "이미지로 저장"으로 남겨 둘 수 있어요.',
      onRetry: renderBox,
    });
    return;
  }

  const shown = all
    .filter((e) => filter === 'all' || e.kind === filter)
    .sort((a, b) => (a.data.d === b.data.d ? b.savedAt - a.savedAt : a.data.d < b.data.d ? 1 : -1));
  list.replaceChildren(...shown.map(itemEl));
  $('box-count').textContent = shown.length ? `${FILTER_KO[filter]} ${shown.length}장 · 최근 날짜순` : '';

  if (shown.length) { clearState(state, '보관함'); return; }
  if (!all.length) {
    showEmpty(state, {
      where: '보관함',
      title: '보관함이 비어 있어요.',
      desc: '영수증을 만들거나, 받은 링크에서 "보관하기"를 누르면 여기에 모여요.',
      actions: [
        { label: '영수증 만들기', onClick: () => { location.hash = '#make-1'; }, primary: true },
        { label: '샘플 캡처로 해보기', onClick: () => startSample(1) },
      ],
    });
  } else {
    showEmpty(state, {
      where: '보관함',
      title: filter === 'mine' ? '내가 만든 영수증이 아직 없어요.' : '받은 영수증이 아직 없어요.',
      desc: filter === 'mine' ? '영수증을 만들면 자동으로 여기에 보관돼요.' : '친구에게 받은 링크를 열고 "보관하기"를 눌러 보세요.',
      actions: [
        { label: '전체 보기', onClick: () => { filter = 'all'; renderBox(); } },
        ...(filter === 'mine' ? [{ label: '영수증 만들기', onClick: () => { location.hash = '#make-1'; } }] : []),
      ],
    });
  }
}

export function setupBox() {
  document.querySelectorAll('#view-box .tab').forEach((t) => {
    t.addEventListener('click', () => { filter = t.dataset.filter; renderBox(); });
  });

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
