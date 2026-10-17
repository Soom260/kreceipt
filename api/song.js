// GET /api/song?id=곡번호 → iTunes 곡 다시 불러오기 (Vercel 함수).
const { handler, send, lookupSong } = require('./_itunes.js');

module.exports = handler(async (req, res) => {
  const id = Number(req.query && req.query.id);
  if (!Number.isInteger(id) || id <= 0) { send(res, 400, { ok: false, code: 'bad_id', message: '곡 번호가 올바르지 않아요.' }); return; }
  send(res, 200, { ok: true, result: await lookupSong(id) }, 3600);
});
