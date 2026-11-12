#!/usr/bin/env node
// Automatic project images: every MAREO project without a picture gets one
// from what is attached to it, best source first:
//   1. its hub, when the hub is a public site (og:image, else a screenshot)
//   2. a Miro board in its links (the biggest image on the board)
//   3. another public site in its links (og:image, else a screenshot)
//   4. its folder in G:\My Drive\WORK (an image named key/cover/poster…, else the newest big one)
// The result goes to projectMeta/{id}.thumb with thumbAuto:{source,key,label}.
// Pictures set by hand (in the app, or by /mareo-sync) are never touched; an
// automatic one is replaced only when a better-ranked source shows up.
//
// Runs inside tools/mareo-work.mjs (Task Scheduler "MAREO sesiones"), so there
// is no job of its own. Firestore cost per run: the project list mareo-work
// already reads, plus one query for projectMeta changed since the last run.
//
//   node tools/mareo-thumbs.mjs [--dry-run] [--max 50]   standalone pass

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PROJECT = 'mareo-app-8de88';
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TOOLS_DIR = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'mareo-tools') : path.join(os.homedir(), '.mareo-tools');
const STATE_FILE = path.join(TOOLS_DIR, 'thumbs.json');
const WORK_DIR = 'G:\\My Drive\\WORK';
const MAX_THUMB_BYTES = 90 * 1024;
const RETRY_MS = 3 * 24 * 3600 * 1000; // a source that gave nothing is retried after 3 days
const FULL_MS = 24 * 3600 * 1000; // full projectMeta re-read once a day
const RANK = { hub: 1, miro: 2, web: 3, folder: 4 };
const LABEL = { hub: 'el hub', miro: 'Miro', web: 'el sitio', folder: 'la carpeta' };
// Sites that need a login (a screenshot would only show the sign-in page)
const PRIVATE_HOSTS = /(^|\.)(claude\.ai|google\.com|miro\.com|figma\.com|notion\.so|notion\.site|dropbox\.com|wetransfer\.com|frame\.io|slack\.com|canva\.com|airtable\.com)$/i;
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const KEY_NAME = /(^|[^a-z])(key|keyart|cover|portada|poster|afiche|hero|thumb|thumbnail|main|principal|logo)([^a-z]|$)/i;
const JUNK_NAME = /screenshot|captura|whatsapp|^img[-_]?\d|^dsc|^photo[-_]|^image\d*\.|^untitled|^sin titulo|^copy of/i;
const SKIP_DIR = /^(\.|_old|old|backup|bk|node_modules|library|temp|tmp|cache|export|exports|render cache)/i;
const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const flat = (s) => norm(s).replace(/[^a-z0-9]/g, '');

// ---- Firestore -----------------------------------------------------------------
function fromValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]));
  return null;
}
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}
// What the picker needs from a meta doc (the thumb itself is not kept)
const metaSummary = (f) => {
  const m = Object.fromEntries(Object.entries(f || {}).filter(([k]) => k !== 'thumb').map(([k, v]) => [k, fromValue(v)]));
  return { hub: m.hub?.url || null, hasThumb: !!(f?.thumb && f.thumb.stringValue), locked: !!m.locked?.thumb, auto: m.thumbAuto || null, updatedAt: m.updatedAt || 0 };
};

async function readMetas(token, state) {
  const h = { Authorization: `Bearer ${token}` };
  const now = Date.now();
  if (!state.fullAt || now - state.fullAt > FULL_MS) {
    const metas = {};
    let pageToken = '';
    do {
      const q = new URLSearchParams({ pageSize: '300' });
      if (pageToken) q.set('pageToken', pageToken);
      const j = await (await fetch(`${DB}/projectMeta?${q}`, { headers: h })).json();
      for (const d of j.documents || []) metas[d.name.split('/').pop()] = metaSummary(d.fields);
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    state.metas = metas;
    state.fullAt = now;
  } else {
    const since = Math.max(0, (state.metaSince || 0) - 60000);
    const res = await fetch(`${DB}:runQuery`, {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'projectMeta' }], where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { integerValue: String(since) } } } } }),
    });
    for (const r of await res.json()) if (r.document) state.metas[r.document.name.split('/').pop()] = metaSummary(r.document.fields);
  }
  state.metaSince = Math.max(state.metaSince || 0, ...Object.values(state.metas).map(m => m.updatedAt || 0));
}

