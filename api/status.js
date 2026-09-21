// Kontrolka konfiguracji: mowi, co jest podpiete, i sprawdza, czy baza
// naprawde odpowiada. Nie zwraca zadnych tokenow ani danych graczy.

const { kvReady, kv, json } = require('./_store.js');

async function handler(req, res) {
  const out = {
    kv: { configured: kvReady, reachable: false },
    pipedrive: { configured: Boolean(process.env.PIPEDRIVE_TOKEN) },
    sheet: { configured: Boolean(process.env.SHEET_WEBHOOK_URL) },
    event: process.env.EVENT_TAG || 'KNM 2026 Katowice'
  };

  if (kvReady) {
    try {
      await kv(['SET', 'ampererush:status', String(Date.now()), 'EX', '60']);
      out.kv.reachable = Boolean(await kv(['GET', 'ampererush:status']));
    } catch (e) {
      out.kv.error = String(e.message || e);
    }
  }

  out.ready = out.kv.reachable;
  out.hint = out.ready
    ? 'Kody QR i wspolna tablica dzialaja.'
    : 'Bez dzialajacego KV gra chodzi w trybie lokalnym: bez kodow QR i bez wspolnej tablicy.';
  return json(res, 200, out);
}

module.exports = handler;
