// Vercel 함수에서 같이 쓰는 오픈하사 AI 도우미 (밑줄로 시작하는 파일은 주소가 생기지 않는다).
// 오픈하사: 경북IT융합산업기술원 공공 AI 서버, OpenAI 와 같은 /v1/chat/completions. 개발키는 1분에 10번·하루 500번.
// 키는 Vercel 환경 변수 HASA_API_KEY 에만 있다 (화면 코드·저장소에 없음).

const ALLOWED_ORIGINS = ['https://soom260.github.io', 'https://kreceipt.vercel.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const BASE = 'https://open.hasa.re.kr/v1';
// 개발키로 쓸 수 있는 모델이 문서에 없어, 한국어에 강한 순서로 시도한다 (403·404·503·시간 초과면 다음 모델)
// 2026-11-18 실제로 응답한 모델: kanana-2-30b-a3b
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

// 이모지·해시태그·앞 번호·감싼 따옴표를 지우고 max 자로 자른다
function cleanLine(s, max) {
  const t = String(s)
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/^[\s\-*•\d.)]+/, '')
    .replace(/#\S+/g, '')
    .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '')
    .trim();
  return Array.from(t).slice(0, max).join('');
}

// 모델 답에서 생각 과정(<think>)을 빼고 첫 JSON 덩어리를 꺼낸다. 없으면 null
function parseJSON(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

async function ask(model, key, messages, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: res.status };
    const data = await res.json();
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    return { status: 200, text: (msg && msg.content) || '' };
  } catch (e) {
    return { status: 504 };
  } finally {
    clearTimeout(timer);
  }
}

// 모델을 차례로 시도해 accept(text) 가 값을 돌려주면 그 값을 쓴다.
// 결과: { ok:true, value, model } | { ok:false, status, code, message, tried }
async function chat(messages, { maxTokens = 400, accept, budgetMs = 22000 } = {}) {
  const key = process.env.HASA_API_KEY;
  if (!key) return { ok: false, status: 500, code: 'nokey', message: 'AI 서버 키가 설정되지 않았어요.' };
  const order = goodModel ? [goodModel, ...MODELS.filter((m) => m !== goodModel)] : MODELS;
  const tried = [];
  const start = Date.now();
  for (const model of order) {
    if (Date.now() - start > budgetMs) break; // 화면은 30초까지 기다린다
    const r = await ask(model, key, messages, maxTokens);
    tried.push(`${model}:${r.status}`);
    if (r.status === 429) return { ok: false, status: 429, code: 'limit', message: 'AI 서버 사용량이 잠깐 찼어요.', tried };
    if (r.status === 401) return { ok: false, status: 502, code: 'key', message: 'AI 서버 키가 맞지 않아요.', tried };
    if (r.status === 200) {
      const value = accept(r.text);
      if (value) { goodModel = model; return { ok: true, value, model }; }
    }
  }
  return { ok: false, status: 502, code: 'upstream', message: 'AI 서버에서 답을 받지 못했어요.', tried };
}

// 함수 공통 틀: POST JSON 만, 받은 내용 검사 후 run(body, res)
function handler(check, run) {
  return async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method !== 'POST') { send(res, 405, { ok: false, code: 'method', message: 'POST 만 받아요.' }); return; }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const c = check(body);
    if (c.err) { send(res, 400, { ok: false, code: 'bad_input', message: c.err }); return; }
    await run(c.ok, res);
  };
}

// AI 실패 결과 → 응답
function fail(res, r) {
  if (r.model) res.setHeader('X-Model', r.model);
  if (r.tried) res.setHeader('X-Tried', r.tried.join(' '));
  send(res, r.status, { ok: false, code: r.code, message: r.message });
}

module.exports = { send, isInt, shortStr, cleanLine, parseJSON, chat, handler, fail };
