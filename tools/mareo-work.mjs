#!/usr/bin/env node
import crypto from 'node:crypto';
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
//   stopped  — an older task list left unfinished while the session moved on
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
import { syncThumbs } from './mareo-thumbs.mjs';

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
  const s = { entrypoint: '', title: '', aiTitle: '', firstPrompt: '', lastPrompt: '', cwd: '', startedAt: null, steps: [], recap: '', ask: '', lastPlanAt: 0, lastWrapAt: 0, userTurns: 0, plans: [],
    // Requests after the last task list: work done without a new list (e.g. a
    // survey worked on through many short messages). Becomes its own piece.
    tail: [], tailFirst: '', tailAt: 0, tailRecap: '', tailAsk: '', tailWrapped: false };
  // Every new task list (update_plan with items) is one piece of work; a long
  // session holds many, and they can belong to different processes.
  let seq = 0, recent = [], plan = null;
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
      if (!text.startsWith('<')) {
        s.lastPrompt = text; s.userTurns++;
        recent.push(clip(text, 300)); if (recent.length > 3) recent.shift();
        if (!s.tail.length) s.tailFirst = clip(text, 300);
        s.tail.push(clip(text, 300)); if (s.tail.length > 12) s.tail.shift();
        s.tailAt = Date.parse(j.timestamp) || s.tailAt;
        s.tailWrapped = false;
      }
    } else if (j.type === 'assistant') {
      for (const c of j.message?.content || []) {
        if (c.type !== 'tool_use') continue;
        if (c.name === 'mcp__ccd_turn__update_plan') {
          s.steps = applyPlan(s.steps, c.input || {});
          s.lastPlanAt = seq;
          if (Array.isArray(c.input?.items)) {
            plan = { steps: s.steps, prompts: recent.slice(), at: Date.parse(j.timestamp) || 0, userTurns: s.userTurns, recap: '', ask: '', wrapped: false, seq };
            s.plans.push(plan);
            recent = [];
          } else if (plan) plan.steps = s.steps;
          if (plan) { plan.wrapped = false; plan.lastAt = Date.parse(j.timestamp) || plan.at; }
          // Requests followed by a task-list update belong to that list
          Object.assign(s, { tail: [], tailFirst: '', tailRecap: '', tailAsk: '', tailWrapped: false });
        }
        if (c.name === 'mcp__ccd_turn__wrap_up') s.lastAnyWrapSeq = seq;
        if (c.name === 'mcp__ccd_turn__wrap_up' && s.tail.length && s.plans.length) {
          // A wrap-up for work done after the last list: it closes the tail, not the list
          Object.assign(s, { tailRecap: clip(c.input?.recap, 400), tailAsk: clip(c.input?.ask, 160), tailWrapped: true });
        } else if (c.name === 'mcp__ccd_turn__wrap_up') {
          s.steps = s.steps.map(x => ({ ...x, status: 'completed' }));
          s.recap = clip(c.input?.recap, 400);
          s.ask = clip(c.input?.ask, 160);
          s.lastWrapAt = seq;
          if (plan) Object.assign(plan, { steps: s.steps, recap: s.recap, ask: s.ask, wrapped: true, lastAt: Date.parse(j.timestamp) || plan.at });
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
  const res = await fetch(`${DB}/projects?pageSize=300&mask.fieldPaths=name&mask.fieldPaths=links`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json();
  return (j.documents || []).map(d => ({
    id: d.name.split('/').pop(), name: d.fields?.name?.stringValue || '',
    links: (d.fields?.links?.arrayValue?.values || []).map(v => ({ url: v.mapValue?.fields?.url?.stringValue || '' })),
  }));
}

// ---- Process names -------------------------------------------------------------
// Each piece of work (a session's task list plus the requests that led to it)
// gets the short name of the process it belongs to ("Encuesta", "Spaceship
// Luna"), written by Claude (haiku, no tools, not saved as a session). Pieces
// with the same name in one session are one process. Names are cached per
// task list, so the CLI only runs for new work.
const TOOLS_DIR = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'mareo-tools') : path.join(os.homedir(), '.mareo-tools');
const NAMES_FILE = path.join(TOOLS_DIR, 'process-names.json');
// What this machine last wrote to each workItems doc (hash without syncedAt).
// Unchanged docs are skipped and stale ones are found here, with no reads:
// rewriting every row each 5 minutes ran past Firestore's free daily quota.
const WRITTEN_FILE = path.join(TOOLS_DIR, 'written.json');
const readWritten = () => { try { return JSON.parse(fs.readFileSync(WRITTEN_FILE, 'utf8')); } catch { return {}; } };
const hashOf = (item) => { const { syncedAt, ...rest } = item; if (rest.status === 'scheduled') delete rest.updatedAt; return crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex'); };
const CLAUDE_BIN = [path.join(os.homedir(), '.local', 'bin', 'claude.exe'), path.join(os.homedir(), '.local', 'bin', 'claude')].find(p => fs.existsSync(p)) || 'claude';
const MAX_NAMING_CALLS = 8; // sessions named per run
const MAX_PLANS_PER_SESSION = 12;

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'proceso';

function nameKey(sessionId, steps, context) {
  const basis = steps.map(x => x.label).join('|') || context || '';
  let h = 0;
  for (const ch of basis) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `${sessionId}:${(h >>> 0).toString(36)}`;
}

// Stable while no new task list starts, so the tail is named once
function tailKey(sessionId, s) {
  return nameKey(sessionId, [], 'tail:' + s.tailFirst);
}

function readNames() {
  try { return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); } catch { return {}; }
}

// One call per session that has unnamed work: Claude sees all its pieces in
// order (already-named ones as context), groups them into a few processes and\n// gives each a title the user recognizes at a glance (Sonnet: haiku's were too terse).
function nameProcesses(groups, names) {
  for (const g of groups) {
    const known = [...new Set(Object.values(names).filter(v => v.project === g.project).map(v => v.name))];
    const prompt = [
      'Esta es una sesión de trabajo con Claude, con sus pedidos en orden. Cada pedido tiene los mensajes del usuario y la lista de pasos.',
      'Agrupalos en POCOS procesos (los desafíos de fondo que se están haciendo, idealmente 1 a 4 por sesión) y ponele a cada proceso un TÍTULO claro en español rioplatense.',
      'El título tiene que dejar entender qué se está haciendo y sobre qué, para que el dueño lo reconozca de un vistazo sin abrir la sesión, como el nombre de una tarea en un tablero de producción:',
      'de 3 a 7 palabras, con verbo o resultado concreto y el objeto concreto (qué nivel, qué pieza, para quién, qué entrega). Sin jerga técnica (nada de "geometry nodes", "gates", "push", "fork", "r2"), sin nombres de archivos ni ramas, sin el nombre del proyecto.',
      'Buenos ejemplos: "Encuesta de niveles con las 12 imágenes", "Horizonte de la Luna en Blender", "Props de la Luna para agarrar", "Pestaña Revisar en MAREO", "Build del casco para Jorge", "Video del prototipo para el hub".',
      'Malos ejemplos (no hagas esto): "Hub ronda 2", "Geometry nodes palco", "Push a main", "Vistas técnicas", "Encuesta".',
      'Pensá en el proceso de fondo, no en la tarea puntual: si imágenes, ajustes o subidas son para la encuesta, el proceso es la encuesta.',
      'Los pedidos cortos de seguimiento ("dale", "sí", "y?", correcciones) van en el proceso del pedido anterior. Si un proceso ya tiene nombre (campo "nombre"), reusalo exacto.',
      'Respondé SOLO un objeto JSON {"<key>": "<nombre>"} con una entrada por cada pedido SIN nombre, sin texto extra.',
      '',
      `Proyecto: ${g.project}. Procesos ya usados en el proyecto: ${JSON.stringify(known)}`,
      '',
      JSON.stringify(g.pieces.map(p => ({ key: p.key, nombre: names[p.key]?.name, pedidos: p.prompts.filter(Boolean).map(x => clip(x, 220)), pasos: p.steps.map(x => x.label) }))),
    ].join('\n');
    const r = spawnSync(CLAUDE_BIN, ['-p', '--model', 'sonnet', '--no-session-persistence', '--tools', ''], {
      input: prompt, cwd: TOOLS_DIR, encoding: 'utf8', timeout: 180000, windowsHide: true,
    });
    const m = /\{[\s\S]*\}/.exec(r.stdout || '');
    if (!m) { console.error('naming failed:', (r.stderr || r.error?.message || '').slice(0, 200)); continue; }
    let out;
    try { out = JSON.parse(m[0]); } catch { console.error('naming: bad JSON', m[0].slice(0, 200)); continue; }
    if (flag('--debug-names')) console.error('naming', g.project, JSON.stringify(out).slice(0, 600), '| asked', g.pieces.filter(p => !names[p.key]).length);
    for (const p of g.pieces) if (!names[p.key] && typeof out[p.key] === 'string' && out[p.key].trim()) names[p.key] = { name: clip(out[p.key], 60), project: g.project };
    fs.writeFileSync(NAMES_FILE, JSON.stringify(names));
  }
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
          try { description = (/^description:\s*(.+)$/m.exec(fs.readFileSync(task.filePath, 'utf8')) || [])[1] || ''; } catch { /* file gone */ }
          out.push({ ...task, description });
        }
      } catch { /* half-written file: next run */ }
    }
  }
  return out;
}

