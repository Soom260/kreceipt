// "오늘의 노래" — iTunes Search API 로 노래를 찾고, 30초 미리듣기를 재생하는 파일.
// 인증키가 필요 없는 공개 API. 브라우저에서 바로 호출된다 (2026-10-14 확인: Access-Control-Allow-Origin: *).
// fetch 가 막히는 환경을 위해 JSONP 우회로도 둔다.
// 호출 제한(분당 약 20회)이 있어 검색은 입력 후 잠깐 기다렸다가(디바운스) 보낸다.

import { ITUNES, LIMITS, SEARCH_DEBOUNCE_MS, SIM, SIM_SLOW_MS, wait } from './config.js';
import { showLoading, showEmpty, showError, clearState, reportState } from './states.js';
import { setFieldError, clearFieldError } from './validate.js';

// iTunes 결과 한 줄 → 앱에서 쓰는 모양
function normalize(r) {
  return {
    id: r.trackId,
    title: r.trackName || '',
    artist: r.artistName || '',
    cover: r.artworkUrl100 || r.artworkUrl60 || '',
    preview: r.previewUrl || '',
    url: r.trackViewUrl || '',
  };
}

// 1차: fetch 로 받기
async function fetchJSON(url, signal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ITUNES.timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { kind: res.status === 403 || res.status === 429 ? 'limit' : 'server' });
    return await res.json();
  } catch (e) {
    // 화면에 이유를 다르게 보여 주려고 실패 종류를 붙인다
    if (!e.kind) e.kind = timedOut ? 'timeout' : navigator.onLine === false ? 'offline' : signal && signal.aborted ? 'abort' : 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 2차: JSONP (<script> 로 받기). 일부 휴대전화 환경에서 fetch 만 막히는 경우를 대비한 우회로.
// iTunes 가 callback 이름으로 감싼 자바스크립트를 돌려준다.
let jsonpSeq = 0;
function jsonp(url, signal) {
  return new Promise((resolve, reject) => {
    const name = `__kreceiptItunes${Date.now()}_${++jsonpSeq}`;
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); delete window[name]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(Object.assign(new Error('JSONP timeout'), { kind: 'timeout' })); }, ITUNES.timeoutMs);
    window[name] = (data) => { done(); resolve(data); };
    s.onerror = () => { done(); reject(Object.assign(new Error('JSONP load error'), { kind: 'network' })); };
    if (signal) signal.addEventListener('abort', () => { done(); reject(Object.assign(new Error('aborted'), { name: 'AbortError', kind: 'abort' })); });
    s.src = `${url}&callback=${name}`;
    document.head.append(s);
  });
}

async function getJSON(url, signal) {
  if (SIM.slow) await wait(SIM_SLOW_MS);
  if (SIM.error) throw Object.assign(new Error('sim-error'), { kind: 'network', detail: 'sim=error' });
  try {
    return await fetchJSON(url, signal);
  } catch (e) {
    if (!['network', 'timeout'].includes(e.kind)) throw e;
    try {
      return await jsonp(url, signal);
    } catch (e2) {
      // 두 길 모두 실패: 원인을 좁힐 수 있게 오류 내용을 함께 남긴다
      e2.detail = `fetch: ${e.name} ${e.message} / jsonp: ${e2.message}`;
      throw e2;
    }
  }
}

// 실패 종류 → "왜" 문장
const WHY = {
  offline: '휴대전화(컴퓨터)가 인터넷에 연결되어 있지 않아요.',
  timeout: `iTunes 서버가 ${ITUNES.timeoutMs / 1000}초 안에 답하지 않았어요. 인터넷이 느릴 수 있어요.`,
  limit: '짧은 시간에 노래를 너무 많이 찾아서 iTunes가 잠깐 막았어요. (1분에 약 20번까지)',
  server: 'iTunes 서버에 문제가 생겼어요.',
  network: '인터넷이 끊겼거나, 브라우저·통신사 설정이 iTunes 연결을 막았을 수 있어요.',
};

export async function searchSongs(term, signal) {
  if (SIM.empty) { if (SIM.slow) await wait(SIM_SLOW_MS); return []; }
  const q = new URLSearchParams({ term, country: ITUNES.country, media: 'music', entity: 'song', limit: String(ITUNES.limit) });
  const data = await getJSON(`${ITUNES.search}?${q}`, signal);
  return (data.results || []).filter((r) => r.trackId).map(normalize);
}

export async function lookupSong(id) {
  const q = new URLSearchParams({ id: String(id), country: ITUNES.country });
  const data = await getJSON(`${ITUNES.lookup}?${q}`);
  const r = (data.results || []).find((x) => x.trackId === id);
  return r ? normalize(r) : null;
}

