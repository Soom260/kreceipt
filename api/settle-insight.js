// POST /api/settle-insight → 정산 소비 분석 (Vercel 함수 → 오픈하사 AI, api/_hasa.js).
// 1) AI 가 가게를 정해진 분류(카페·식사 …)로 나눈다 → 2) 분류별 합계·비율은 여기서 직접 계산한다 (AI 에 계산을 맡기지 않음)
// → 3) 계산한 숫자를 주고 AI 가 한두 문장 코멘트를 쓴다.
// 받는 것: 기간 이름, 가게별 [이름, 금액, 횟수] (최대 40곳), 지난 기간 합계(있으면). 캡처·보내는 사람 이름은 받지 않는다.

const { send, isInt, shortStr, cleanLine, parseJSON, chat, handler, fail } = require('./_hasa.js');

const CATS = ['카페', '식사', '간식·디저트', '편의점·마트', '교통', '쇼핑', '문화·여가', '생활', '기타'];

function check(b) {
  if (!b || typeof b !== 'object') return { err: '내용이 비어 있어요.' };
  if (!shortStr(b.period, 20)) return { err: '기간 이름이 올바르지 않아요.' };
  if (!Array.isArray(b.shops) || !b.shops.length || b.shops.length > 40) return { err: '가게 목록이 올바르지 않아요.' };
  for (const t of b.shops) {
    if (!Array.isArray(t) || t.length !== 3 || !shortStr(t[0], 20) || !isInt(t[1], 1, 1e10) || !isInt(t[2], 1, 999)) return { err: '가게 목록이 올바르지 않아요.' };
  }
  if (new Set(b.shops.map((t) => t[0].trim())).size !== b.shops.length) return { err: '가게 이름이 겹쳐요.' };
  if (b.prev != null && !(b.prev && shortStr(b.prev.label, 30) && isInt(b.prev.total, 0, 1e11))) return { err: '지난 기간 정보가 올바르지 않아요.' };
  return { ok: { period: b.period, shops: b.shops.map(([n, a, v]) => [n.trim(), a, v]), prev: b.prev || null } };
}

const CLASSIFY = [
  '너는 가계부 앱에서 가게 이름을 소비 분류로 나눈다.',
  `분류는 이 중 하나만 쓴다: ${CATS.join(', ')}`,
  '- 커피·카페 → 카페, 밥집·식당·배달 → 식사, 빵집·디저트·아이스크림 → 간식·디저트, 편의점·마트·시장 → 편의점·마트,',
  '  지하철·버스·택시·주유 → 교통, 옷·온라인쇼핑 → 쇼핑, 책·영화·공연·게임 → 문화·여가, 병원·약국·미용·통신 → 생활, 모르겠으면 기타.',
  '받은 가게 이름을 글자 그대로 키로 쓴다. 출력은 JSON 한 줄만: {"cats":{"가게 이름":"분류", ...}}',
].join('\n');

const COMMENT = [
  '너는 가계부 앱 kreceipt 에서 정산 결과 아래에 짧은 코멘트를 쓴다.',
  '- 한국어 해요체, 1~2문장, 70자 이내.',
  '- 받은 숫자만 쓰고 새 숫자를 지어내지 않는다. 비율은 받은 그대로 쓴다.',
  '- 가장 큰 분류를 짚고, 지난 기간 비교가 있으면 늘었는지 줄었는지 말한다.',
  '- 꾸짖거나 훈계하지 않는다. 이모지·해시태그를 쓰지 않는다.',
  '출력은 JSON 한 줄만: {"comment":"..."}',
].join('\n');

// 분류 결과 → { 가게: 분류 } (모르는 분류·빠진 가게는 기타)
function readCats(text, shops) {
  const o = parseJSON(text);
  if (!o || !o.cats || typeof o.cats !== 'object') return null;
  const map = {};
  let known = 0;
  for (const [name] of shops) {
    const c = typeof o.cats[name] === 'string' ? o.cats[name].trim() : '';
    if (CATS.includes(c)) { map[name] = c; known += 1; } else map[name] = '기타';
  }
  return known ? map : null; // 하나도 못 나눴으면 다음 모델로
}

module.exports = handler(check, async (b, res) => {
  const r1 = await chat(
    [{ role: 'system', content: CLASSIFY }, { role: 'user', content: b.shops.map(([n]) => n).join('\n') }],
    { maxTokens: 900, accept: (text) => readCats(text, b.shops), budgetMs: 15000 },
  );
  if (!r1.ok) { fail(res, r1); return; }
  const map = r1.value;

  // 분류별 합계·비율 (반올림한 비율 합이 100 이 안 될 수 있어 화면에는 금액도 함께 보여 준다)
  const total = b.shops.reduce((s, [, a]) => s + a, 0);
  const byCat = new Map();
  for (const [name, amount, visits] of b.shops) {
    const g = byCat.get(map[name]) || { cat: map[name], amount: 0, visits: 0 };
    g.amount += amount;
    g.visits += visits;
    byCat.set(map[name], g);
  }
  const cats = [...byCat.values()].sort((x, y) => y.amount - x.amount).map((g) => ({ ...g, share: Math.round((g.amount / total) * 100) }));

  // 코멘트 (실패해도 분류 결과는 보여 준다)
  const lines = [
    `기간: ${b.period}, 합계 ${total.toLocaleString('ko-KR')}원`,
    `분류별: ${cats.map((g) => `${g.cat} ${g.share}% (${g.amount.toLocaleString('ko-KR')}원, ${g.visits}번)`).join(', ')}`,
  ];
  if (b.prev && b.prev.total > 0) {
    const diff = Math.round(((total - b.prev.total) / b.prev.total) * 100);
    lines.push(`${b.prev.label} 합계 ${b.prev.total.toLocaleString('ko-KR')}원 → 이번 ${diff >= 0 ? diff + '% 많음' : -diff + '% 적음'}`);
  }
  const r2 = await chat(
    [{ role: 'system', content: COMMENT }, { role: 'user', content: lines.join('\n') }],
    { maxTokens: 300, accept: (text) => { const o = parseJSON(text); const c = o && typeof o.comment === 'string' ? cleanLine(o.comment, 90) : ''; return c || null; }, budgetMs: 12000 },
  );

  res.setHeader('X-Model', r1.model);
  send(res, 200, { ok: true, map, cats, comment: r2.ok ? r2.value : '' });
});
module.exports.readCats = readCats;
