// kreceipt 의 작은 서버 (Cloudflare Worker).
// 하는 일은 두 가지뿐이고, 정해진 값만 받는다 (아무 주소나 대신 불러 주는 서버가 아님).
//   GET /songs?term=검색어      → iTunes 노래 검색 (아이폰 브라우저에서 Apple 이 음악 앱으로 돌려보내는 문제를 피함)
//   GET /song?id=곡ID           → iTunes 곡 다시 불러오기
//   GET  /reactions?id=영수증번호         → 그 영수증에 달린 답장 스티커 목록
//   POST /reactions {id, s, n, dev}       → 답장 스티커 남기기 (같은 기기는 하나만, 다시 보내면 바뀜)
//        영수증번호는 브라우저가 링크로 만든 SHA-256 해시 앞 32자. 서버는 영수증 내용을 모른다.
//        저장소: Cloudflare KV (REACTIONS), 90일 뒤 저절로 지워짐
//   GET /weather?date=YYYY-MM-DD&nx=60&ny=127&stn=108
//                                → 기상청 날씨. 오늘은 초단기실황·초단기예보(격자 nx,ny), 지난 날짜는 ASOS 일자료(관측소 stn)
// 인증키(KMA_API_KEY)는 코드에 없다. GitHub Secrets → GitHub Actions 배포 때 Worker 비밀 값으로 들어온다.
// 위치는 정확한 좌표를 받지 않는다. 브라우저가 약 5km 격자 번호와 가장 가까운 관측소 번호로 바꿔서 보낸다.

// 이 주소에서 연 화면만 응답을 읽을 수 있다
const ALLOWED_ORIGINS = ['https://soom260.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];

// 받아 줄 ASOS 관측소 번호 (js/places.js 와 같은 목록)
const STATIONS = new Set([90, 95, 98, 99, 100, 101, 102, 105, 108, 112, 114, 115, 119, 121, 127, 129, 130, 131, 133, 135, 136, 138, 140, 143, 146, 152, 155, 156, 159, 162, 165, 168, 169, 170, 177, 184, 185, 189, 192, 201, 202, 203, 211, 212, 232, 239, 243, 244, 247, 261, 273, 277, 279, 283, 295]);

const KMA = {
  ncst: 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst',
  fcst: 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst',
  asos: 'https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList',
};
const ITUNES = { search: 'https://itunes.apple.com/search', lookup: 'https://itunes.apple.com/lookup', country: 'US', limit: 5 };
// 아이폰 정보로 보내면 Apple 이 음악 앱으로 돌려보내므로 서버 이름으로 보낸다
const UA = 'kreceipt/1.0 (+https://soom260.github.io/kreceipt/)';

// ───────── 짧은 메모리 캐시 (같은 요청이 몰릴 때 바깥 API 호출을 아낌) ─────────
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.until < Date.now()) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value, ttlSec) {
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, { value, until: Date.now() + ttlSec * 1000 });
}

// ───────── 응답 ─────────
function corsHeaders(req) {
  const origin = req.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}
function json(req, status, body, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      ...corsHeaders(req),
    },
  });
}
const fail = (req, status, code, message) => json(req, status, { ok: false, code, message });

async function getJSON(url, init = {}) {
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status === 403 || res.status === 429) throw Object.assign(new Error('limit'), { code: 'limit', status: res.status });
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { code: 'upstream', status: res.status });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    // 공공데이터포털은 키 오류 등을 XML 로 돌려준다 (예: SERVICE_KEY_IS_NOT_REGISTERED_ERROR)
    const m = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>|<resultMsg>([^<]+)<\/resultMsg>/);
    throw Object.assign(new Error(m ? (m[1] || m[2]) : 'not json'), { code: 'upstream' });
  }
}

// ───────── 노래 ─────────
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

