// "오늘의 노래" — iTunes Search API 로 노래를 찾고, 30초 미리듣기를 재생하는 파일.
// 인증키가 필요 없는 공개 API. 브라우저에서 바로 호출된다 (2026-10-14 확인: Access-Control-Allow-Origin: *).
// fetch 가 막히는 환경을 위해 JSONP 우회로도 둔다.
// 먼저 우리 Vercel 서버를 거쳐 iTunes 를 부르고, 안 되면 브라우저에서 직접, 그래도 안 되면 Deezer 로 찾는다 (곡마다 출처 src 를 기억).
// 호출 제한(분당 약 20회)이 있어 검색은 입력 후 잠깐 기다렸다가(디바운스) 보낸다.

import { ITUNES, DEEZER, SONG_API_BASE, API_TIMEOUT_MS, LIMITS, SEARCH_DEBOUNCE_MS, SIM, SIM_SLOW_MS, wait } from './config.js';
import { showLoading, showEmpty, showError, clearState, reportState } from './states.js';
import { setFieldError, clearFieldError } from './validate.js';

// iTunes 결과 한 줄 → 앱에서 쓰는 모양
function normalize(r) {
  return {
    src: 'it',
    id: r.trackId,
    title: r.trackName || '',
    artist: r.artistName || '',
    cover: r.artworkUrl100 || r.artworkUrl60 || '',
    preview: r.previewUrl || '',
    url: r.trackViewUrl || '',
  };
}

// Deezer 결과 한 곡 → 같은 모양
function normalizeDeezer(t) {
  return {
    src: 'dz',
    id: t.id,
    title: t.title || '',
    artist: (t.artist && t.artist.name) || '',
    cover: (t.album && (t.album.cover_medium || t.album.cover_small)) || '',
    preview: t.preview || '',
    url: t.link || '',
  };
}

// 출처별 표시 이름 (화면의 "○○에서 보기" 링크)
export const SOURCE_NAME = { it: 'Apple Music', dz: 'Deezer' };

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
    const name = `__kreceiptSong${Date.now()}_${++jsonpSeq}`;
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

// Deezer 는 CORS 를 허용하지 않아 JSONP 로만 받는다. 오류는 { error: {...} } 로 온다
async function getDeezer(url, signal) {
  if (SIM.slow) await wait(SIM_SLOW_MS);
  if (SIM.error) throw Object.assign(new Error('sim-error'), { kind: 'network', detail: 'sim=error' });
  const data = await jsonp(url + (url.includes('?') ? '&' : '?') + 'output=jsonp', signal);
  if (data && data.error) {
    if (data.error.code === 800) return null; // 곡 없음
    throw Object.assign(new Error(`Deezer ${data.error.code} ${data.error.message}`), { kind: data.error.code === 4 ? 'limit' : 'server' });
  }
  return data;
}

// 실패 종류 → "왜" 문장
const WHY = {
  offline: '휴대전화(컴퓨터)가 인터넷에 연결되어 있지 않아요.',
  timeout: `노래 서버가 ${ITUNES.timeoutMs / 1000}초 안에 답하지 않았어요. 인터넷이 느릴 수 있어요.`,
  limit: '짧은 시간에 노래를 너무 많이 찾아서 노래 서버가 잠깐 막았어요.',
  server: '노래 서버에 문제가 생겼어요.',
  network: '인터넷이 끊겼거나, 브라우저·통신사 설정이 노래 서버 연결을 막았을 수 있어요.',
};

async function searchDeezer(term, signal) {
  const q = new URLSearchParams({ q: term, limit: String(DEEZER.limit) });
  const data = await getDeezer(`${DEEZER.search}?${q}`, signal);
  return ((data && data.data) || []).filter((t) => t.id).map(normalizeDeezer);
}

