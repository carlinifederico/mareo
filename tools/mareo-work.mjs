#!/usr/bin/env node
// MAREO work sync: reads the local Claude Code sessions (~/.claude/projects/*/*.jsonl)
// and writes one workItems/{sessionId} doc per session, so the v2 "Revisar" tab
// shows what each session is doing, its task list with progress, and what is
// waiting for the user's review.
//
// Per session it keeps: title, project (from the session's folder), the task
// list as the desktop app shows it (update_plan), the last wrap-up recap and
// question, the last prompt, and a status:
//   running  — transcript written in the last few minutes
//   decide   — finished a turn with a question for the user
//   review   — finished a turn, nothing pending but checking the result
//   paused   — has unfinished steps and nobody is working on it
// Scheduled-task runs are flagged `auto` so the tab can fold them away.
//
//   node tools/mareo-work.mjs                 last 7 days, write
//   node tools/mareo-work.mjs --days 3 --dry-run [--json]
//   node tools/mareo-work.mjs --watch         rescan every 2 minutes
//   --no-names                                 skip naming new sessions with Claude
//
// Auth: same as mareo-sync.mjs (Firebase CLI login, Firestore REST as owner).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const PROJECT = 'mareo-app-8de88';
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
// Public OAuth client of firebase-tools (same values ship in its source)
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
// Federico's MAREO uid (ownerId of his projects); the rules let only him read these docs
const OWNER_UID = '7kJgWTraHBdsVXzzn9X8owXszS92';
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'projects');
const RUNNING_MS = 3 * 60 * 1000;
const MAX_LINE = 400 * 1024; // skip giant tool results; titles and plans are small

// Session folder → MAREO project. Matched against the session's cwd, accent-insensitive.
// Folders not listed here are matched to a MAREO project with the same name.
const FOLDER_PROJECTS = [
  [/banana airways|avioncito/, 'proj-eed460ef-50cd-4605-a4ab-aad252ccadda', 'BANANA AIRWAYS'],
  [/the silence between|[\\/]opi\b/, 'proj-silence', 'OPI AND THE QUIET ONES'],
  [/[\\/]mareo\b/, null, 'MAREO'],
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function accessToken() {
  const file = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(file)) throw new Error('No Firebase CLI login. Run: npx firebase-tools login');
  const { tokens } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(j));
  return j.access_token;
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---- Transcript → work item --------------------------------------------------
// Replays the task list the way the desktop app does: `items` replaces it,
// `advance` completes the step in progress and starts the next, `done`/`start`
// jump around, and wrap_up checks everything off.
function applyPlan(plan, input) {
  if (Array.isArray(input.items)) return input.items.map(i => ({ label: clip(i.content, 120), status: i.status || 'pending' }));
  const steps = plan.map(s => ({ ...s }));
  if (input.advance) {
    const cur = steps.findIndex(s => s.status === 'in_progress');
    if (cur >= 0) steps[cur].status = 'completed';
    const next = steps.findIndex(s => s.status === 'pending');
    if (next >= 0) steps[next].status = 'in_progress';
  }
  for (const n of input.done || []) if (steps[n - 1]) steps[n - 1].status = 'completed';
  if (input.start && steps[input.start - 1]) {
    steps.forEach(s => { if (s.status === 'in_progress') s.status = 'pending'; });
    steps[input.start - 1].status = 'in_progress';
  }
  return steps;
}

