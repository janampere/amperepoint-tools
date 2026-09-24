// Kiosk zglasza zakonczony przejazd i dostaje kod do kodu QR.
// Wynik powstaje tutaj, nie na telefonie - inaczej nie da sie powiazac
// maila z konkretna gra.

const { kvReady, makeCode, saveRun, loadRun, json, readBody, kvReason } = require('./_store.js');

async function handler(req, res) {
  if (!kvReady) return json(res, 503, { error: 'not_configured' });

  // Telefon pyta o przejazd, zeby pokazac wynik nad formularzem.
  if (req.method === 'GET') {
    const code = String((req.query && req.query.code) || '').trim().toUpperCase().slice(0, 12);
    if (!code) return json(res, 400, { error: 'no_code' });
    let run;
    try { run = await loadRun(code); }
    catch (e) { return json(res, 503, { error: 'store_unavailable', reason: kvReason(e) }); }
    if (!run) return json(res, 404, { error: 'unknown_code' });
    return json(res, 200, {
      score: run.score, distance: run.distance, pickups: run.pickups,
      level: run.level || 1, initials: run.initials, claimed: Boolean(run.claimed), nick: run.nick || ''
    });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const b = readBody(req);
  const score = Math.max(0, Math.min(9999999, Math.floor(Number(b.score) || 0)));
  const distance = Math.max(0, Math.min(9999999, Math.floor(Number(b.distance) || 0)));
  const pickups = Math.max(0, Math.min(9999, Math.floor(Number(b.pickups) || 0)));
  const level = Math.max(1, Math.min(999, Math.floor(Number(b.level) || 1)));
  const initials = String(b.initials || '').replace(/[^A-Z0-9\-]/gi, '').slice(0, 3).toUpperCase();

  const code = makeCode();
  try {
    await saveRun(code, {
      code, score, distance, pickups, level, initials,
      playedAt: new Date().toISOString(),
      claimed: false
    });
  } catch (e) {
    // Bez tego ekran przy stoisku pokazywal tylko "http_503" i nie dalo sie
    // zdalnie stwierdzic, czy to baza, limit planu, czy sieć na targach.
    return json(res, 503, { error: 'store_unavailable', reason: kvReason(e) });
  }
  return json(res, 200, { code });
}

module.exports = handler;
