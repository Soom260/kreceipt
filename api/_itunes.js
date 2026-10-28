// Vercel 함수에서 같이 쓰는 iTunes 중계 도우미 (밑줄로 시작하는 파일은 주소가 생기지 않는다).
// 왜 Vercel 인가: 아이폰 브라우저는 Apple 이 iTunes 검색을 음악 앱(musics://)으로 돌려보내고,
// Cloudflare Worker 에서 부르면 Apple 이 429/403 으로 막는다 (2026-10-18 확인). Vercel 서버에서는 정상.

const ALLOWED_ORIGINS = ['https://soom260.github.io', 'https://kreceipt.vercel.app','http://127.0.0.1:8765', 'http://localhost:8765'];
const UA = 'kreceipt/1.0 (+https://soom260.github.io/kreceipt/)';
const COUNTRY = 'US';

// 같은 요청이 몰릴 때 Apple 호출을 아끼는 짧은 메모리 캐시
const cache = new Map();
function cached(key, ttlSec, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = load();
  cache.set(key, { value, until: Date.now() + ttlSec * 1000 });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  value.catch(() => cache.delete(key));
  return value;
}

function song(r) {
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

async function itunes(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  if (res.status === 403 || res.status === 429) throw Object.assign(new Error('limit'), { code: 'limit', status: res.status });
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { code: 'upstream', status: res.status });
  return res.json();
}

// 허용한 화면 주소만 응답을 읽을 수 있게
function cors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
}

function send(res, status, body, maxAge = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', maxAge ? `public, max-age=${maxAge}, s-maxage=${maxAge}` : 'no-store');
  res.end(JSON.stringify(body));
}

// 공통 틀: GET 만, 실패하면 이유 코드만 돌려준다
function handler(run) {
  return async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method !== 'GET') { send(res, 405, { ok: false, code: 'method', message: 'GET 만 받아요.' }); return; }
    try {
      await run(req, res);
    } catch (e) {
      if (e.status) res.setHeader('X-Upstream-Status', String(e.status));
      send(res, 502, { ok: false, code: e.code || 'upstream', message: e.code === 'limit' ? '바깥 서버가 잠깐 막았어요.' : '바깥 서버에서 정보를 받지 못했어요.' });
    }
  };
}

async function searchSongs(term) {
  const q = new URLSearchParams({ term, country: COUNTRY, media: 'music', entity: 'song', limit: '5' });
  return cached('s:' + term.toLowerCase(), 3600, async () => {
    const data = await itunes(`https://itunes.apple.com/search?${q}`);
    return (data.results || []).filter((r) => r.trackId).map(song);
  });
}

async function lookupSong(id) {
  return cached('l:' + id, 86400, async () => {
    const data = await itunes(`https://itunes.apple.com/lookup?id=${id}&country=${COUNTRY}`);
    const r = (data.results || []).find((x) => x.trackId === id);
    return r ? song(r) : null;
  });
}

module.exports = { handler, send, searchSongs, lookupSong };
