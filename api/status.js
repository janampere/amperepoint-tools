// Kontrolka konfiguracji: mowi, co jest podpiete, i realnie puka do kazdej
// integracji. Nie zwraca tokenow, adresow ani danych graczy - tylko to, czy
// dana rzecz odpowiada. Zadna z tych prob nic nie zapisuje.

const { kvReady, kv, kvEnvNames, json } = require('./_store.js');

const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_TOKEN;
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL;

async function ping(run, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await run(ctl.signal); } finally { clearTimeout(t); }
}

async function checkPipedrive() {
  const out = { configured: Boolean(PIPEDRIVE_TOKEN), reachable: false };
  if (!PIPEDRIVE_TOKEN) return out;
  try {
    // /users/me tylko czyta - potwierdza, ze token jest wazny.
    const r = await ping((signal) => fetch(
      'https://api.pipedrive.com/v1/users/me?api_token=' + encodeURIComponent(PIPEDRIVE_TOKEN),
      { signal }), 6000);
    const data = await r.json().catch(() => ({}));
    out.reachable = Boolean(data && data.success);
    if (!out.reachable) out.error = 'token odrzucony (HTTP ' + r.status + ')';
    else if (data.data && data.data.company_name) out.company = data.data.company_name;
  } catch (e) {
    out.error = String(e.name === 'AbortError' ? 'brak odpowiedzi w 6 s' : e.message);
  }
  return out;
}

async function checkSheet() {
  const out = { configured: Boolean(SHEET_WEBHOOK_URL), reachable: false };
  if (!SHEET_WEBHOOK_URL) return out;
  try {
    // GET trafia w doGet, ktore tylko sie przedstawia - nie dopisuje wiersza.
    const r = await ping((signal) => fetch(SHEET_WEBHOOK_URL, { signal }), 8000);
    const txt = await r.text().catch(() => '');
    out.reachable = r.ok && txt.includes('Ampere Rush');
    if (!out.reachable) {
      out.error = r.ok
        ? 'adres odpowiada, ale to nie jest nasz skrypt (sprawdz, czy wklejony URL to wdrozenie z apps-script.gs)'
        : 'HTTP ' + r.status + ' (czy dostep ustawiony na "Wszyscy"?)';
    }
  } catch (e) {
    out.error = String(e.name === 'AbortError' ? 'brak odpowiedzi w 8 s' : e.message);
  }
  return out;
}

// /api/status?test=sheet wysyla jeden oznaczony wiersz i pokazuje, co
// arkusz odpowiedzial. Sluzy do rozbrojenia sytuacji "wyglada dobrze, a
// wierszy brak" - inaczej trzeba by zgadywac.
async function writeTestRow() {
  if (!SHEET_WEBHOOK_URL) return { error: 'brak SHEET_WEBHOOK_URL' };
  const { toSheetDebug } = require('./claim.js');
  try {
    return await toSheetDebug({
      nick: 'TEST', email: '', consent: false, score: 0, distance: 0,
      pickups: 0, level: 1, code: 'TEST', playedAt: new Date().toISOString(),
      event: (process.env.EVENT_TAG || 'KNM 2026 Katowice') + ' (wiersz testowy)'
    });
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function handler(req, res) {
  const out = {
    // Nazwy zmiennych nie sa tajne, a bez nich nie da sie zdalnie ustalic,
    // czy Vercel wstrzyknal to, co trzeba.
    kv: { configured: kvReady, reachable: false, usingEnv: kvEnvNames },
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

  const [pd, sh] = await Promise.all([checkPipedrive(), checkSheet()]);
  out.pipedrive = pd;
  out.sheet = sh;

  if (req.query && req.query.test === 'sheet') {
    out.testowyWiersz = await writeTestRow();
  }

  out.ready = out.kv.reachable;
  out.leady = pd.reachable && sh.reachable;
  out.hint = !out.ready
    ? 'Bez dzialajacego KV gra chodzi w trybie lokalnym: bez kodow QR i bez wspolnej tablicy.'
    : out.leady
      ? 'Wszystko podpiete: kody QR, wspolna tablica, Pipedrive i arkusz.'
      : 'Gra i tablica dzialaja. Leady: sprawdz pola pipedrive/sheet powyzej.';
  return json(res, 200, out);
}

module.exports = handler;