async function readSession(file) {
  const s = { entrypoint: '', title: '', aiTitle: '', firstPrompt: '', lastPrompt: '', cwd: '', startedAt: null, steps: [], recap: '', ask: '', lastPlanAt: 0, lastWrapAt: 0, userTurns: 0 };
  let seq = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > MAX_LINE) continue;
    const hit = line.includes('"custom-title"') || line.includes('"ai-title"') || line.includes('"type":"user"')
      || line.includes('mcp__ccd_turn__update_plan') || line.includes('mcp__ccd_turn__wrap_up');
    if (!hit) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    seq++;
    if (!s.cwd && j.cwd) s.cwd = j.cwd;
    if (!s.entrypoint && j.entrypoint) s.entrypoint = j.entrypoint;
    if (!s.startedAt && j.timestamp) s.startedAt = Date.parse(j.timestamp);
    if (j.type === 'custom-title') s.title = j.customTitle || s.title;
    else if (j.type === 'ai-title') s.aiTitle = j.aiTitle || j.title || s.aiTitle;
    else if (j.type === 'user' && typeof j.message?.content === 'string' && !j.isMeta) {
      const text = j.message.content.trim();
      if (!text || text.startsWith('<local-command') || text.startsWith('<command-')) continue;
      if (!s.firstPrompt) s.firstPrompt = text;
      if (!text.startsWith('<')) { s.lastPrompt = text; s.userTurns++; }
    } else if (j.type === 'assistant') {
      for (const c of j.message?.content || []) {
        if (c.type !== 'tool_use') continue;
        if (c.name === 'mcp__ccd_turn__update_plan') { s.steps = applyPlan(s.steps, c.input || {}); s.lastPlanAt = seq; }
        if (c.name === 'mcp__ccd_turn__wrap_up') {
          s.steps = s.steps.map(x => ({ ...x, status: 'completed' }));
          s.recap = clip(c.input?.recap, 400);
          s.ask = clip(c.input?.ask, 160);
          s.lastWrapAt = seq;
        }
      }
    }
  }
  return s;
}

function projectFor(cwd, projects) {
  const n = norm(cwd);
  for (const [re, id, name] of FOLDER_PROJECTS) if (re.test(n)) return { projectId: id, projectName: name };
  const folder = path.basename(cwd || '') || 'Otros';
  const p = projects.find(x => norm(x.name) === norm(folder));
  return p ? { projectId: p.id, projectName: p.name } : { projectId: null, projectName: folder.toUpperCase() };
}

function statusOf(s, mtime) {
  if (Date.now() - mtime < RUNNING_MS) return 'running';
  if (s.lastWrapAt && s.lastWrapAt > s.lastPlanAt) return s.ask ? 'decide' : 'review';
  if (s.steps.some(x => x.status !== 'completed')) return 'paused';
  return 'review';
}

async function scan(days) {
  const since = Date.now() - days * 86400000;
  const out = [];
  for (const dir of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = path.join(SESSIONS_DIR, dir.name);
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(full, f);
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs < since) continue;
      out.push({ file, sessionId: f.replace(/\.jsonl$/, ''), mtime: mtimeMs });
    }
  }
  return out;
}

async function listProjects(token) {
  const res = await fetch(`${DB}/projects?pageSize=300&mask.fieldPaths=name`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json();
  return (j.documents || []).map(d => ({ id: d.name.split('/').pop(), name: d.fields?.name?.stringValue || '' }));
}

// ---- Process names -------------------------------------------------------------
// Each session gets a short name for what it is working on ("Encuesta",
// "Spaceship Luna"), written by Claude (haiku, no tools, not saved as a
// session) from its task list and last request. Names are cached per session
// and content, so the CLI only runs for sessions that are new or changed course.
const TOOLS_DIR = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'mareo-tools') : path.join(os.homedir(), '.mareo-tools');
const NAMES_FILE = path.join(TOOLS_DIR, 'process-names.json');
const CLAUDE_BIN = [path.join(os.homedir(), '.local', 'bin', 'claude.exe'), path.join(os.homedir(), '.local', 'bin', 'claude')].find(p => fs.existsSync(p)) || 'claude';
const MAX_NAMES_PER_RUN = 25;

function nameKey(sessionId, s) {
  const basis = s.steps.map(x => x.label).join('|') || s.lastPrompt || s.title;
  let h = 0;
  for (const ch of basis) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `${sessionId}:${(h >>> 0).toString(36)}`;
}

function readNames() {
  try { return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); } catch { return {}; }
}

