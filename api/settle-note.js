// POST /api/settle-note → 정산 영수증에 붙일 한마디 3개 (Vercel 함수 → 오픈하사 AI).
// 받는 것: 기간 이름·장수·날수·합계·가게별 금액(최대 10곳)·기분·날씨 개수. 캡처·보내는 사람 이름은 받지 않는다.
// 키는 Vercel 환경 변수 HASA_API_KEY 에만 있다 (화면 코드·저장소에 없음).
// 오픈하사: 경북IT융합산업기술원 공공 AI 서버, OpenAI 와 같은 /v1/chat/completions. 개발키는 1분에 10번·하루 500번.

const ALLOWED_ORIGINS = ['https://soom260.github.io', 'https://kreceipt.vercel.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const BASE = 'https://open.hasa.re.kr/v1';
// 개발키로 쓸 수 있는 모델이 문서에 없어, 한국어에 강한 순서로 시도한다 (403·404·503 이면 다음 모델)
const MODELS = ['kanana-2-30b-a3b', 'hyperclovax-seed-32b', 'exaone-4.0-32b', 'gpt-oss-20b', 'llama-3.3-70b'];
let goodModel = null; // 한 번 된 모델은 다음부터 먼저 쓴다 (함수가 살아 있는 동안)

function cors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const isInt = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
const shortStr = (x, max) => typeof x === 'string' && x.trim().length > 0 && Array.from(x).length <= max;

// 받은 내용 검사. 문제가 있으면 이유, 없으면 정리한 값
function check(b) {
  if (!b || typeof b !== 'object') return { err: '내용이 비어 있어요.' };
  if (!shortStr(b.period, 20)) return { err: '기간 이름이 올바르지 않아요.' };
  if (!isInt(b.receipts, 1, 999) || !isInt(b.days, 1, 400) || !isInt(b.total, 1, 1e10)) return { err: '장수·날수·합계가 올바르지 않아요.' };
  if (!Array.isArray(b.top) || !b.top.length || b.top.length > 10) return { err: '가게 목록이 올바르지 않아요.' };
  for (const t of b.top) {
    if (!Array.isArray(t) || t.length !== 3 || !shortStr(t[0], 20) || !isInt(t[1], 1, 1e10) || !isInt(t[2], 1, 999)) return { err: '가게 목록이 올바르지 않아요.' };
  }
  const counts = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length <= 10
    && Object.entries(o).every(([k, v]) => shortStr(k, 10) && isInt(v, 1, 999));
  if (!counts(b.moods || {}) || !counts(b.weather || {})) return { err: '기분·날씨가 올바르지 않아요.' };
  return { ok: { ...b, moods: b.moods || {}, weather: b.weather || {} } };
}

const SYSTEM = [
  '너는 영수증 앱 kreceipt 에서 "정산 영수증" 맨 아래에 들어갈 한마디를 쓴다.',
  '정산 영수증은 한 주나 한 달 동안 쓴 돈을 한 장으로 모은 것이다.',
  '규칙:',
  '- 한국어 반말 혼잣말, 일기 끝에 적는 말투. 각 30자 이내.',
  '- 3개를 쓰고, 셋의 느낌을 다르게 한다 (담담하게 / 피식 웃기게 / 다음을 다짐하며).',
  '- 가장 많이 간 가게나 기분·날씨 중 하나쯤을 자연스럽게 녹인다.',
  '- 돈 쓴 것을 꾸짖거나 훈계하지 않는다. 금액 숫자를 그대로 나열하지 않는다.',
  '- 이모지, 해시태그, 따옴표를 쓰지 않는다.',
  '출력은 JSON 한 줄만: {"notes":["...","...","..."]}',
].join('\n');

function userText(b) {
  const top = b.top.map(([n, a, v]) => `${n} ${v}번 ${a.toLocaleString('ko-KR')}원`).join(', ');
  const cnt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}번`).join(', ') || '기록 없음';
  return [
    `기간: ${b.period} (영수증 ${b.receipts}장, ${b.days}일)`,
    `합계: ${b.total.toLocaleString('ko-KR')}원`,
    `가게별: ${top}`,
    `기분: ${cnt(b.moods)}`,
    `날씨: ${cnt(b.weather)}`,
  ].join('\n');
}

// 모델 답 → 한마디 최대 3개 (JSON 이 아니면 줄 단위로 꺼낸다)
function parseNotes(text) {
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  let list = null;
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { const o = JSON.parse(m[0]); if (Array.isArray(o.notes)) list = o.notes; } catch (e) { /* 아래 줄 단위로 */ } }
  if (!list) list = t.split('\n');
  const seen = new Set();
  return list
    .map((s) => String(s)
      .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
      .replace(/^[\s\-*•\d.)]+/, '')
      .replace(/#\S+/g, '')
      .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '')
      .trim())
    .filter((s) => s && !s.startsWith('{') && !seen.has(s) && seen.add(s))
    .map((s) => Array.from(s).slice(0, 60).join(''))
    .slice(0, 3);
}

async function ask(model, key, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userText(body) }],
        temperature: 0.8,
        max_tokens: 400,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: res.status };
    const data = await res.json();
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    return { status: 200, notes: parseNotes(msg && msg.content) };
  } catch (e) {
    return { status: 504 };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { send(res, 405, { ok: false, code: 'method', message: 'POST 만 받아요.' }); return; }
  const key = process.env.HASA_API_KEY;
  if (!key) { send(res, 500, { ok: false, code: 'nokey', message: 'AI 서버 키가 설정되지 않았어요.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const c = check(body);
  if (c.err) { send(res, 400, { ok: false, code: 'bad_input', message: c.err }); return; }

  const order = goodModel ? [goodModel, ...MODELS.filter((m) => m !== goodModel)] : MODELS;
  const tried = [];
  const start = Date.now();
  for (const model of order) {
    if (Date.now() - start > 22000) break; // 화면은 30초까지 기다린다
    const r = await ask(model, key, c.ok);
    tried.push(`${model}:${r.status}`);
    if (r.status === 429) { res.setHeader('X-Tried', tried.join(' ')); send(res, 429, { ok: false, code: 'limit', message: 'AI 서버 사용량이 잠깐 찼어요.' }); return; }
    if (r.status === 401) { send(res, 502, { ok: false, code: 'key', message: 'AI 서버 키가 맞지 않아요.' }); return; }
    if (r.status === 200 && r.notes.length) {
      goodModel = model;
      res.setHeader('X-Model', model);
      send(res, 200, { ok: true, notes: r.notes });
      return;
    }
    // 403(이 키로 못 쓰는 모델)·404·503·시간 초과·빈 답 → 다음 모델
  }
  res.setHeader('X-Tried', tried.join(' '));
  send(res, 502, { ok: false, code: 'upstream', message: 'AI 서버에서 한마디를 받지 못했어요.' });
};
