// POST /api/settle-note → 정산 영수증에 붙일 한마디 3개 (Vercel 함수 → 오픈하사 AI, api/_hasa.js).
// 받는 것: 기간 이름·장수·날수·합계·가게별 금액(최대 10곳)·기분·날씨 개수. 캡처·보내는 사람 이름은 받지 않는다.

const { send, isInt, shortStr, cleanLine, parseJSON, chat, handler, fail } = require('./_hasa.js');

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
  const o = parseJSON(text);
  const list = o && Array.isArray(o.notes) ? o.notes : String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n');
  const seen = new Set();
  return list
    .map((s) => cleanLine(s, 60))
    .filter((s) => s && !s.startsWith('{') && !seen.has(s) && seen.add(s))
    .slice(0, 3);
}

module.exports = handler(check, async (b, res) => {
  const r = await chat(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: userText(b) }],
    { maxTokens: 400, accept: (text) => { const n = parseNotes(text); return n.length ? n : null; } },
  );
  if (!r.ok) { fail(res, r); return; }
  res.setHeader('X-Model', r.model);
  send(res, 200, { ok: true, notes: r.value });
});
module.exports.parseNotes = parseNotes;
