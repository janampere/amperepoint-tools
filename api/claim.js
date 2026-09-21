// Telefon odbiera przejazd: nick na tablice, mail (dobrowolnie) do CRM-u.
// Zasada: wpis na tablice nie moze zalezec od tego, czy Pipedrive albo
// arkusz odpowiedzial. Na targach tablica jest wazniejsza niz integracja.

const {
  kvReady, loadRun, saveRun, addToBoard, cleanNick, cleanEmail, json, readBody
} = require('./_store.js');

const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_TOKEN;
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL;
const EVENT_TAG = process.env.EVENT_TAG || 'KNM 2026 Katowice';
// Apps Script po wdrozeniu budzi sie wolno (zimny start + otwarcie arkusza),
// wiec 8 s bylo za malo i konczylo sie zerwaniem polaczenia mimo udanego
// zapisu. Przy nagrzanym skrypcie zapytanie wraca w 1-3 s.
const SHEET_TIMEOUT = 15000;

async function withTimeout(promise, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await promise(ctl.signal); } finally { clearTimeout(t); }
}

async function toPipedrive(entry) {
  if (!PIPEDRIVE_TOKEN) return 'skipped';
  const base = 'https://api.pipedrive.com/v1';
  const q = 'api_token=' + encodeURIComponent(PIPEDRIVE_TOKEN);

  const call = (path, body, method = 'POST') => withTimeout((signal) =>
    fetch(base + path + (path.includes('?') ? '&' : '?') + q, {
      method,
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then((r) => r.json()), 6000);

  // Ten sam czlowiek moze zagrac kilka razy - nie mnozymy kontaktow.
  let personId = null;
  const found = await call('/persons/search?term=' + encodeURIComponent(entry.email) + '&fields=email&exact_match=true', null, 'GET');
  if (found && found.data && found.data.items && found.data.items.length) {
    personId = found.data.items[0].item.id;
  } else {
    const created = await call('/persons', { name: entry.nick || entry.email, email: [entry.email] });
    if (!created || !created.data) throw new Error('person_failed');
    personId = created.data.id;
  }

  const lead = await call('/leads', {
    title: EVENT_TAG + ' – ' + (entry.nick || entry.email),
    person_id: personId
  });
  const leadId = lead && lead.data ? lead.data.id : null;

  await call('/notes', {
    content: 'Ampere Rush (' + EVENT_TAG + ')<br>Nick: ' + entry.nick +
             '<br>Wynik: ' + entry.score + '<br>Dystans: ' + entry.distance + ' m' +
             '<br>Poziom: ' + entry.level +
             '<br>Ładowarki: ' + entry.pickups,
    person_id: personId,
    lead_id: leadId || undefined
  });
  return 'ok';
}

// Apps Script na POST do /exec odpowiada przekierowaniem pod adres, ktory
// serwuje juz tylko wynik wykonania - sam doPost zdazyl sie wykonac przy
// pierwszym zadaniu. Dlatego przekierowanie po prostu sledzimy (ponawianie
// POST-a konczy sie tam bledem 405), a o powodzeniu decyduje potwierdzenie
// "wrote" w odpowiedzi, nie sam kod HTTP.
async function postToSheet(url, entry, signal) {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  const text = await res.text().catch(() => '');
  return { status: res.status, wrote: /"wrote"\s*:\s*true/.test(text), text };
}

async function toSheet(entry) {
  if (!SHEET_WEBHOOK_URL) return 'skipped';
  let out;
  try {
    out = await withTimeout(
      (signal) => postToSheet(SHEET_WEBHOOK_URL, entry, signal), SHEET_TIMEOUT);
  } catch (e) {
    // Zerwanie po czasie nie znaczy, ze zapis sie nie udal - zadanie
    // doszlo, tylko odpowiedz nie wrocila na czas.
    return e.name === 'AbortError' ? 'brak odpowiedzi w ' + (SHEET_TIMEOUT / 1000) + ' s' : 'failed';
  }
  if (out.wrote) return 'ok';
  if (out.status >= 200 && out.status < 300) return 'brak potwierdzenia zapisu';
  return 'HTTP ' + out.status;
}

async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!kvReady) return json(res, 503, { error: 'not_configured' });

  const b = readBody(req);
  const code = String(b.code || '').trim().toUpperCase().slice(0, 12);
  if (!code) return json(res, 400, { error: 'no_code' });

  const nick = cleanNick(b.nick);
  if (!nick) return json(res, 400, { error: 'no_nick' });

  const email = cleanEmail(b.email);
  if (email === null) return json(res, 400, { error: 'bad_email' });
  const consent = Boolean(b.consent);
  if (email && !consent) return json(res, 400, { error: 'no_consent' });

  let run;
  try { run = await loadRun(code); } catch (e) { return json(res, 503, { error: 'store_unavailable' }); }
  if (!run) return json(res, 404, { error: 'unknown_code' });
  if (run.claimed) return json(res, 409, { error: 'already_claimed', nick: run.nick });

  const entry = {
    code, nick,
    score: run.score, distance: run.distance, pickups: run.pickups,
    level: run.level || 1, playedAt: run.playedAt, claimedAt: new Date().toISOString()
  };

  // Najpierw tablica - to jest to, po co gracz stoi przy ekranie.
  try { await addToBoard(entry); } catch (e) { return json(res, 503, { error: 'store_unavailable' }); }
  await saveRun(code, Object.assign({}, run, { claimed: true, nick, hasEmail: Boolean(email) }));

  // Integracje sa best-effort i nie blokuja odpowiedzi dla gracza.
  // Arkusz dostaje kazdy zapisany przejazd, bo sluzy tez za liste "kto
  // zagral". Pipedrive tylko tych z mailem - kontakt bez adresu jest pusty.
  const delivery = { pipedrive: 'skipped', sheet: 'skipped' };
  const row = Object.assign({}, entry, { email: email || '', consent, event: EVENT_TAG });
  const jobs = [toSheet(row)];
  if (email) jobs.push(toPipedrive(row));
  const [sh, pd] = await Promise.allSettled(jobs);
  delivery.sheet = sh.status === 'fulfilled' ? sh.value : 'failed';
  if (pd) delivery.pipedrive = pd.status === 'fulfilled' ? pd.value : 'failed';

  return json(res, 200, { ok: true, nick, score: entry.score, delivery });
}

module.exports = handler;
// Uzywane przez /api/status?test=sheet - ta sama sciezka co na produkcji,
// zeby test sprawdzal to, co naprawde leci przy zapisie wyniku.
module.exports.toSheetDebug = async (entry) => {
  if (!SHEET_WEBHOOK_URL) return { error: 'brak SHEET_WEBHOOK_URL' };
  const out = await withTimeout(
    (signal) => postToSheet(SHEET_WEBHOOK_URL, entry, signal), SHEET_TIMEOUT);
  return { status: out.status, wrote: out.wrote, odpowiedz: String(out.text).slice(0, 400) };
};
