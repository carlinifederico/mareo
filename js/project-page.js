// Project page (#/p/<id>): identity hero, stages from the project's top-level
// tasks, production hub, notes, a one-year mini timeline, dedication and the
// identity editor (color, glyph, thumbnail, aliases, stage).

import { Store } from './store.js';
import { Meta } from './meta-repo.js';
import { identityFor, glyphSvg, GLYPHS, PALETTE, listProjects } from './identity.js';
import { projectMonths, fmtHours } from './stats.js';
import { showLinksModal } from './modal.js';
import { statusPill } from './home.js';

const MONTHS_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
const MAX_THUMB_BYTES = 90 * 1024;

let editingIdentity = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function rerender() {
  document.dispatchEvent(new Event('mareo:render'));
}

function canEdit(project) {
  return project._role !== 'viewer';
}

function todayDoy() {
  const now = new Date();
  return Math.floor((now - new Date(now.getFullYear(), 0, 1)) / 86400000);
}

export function renderProjectPage(container, projectId) {
  const project = Store._findProject(projectId);
  const id = identityFor(project);
  const entry = listProjects({ includeArchived: true }).find(x => x.project.id === projectId);
  const page = el('div', 'v2-page project-page');

  // --- Breadcrumb ---
  const crumbs = el('nav', 'pp-crumbs');
  crumbs.setAttribute('aria-label', 'Ruta');
  const back = el('a', null, 'Studio');
  back.href = '#';
  crumbs.append(back, el('span', null, '/'), el('span', null, entry ? entry.categoryName : ''), el('span', null, '/'), el('span', 'cur', project.name));
  page.appendChild(crumbs);

  // --- Hero ---
  const hero = el('section', 'pp-hero');
  hero.style.background = id.color;
  hero.style.color = id.ink;
  const heroText = el('div', 'pp-hero-text');
  const eyebrow = el('div', 'pp-hero-eyebrow');
  eyebrow.appendChild(el('span', 'v2-eyebrow', `${id.monogram} · ${(entry ? entry.categoryName : '').toUpperCase()}`));
  if (id.stage) eyebrow.appendChild(el('span', 'pp-chip', id.stage));
  if (Store.isProjectArchived(projectId)) eyebrow.appendChild(el('span', 'pp-chip', 'Archivado'));
  const hubPill = statusPill(!!id.hub);
  hubPill.classList.add('pp-hub-pill');
  eyebrow.appendChild(hubPill);
  heroText.appendChild(eyebrow);
  heroText.appendChild(el('h1', 'pp-title', project.name));

  const buttons = el('div', 'pp-hero-actions');
  if (id.hub) {
    const a = el('a', 'pp-btn-solid');
    a.href = id.hub.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span>Abrir production hub</span>${ARROW}`;
    buttons.appendChild(a);
  }
  for (const link of (project.links || []).filter(l => l.url).slice(0, 5)) {
    const a = el('a', 'pp-btn-outline', link.label || hostOf(link.url));
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener';
    buttons.appendChild(a);
  }
  const pinned = Store.isProjectPinned(project.id);
  const pin = el('button', 'pp-btn-outline', pinned ? 'Fijado en Studio ✓' : 'Fijar en Studio');
  pin.type = 'button';
  pin.setAttribute('aria-pressed', String(pinned));
  pin.addEventListener('click', () => {
    if (pinned) Store.unpinProject(project.id); else Store.pinProject(project.id);
    rerender();
  });
  buttons.appendChild(pin);
  if (canEdit(project)) {
    const editLinks = el('button', 'pp-btn-outline', (project.links || []).length ? 'Editar links' : '+ Links');
    editLinks.type = 'button';
    editLinks.addEventListener('click', () => showLinksModal(project));
    buttons.appendChild(editLinks);
  }
  heroText.appendChild(buttons);
  hero.appendChild(heroText);

  const art = el('div', 'pp-hero-art');
  if (id.thumb) {
    const img = document.createElement('img');
    img.src = id.thumb;
    img.alt = `Imagen de ${project.name}`;
    art.appendChild(img);
    art.classList.add('has-thumb');
  } else {
    art.innerHTML = glyphSvg(id.glyph, { size: 220, stroke: 1.4, label: `Icono de ${project.name}` });
  }
  hero.appendChild(art);
  page.appendChild(hero);

  // --- Stages ---
  const stages = buildStages(project);
  if (stages.length) {
    const sec = el('section', 'pp-section');
    sec.appendChild(el('h2', 'studio-h2', 'Etapas'));
    const ol = el('ol', 'pp-stages');
    for (const s of stages) {
      const li = el('li', `pp-stage ${s.status}`);
      if (s.status === 'now') { li.style.background = id.color; li.style.color = id.ink; }
      const st = el('span', 'pp-stage-status');
      if (s.status === 'done') st.innerHTML = `${CHECK}<span>Hecho</span>`;
      else st.textContent = s.status === 'now' ? 'En curso' : 'Próximo';
      li.append(st, el('span', 'pp-stage-name', s.label), el('span', 'pp-stage-date', s.dates));
      ol.appendChild(li);
    }
    sec.appendChild(ol);
    page.appendChild(sec);
  }

  // --- Hub + notes ---
  const row = el('div', 'pp-row');
  row.appendChild(renderHubPanel(project, id));
  row.appendChild(renderNotes(project, id));
  page.appendChild(row);

  // --- Timeline + dedication ---
  const row2 = el('div', 'pp-row');
  row2.appendChild(renderMiniTimeline(project, id));
  row2.appendChild(renderProjectDedication(project, id));
  page.appendChild(row2);

  // --- Identity editor ---
  if (canEdit(project)) page.appendChild(renderIdentityEditor(project, id));

  container.appendChild(page);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Link'; }
}

function fmtDoy(doy) {
  const d = new Date(new Date().getFullYear(), 0, 1 + doy);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toLowerCase()}`;
}

function buildStages(project) {
  const doy = todayDoy();
  return (project.tasks || [])
    .filter(t => !t.parentId)
    .sort((a, b) => (a.startDay || 0) - (b.startDay || 0))
    .map(t => {
      const s = t.startDay || 0, e = s + (t.durationDays || 1);
      const status = doy >= e ? 'done' : doy >= s ? 'now' : 'next';
      return { label: t.label || 'Etapa', status, dates: `${fmtDoy(s)} → ${fmtDoy(e - 1)}` };
    });
}

function renderHubPanel(project, id) {
  const card = el('section', 'v2-card pp-hub');
  if (id.hub) {
    const bar = el('div', 'pp-hub-bar');
    bar.appendChild(el('span', 'pp-hub-url', id.hub.url.replace(/^https?:\/\//, '')));
    const open = el('a', 'v2-link', 'Abrir');
    open.href = id.hub.url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.style.color = id.color;
    bar.appendChild(open);
    card.appendChild(bar);
    const body = el('div', 'pp-hub-body');
    const head = el('div', 'v2-card-head');
    head.appendChild(el('h2', 'v2-card-title', id.hub.title || 'Production hub'));
    if (id.hub.syncedAt) head.appendChild(el('span', 'pp-muted', `Sincronizado ${new Date(id.hub.syncedAt).toLocaleDateString('es-AR')}`));
    body.appendChild(head);
    const sections = id.hub.sections || [];
    const tiles = el('div', 'pp-hub-tiles');
    if (id.thumb) {
      const t = el('a', 'pp-hub-preview');
      t.href = id.hub.url;
      t.target = '_blank';
      t.rel = 'noopener';
      const img = document.createElement('img');
      img.src = id.thumb;
      img.alt = '';
      t.appendChild(img);
      tiles.appendChild(t);
    }
    for (const s of sections) {
      const a = el('a', 'pp-hub-tile', s.label);
      a.href = s.url || id.hub.url;
      a.target = '_blank';
      a.rel = 'noopener';
      tiles.appendChild(a);
    }
    if (tiles.childElementCount) body.appendChild(tiles);
    card.appendChild(body);
    if (canEdit(project)) card.appendChild(hubUrlForm(project, id, 'Cambiar URL del hub'));
  } else {
    const body = el('div', 'pp-hub-body');
    body.appendChild(el('h2', 'v2-card-title', 'Production hub'));
    body.appendChild(el('p', 'pp-muted', 'Este proyecto todavía no tiene hub. Se vincula solo cuando corrés /mareo-sync en Claude Code, o pegá la URL acá.'));
    card.appendChild(body);
    if (canEdit(project)) card.appendChild(hubUrlForm(project, id, 'URL del hub'));
  }
  return card;
}

function hubUrlForm(project, id, labelText) {
  const form = el('form', 'pp-inline-form');
  const fid = `hub-url-${project.id}`;
  const label = el('label', 'v2-visually-hidden', labelText);
  label.htmlFor = fid;
  const input = document.createElement('input');
  input.id = fid;
  input.type = 'url';
  input.className = 'v2-input';
  input.placeholder = 'https://claude.ai/artifact/…';
  input.value = id.hub ? id.hub.url : '';
  const save = el('button', 'v2-btn', 'Guardar');
  save.type = 'submit';
  form.append(label, input, save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    const hub = url ? { ...(id.hub || {}), url, source: 'manual', title: id.hub?.title || `${project.name} · production hub` } : null;
    await Meta.update(project.id, { hub }, { lock: ['hub'] });
    rerender();
  });
  return form;
}

function renderNotes(project, id) {
  const card = el('section', 'v2-card pp-notes');
  const head = el('div', 'v2-card-head');
  head.appendChild(el('h2', 'v2-card-title', 'Notas y tareas'));
  card.appendChild(head);
  const notes = (project.projectNotes || []).filter(n => (n.title || n.content || '').trim());
  const open = notes.filter(n => !n.done);
  const done = notes.filter(n => n.done).slice(0, 3);
  if (!notes.length) card.appendChild(el('p', 'pp-muted', 'Sin notas. Las notas del Task Board aparecen acá.'));
  for (const n of [...open.slice(0, 8), ...done]) {
    const row = el('label', 'pp-note' + (n.done ? ' done' : ''));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!n.done;
    cb.disabled = !canEdit(project);
    cb.style.accentColor = id.color;
    cb.addEventListener('change', () => {
      Store.updateProjectNote(project.id, n.id, { done: cb.checked });
      rerender();
    });
    const text = el('span', 'pp-note-text');
    text.appendChild(el('span', null, n.title || n.content.split('\n')[0]));
    if (n.today) text.appendChild(el('span', 'pp-muted', 'En Today'));
    row.append(cb, text);
    card.appendChild(row);
  }
  if (open.length > 8) card.appendChild(el('p', 'pp-muted', `y ${open.length - 8} más en el Task Board`));
  return card;
}

function renderMiniTimeline(project, id) {
  const card = el('section', 'v2-card pp-timeline');
  const head = el('div', 'v2-card-head');
  head.appendChild(el('h2', 'v2-card-title', `Timeline ${new Date().getFullYear()}`));
  const go = el('button', 'v2-link', 'Ver en el timeline general');
  go.type = 'button';
  go.addEventListener('click', () => document.dispatchEvent(new CustomEvent('mareo:switchView', { detail: 'timeline' })));
  head.appendChild(go);
  card.appendChild(head);

  const tasks = (project.tasks || []).filter(t => !t.parentId).sort((a, b) => (a.startDay || 0) - (b.startDay || 0));
  if (!tasks.length) {
    card.appendChild(el('p', 'pp-muted', 'Sin tareas en el timeline.'));
    return card;
  }
  const scroll = el('div', 'pp-tl-scroll');
  const grid = el('div', 'pp-tl');
  const months = el('div', 'pp-tl-months');
  for (const m of MONTHS_SHORT) months.appendChild(el('span', null, m));
  grid.appendChild(months);
  const yearDays = 366;
  const doy = todayDoy();
  for (const t of tasks) {
    const r = el('div', 'pp-tl-row');
    r.appendChild(el('span', 'pp-tl-label', t.label || ''));
    const track = el('div', 'pp-tl-track');
    const bar = el('span', 'pp-tl-bar');
    const s = t.startDay || 0, d = t.durationDays || 1;
    bar.style.left = `${(s / yearDays) * 100}%`;
    bar.style.width = `${Math.max((d / yearDays) * 100, 0.8)}%`;
    const active = doy >= s && doy < s + d;
    bar.style.background = active ? id.color : (t.color || id.color);
    bar.style.opacity = doy >= s + d ? '0.45' : '1';
    bar.title = `${t.label} · ${fmtDoy(s)} → ${fmtDoy(s + d - 1)}`;
    track.appendChild(bar);
    r.appendChild(track);
    grid.appendChild(r);
  }
  const now = el('span', 'pp-tl-now');
  now.style.left = `calc(var(--tl-label) + (100% - var(--tl-label)) * ${doy / yearDays})`;
  grid.appendChild(now);
  scroll.appendChild(grid);
  card.appendChild(scroll);
  return card;
}

function renderProjectDedication(project, id) {
  const card = el('section', 'v2-card pp-dedication');
  const head = el('div', 'v2-card-head');
  head.appendChild(el('h2', 'v2-card-title', 'Dedicación'));
  const go = el('button', 'v2-link', 'Ver todo');
  go.type = 'button';
  go.addEventListener('click', () => document.dispatchEvent(new CustomEvent('mareo:openDedication')));
  head.appendChild(go);
  card.appendChild(head);
  const months = projectMonths(project.id);
  const max = Math.max(...months.map(m => m.minutes), 1);
  const bars = el('div', 'pp-ded-bars');
  for (const m of months) {
    const col = el('div', 'pp-ded-col');
    const val = el('span', 'pp-ded-val', m.minutes ? `${Math.round(m.pct * 100)}%` : '');
    const track = el('div', 'pp-ded-track');
    const fill = el('span', 'pp-ded-fill');
    fill.style.height = `${(m.minutes / max) * 100}%`;
    fill.style.background = id.color;
    fill.title = `${fmtHours(m.minutes)} · ${Math.round(m.pct * 100)}% del mes`;
    track.appendChild(fill);
    col.append(val, track, el('span', 'pp-ded-label', m.label));
    bars.appendChild(col);
  }
  card.appendChild(bars);
  const cur = months[months.length - 1];
  card.appendChild(el('p', 'pp-muted', cur.minutes
    ? `Este mes: ${fmtHours(cur.minutes)} (${Math.round(cur.pct * 100)}% de tu tiempo registrado).`
    : 'Este mes todavía no hay bloques ni reuniones de este proyecto.'));
  return card;
}

function renderIdentityEditor(project, id) {
  const sec = el('section', 'v2-card pp-identity');
  const head = el('div', 'v2-card-head');
  head.appendChild(el('h2', 'v2-card-title', 'Identidad'));
  const toggle = el('button', 'v2-btn', editingIdentity ? 'Listo' : 'Editar');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(editingIdentity));
  toggle.addEventListener('click', () => { editingIdentity = !editingIdentity; rerender(); });
  head.appendChild(toggle);
  sec.appendChild(head);

  const summary = el('div', 'pp-id-summary');
  const tile = el('span', 'pp-id-tile');
  tile.style.background = id.color;
  tile.style.color = id.ink;
  tile.innerHTML = glyphSvg(id.glyph, { size: 40, stroke: 2.6 });
  const txt = el('div', 'pp-id-text');
  txt.append(el('strong', null, `${id.glyph} · ${id.monogram}`), el('span', 'pp-mono', id.color.toUpperCase()));
  if (id.aliases.length) txt.appendChild(el('span', 'pp-muted', `Alias para el Calendar: ${id.aliases.join(', ')}`));
  summary.append(tile, txt);
  sec.appendChild(summary);
  if (!editingIdentity) return sec;

  // Color
  const colors = el('div', 'pp-id-group');
  colors.appendChild(el('span', 'v2-eyebrow', 'COLOR'));
  const sw = el('div', 'pp-swatches');
  for (const c of PALETTE) {
    const b = el('button', 'pp-swatch' + (c.toLowerCase() === id.color.toLowerCase() ? ' on' : ''));
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', `Color ${c}`);
    b.addEventListener('click', () => {
      // Project color is a v1 field too: v1 picks the change up as well
      Store.updateProject(project.id, { color: c });
      if (Meta.get(project.id).color) Meta.update(project.id, { color: null });
      rerender();
    });
    sw.appendChild(b);
  }
  colors.appendChild(sw);
  sec.appendChild(colors);

  // Glyph
  const glyphs = el('div', 'pp-id-group');
  glyphs.appendChild(el('span', 'v2-eyebrow', 'ICONO'));
  const gg = el('div', 'pp-glyphs');
  for (const key of Object.keys(GLYPHS)) {
    const b = el('button', 'pp-glyph' + (key === id.glyph ? ' on' : ''));
    b.type = 'button';
    b.setAttribute('aria-label', `Icono ${key}`);
    b.innerHTML = glyphSvg(key, { size: 28, stroke: 2.6 });
    b.addEventListener('click', async () => { await Meta.update(project.id, { icon: key }, { lock: ['icon'] }); rerender(); });
    gg.appendChild(b);
  }
  glyphs.appendChild(gg);
  sec.appendChild(glyphs);

  // Thumbnail
  const thumbs = el('div', 'pp-id-group');
  thumbs.appendChild(el('span', 'v2-eyebrow', 'THUMBNAIL'));
  const trow = el('div', 'pp-inline-form');
  const fid = `thumb-${project.id}`;
  const flabel = el('label', 'v2-btn', id.thumb ? 'Cambiar imagen' : 'Subir imagen');
  flabel.htmlFor = fid;
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.id = fid;
  file.className = 'v2-visually-hidden';
  const status = el('span', 'pp-muted');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    status.textContent = 'Procesando…';
    try {
      const dataUrl = await resizeImage(f);
      await Meta.update(project.id, { thumb: dataUrl }, { lock: ['thumb'] });
      rerender();
    } catch (err) {
      console.warn('thumbnail failed', err);
      status.textContent = 'No se pudo usar esa imagen.';
    }
  });
  trow.append(file, flabel);
  if (id.thumb) {
    const rm = el('button', 'v2-btn', 'Quitar');
    rm.type = 'button';
    rm.addEventListener('click', async () => { await Meta.update(project.id, { thumb: null }, { lock: ['thumb'] }); rerender(); });
    trow.appendChild(rm);
  }
  trow.appendChild(status);
  thumbs.appendChild(trow);
  sec.appendChild(thumbs);

  // Stage + aliases
  const more = el('div', 'pp-id-group pp-id-fields');
  more.appendChild(textField(project, 'Etapa', 'stage', id.stage, 'Desarrollo, Preproducción…', v => v));
  more.appendChild(textField(project, 'Alias (separados por coma) para reconocer reuniones', 'aliases', id.aliases.join(', '), 'Opi, OQ', v => v.split(',').map(s => s.trim()).filter(Boolean)));
  sec.appendChild(more);
  return sec;
}

