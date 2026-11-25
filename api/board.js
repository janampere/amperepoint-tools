// Tablica wynikow dla duzego ekranu. Kiosk odpytuje ja co minute.

const { kvReady, topBoard, nickKey, json, BOARD_KEY, EDITIONS } = require('./_store.js');

async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (!kvReady) return json(res, 503, { error: 'not_configured' });

  // ?edition=knm2026 - tablica z poprzednich targow, tylko do wgladu.
  const edition = String((req.query && req.query.edition) || '');
  if (edition && !EDITIONS[edition]) return json(res, 400, { error: 'unknown_edition' });
  const key = edition ? EDITIONS[edition] : BOARD_KEY;
  const limit = Math.max(1, Math.min(20, parseInt(req.query && req.query.limit, 10) || 10));
  try {
    // Jedna osoba moze wygrac tylko jedna nagrode, wiec na tablicy zostaje
    // jej najlepszy przejazd. Odsiewamy przy odczycie, a nie przy zapisie -
    // dzieki temu porzadkuje to takze duplikaty juz zapisane w bazie.
    // Pobieramy z zapasem, bo czesc wierszy wypadnie.
    const rows = await topBoard(Math.min(80, limit * 8), key, Boolean(edition));
    const better = edition ? (a, b) => a > b : (a, b) => a < b;
    const best = new Map();
    for (const r of rows) {
      const key = nickKey(r.nick);
      if (!key) continue;
      const prev = best.get(key);
      if (!prev || better(Number(r.score), Number(prev.score))) best.set(key, r);
    }
    const board = [...best.values()]
      .sort((a, b) => (better(Number(a.score), Number(b.score)) ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({
        nick: r.nick, score: r.score, level: r.level || 1, playedAt: r.playedAt
      }));
    return json(res, 200, { board });
  } catch (e) {
    return json(res, 503, { error: 'store_unavailable' });
  }
}

module.exports = handler;
