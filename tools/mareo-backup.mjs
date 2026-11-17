// Daily copy of MAREO's Firestore data to Google Drive (G:\My Drive\WORK\MAREO\_backups),
// one JSON per day, last 30 kept. Runs inside tools/mareo-work.mjs, at most once a day.
// Firestore's own history only reaches back one hour unless billing is on
// (point-in-time recovery). Restore: PATCH each doc with its saved `fields`.
// Cost: ~70 reads a day.
import fs from 'node:fs';
import path from 'node:path';

const DB = 'https://firestore.googleapis.com/v1/projects/mareo-app-8de88/databases/(default)/documents';
const DIR = 'G:\\My Drive\\WORK\\MAREO\\_backups';
const COLLECTIONS = ['projects', 'mareo_data', 'mareo_v2', 'projectMeta', 'userProfiles'];
const KEEP = 30;

export async function dailyBackup(token, { force = false, log = console.log } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(DIR, `mareo-${day}.json`);
  if (!force && fs.existsSync(file)) return;
  fs.mkdirSync(DIR, { recursive: true });
  const out = { at: new Date().toISOString() };
  for (const c of COLLECTIONS) {
    out[c] = [];
    let pt = '';
    do {
      const j = await (await fetch(`${DB}/${c}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: { Authorization: `Bearer ${token}` } })).json();
      if (j.error) throw new Error(`${c}: ${j.error.message}`);
      out[c].push(...(j.documents || []));
      pt = j.nextPageToken || '';
    } while (pt);
  }
  if (!out.projects.length) throw new Error('no projects read, not saving');
  fs.writeFileSync(file, JSON.stringify(out));
  const old = fs.readdirSync(DIR).filter(f => /^mareo-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) fs.unlinkSync(path.join(DIR, f));
  log(`backup: ${file} (${out.projects.length} proyectos)`);
}