// ───────── 미리듣기 재생 (한 번에 한 곡) ─────────
let audio = null;
let currentBtn = null;

function setBtn(btn, playing) {
  btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
  btn.textContent = playing ? '❚❚' : '▶';
}

export function stopPreview() {
  if (audio) audio.pause();
  if (currentBtn) setBtn(currentBtn, false);
  currentBtn = null;
}

// 재생/정지 버튼. <button> 이라 키보드(Enter·Space)로도 누를 수 있다
export function playButton(song) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'play-btn';
  b.setAttribute('aria-label', `${song.title} 미리듣기 30초`);
  setBtn(b, false);
  if (!song.preview) { b.disabled = true; b.setAttribute('aria-label', '미리듣기가 없는 곡'); return b; }
  b.addEventListener('click', () => {
    if (currentBtn === b) { stopPreview(); return; }
    stopPreview();
    if (!audio) {
      audio = new Audio();
      audio.addEventListener('ended', () => stopPreview());
    }
    audio.src = song.preview; // 스트리밍만 하고 저장하지 않는다
    audio.play().then(() => { currentBtn = b; setBtn(b, true); }).catch(() => {
      b.setAttribute('aria-label', '미리듣기를 재생하지 못했어요');
    });
  });
  return b;
}

// 곡 정보 한 줄(커버·곡명·가수)
export function songInfo(song) {
  const frag = document.createDocumentFragment();
  const img = document.createElement('img');
  img.className = 'song__cover';
  img.alt = song.cover ? `${song.title} 앨범 커버` : '';
  img.crossOrigin = 'anonymous'; // 이미지로 저장할 때 커버도 함께 그리기 위해
  img.width = 48; img.height = 48;
  if (song.cover) img.src = song.cover;
  const text = document.createElement('span');
  text.className = 'song__text';
  const t = document.createElement('span'); t.className = 'song__title'; t.textContent = song.title;
  const a = document.createElement('span'); a.className = 'song__artist'; a.textContent = song.artist;
  text.append(t, a);
  frag.append(img, text);
  return { frag, text };
}

// 영수증 안 노래 블록 채우기. 링크에는 곡 ID·곡명·가수만 있으므로 커버·미리듣기는 lookup 으로 다시 불러온다.
// 실패해도 영수증은 그대로 두고, 곡명·가수는 글자로 남긴다.
export async function fillReceiptSong(slot, s, known) {
  const draw = (song, errMsg, retry) => {
    const box = document.createElement('div');
    box.className = 'receipt__song';
    const { frag, text } = songInfo(song);
    box.append(frag);
    if (song.url) {
      const link = document.createElement('a');
      link.className = 'receipt__song-link';
      link.href = song.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Apple Music에서 보기';
      link.setAttribute('aria-label', `${song.title} Apple Music에서 보기 (새 창)`);
      text.append(link);
    }
    if (errMsg) {
      const e = document.createElement('span');
      e.className = 'receipt__song-err';
      e.setAttribute('role', 'alert');
      e.textContent = errMsg;
      text.append(e);
      if (retry) {
        const rb = document.createElement('button');
        rb.type = 'button';
        rb.className = 'btn btn--small';
        rb.textContent = '다시 시도';
        rb.addEventListener('click', retry);
        text.append(rb);
      }
    }
    box.append(playButton(song));
    slot.replaceChildren(box);
  };

  const base = { id: s.id, title: s.t, artist: s.a, cover: '', preview: '', url: '' };
  if (known && known.id === s.id) { draw({ ...known, title: s.t, artist: s.a }); return; }

  const load = async () => {
    slot.setAttribute('aria-busy', 'true');
    const sk = document.createElement('div');
    sk.className = 'receipt__song';
    sk.innerHTML = '<span class="song__cover" aria-hidden="true"></span><span class="song__text"></span>';
    sk.querySelector('.song__text').textContent = `${s.t} · ${s.a} — 노래 정보를 불러오는 중…`;
    slot.replaceChildren(sk);
    reportState('영수증 노래', 'loading');
    try {
      const song = await lookupSong(s.id);
      slot.removeAttribute('aria-busy');
      if (!song) {
        draw(base, '이 곡의 미리듣기를 찾지 못했어요. 곡 정보가 바뀌었을 수 있어요.');
        reportState('영수증 노래', 'empty');
        return;
      }
      draw({ ...song, title: s.t, artist: s.a });
      reportState('영수증 노래', 'ok');
    } catch (e) {
      slot.removeAttribute('aria-busy');
      draw(base, '노래 정보를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', load);
      reportState('영수증 노래', 'error');
    }
  };
  await load();
}

