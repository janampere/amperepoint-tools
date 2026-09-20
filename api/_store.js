// Wspolne klocki dla funkcji API: magazyn (Vercel KV przez REST) i walidacja.
// Bez zaleznosci npm - Upstash wystawia REST, wiec wystarczy fetch.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const BOARD_KEY = 'ampererush:board';
const RUN_TTL = 60 * 60 * 24;   // kod przejazdu wazny dobe

const kvReady = Boolean(KV_URL && KV_TOKEN);

async function kv(command) {
  if (!kvReady) throw new Error('KV_NOT_CONFIGURED');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!res.ok) throw new Error('KV_HTTP_' + res.status);
  const data = await res.json();
  if (data.error) throw new Error('KV_' + data.error);
  return data.result;
}

// Bez I, O, 0 i 1 - kod przepisuje z ekranu czlowiek, ktory sie spieszy.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(len = 6) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

const runKey = (code) => 'ampererush:run:' + code;

async function saveRun(code, run) {
  await kv(['SET', runKey(code), JSON.stringify(run), 'EX', String(RUN_TTL)]);
}

async function loadRun(code) {
  const raw = await kv(['GET', runKey(code)]);
  return raw ? JSON.parse(raw) : null;
}

async function addToBoard(entry) {
  await kv(['ZADD', BOARD_KEY, String(entry.score), JSON.stringify(entry)]);
}

async function topBoard(limit = 10) {
  const rows = await kv(['ZRANGE', BOARD_KEY, '0', String(limit - 1), 'REV']);
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean);
}

// --------------------------------------------------------------- walidacja
function cleanNick(v) {
  return String(v || '').replace(/[^\p{L}\p{N} .\-_]/gu, '').trim().slice(0, 16);
}

function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase().slice(0, 120);
  if (!e) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;   // null = podany, ale bledny
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}

module.exports = {
  kvReady, kv, makeCode, runKey, saveRun, loadRun, addToBoard, topBoard,
  cleanNick, cleanEmail, readBody, json
};
