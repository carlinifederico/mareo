// Automatic project identity: color, glyph, monogram, thumbnail.
// Nothing has to be configured by hand — every project gets a stable look
// derived from its name/id, and projectMeta (see meta-repo.js) overrides it
// when the user or the hub sync sets something explicitly.

import { Store } from './store.js';
import { Meta } from './meta-repo.js';

// Stroke glyphs drawn on a 48×48 grid.
export const GLYPHS = {
  butterfly: '<path d="M24 15v22"/><path d="M24 22C18 10 6 10 8 20c1 5 8 6 16 4"/><path d="M24 22c6-12 18-12 16-2-1 5-8 6-16 4"/><path d="M24 26c-6 2-12 6-10 10 2 4 8 0 10-6"/><path d="M24 26c6 2 12 6 10 10-2 4-8 0-10-6"/>',
  quiet: '<path d="M9 22c4 7 26 7 30 0"/><path d="M15 27l-2 4"/><path d="M24 29v4.5"/><path d="M33 27l2 4"/><circle cx="24" cy="12" r="2.5"/>',
  wind: '<path d="M8 18h22a5 5 0 1 0-5-5"/><path d="M8 26h28a5 5 0 1 1-5 5"/><path d="M8 34h14"/>',
  morph: '<path d="M10 24a14 14 0 0 1 14-14h14v28H24a14 14 0 0 1-14-14z"/><circle cx="24" cy="24" r="4"/>',
  moss: '<circle cx="18" cy="29" r="7"/><circle cx="30" cy="29" r="7"/><circle cx="24" cy="19" r="7"/><path d="M8 40h32"/>',
  seed: '<path d="M24 8c8 8 10 16 10 22a10 10 0 0 1-20 0c0-6 2-14 10-22z"/><path d="M24 22v18"/>',
  rings: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="2"/>',
  figure: '<circle cx="24" cy="16" r="6"/><path d="M12 40c0-7 5-12 12-12s12 5 12 12"/>',
  window: '<rect x="8" y="11" width="32" height="26" rx="4"/><path d="M8 18h32"/><path d="M20 24h8M20 24v8M20 28h6"/>',
  open: '<path d="M20 10c-8 4-8 24 0 28"/><path d="M28 10c8 4 8 24 0 28"/><circle cx="24" cy="24" r="3"/>',
  moon: '<path d="M30 9a11 11 0 1 0 9 15 9 9 0 0 1-9-15z"/><path d="M8 37c4-3 8-3 12 0s8 3 12 0 8-3 8-3"/>',
  vinyl: '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="4"/><path d="M24 9v6"/>',
  house: '<path d="M8 22L24 9l16 13"/><path d="M12 19v19h24V19"/><path d="M21 38v-9h6v9"/>',
  lotus: '<path d="M24 36c-6-4-8-10-8-16 4 2 7 5 8 9 1-4 4-7 8-9 0 6-2 12-8 16z"/><path d="M8 30c4 4 10 6 16 6s12-2 16-6"/>',
  wave: '<path d="M6 20c4-4 8-4 12 0s8 4 12 0 8-4 12 0"/><path d="M6 30c4-4 8-4 12 0s8 4 12 0 8-4 12 0"/>',
  mountain: '<path d="M6 38l12-20 8 12 5-7 11 15z"/><circle cx="34" cy="13" r="3"/>',
  sun: '<circle cx="24" cy="24" r="7"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11 11l4 4M33 33l4 4M37 11l-4 4M15 33l-4 4"/>',
  leaf: '<path d="M10 38C10 20 20 10 38 10c0 18-10 28-28 28z"/><path d="M10 38l16-16"/>',
  star: '<path d="M24 7l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z"/>',
  eye: '<path d="M6 24s7-11 18-11 18 11 18 11-7 11-18 11S6 24 6 24z"/><circle cx="24" cy="24" r="5"/>',
  plane: '<path d="M6 27l36-13-9 22-8-7-6 6v-9z"/>',
  drop: '<path d="M24 7c7 9 11 15 11 21a11 11 0 0 1-22 0c0-6 4-12 11-21z"/>',
  spiral: '<path d="M24 24a3 3 0 1 1 3 3 7 7 0 1 1 7-7 11 11 0 1 1-11-11 15 15 0 1 1-15 15"/>',
  diamond: '<path d="M24 6l14 18-14 18-14-18z"/><path d="M10 24h28"/>',
};