// ---- Claude plan status -----------------------------------------------------
// The desktop app samples plan usage into %APPDATA%/Claude/plan-usage-history.json
// ({ t, org, u: { fh: 5-hour %, sd: weekly % } }). The plan name, reset times
// and extra-usage spend come from a snapshot a Claude session saves in
// mareo-tools/plan.json (the get_usage tool); weekly reset times roll forward.
function claudeStatus() {
  const status = { ownerUid: OWNER_UID, sessionId: 'claude-status', kind: 'claude-status', syncedAt: Date.now() };
  try {
    const hist = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'Claude', 'plan-usage-history.json'), 'utf8'));
    const samples = (hist.samples || []).filter(s => s && s.u);
    const org = samples.length ? samples[samples.length - 1].org : null;
    const mine = samples.filter(s => s.org === org);
    const last = mine[mine.length - 1];
    if (last) {
      status.sampledAt = last.t;
      if (last.u.sd != null) status.weekly = last.u.sd;
      if (last.u.fh != null) status.fiveHour = last.u.fh;
    }
    // Weekly % over the last 14 days, one point per sample, for a small chart
    const since = Date.now() - 14 * 86400000;
    status.weeklyHistory = mine.filter(s => s.t >= since && s.u.sd != null).map(s => ({ t: s.t, v: s.u.sd }));
  } catch { /* no history yet */ }
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'plan.json'), 'utf8'));
    status.plan = snap.plan || '';
    status.planTakenAt = Date.parse(snap.takenAt) || null;
    status.windows = (snap.windows || []).map(w => {
      let resetsAt = Date.parse(w.resetsAt) || 0;
      const period = (w.periodDays || 0) * 86400000;
      while (period && resetsAt && resetsAt < Date.now()) resetsAt += period;
      // The live weekly % beats the snapshot when it is newer
      const live = w.id === 'weekly' && status.weekly != null && (status.sampledAt || 0) > (status.planTakenAt || 0);
      return { id: w.id, label: w.label, percentUsed: live ? status.weekly : w.percentUsed, resetsAt };
    });
    if (snap.extraUsage) status.extraUsage = snap.extraUsage;
  } catch { /* no snapshot yet */ }
  return status;
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

  // Pieces of work: the session itself for those without task lists, or each
  // task list of the last days, named by Claude and grouped by process name.
  const since = Date.now() - days * 86400000;
  const names = readNames();
  const groups = [];
  for (const { f, s } of rows) {
    if (isAuto(s)) continue;
    const project = projectFor(s.cwd, projects).projectName;
    const plans = s.plans.filter(p => (p.lastAt || p.at) >= since).slice(-MAX_PLANS_PER_SESSION);
    const pieces = plans.length
      ? plans.map(p => ({ key: nameKey(f.sessionId, p.steps, p.prompts.join('|')), prompts: p.prompts, steps: p.steps }))
      : [{ key: nameKey(f.sessionId, s.steps, s.lastPrompt || s.title), prompts: [s.lastPrompt || s.firstPrompt], steps: s.steps }];
    if (plans.length && s.tail.length) pieces.push({ key: tailKey(f.sessionId, s), prompts: s.tail, steps: [] });
    if (pieces.some(p => !names[p.key]) && groups.length < MAX_NAMING_CALLS) groups.push({ project, pieces });
  }
  // --dump-names <file>: write every session's pieces (named or not) for a person
  // or a Claude session to title by hand into process-names.json
  if (opt('--dump-names')) {
    const allGroups = [];
    for (const { f, s } of rows) {
      if (isAuto(s)) continue;
      const plans = s.plans.filter(p => (p.lastAt || p.at) >= since).slice(-MAX_PLANS_PER_SESSION);
      const pieces = plans.map(p => ({ key: nameKey(f.sessionId, p.steps, p.prompts.join('|')), prompts: p.prompts, steps: p.steps.map(x => x.label) }));
      if (plans.length && s.tail.length) pieces.push({ key: tailKey(f.sessionId, s), prompts: s.tail, steps: [] });
      if (!plans.length) pieces.push({ key: nameKey(f.sessionId, s.steps, s.lastPrompt || s.title), prompts: [s.lastPrompt || s.firstPrompt], steps: s.steps.map(x => x.label) });
      allGroups.push({ session: f.sessionId, project: projectFor(s.cwd, projects).projectName, title: s.title || s.aiTitle, pieces: pieces.map(p => ({ ...p, name: names[p.key]?.name || null, prompts: p.prompts.map(x => clip(x, 200)) })) });
    }
    fs.writeFileSync(opt('--dump-names'), JSON.stringify(allGroups, null, 1));
    console.log(`${allGroups.length} sesiones → ${opt('--dump-names')}`);
    return;
  }
  if (!flag('--no-names')) nameProcesses(groups, names);

  let written = 0;
  const all = [];
  const written_ids = new Set();
  const cache = readWritten();
  const remove = async (id) => {
    if (!(id in cache)) return;
    const res = await fetch(`${DB}/workItems/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { delete cache[id]; fs.writeFileSync(WRITTEN_FILE, JSON.stringify(cache)); }
  };
  const patch = async (id, item) => {
    const h = hashOf(item);
    if (cache[id] === h) return false;
    const res = await fetch(`${DB}/workItems/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toValue(v)])) }),
    });
    if (!res.ok) throw new Error(`workItems/${id} → ${res.status} ${await res.text()}`);
    cache[id] = h;
    fs.writeFileSync(WRITTEN_FILE, JSON.stringify(cache));
    return true;
  };
  const put = async (id, item) => {
    written_ids.add(id);
    if (dryRun && flag('--json')) { all.push(item); return; }
    if (dryRun) {
      console.log(`${item.projectName.padEnd(24)} ${item.status.padEnd(8)} ${String(item.progress ?? '-').padStart(3)}% ${item.auto ? '[auto] ' : ''}${item.process}  ·  ${item.title}`);
      return;
    }
    if (await patch(id, item)) written++;
  };
  const pct = (steps) => steps.length ? Math.round((steps.filter(x => x.status === 'completed').length / steps.length) * 100) : null;

  for (const { f, s } of rows) {
    const auto = isAuto(s);
    const autoName = auto ? (/name="([^"]+)"/.exec(s.firstPrompt) || [])[1] : '';
    const proj = projectFor(s.cwd, projects);
    // A session named after its folder ("BANANA AIRWAYS") says nothing: use what was asked
    const generic = !s.title || [proj.projectName, path.basename(s.cwd)].some(n => norm(n) === norm(s.title));
    const title = generic && !auto ? (s.aiTitle || s.lastPrompt || s.title) : (s.title || s.aiTitle || autoName || s.firstPrompt);
    // Name of a piece Claude has not named yet: the session's own title, so its pieces stay one row
    const fallback = clip(auto ? title : (generic ? (s.aiTitle || 'Trabajo general') : s.title), 40);
    const base = {
      ownerUid: OWNER_UID,
      ...proj,
      folder: s.cwd,
      title: clip(title, 90),
      auto,
      startedAt: s.startedAt || f.mtime,
      syncedAt: Date.now(),
    };
    const plans = auto ? [] : s.plans.filter(p => (p.lastAt || p.at) >= since).slice(-MAX_PLANS_PER_SESSION);
    if (!plans.length) {
      await put(f.sessionId, {
        ...base,
        sessionId: f.sessionId,
        process: auto ? clip(autoName || title, 40) : (names[nameKey(f.sessionId, s.steps, s.lastPrompt || s.title)]?.name || fallback),
        status: statusOf(s, f.mtime),
        steps: s.steps.slice(0, 14),
        progress: pct(s.steps),
        recap: s.recap,
        ask: s.ask,
        lastPrompt: auto ? '' : clip(s.lastPrompt, 240),
        userTurns: s.userTurns,
        updatedAt: Math.round(f.mtime),
      });
      continue;
    }
    // One row per process: its latest task list. The session's current process
    // keeps the session id; earlier ones get <session>~<process>.
    const byName = new Map();
    for (const p of plans) {
      const name = names[nameKey(f.sessionId, p.steps, p.prompts.join('|'))]?.name || fallback;
      byName.set(name, p); // later plans win
    }
    let last = plans[plans.length - 1];
    if (s.tail.length) {
      // Work after the last list: keep the list's steps if it is the same process
      const name = names[tailKey(f.sessionId, s)]?.name || fallback;
      const same = byName.get(name);
      last = {
        steps: same ? same.steps : [],
        prompts: s.tail,
        recap: s.tailRecap, ask: s.tailAsk, wrapped: s.tailWrapped,
        at: s.tailAt, lastAt: s.tailAt, userTurns: s.userTurns,
      };
      byName.delete(name);
      byName.set(name, last);
    }
    for (const [name, p] of byName) {
      const current = p === last;
      const id = current ? f.sessionId : `${f.sessionId}~${slug(name)}`;
      await put(id, {
        ...base,
        sessionId: id,
        process: name,
        status: current && !s.tail.length ? statusOf(s, f.mtime)
          : current && Date.now() - f.mtime < RUNNING_MS ? 'running'
          : p.wrapped ? (p.ask ? 'decide' : 'review')
          : current ? 'paused' // still talking about it, no wrap-up yet: in course
          // an older list left unfinished while the session moved on: stopped halfway
          : p.steps.some(x => x.status !== 'completed') ? ((s.lastAnyWrapSeq || 0) > (p.seq || 0) ? 'stopped' : 'paused') : 'review',
        steps: p.steps.slice(0, 14),
        progress: pct(p.steps),
        recap: p.recap,
        ask: p.ask,
        lastPrompt: clip(p.prompts[p.prompts.length - 1] || '', 240),
        userTurns: current ? s.userTurns : p.userTurns,
        updatedAt: current ? Math.round(f.mtime) : (p.lastAt || p.at),
      });
      // That process may have had its own row while it was not the current one
      if (current && !dryRun) await remove(`${f.sessionId}~${slug(name)}`);
    }
  }
  // Rows of earlier processes that no longer exist (renamed or regrouped):
  // <session>~<process> ids of sessions seen this run that were not written.
  if (!dryRun) {
    const seen = new Set(rows.map(r => r.f.sessionId));
    for (const id of Object.keys(cache)) {
      if (id.includes('~') && seen.has(id.split('~')[0]) && !written_ids.has(id)) await remove(id);
    }
  }
  for (const task of scheduledTasks()) {
    const proj = projectFor(task.cwd || '', projects);
    const name = String(task.displayName || task.id).replace(/^[^:]{2,40}:\s*/, '');
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
    if (await patch(item.sessionId, item)) written++;
  }
  const cs = claudeStatus();
  if (dryRun) console.log('claude-status', JSON.stringify({ ...cs, weeklyHistory: (cs.weeklyHistory || []).length }));
  else {
    await patch('claude-status', cs);
  }
  if (all.length) console.log(JSON.stringify(all));
  if (!dryRun) console.log(`${new Date().toLocaleTimeString('es-AR')} · ${written} sesiones actualizadas`);
  // Project pictures from what each project has attached (tools/mareo-thumbs.mjs)
  if (!dryRun && !flag('--no-thumbs')) await syncThumbs({ token, projects }).catch(err => console.error('thumbs: ' + (err.message || err)));
}

const main = async () => {
  const dryRun = flag('--dry-run');
  await once(dryRun);
  if (flag('--watch')) setInterval(() => once(dryRun).catch(err => console.error(err.message || err)), 2 * 60 * 1000);
};

main().catch(err => { console.error(err.message || err); process.exit(1); });