async function searchItunes(term, signal) {
  const q = new URLSearchParams({ term, country: ITUNES.country, media: 'music', entity: 'song', limit: String(ITUNES.limit) });
  const data = await getJSON(`${ITUNES.search}?${q}`, signal);
  return (data.results || []).filter((r) => r.trackId).map(normalize);
}

// 우리 서버(Vercel 함수, api/ 폴더)를 거쳐 iTunes 부르기
async function viaServer(path, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(`${SONG_API_BASE}${path}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw Object.assign(new Error((data && data.code) || 'HTTP ' + res.status), { kind: data && data.code === 'limit' ? 'limit' : 'server' });
    return data;
  } catch (e) {
    if (!e.kind) e.kind = signal && signal.aborted ? 'abort' : 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 노래 찾기 순서: ① 우리 서버(Vercel)를 거쳐 iTunes → ② 브라우저에서 iTunes 직접 → ③ Deezer (마지막 대안)
// ①을 먼저 쓰는 이유: 아이폰은 Apple 이 브라우저의 직접 요청을 음악 앱으로 돌려보낼 때가 있다.
// Vercel 서버에서는 Apple 이 막지 않는다 (2026-10-28 확인, Cloudflare Worker 는 429/403).
export async function searchSongs(term, signal) {
  if (SIM.empty) { if (SIM.slow) await wait(SIM_SLOW_MS); return []; }
  const errors = [];
  if (!SIM.error) {
    try {
      const data = await viaServer(`/songs?${new URLSearchParams({ term })}`, signal);
      return data.results || [];
    } catch (e) {
      if (e.kind === 'abort') throw e;
      errors.push('server:' + e.message);
    }
  }
  try {
    return await searchItunes(term, signal);
  } catch (e) {
    if (e.kind === 'abort' || SIM.error) throw e;
    errors.push('direct:' + (e.detail || e.message));
  }
  try {
    return await searchDeezer(term, signal);
  } catch (e) {
    e.detail = errors.concat('deezer:' + e.message).join(' / ');
    throw e;
  }
}

// 링크에서 꺼낸 곡 다시 불러오기. src 가 없으면 iTunes (예전 링크와 호환)
export async function lookupSong(id, src = 'it') {
  if (src === 'dz') {
    const t = await getDeezer(`${DEEZER.track}${encodeURIComponent(id)}`);
    return t && t.id === id ? normalizeDeezer(t) : null;
  }
  if (!SIM.error) {
    try {
      const data = await viaServer(`/song?id=${encodeURIComponent(id)}`);
      return data.result || null;
    } catch (e) { /* 서버가 안 되면 브라우저에서 직접 */ }
  }
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
  // 어디서 찾은 곡인지 작게 표시 (iTunes / Deezer)
  const src = document.createElement('span');
  src.className = 'song__src';
  src.textContent = song.src === 'dz' ? 'Deezer' : 'iTunes';
  a.append(' · ', src);
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
      const where = SOURCE_NAME[song.src] || SOURCE_NAME.it;
      link.textContent = `${where}에서 보기`;
      link.setAttribute('aria-label', `${song.title} ${where}에서 보기 (새 창)`);
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

  const src = s.p === 'dz' ? 'dz' : 'it';
  const base = { src, id: s.id, title: s.t, artist: s.a, cover: '', preview: '', url: '' };
  if (known && known.id === s.id && (known.src || 'it') === src) { draw({ ...known, title: s.t, artist: s.a }); return; }

  const load = async () => {
    slot.setAttribute('aria-busy', 'true');
    const sk = document.createElement('div');
    sk.className = 'receipt__song';
    sk.innerHTML = '<span class="song__cover" aria-hidden="true"></span><span class="song__text"></span>';
    sk.querySelector('.song__text').textContent = `${s.t} · ${s.a} — 노래 정보를 불러오는 중…`;
    slot.replaceChildren(sk);
    reportState('영수증 노래', 'loading');
    try {
      const song = await lookupSong(s.id, src);
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
