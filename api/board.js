// Tablica wynikow dla duzego ekranu. Kiosk odpytuje ja co kilka sekund.

const { kvReady, topBoard, json } = require('./_store.js');

async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (!kvReady) return json(res, 503, { error: 'not_configured' });

  const limit = Math.max(1, Math.min(20, parseInt(req.query && req.query.limit, 10) || 10));
  try {
    const rows = await topBoard(limit);
    return json(res, 200, {
      board: rows.map((r) => ({ nick: r.nick, score: r.score, playedAt: r.playedAt }))
    });
  } catch (e) {
    return json(res, 503, { error: 'store_unavailable' });
  }
}

module.exports = handler;
