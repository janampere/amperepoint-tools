// Porzadki na tablicy wynikow. Endpoint kasuje dane, wiec wymaga hasla z
// ADMIN_TOKEN i domyslnie tylko pokazuje, co by usunal - skasowanie trzeba
// potwierdzic osobno. W trakcie targow pomylka kosztuje tu za duzo.

const { kvReady, kv, json } = require('./_store.js');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const BOARD_KEY = 'ampererush:board';

// Sprzatanie po testach sprzed targow. Data jest wpisana na sztywno, wiec
// ten tryb nie tknie zadnego wyniku z 23-25.09 nawet, gdyby ktos obcy
// trafil na adres - a powtorne wywolanie niczego nie zmienia. Dzieki temu
// dziala bez hasla, gdy nie ma dostepu do panelu.
const PRZED_TARGAMI = Date.parse('2026-09-22T22:00:00.000Z');   // 23.09, 00:00 czasu lokalnego

function entryTime(e) {
  return Date.parse(e.claimedAt || e.playedAt || '') || 0;
}

async function handler(req, res) {
  if (!kvReady) return json(res, 503, { error: 'not_configured' });
  const q = req.query || {};

  // Z haslem: pelne porzadki. Bez hasla: wylacznie sprzataniedanych sprzed
  // targow, bo ten zakres jest nieszkodliwy nawet w cudzych rekach.
  const hasToken = Boolean(ADMIN_TOKEN && ADMIN_TOKEN.length >= 12);
  const authorized = hasToken && String(q.token || '') === ADMIN_TOKEN;
  if (q.token && !authorized) return json(res, 403, { error: 'zle haslo' });

  let raw;
  try {
    raw = await kv(['ZRANGE', BOARD_KEY, '0', '-1', 'REV']);
  } catch (e) {
    return json(res, 503, { error: 'store_unavailable' });
  }
  const rows = (Array.isArray(raw) ? raw : []).map((s) => {
    try { return { s, e: JSON.parse(s) }; } catch (err) { return { s, e: {} }; }
  });

  // Bez hasla dziala tylko sztywny zakres sprzed targow. Wlasna data i
  // czyszczenie calej tablicy wymagaja hasla.
  let before = PRZED_TARGAMI;
  if (authorized && q.before) {
    before = Date.parse(q.before);
    if (Number.isNaN(before)) return json(res, 400, { error: 'zla data w parametrze before' });
  }
  const doomed = (authorized && q.all === '1')
    ? rows
    : rows.filter((r) => entryTime(r.e) < before);
  const summary = (list) => list.map((r) => ({
    nick: r.e.nick, score: r.e.score,
    kiedy: r.e.claimedAt || r.e.playedAt || '?'
  }));

  if (q.confirm !== '1') {
    return json(res, 200, {
      tryb: 'podglad',
      zakres: authorized ? 'pelny (z haslem)' : 'tylko wpisy sprzed 23.09',
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