function textField(project, labelText, key, value, placeholder, parse) {
  const form = el('form', 'pp-field');
  const fid = `f-${key}-${project.id}`;
  const label = el('label', 'v2-eyebrow', labelText.toUpperCase());
  label.htmlFor = fid;
  const row = el('div', 'pp-inline-form');
  const input = document.createElement('input');
  input.id = fid;
  input.className = 'v2-input';
  input.value = value || '';
  input.placeholder = placeholder;
  const save = el('button', 'v2-btn', 'Guardar');
  save.type = 'submit';
  row.append(input, save);
  form.append(label, row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await Meta.update(project.id, { [key]: parse(input.value.trim()) });
    rerender();
  });
  return form;
}

// Resize to ≤640px wide WebP and shrink quality until it fits the budget
// (thumbnails live inside a Firestore doc, 1MB max).
async function resizeImage(file) {
  const bmp = await createImageBitmap(file);
  let width = Math.min(640, bmp.width);
  for (let attempt = 0; attempt < 6; attempt++) {
    const h = Math.round(bmp.height * (width / bmp.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, width, h);
    for (const q of [0.82, 0.7, 0.58]) {
      const url = canvas.toDataURL('image/webp', q);
      if (url.length * 0.75 <= MAX_THUMB_BYTES) return url;
    }
    width = Math.round(width * 0.8);
  }
  throw new Error('Image too large');
}
