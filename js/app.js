// 앱 시작점. 주소의 # 뒤 값을 보고 어느 화면을 보여 줄지 정한다(해시 라우팅).
//   #home · #make-1~4 · #r=(공유 영수증) · #box
// 뒤로 가기를 누르면 이전 # 으로 돌아가므로 단계 이동도 자연스럽게 된다.

import { setupMaker, enterStep, startSample, startManual, takeFocusTarget } from './maker.js';
import { setupViewer, showReceived } from './viewer.js';
import { setupBox, renderBox } from './box.js';
import { stopPreview } from './music.js';
import { copyText } from './share.js';
import { reportState } from './states.js';

const $ = (id) => document.getElementById(id);
let first = true;

function show(viewName) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== viewName; });
  const navKey = viewName.startsWith('make') ? 'make' : viewName;
  document.querySelectorAll('.top nav a').forEach((a) => {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  // 화면이 바뀌면 제목으로 초점을 옮겨 화면낭독기가 새 화면을 읽게 한다 (첫 화면은 제외)
  if (!first) (takeFocusTarget() || $(`view-${viewName}`).querySelector('h1'))?.focus();
  first = false;
}

function route() {
  stopPreview();
  const h = location.hash;
  if (h.startsWith('#r=')) {
    show('read');
    showReceived(h.slice(3));
    document.title = 'kreceipt — 받은 영수증';
    return;
  }
  document.title = 'kreceipt — 영수증으로 쓰는 하루 기록';
  const m = h.match(/^#make-([1-4])$/);
  if (m) {
    const want = Number(m[1]);
    const got = enterStep(want);
    if (got !== want) { location.replace('#make-' + got); return; }
    show('make-' + got);
    if (got !== 1) reportState(`만들기 ${got}단계`, 'ok');
    return;
  }
  if (h === '#box') {
    show('box');
    renderBox();
    return;
  }
  show('home');
  reportState('홈', 'ok');
}

// 카카오톡 인앱 브라우저 안내
function setupKakao() {
  if (!/KAKAOTALK/i.test(navigator.userAgent)) return;
  $('kakao-banner').hidden = false;
  $('kakao-open').addEventListener('click', () => {
    // 2026-10 기준 동작이 기기·버전마다 다르다는 보고가 있어, 안 되면 주소 복사를 안내한다
    location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
    setTimeout(() => {
      $('kakao-msg').textContent = '외부 브라우저가 열리지 않았다면 "주소 복사"를 누른 뒤 크롬·사파리에 붙여 넣어 주세요.';
    }, 1500);
  });
  $('kakao-copy').addEventListener('click', async () => {
    const ok = await copyText(location.href);
    $('kakao-msg').textContent = ok ? '주소를 복사했어요. 크롬·사파리 주소창에 붙여 넣어 주세요.' : '복사하지 못했어요. 오른쪽 아래 메뉴(⋮)의 "다른 브라우저로 열기"를 이용해 주세요.';
  });
}

function setup() {
  setupMaker();
  setupViewer();
  setupBox();
  setupKakao();
  // 홈·1단계·빈 결과의 "샘플로 해보기" / "직접 입력하기" 버튼
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sample]');
    if (s) { startSample(Number(s.dataset.sample)); return; }
    if (e.target.closest('[data-manual]')) startManual();
  });
  window.addEventListener('hashchange', route);
  route();
}

setup();