const GLYPH_KEYS = Object.keys(GLYPHS);

// Name keyword → glyph. Checked against the accent-free lowercase name.
const KEYWORDS = [
  [/farfalla|mariposa|butterfl/, 'butterfly'],
  [/quiet|opi\b|silen/, 'quiet'],
  [/kaze|wind|viento/, 'wind'],
  [/mutar|morph|muta/, 'morph'],
  [/musg|moss/, 'moss'],
  [/seed|semilla|brot/, 'seed'],
  [/atman|alma|soul/, 'rings'],
  [/protag|person/, 'figure'],
  [/site|web|app\b|landing/, 'window'],
  [/hiraku|open|abrir/, 'open'],
  [/noche|night|nadar|luna|moon/, 'moon'],
  [/music|musica|solo set|\bset\b|dj|vinyl/, 'vinyl'],
  [/casa|house|habitat|hogar/, 'house'],
  [/yoga|lotus/, 'lotus'],
  [/mar\b|mareo|ocean|agua|water/, 'wave'],
  [/montan|mount|montes/, 'mountain'],
  [/primavera|sun|sol\b|verano/, 'sun'],
  [/jungla|jungle|vivero|planta|plant|leaf/, 'leaf'],
  [/dream|sueno/, 'star'],
  [/airway|avion|plane|vuelo/, 'plane'],
];

// Identity palette (all readable with dark glyphs on top).
export const PALETTE = [
  '#E9A23B', '#8EA6FF', '#EE8A3C', '#C9A3F5', '#7FC48A', '#EF6B5B',
  '#E7D8B8', '#4CC9B0', '#F28DB8', '#5FB4E6', '#F0D35A', '#B8BCC6',
];

const DEFAULT_V1_COLORS = new Set(['#bdc3c7', '#d5d5d5', '']);

export function normalizeText(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function monogramFor(name) {
  const words = normalizeText(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w && !['THE', 'AND', 'DE', 'LA', 'EL', 'Y', '&'].includes(w));
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]);
}

export function glyphFor(project) {
  const n = normalizeText(project.name);
  for (const [re, key] of KEYWORDS) if (re.test(n)) return key;
  return GLYPH_KEYS[hash(project.id || n) % GLYPH_KEYS.length];
}

// Full identity for a project: meta overrides → automatic defaults.
export function identityFor(project) {
  const meta = Meta.get(project.id);
  let color = meta.color || project.color;
  if (!color || DEFAULT_V1_COLORS.has(color.toLowerCase())) {
    color = PALETTE[hash(project.id || project.name || '') % PALETTE.length];
  }
  return {
    color,
    ink: inkFor(color),
    glyph: GLYPHS[meta.icon] ? meta.icon : glyphFor(project),
    monogram: meta.monogram || monogramFor(project.name),
    thumb: meta.thumb || null,
    hub: meta.hub && meta.hub.url ? meta.hub : null,
    stage: meta.stage || '',
    aliases: meta.aliases || [],
  };
}

// Dark or light ink depending on the background's luminance.
export function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#141416';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#141416' : '#F4F4F6';
}

export function glyphSvg(key, { size = 48, color = 'currentColor', stroke = 2.4, label = '' } = {}) {
  const body = GLYPHS[key] || GLYPHS.diamond;
  const a11y = label ? `role="img" aria-label="${escapeAttr(label)}"` : 'aria-hidden="true"';
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Every active project (own categories + shared with me), with its category.
export function listProjects({ includeArchived = false } = {}) {
  const seen = new Set();
  const out = [];
  const add = (p, categoryId, categoryName) => {
    if (!p || typeof p !== 'object' || seen.has(p.id)) return;
    if (!includeArchived && Store.isProjectArchived(p.id)) return;
    seen.add(p.id);
    out.push({ project: p, categoryId, categoryName });
  };
  for (const cat of Store.data.categories) for (const p of cat.projects) add(p, cat.id, cat.name);
  for (const p of Store._sharedProjects || []) add(p, 'shared', 'Compartidos conmigo');
  return out;
}

export function findProject(id) {
  return Store._findProject(id);
}