async function handleSongs(req, url) {
  const term = (url.searchParams.get('term') || '').trim();
  if (term.length < 2 || term.length > 50) return fail(req, 400, 'bad_term', '검색어는 2–50자여야 해요.');
  const key = 'songs:' + term.toLowerCase();
  let list = cacheGet(key);
  if (!list) {
    const q = new URLSearchParams({ term, country: ITUNES.country, media: 'music', entity: 'song', limit: String(ITUNES.limit) });
    const data = await getJSON(`${ITUNES.search}?${q}`, { headers: { 'User-Agent': UA } });
    list = (data.results || []).filter((r) => r.trackId).map(song);
    cacheSet(key, list, 3600);
  }
  return json(req, 200, { ok: true, results: list }, 600);
}

async function handleSong(req, url) {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return fail(req, 400, 'bad_id', '곡 번호가 올바르지 않아요.');
  const key = 'song:' + id;
  let item = cacheGet(key);
  if (item === null) {
    const q = new URLSearchParams({ id: String(id), country: ITUNES.country });
    const data = await getJSON(`${ITUNES.lookup}?${q}`, { headers: { 'User-Agent': UA } });
    const r = (data.results || []).find((x) => x.trackId === id);
    item = r ? song(r) : false;
    cacheSet(key, item, 86400);
  }
  return json(req, 200, { ok: true, result: item || null }, 3600);
}

// ───────── 날씨 ─────────
// 한국 시각(KST) 기준 지금
function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    ymd: d.toISOString().slice(0, 10).replace(/-/g, ''),
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    ms: d.getTime(),
  };
}
const pad = (n) => String(n).padStart(2, '0');
function ymdOf(ms) { return new Date(ms).toISOString().slice(0, 10).replace(/-/g, ''); }

// 초단기실황: 매시 정각 자료가 약 40분 뒤 나온다
function ncstBase(now) {
  let ms = now.ms;
  if (now.m < 41) ms -= 3600 * 1000;
  const d = new Date(ms);
  return { base_date: ymdOf(ms), base_time: pad(d.getUTCHours()) + '00' };
}
// 초단기예보: 매시 30분 자료가 약 45분에 나온다
function fcstBase(now) {
  let ms = now.ms;
  if (now.m < 46) ms -= 3600 * 1000;
  const d = new Date(ms);
  return { base_date: ymdOf(ms), base_time: pad(d.getUTCHours()) + '30' };
}

function items(data) {
  const header = data && data.response && data.response.header;
  if (!header || header.resultCode !== '00') {
    // 03 = 자료 없음
    if (header && header.resultCode === '03') return [];
    throw Object.assign(new Error((header && header.resultMsg) || 'bad response'), { code: 'upstream' });
  }
  const it = data.response.body && data.response.body.items && data.response.body.items.item;
  return Array.isArray(it) ? it : it ? [it] : [];
}

// 오늘: 지금 기온(T1H)·강수 형태(PTY) + 하늘 상태(SKY, 가장 가까운 예보 시각)
async function weatherToday(env, nx, ny, now) {
  const common = { serviceKey: env.KMA_API_KEY, pageNo: '1', numOfRows: '60', dataType: 'JSON', nx: String(nx), ny: String(ny) };
  const [ncst, fcst] = await Promise.all([
    getJSON(`${KMA.ncst}?${new URLSearchParams({ ...common, ...ncstBase(now) })}`),
    getJSON(`${KMA.fcst}?${new URLSearchParams({ ...common, ...fcstBase(now) })}`),
  ]);
  const obs = Object.fromEntries(items(ncst).map((i) => [i.category, Number(i.obsrValue)]));
  const sky = items(fcst).filter((i) => i.category === 'SKY').sort((a, b) => (a.fcstDate + a.fcstTime).localeCompare(b.fcstDate + b.fcstTime))[0];
  if (!Number.isFinite(obs.T1H)) return null;
  const pty = obs.PTY || 0;
  let c;
  if ([1, 5].includes(pty)) c = 'rain';
  else if ([2, 6].includes(pty)) c = 'sleet';
  else if ([3, 7].includes(pty)) c = 'snow';
  else c = { 1: 'sun', 3: 'cloud', 4: 'overcast' }[Number(sky && sky.fcstValue)] || 'sun';
  return { c, t: Math.round(obs.T1H), kind: 'now' };
}

