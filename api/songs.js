// GET /api/songs?term=검색어 → iTunes 노래 검색 (Vercel 함수). 검색어는 2–50자만 받는다.
const { handler, send, searchSongs } = require('./_itunes.js');

module.exports = handler(async (req, res) => {
  const term = String((req.query && req.query.term) || '').trim();
  if (term.length < 2 || term.length > 50) { send(res, 400, { ok: false, code: 'bad_term', message: '검색어는 2–50자여야 해요.' }); return; }
  send(res, 200, { ok: true, results: await searchSongs(term) }, 600);
});