function nameProcesses(pending, names) {
  if (!pending.length) return;
  const known = {};
  for (const [k, v] of Object.entries(names)) if (v.project) (known[v.project] ||= new Set()).add(v.name);
  const prompt = [
    'Ponele a cada sesión de trabajo el nombre corto del proceso o desafío en el que está, en español, de 1 a 3 palabras',
    '(ejemplos: "Encuesta", "Spaceship Luna", "Pestaña Revisar", "Build para Jorge"). Sin el nombre del proyecto.',
    'Si es el mismo proceso que un nombre ya usado en ese proyecto, repetí ese nombre exacto.',
    'Respondé SOLO un objeto JSON {"<key>": "<nombre>"} sin texto extra.',
    '',
    'Nombres ya usados por proyecto: ' + JSON.stringify(Object.fromEntries(Object.entries(known).map(([p, s]) => [p, [...s]]))),
    '',
    'Sesiones:',
    JSON.stringify(pending.map(p => ({ key: p.key, proyecto: p.project, titulo: p.title, pedido: clip(p.lastPrompt, 300), pasos: p.steps.map(x => x.label) }))),
  ].join('\n');
  const r = spawnSync(CLAUDE_BIN, ['-p', '--model', 'haiku', '--no-session-persistence', '--tools', ''], {
    input: prompt, cwd: TOOLS_DIR, encoding: 'utf8', timeout: 180000, windowsHide: true,
  });
  const m = /\{[\s\S]*\}/.exec(r.stdout || '');
  if (!m) { console.error('naming failed:', (r.stderr || r.error?.message || '').slice(0, 200)); return; }
  let out;
  try { out = JSON.parse(m[0]); } catch { return; }
  for (const p of pending) if (typeof out[p.key] === 'string' && out[p.key].trim()) names[p.key] = { name: clip(out[p.key], 40), project: p.project };
  fs.writeFileSync(NAMES_FILE, JSON.stringify(names));
}

// ---- Scheduled tasks ----------------------------------------------------------
// One-time tasks scheduled in the desktop app ("arrancá el domingo con X") show
// up as "Programadas" until they fire. The app keeps their schedule in
// %APPDATA%/Claude/claude-code-sessions/<account>/<org>/scheduled-tasks.json;
// recurring ones (digests, watchers) are routine and stay out.
function scheduledTasks() {
  const root = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions');
  const out = [];
  let accounts = [];
  try { accounts = fs.readdirSync(root); } catch { return out; }
  for (const a of accounts) {
    let orgs = [];
    try { orgs = fs.readdirSync(path.join(root, a)); } catch { continue; }
    for (const o of orgs) {
      const file = path.join(root, a, o, 'scheduled-tasks.json');
      if (!fs.existsSync(file)) continue;
      try {
        for (const task of JSON.parse(fs.readFileSync(file, 'utf8')).scheduledTasks || []) {
          if (!task.fireAt || task.cronExpression) continue;
          let description = '';
          try { description = (/^description:s*(.+)$/m.exec(fs.readFileSync(task.filePath, 'utf8')) || [])[1] || ''; } catch { /* file gone */ }
          out.push({ ...task, description });
        }
      } catch { /* half-written file: next run */ }
    }
  }
  return out;
}

// Scheduled tasks and headless `claude -p` runs (scripts like the guitar watcher)
function isAuto(s) {
  return s.firstPrompt.startsWith('<scheduled-task') || s.entrypoint === 'sdk-cli';
}