// 3단계 "노래 고르기" 화면 연결
export function setupSongPicker({ form, input, stateBox, list, pickedBox, onPick, getPicked }) {
  let timer = null;
  let ctrl = null;
  let lastTerm = '';

  const renderPicked = () => {
    const song = getPicked();
    pickedBox.hidden = !song;
    if (!song) { pickedBox.replaceChildren(); return; }
    const { frag } = songInfo(song);
    const btns = document.createElement('span');
    btns.className = 'song__btns';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn--small btn--ghost pick-btn';
    rm.textContent = '빼기';
    rm.setAttribute('aria-label', `고른 노래 ${song.title} 빼기`);
    rm.addEventListener('click', () => { stopPreview(); onPick(null); renderPicked(); input.focus(); });
    btns.append(playButton(song), rm);
    pickedBox.replaceChildren(frag, btns);
  };

  const renderResults = (songs) => {
    list.replaceChildren();
    songs.forEach((song, k) => {
      const li = document.createElement('li');
      li.className = 'song';
      li.style.setProperty('--i', k);
      const { frag } = songInfo(song);
      const btns = document.createElement('span');
      btns.className = 'song__btns';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'btn btn--small pick-btn';
      pick.textContent = '고르기';
      pick.setAttribute('aria-label', `${song.title} - ${song.artist} 고르기`);
      pick.addEventListener('click', () => {
        stopPreview();
        onPick(song);
        renderPicked();
        list.replaceChildren();
        clearState(stateBox);
        const p = document.createElement('p');
        p.className = 'status-line';
        p.setAttribute('role', 'status');
        p.textContent = `"${song.title}"을(를) 골랐어요.`;
        stateBox.append(p);
        pickedBox.querySelector('button')?.focus();
      });
      btns.append(playButton(song), pick);
      li.append(frag, btns);
      list.append(li);
    });
  };

  const run = async (term) => {
    lastTerm = term;
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const my = ctrl;
    list.replaceChildren();
    showLoading(stateBox, { where: '노래 검색', text: `"${term}" 노래를 찾는 중…`, kind: 'song' });
    try {
      const songs = await searchSongs(term, my.signal);
      if (my.signal.aborted) return;
      if (!songs.length) {
        showEmpty(stateBox, {
          where: '노래 검색',
          title: `"${term}"(으)로 찾은 노래가 없어요.`,
          desc: '곡명이나 가수 이름을 다르게 적어 보세요. 예: IU, 밤편지, NewJeans. 노래 없이 만들어도 돼요.',
          actions: [{ label: '다른 검색어 적기', onClick: () => { input.select(); input.focus(); } }],
        });
        return;
      }
      clearState(stateBox, '노래 검색');
      renderResults(songs);
      list.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      if (my.signal.aborted) return; // 새 검색이 시작돼 이전 검색을 멈춘 경우
      showError(stateBox, {
        where: '노래 검색',
        what: '노래 정보를 불러오지 못했어요.',
        why: (WHY[e.kind] || WHY.network) + (e.detail ? ` (오류 코드: ${e.detail})` : ''),
        todo: e.kind === 'limit' ? '1분쯤 뒤에 다시 시도해 주세요. 노래 없이 영수증을 만들어도 돼요.' : '연결을 확인하고 다시 시도해 주세요. 노래 없이 영수증을 만들어도 돼요.',
        onRetry: () => run(lastTerm),
      });
    }
  };

  // 입력이 바뀔 때마다 잠깐 기다렸다가 찾는다.
  // 휴대전화 한글 키보드는 글자 조합이 끝날 때만 알려 주는 경우가 있어 여러 신호를 함께 듣는다.
  const schedule = () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (input.getAttribute('aria-invalid')) clearFieldError(input);
    if (term.length < LIMITS.songQueryMin) {
      if (ctrl) ctrl.abort();
      lastTerm = '';
      list.replaceChildren();
      clearState(stateBox);
      return;
    }
    if (term === lastTerm) return;
    timer = setTimeout(() => run(term), SEARCH_DEBOUNCE_MS);
  };
  ['input', 'keyup', 'compositionend', 'change'].forEach((ev) => input.addEventListener(ev, schedule));

  // "찾기" 버튼·키보드의 검색(Enter) 키: 바로 찾고, 휴대전화 키보드를 내려 결과가 가리지 않게 한다
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < LIMITS.songQueryMin) {
      setFieldError(input, `노래 검색어를 ${LIMITS.songQueryMin}자 이상 적어 주세요.`, { after: form });
      return;
    }
    input.blur();
    run(term);
  });

  return { renderPicked };
}