// 지난 날짜: 그날 관측 기록 (최고기온, 강수량, 평균 구름양)
async function weatherPast(env, stn, date) {
  const ymd = date.replace(/-/g, '');
  const q = new URLSearchParams({ serviceKey: env.KMA_API_KEY, pageNo: '1', numOfRows: '1', dataType: 'JSON', dataCd: 'ASOS', dateCd: 'DAY', startDt: ymd, endDt: ymd, stnIds: String(stn) });
  const it = items(await getJSON(`${KMA.asos}?${q}`))[0];
  if (!it) return null;
  const num = (v) => (v === '' || v === undefined || v === null ? NaN : Number(v));
  const rain = num(it.sumRn) || 0;
  const snow = num(it.ddMes) || 0;
  const tca = num(it.avgTca);
  const hi = num(it.maxTa);
  const lo = num(it.minTa);
  if (!Number.isFinite(hi)) return null;
  let c;
  if (snow > 0 || (rain >= 1 && Number.isFinite(lo) && hi <= 2)) c = 'snow';
  else if (rain >= 1) c = 'rain';
  else if (!Number.isFinite(tca) || tca <= 5) c = 'sun';
  else if (tca <= 8) c = 'cloud';
  else c = 'overcast';
  return { c, t: Math.round(hi), kind: 'max', place: it.stnNm || '' };
}

