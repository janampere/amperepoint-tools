// Porzadki na tablicy wynikow. Endpoint kasuje dane, wiec wymaga hasla z
// ADMIN_TOKEN i domyslnie tylko pokazuje, co by usunal - skasowanie trzeba
// potwierdzic osobno. W trakcie targow pomylka kosztuje tu za duzo.

const { kvReady, kv, json } = require('./_store.js');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const BOARD_KEY = 'ampererush:board';

function entryTime(e) {
  return Date.parse(e.claimedAt || e.playedAt || '') || 0;
}

async function handler(req, res) {
  if (!kvReady) return json(res, 503, { error: 'not_configured' });
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) {
    return json(res, 503, {
      error: 'brak ADMIN_TOKEN',
      hint: 'Ustaw w Vercelu zmienna ADMIN_TOKEN (dlugi, losowy ciag) i zrob redeploy.'
    });
  }
  const q = req.query || {};
  if (String(q.token || '') !== ADMIN_TOKEN) return json(res, 403, { error: 'zle haslo' });

  let raw;
  try {
    raw = await kv(['ZRANGE', BOARD_KEY, '0', '-1', 'REV']);
  } catch (e) {
    return json(res, 503, { error: 'store_unavailable' });
  }
  const rows = (Array.isArray(raw) ? raw : []).map((s) => {
    try { return { s, e: JSON.parse(s) }; } catch (err) { return { s, e: {} }; }
  });

  // Domyslnie tniemy wszystko sprzed dzisiaj - to jest ten typowy przypadek
  // "wyczysc testy z wczoraj", a date mozna nadpisac parametrem.
  const before = q.before ? Date.parse(q.before) : new Date().setHours(0, 0, 0, 0);
  if (Number.isNaN(before)) return json(res, 400, { error: 'zla data w parametrze before' });

  const doomed = q.all === '1' ? rows : rows.filter((r) => entryTime(r.e) < before);
  const summary = (list) => list.map((r) => ({
    nick: r.e.nick, score: r.e.score,
    kiedy: r.e.claimedAt || r.e.playedAt || '?'
  }));

  if (q.confirm !== '1') {
    return json(res, 200, {
      tryb: 'podglad',
      doUsuniecia: summary(doomed),
      zostanie: summary(rows.filter((r) => !doomed.includes(r))),
      hint: 'Dodaj &confirm=1 do adresu, zeby naprawde usunac.'
    });
  }

  let removed = 0;
  for (const r of doomed) {
    try { await kv(['ZREM', BOARD_KEY, r.s]); removed++; } catch (e) { /* lecimy dalej */ }
  }
  return json(res, 200, { tryb: 'usuniete', usunieto: removed, zostalo: rows.length - removed });
}

module.exports = handler;
