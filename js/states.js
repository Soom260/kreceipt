// 화면 상태(로딩·빈 결과·오류)를 같은 모양으로 그려 주는 도우미.
// 각 상태 영역(.state-box)은 aria-live 가 걸려 있어 화면낭독기가 바뀐 내용을 읽는다.

import { DEBUG } from './config.js';

const chip = () => document.getElementById('debug-chip');
const LABEL = { loading: '로딩', ok: '정상', empty: '빈 결과', error: '오류', invalid: '잘못된 입력' };

// ?debug=1 일 때 화면 구석 칩에 "지금 화면 상태"를 보여 준다
export function reportState(where, state) {
  if (!DEBUG) return;
  const el = chip();
  el.hidden = false;
  el.textContent = `지금 화면 상태: ${LABEL[state] || state} · ${where}`;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// 버튼 목록 [{label, onClick, primary}] → 버튼 묶음
function actionButtons(actions = []) {
  const wrap = el('div', 'stack-btns');
  actions.forEach((a) => {
    const b = el('button', 'btn' + (a.primary ? ' btn--primary' : ''), a.label);
    b.type = 'button';
    b.addEventListener('click', a.onClick);
    wrap.append(b);
  });
  return wrap;
}

// 로딩: 진행 안내 문장 + 진행 막대(선택) + 회색 자리
export function showLoading(box, { where, text, progress = false, kind = '' }) {
  box.setAttribute('aria-busy', 'true');
  box.dataset.state = 'loading';
  const s = el('div', 'state state--loading');
  const p = el('p', 'state__text', text);
  s.append(p);
  if (progress) {
    const bar = el('div', 'progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', '진행률');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', '0');
    bar.append(el('div', 'progress__bar'));
    s.append(bar);
  }
  const sk = el('div', 'skeleton' + (kind ? ' skeleton--' + kind : ''));
  sk.setAttribute('aria-hidden', 'true');
  sk.append(el('span'), el('span'), el('span'));
  s.append(sk);
  box.replaceChildren(s);
  reportState(where, 'loading');
}

// 로딩 중 진행 문장·진행률(0~1) 바꾸기
export function updateLoading(box, text, ratio) {
  const p = box.querySelector('.state__text');
  if (p && text) p.textContent = text;
  const bar = box.querySelector('.progress');
  if (bar && typeof ratio === 'number') {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    bar.setAttribute('aria-valuenow', String(pct));
    bar.firstChild.style.width = pct + '%';
  }
}

// 빈 결과: 없다는 문장 + 다음에 할 수 있는 행동 버튼
export function showEmpty(box, { where, title, desc, actions }) {
  box.removeAttribute('aria-busy');
  box.dataset.state = 'empty';
  const s = el('div', 'state state--empty');
  s.setAttribute('role', 'status');
  s.append(el('p', 'state__title', title));
  if (desc) s.append(el('p', 'hint', desc));
  if (actions && actions.length) s.append(actionButtons(actions));
  box.replaceChildren(s);
  reportState(where, 'empty');
}

// 오류: 무슨 일 · 왜 · 할 일 + 다시 시도
export function showError(box, { where, what, why, todo, onRetry, retryLabel = '다시 시도', actions = [] }) {
  box.removeAttribute('aria-busy');
  box.dataset.state = 'error';
  const s = el('div', 'state state--error');
  s.setAttribute('role', 'alert');
  const dl = el('dl');
  [['무슨 일', what], ['왜', why], ['할 일', todo]].forEach(([k, v]) => {
    dl.append(el('dt', '', k), el('dd', '', v));
  });
  s.append(dl);
  const list = [];
  if (onRetry) list.push({ label: retryLabel, onClick: onRetry, primary: true });
  s.append(actionButtons(list.concat(actions)));
  box.replaceChildren(s);
  reportState(where, 'error');
}

// 상태 영역 비우기 (= 정상 결과를 다른 곳에 보여 줄 때)
export function clearState(box, where) {
  box.removeAttribute('aria-busy');
  box.dataset.state = 'ok';
  box.replaceChildren();
  if (where) reportState(where, 'ok');
}