async function once(dryRun) {
  const days = Number(opt('--days') || 7);
  const token = await accessToken();
  const projects = await listProjects(token);
  const files = await scan(days);
  const rows = [];
  for (const f of files) {
    const s = await readSession(f.file);
    if (!s.cwd || (!s.firstPrompt && !s.steps.length)) continue;
    if (norm(s.cwd).startsWith(norm(TOOLS_DIR))) continue; // our own naming calls
    rows.push({ f, s });
  }

  const names = readNames();
  const pending = [];
  for (const { f, s } of rows) {
    if (isAuto(s)) continue;
    const key = nameKey(f.sessionId, s);
    if (!names[key] && pending.length < MAX_NAMES_PER_RUN) {
      pending.push({ key, project: projectFor(s.cwd, projects).projectName, title: s.title || s.aiTitle, lastPrompt: s.lastPrompt || s.firstPrompt, steps: s.steps });
    }
  }
  if (!flag('--no-names')) nameProcesses(pending, names);

  let written = 0;
  const all = [];
  for (const { f, s } of rows) {
    const auto = isAuto(s);
    const autoName = auto ? (/name="([^"]+)"/.exec(s.firstPrompt) || [])[1] : '';
    const proj = projectFor(s.cwd, projects);
    // A session named after its folder ("BANANA AIRWAYS") says nothing: use what was asked
    const generic = !s.title || [proj.projectName, path.basename(s.cwd)].some(n => norm(n) === norm(s.title));
    const title = generic && !auto ? (s.aiTitle || s.lastPrompt || s.title) : (s.title || s.aiTitle || autoName || s.firstPrompt);
    const total = s.steps.length;
    const done = s.steps.filter(x => x.status === 'completed').length;
    const item = {
      ownerUid: OWNER_UID,
      sessionId: f.sessionId,
      ...proj,
      folder: s.cwd,
      process: auto ? clip(autoName || title, 40) : (names[nameKey(f.sessionId, s)]?.name || clip(title, 40)),
      title: clip(title, 90),
      auto,
      status: statusOf(s, f.mtime),
      steps: s.steps.slice(0, 14),
      progress: total ? Math.round((done / total) * 100) : null,
      recap: s.recap,
      ask: s.ask,
      lastPrompt: auto ? '' : clip(s.lastPrompt, 240),
      userTurns: s.userTurns,
      startedAt: s.startedAt || f.mtime,
      updatedAt: Math.round(f.mtime),
      syncedAt: Date.now(),
    };
    if (dryRun && flag('--json')) { all.push(item); continue; }
    if (dryRun) {
      console.log(`${item.projectName.padEnd(24)} ${item.status.padEnd(8)} ${String(item.progress ?? '-').padStart(3)}% ${auto ? '[auto] ' : ''}${item.process}  ·  ${item.title}`);
      continue;
    }
    const res = await fetch(`${DB}/workItems/${encodeURIComponent(f.sessionId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toValue(v)])) }),
    });
    if (!res.ok) throw new Error(`workItems/${f.sessionId} → ${res.status} ${await res.text()}`);
    written++;
  }
  for (const task of scheduledTasks()) {
    const proj = projectFor(task.cwd || '', projects);
    const name = String(task.displayName || task.id).replace(/^[^:]{2,40}:s*/, '');
    const item = {
      ownerUid: OWNER_UID,
      sessionId: `sched-${task.id}`,
      ...proj,
      folder: task.cwd || '',
      process: clip(name, 40),
      title: clip(task.displayName || task.id, 90),
      auto: false,
      status: 'scheduled',
      scheduledFor: Number(task.fireAt),
      enabled: !!task.enabled,
      steps: [],
      recap: clip(task.description, 240),
      updatedAt: Date.now(),
      syncedAt: Date.now(),
    };
    if (!task.enabled) item.scheduledFor = 0; // cancelled or already fired: hide it
    if (dryRun) { if (flag('--json')) all.push(item); else console.log(`${item.projectName.padEnd(24)} sched    ${new Date(Number(task.fireAt)).toLocaleString('es-AR')} ${item.process}`); continue; }
    const res = await fetch(`${DB}/workItems/${encodeURIComponent(item.sessionId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toValue(v)])) }),
    });
    if (!res.ok) throw new Error(`workItems/${item.sessionId} → ${res.status} ${await res.text()}`);
    written++;
  }
  if (all.length) console.log(JSON.stringify(all));
  if (!dryRun) console.log(`${new Date().toLocaleTimeString('es-AR')} · ${written} sesiones actualizadas`);
}

const main = async () => {
  const dryRun = flag('--dry-run');
  await once(dryRun);
  if (flag('--watch')) setInterval(() => once(dryRun).catch(err => console.error(err.message || err)), 2 * 60 * 1000);
};

main().catch(err => { console.error(err.message || err); process.exit(1); });
