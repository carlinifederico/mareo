#!/usr/bin/env node
// MAREO hub sync: writes production-hub links and thumbnails into
// projectMeta/{projectId} (Firestore), so the v2 Studio shows them without
// configuring each project by hand. Driven by the /mareo-sync Claude Code
// skill (.claude/skills/mareo-sync/SKILL.md), which finds the hubs.
//
// Auth: reuses the Firebase CLI login (`npx firebase-tools login`) — the
// refresh token in ~/.config/configstore/firebase-tools.json — and talks to
// the Firestore REST API as that Google account (project owner), so no
// service-account key is needed and security rules don't apply.
//
//   node tools/mareo-sync.mjs --list                 projects + current hub/thumb
//   node tools/mareo-sync.mjs --apply plan.json      write hubs/thumbnails
//   node tools/mareo-sync.mjs --apply plan.json --dry-run
//
// plan.json: [{ "projectId": "proj-…", "hubUrl": "https://claude.ai/artifact/…",
//               "hubTitle": "…", "sections": [{"label","url"}], "imagePath": "G:/…/key.jpg",
//               "aliases": ["Opi"], "stage": "Preproducción" }]
// Fields the user edited in the app (meta.locked.hub / .thumb / .icon) are
// never overwritten.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const PROJECT = 'mareo-app-8de88';
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
// Public OAuth client of firebase-tools (same values ship in its source)
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const MAX_THUMB_BYTES = 90 * 1024;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function accessToken() {
  const file = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(file)) throw new Error('No Firebase CLI login. Run: npx firebase-tools login');
  const { tokens, user } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!tokens?.refresh_token) throw new Error('No refresh token. Run: npx firebase-tools login');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(j));
  return { token: j.access_token, email: user?.email };
}

let TOKEN;
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  const j = await res.json();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(j.error || j)}`);
  return j;
}

// ---- Firestore value <-> JS ------------------------------------------------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

function fromValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, fromValue(v)]));
}

async function listCollection(name) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ pageSize: '300' });
    if (pageToken) q.set('pageToken', pageToken);
    const j = await api('GET', `${DB}/${name}?${q}`);
    for (const d of j?.documents || []) out.push({ id: d.name.split('/').pop(), ...fromFields(d.fields) });
    pageToken = j?.nextPageToken || '';
  } while (pageToken);
  return out;
}

// ---- Thumbnails -------------------------------------------------------------
async function makeThumb(imagePath) {
  // npm can't install into Google Drive folders, so sharp lives in a local
  // folder outside the repo: %LOCALAPPDATA%\mareo-tools (or ~/.mareo-tools).
  const toolsDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'mareo-tools')
    : path.join(os.homedir(), '.mareo-tools');
  let sharp;
  try {
    sharp = createRequire(path.join(toolsDir, 'package.json'))('sharp');
  } catch {
    throw new Error(`sharp missing. Run: mkdir "${toolsDir}" && cd "${toolsDir}" && npm init -y && npm install sharp@0.33.5`);
  }
  let width = 640;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const quality of [82, 70, 58]) {
      const buf = await sharp(imagePath).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (buf.length <= MAX_THUMB_BYTES) return `data:image/webp;base64,${buf.toString('base64')}`;
    }
    width = Math.round(width * 0.8);
  }
  throw new Error(`Could not get ${imagePath} under ${MAX_THUMB_BYTES} bytes`);
}

// ---- Commands -----------------------------------------------------------------
async function list() {
  const [projects, metas] = await Promise.all([listCollection('projects'), listCollection('projectMeta')]);
  const metaById = new Map(metas.map(m => [m.id, m]));
  const rows = projects.map(p => {
    const m = metaById.get(p.id) || {};
    return {
      projectId: p.id,
      name: p.name,
      owner: p.ownerId,
      members: (p.memberUids || []).length,
      hub: m.hub?.url || null,
      thumb: m.thumb ? `${Math.round(m.thumb.length * 0.75 / 1024)}KB` : null,
      aliases: m.aliases || [],
      locked: Object.keys(m.locked || {}).filter(k => m.locked[k]),
      links: (p.links || []).map(l => l.url).filter(Boolean),
    };
  });
  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  console.log(JSON.stringify(rows, null, 2));
}

async function apply(planFile, dryRun) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const now = Date.now();
  for (const entry of plan) {
    const id = entry.projectId;
    if (!id) { console.warn('skip: entry without projectId', entry); continue; }
    const doc = await api('GET', `${DB}/projectMeta/${encodeURIComponent(id)}`);
    const cur = doc ? fromFields(doc.fields) : {};
    const locked = cur.locked || {};
    const update = {};
    const skipped = [];

    if (entry.hubUrl) {
      if (locked.hub) skipped.push('hub (editado a mano)');
      else update.hub = {
        url: entry.hubUrl,
        title: entry.hubTitle || cur.hub?.title || '',
        source: 'mareo-sync',
        syncedAt: now,
        sections: entry.sections || cur.hub?.sections || [],
      };
    }
    if (entry.imagePath) {
      if (locked.thumb) skipped.push('thumb (editado a mano)');
      else if (!fs.existsSync(entry.imagePath)) skipped.push(`thumb (no existe ${entry.imagePath})`);
      else update.thumb = dryRun ? '(dry-run)' : await makeThumb(entry.imagePath);
    }
    if (entry.aliases) update.aliases = entry.aliases;
    if (entry.stage) update.stage = entry.stage;
    if (entry.icon && !locked.icon) update.icon = entry.icon;

    const keys = Object.keys(update);
    if (!keys.length) { console.log(`${id}: nada que actualizar${skipped.length ? ' · salteado: ' + skipped.join(', ') : ''}`); continue; }
    update.updatedAt = now;
    const summary = keys.filter(k => k !== 'updatedAt').map(k => k === 'thumb' ? `thumb ${typeof update.thumb === 'string' ? Math.round(update.thumb.length * 0.75 / 1024) + 'KB' : ''}` : k).join(', ');
    if (dryRun) { console.log(`${id}: [dry-run] ${summary}${skipped.length ? ' · salteado: ' + skipped.join(', ') : ''}`); continue; }
    const mask = Object.keys(update).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    await api('PATCH', `${DB}/projectMeta/${encodeURIComponent(id)}?${mask}`, {
      fields: Object.fromEntries(Object.entries(update).map(([k, v]) => [k, toValue(v)])),
    });
    console.log(`${id}: ${summary}${skipped.length ? ' · salteado: ' + skipped.join(', ') : ''}`);
  }
}

const main = async () => {
  const { token, email } = await accessToken();
  TOKEN = token;
  console.error(`(Firestore ${PROJECT} como ${email})`);
  if (flag('--list')) return list();
  const planFile = opt('--apply');
  if (planFile) return apply(planFile, flag('--dry-run'));
  console.log('Uso: node tools/mareo-sync.mjs --list | --apply plan.json [--dry-run]');
};

main().catch(err => { console.error(err.message || err); process.exit(1); });