async function writeThumb(token, projectId, thumb, auto) {
  const update = { thumb, thumbAuto: auto, updatedAt: Date.now() };
  const mask = Object.keys(update).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(`${DB}/projectMeta/${encodeURIComponent(projectId)}?${mask}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(update).map(([k, v]) => [k, toValue(v)])) }),
  });
  if (!res.ok) throw new Error(`write ${projectId} → ${res.status} ${await res.text()}`);
  return update.updatedAt;
}

// ---- Image sources ---------------------------------------------------------------
async function fetchBuf(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '', url: res.url };
}

async function fromWeb(url) {
  // The page's own preview image first
  try {
    const { buf, type, url: finalUrl } = await fetchBuf(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MAREO thumbnails)' } });
    if (type.startsWith('image/')) return buf;
    const html = buf.toString('utf8', 0, Math.min(buf.length, 1_000_000));
    const tag = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image(?::src)?)["'][^>]*>/i)?.[0]
      || html.match(/<meta[^>]+content=["'][^"']+["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i)?.[0];
    const src = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (src) {
      const img = await fetchBuf(new URL(src.replace(/&amp;/g, '&'), finalUrl).href);
      if (img.type.startsWith('image/') && img.buf.length > 5000) return img.buf;
    }
  } catch { /* fall through to a screenshot */ }
  // Else a screenshot of the page, in a headless browser with its own profile
  if (!BROWSER) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mareo-shot-'));
  const out = path.join(dir, 'shot.png');
  try {
    spawnSync(BROWSER, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--window-size=1280,800', '--virtual-time-budget=8000', `--screenshot=${out}`, url], { timeout: 60000, windowsHide: true });
    return fs.existsSync(out) && fs.statSync(out).size > 8000 ? fs.readFileSync(out) : null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
}

async function fromMiro(boardId) {
  const token = process.env.MIRO_ACCESS_TOKEN;
  if (!token) return null;
  const h = { Authorization: `Bearer ${token}` };
  const j = await (await fetch(`https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}/items?type=image&limit=50`, { headers: h, signal: AbortSignal.timeout(20000) })).json();
  // The biggest picture on the board is usually the key one
  const best = (j.data || []).sort((a, b) => (b.geometry?.width || 0) * (b.geometry?.height || 0) - (a.geometry?.width || 0) * (a.geometry?.height || 0))[0];
  if (!best?.data?.imageUrl) return null;
  const link = await (await fetch(best.data.imageUrl.replace(/format=\w+/, 'format=preview'), { headers: h })).json();
  return link.url ? (await fetchBuf(link.url)).buf : null;
}

// The project's folder in WORK: same name, or one name starting with the other
function folderFor(name) {
  const n = flat(name);
  if (n.length < 3) return null;
  let dirs = [];
  try { dirs = fs.readdirSync(WORK_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return null; }
  const hit = dirs.find(d => flat(d) === n)
    || dirs.find(d => { const f = flat(d); return f.length >= 4 && n.length >= 4 && (f.startsWith(n) || n.startsWith(f)); });
  return hit ? path.join(WORK_DIR, hit) : null;
}

function pickFolderImage(dir) {
  const found = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length > 400) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3 && !SKIP_DIR.test(e.name)) walk(p, depth + 1); continue; }
      if (!IMG_EXT.test(e.name) || JUNK_NAME.test(e.name)) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size < 150 * 1024 || st.size > 30 * 1024 * 1024) continue;
      found.push({ p, key: KEY_NAME.test(e.name), depth, mtime: st.mtimeMs });
    }
  };
  walk(dir, 0);
  found.sort((a, b) => (b.key - a.key) || (a.depth - b.depth) || (b.mtime - a.mtime));
  return found[0]?.p || null;
}

// Ranked sources available for a project right now
function sourcesFor(project, meta) {
  const out = [];
  const pub = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !PRIVATE_HOSTS.test(x.hostname); } catch { return false; } };
  if (meta?.hub && pub(meta.hub)) out.push({ source: 'hub', key: `hub:${meta.hub}`, url: meta.hub });
  for (const l of project.links || []) {
    const u = l.url || '';
    const miro = u.match(/miro\.com\/app\/board\/([^/?#]+)/);
    if (miro) out.push({ source: 'miro', key: `miro:${decodeURIComponent(miro[1])}`, board: decodeURIComponent(miro[1]) });
    else if (pub(u)) out.push({ source: 'web', key: `web:${u}`, url: u });
  }
  const dir = folderFor(project.name);
  if (dir) out.push({ source: 'folder', key: `folder:${dir}`, dir });
  return out.sort((a, b) => RANK[a.source] - RANK[b.source]);
}

let sharp;
async function toThumb(input) {
  if (!sharp) sharp = createRequire(path.join(TOOLS_DIR, 'package.json'))('sharp');
  let width = 640;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const quality of [80, 68, 56]) {
      const buf = await sharp(input).rotate().resize({ width, height: Math.round(width * 0.75), fit: 'cover', position: 'attention', withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (buf.length <= MAX_THUMB_BYTES) return `data:image/webp;base64,${buf.toString('base64')}`;
    }
    width = Math.round(width * 0.8);
  }
  return null;
}

async function imageFrom(src) {
  if (src.source === 'miro') return fromMiro(src.board);
  if (src.source === 'folder') { const p = pickFolderImage(src.dir); return p ? fs.readFileSync(p) : null; }
  return fromWeb(src.url);
}

// ---- Pass ----------------------------------------------------------------------------
// projects: [{ id, name, links:[{url}] }] (mareo-work already has them)
export async function syncThumbs({ token, projects, dryRun = false, max = 2, log = console.log }) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { }
  state.tried ||= {};
  await readMetas(token, state);
  const now = Date.now();
  let done = 0;
  for (const p of projects) {
    if (done >= max) break;
    const meta = state.metas[p.id] || {};
    if (meta.locked || (meta.hasThumb && !meta.auto)) continue; // chosen by hand
    const current = meta.hasThumb && meta.auto ? meta.auto : null;
    const all = sourcesFor(p, meta);
    const stillThere = current && all.some(s => s.key === current.key);
    const cands = all.filter(s => !(now - (state.tried[s.key] || 0) < RETRY_MS) && (!stillThere || RANK[s.source] < RANK[current.source]));
    for (const src of cands) {
      done++;
      let thumb = null;
      try { const buf = await imageFrom(src); if (buf) thumb = await toThumb(buf); } catch (err) { log(`  ${p.name}: ${src.source} falló (${err.message})`); }
      if (!thumb) { state.tried[src.key] = now; continue; }
      const auto = { source: src.source, label: LABEL[src.source], key: src.key, at: now };
      if (dryRun) { if (process.env.THUMBS_OUT) fs.writeFileSync(path.join(process.env.THUMBS_OUT, p.id + '.webp'), Buffer.from(thumb.split(',')[1], 'base64')); log(`${p.name}: [dry-run] imagen de ${src.source} (${Math.round(thumb.length * 0.75 / 1024)}KB)`); break; }
      const at = await writeThumb(token, p.id, thumb, auto);
      state.metas[p.id] = { ...meta, hasThumb: true, auto, updatedAt: at };
      log(`${p.name}: imagen de ${src.source} (${Math.round(thumb.length * 0.75 / 1024)}KB)`);
      break;
    }
  }
  if (!dryRun) fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  else fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, tried: {} }));
}

// ---- Standalone ------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
  const { tokens } = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
  const tj = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  })).json();
  const token = tj.access_token;
  const j = await (await fetch(`${DB}/projects?pageSize=300&mask.fieldPaths=name&mask.fieldPaths=links`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const projects = (j.documents || []).map(d => ({ id: d.name.split('/').pop(), name: fromValue(d.fields?.name) || '', links: fromValue(d.fields?.links) || [] }));
  const i = args.indexOf('--max');
  await syncThumbs({ token, projects, dryRun: args.includes('--dry-run'), max: i >= 0 ? Number(args[i + 1]) : 50 });
}