async function handleWeather(req, url, env) {
  if (!env.KMA_API_KEY) return fail(req, 503, 'no_key', '서버에 날씨 인증키가 설정되지 않았어요.');
  const date = url.searchParams.get('date') || '';
  const nx = Number(url.searchParams.get('nx'));
  const ny = Number(url.searchParams.get('ny'));
  const stn = Number(url.searchParams.get('stn'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return fail(req, 400, 'bad_date', '날짜가 올바르지 않아요.');
  if (!Number.isInteger(nx) || nx < 1 || nx > 149 || !Number.isInteger(ny) || ny < 1 || ny > 253) return fail(req, 400, 'bad_grid', '위치(격자)가 올바르지 않아요.');
  if (!STATIONS.has(stn)) return fail(req, 400, 'bad_station', '관측소 번호가 올바르지 않아요.');

  const now = kstNow();
  if (date > now.date) return fail(req, 400, 'future', '아직 오지 않은 날짜예요.');
  const today = date === now.date;
  const key = today ? `w:${date}:${nx},${ny}:${now.h}` : `w:${date}:${stn}`;
  let w = cacheGet(key);
  if (!w) {
    // 지난 날짜 자료는 다음 날 오전에 올라오므로, 어제 자료가 아직 없으면 "없음"으로 답한다
    w = today ? await weatherToday(env, nx, ny, now) : await weatherPast(env, stn, date);
    if (!w) return json(req, 200, { ok: true, weather: null }, 600);
    cacheSet(key, w, today ? 1800 : 86400 * 7);
  }
  return json(req, 200, { ok: true, weather: w }, today ? 600 : 86400);
}

// ───────── 답장 스티커 ─────────
// 스티커 종류 (js/config.js 의 REPLY_STICKERS 와 같은 목록)
const STICKERS = new Set(['lol', 'touched', 'nice', 'yum', 'thanks', 'cheer']);
const MAX_REACTIONS = 30;
const KEEP_SEC = 90 * 24 * 3600;
const ID_RE = /^[0-9a-f]{32}$/;
const DEV_RE = /^[0-9a-f]{16,32}$/;

// 바깥에 내보내는 모양: 기기 번호(dev)는 빼고 스티커·이름·시각만
const publicList = (list) => list.map((r) => ({ s: r.s, n: r.n || '', t: r.t }));

async function readReactions(env, id) {
  const raw = await env.REACTIONS.get('r:' + id);
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

async function handleReactionsGet(req, url, env) {
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return fail(req, 400, 'bad_id', '영수증 번호가 올바르지 않아요.');
  return json(req, 200, { ok: true, reactions: publicList(await readReactions(env, id)) });
}

async function handleReactionsPost(req, env) {
  if (!(req.headers.get('Content-Type') || '').includes('application/json')) return fail(req, 415, 'type', 'JSON 으로 보내 주세요.');
  const text = await req.text();
  if (text.length > 600) return fail(req, 413, 'too_big', '보낸 내용이 너무 커요.');
  let body;
  try { body = JSON.parse(text); } catch (e) { return fail(req, 400, 'bad_json', '내용을 읽을 수 없어요.'); }
  const id = String(body.id || '');
  const sticker = String(body.s || '');
  const dev = String(body.dev || '');
  const name = typeof body.n === 'string' ? Array.from(body.n.trim()).slice(0, 10).join('') : '';
  if (!ID_RE.test(id)) return fail(req, 400, 'bad_id', '영수증 번호가 올바르지 않아요.');
  if (!STICKERS.has(sticker)) return fail(req, 400, 'bad_sticker', '없는 스티커예요.');
  if (!DEV_RE.test(dev)) return fail(req, 400, 'bad_dev', '기기 번호가 올바르지 않아요.');

  const list = (await readReactions(env, id)).filter((r) => r.d !== dev);
  if (list.length >= MAX_REACTIONS) return fail(req, 429, 'full', `한 영수증에는 답장을 ${MAX_REACTIONS}개까지 남길 수 있어요.`);
  list.push({ s: sticker, n: name, t: Date.now(), d: dev });
  await env.REACTIONS.put('r:' + id, JSON.stringify(list), { expirationTtl: KEEP_SEC });
  return json(req, 200, { ok: true, reactions: publicList(list) });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/reactions') {
      // 허용한 화면 주소에서 온 요청만 받는다
      if (!ALLOWED_ORIGINS.includes(req.headers.get('Origin') || '')) return fail(req, 403, 'origin', '허용되지 않은 주소예요.');
      if (!env.REACTIONS) return fail(req, 503, 'no_store', '답장 저장소가 준비되지 않았어요.');
      try { return await handleReactionsPost(req, env); } catch (e) { return fail(req, 502, 'store', '답장을 저장하지 못했어요.'); }
    }
    if (req.method !== 'GET') return fail(req, 405, 'method', 'GET·POST 만 받아요.');
    try {
      if (url.pathname === '/reactions') {
        if (!env.REACTIONS) return fail(req, 503, 'no_store', '답장 저장소가 준비되지 않았어요.');
        return await handleReactionsGet(req, url, env);
      }
      if (url.pathname === '/songs') return await handleSongs(req, url);
      if (url.pathname === '/song') return await handleSong(req, url);
      if (url.pathname === '/weather') return await handleWeather(req, url, env);
      if (url.pathname === '/') return json(req, 200, { ok: true, service: 'kreceipt-api', paths: ['/songs', '/song', '/weather', '/reactions'] });
      return fail(req, 404, 'not_found', '없는 주소예요.');
    } catch (e) {
      // 바깥 API 실패. 인증키나 원본 응답은 돌려주지 않는다
      const res = fail(req, 502, e.code || 'upstream', e.code === 'limit' ? '바깥 서버가 잠깐 막았어요.' : '바깥 서버에서 정보를 받지 못했어요.');
      if (e.status) res.headers.set('X-Upstream-Status', String(e.status)); // 원인 확인용 (응답 번호만)
      return res;
    }
  },
};
