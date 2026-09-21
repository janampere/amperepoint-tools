// Telefon odbiera przejazd: nick na tablice, mail (dobrowolnie) do CRM-u.
// Zasada: wpis na tablice nie moze zalezec od tego, czy Pipedrive albo
// arkusz odpowiedzial. Na targach tablica jest wazniejsza niz integracja.

const {
  kvReady, loadRun, saveRun, addToBoard, cleanNick, cleanEmail, json, readBody
} = require('./_store.js');

const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_TOKEN;
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL;
const EVENT_TAG = process.env.EVENT_TAG || 'KNM 2026 Katowice';

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

async function toSheet(entry) {
  if (!SHEET_WEBHOOK_URL) return 'skipped';
  await withTimeout((signal) => fetch(SHEET_WEBHOOK_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  }), 6000);
  return 'ok';
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
