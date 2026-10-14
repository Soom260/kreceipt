// "오늘의 노래" — iTunes Search API 로 노래를 찾고, 30초 미리듣기를 재생하는 파일.
// 인증키가 필요 없는 공개 API. 브라우저에서 바로 호출된다 (2026-10-14 확인: Access-Control-Allow-Origin: *).
// 호출 제한(분당 약 20회)이 있어 검색은 입력 후 잠깐 기다렸다가(디바운스) 보낸다.

import { ITUNES, LIMITS, SEARCH_DEBOUNCE_MS, SIM, SIM_SLOW_MS, wait } from './config.js';
import { showLoading, showEmpty, showError, clearState, reportState } from './states.js';

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

async function getJSON(url, signal) {
  if (SIM.slow) await wait(SIM_SLOW_MS);
  if (SIM.error) throw new Error('sim-error');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ITUNES.timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

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
export function setupSongPicker({ input, stateBox, list, pickedBox, onPick, getPicked }) {
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
    songs.forEach((song) => {
      const li = document.createElement('li');
      li.className = 'song';
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
    } catch (e) {
      if (my.signal.aborted && e.name === 'AbortError') return;
      showError(stateBox, {
        where: '노래 검색',
        what: '노래 정보를 불러오지 못했어요.',
        why: '인터넷이 끊겼거나 iTunes 서버가 잠시 응답하지 않아요. 짧은 시간에 너무 많이 찾아도 잠깐 막힐 수 있어요.',
        todo: '잠시 뒤 다시 시도해 주세요. 노래 없이 영수증을 만들어도 돼요.',
        onRetry: () => run(lastTerm),
      });
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < LIMITS.songQueryMin) {
      if (ctrl) ctrl.abort();
      list.replaceChildren();
      clearState(stateBox);
      return;
    }
    timer = setTimeout(() => run(term), SEARCH_DEBOUNCE_MS);
  });
  // Enter 로 바로 찾기
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer);
      const term = input.value.trim();
      if (term.length >= LIMITS.songQueryMin && term !== lastTerm) run(term);
    }
  });

  return { renderPicked };
}
