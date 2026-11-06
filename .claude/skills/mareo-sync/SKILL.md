---
name: mareo-sync
description: Sync production hubs (Claude artifacts), thumbnails and each project's "Al día" brief (summary, facts, milestones, next steps, meetings) into MAREO v2, so the user never loads project info by hand. Use when the user says /mareo-sync, "sincronizá los hubs", "actualizá MAREO", added a new production hub, or when the scheduled daily sync runs.
---

# /mareo-sync — hubs, thumbnails and briefs into MAREO

MAREO v2 reads each project's hub, thumbnail and brief from Firestore `projectMeta/{projectId}`.
This skill finds the hubs, matches them to MAREO projects, picks key art, gathers the brief,
and writes everything with `tools/mareo-sync.mjs`. Nothing has to be configured per project in the app.

Only the user's own material counts: their own artifacts (`(mine)` in the list), their Drive
folders, their calendar and their Wispr Flow meetings. Artifacts other people shared are used
only for hubs already linked (Opi, NATURIS); never pull a brief from someone else's artifact.

## Requirements (one-time)
- Firebase CLI login as the project owner: `npx firebase-tools login` (carlinifederico@gmail.com).
- `sharp` installed OUTSIDE Google Drive (npm can't install inside Drive folders):
  `mkdir "%LOCALAPPDATA%\mareo-tools" && cd "%LOCALAPPDATA%\mareo-tools" && npm init -y && npm install sharp@0.33.5`

## Steps
1. **Current state:** `node tools/mareo-sync.mjs --list`. Prints every MAREO project: `projectId`,
   `name`, its `hub`/`thumb` if already set, and `locked` (fields the user edited by hand; the
   script never overwrites those).
2. **Find hubs:**
   - `Artifact` tool, `action: "list"`, `scope: "all"`, `limit: 200`. Titles containing "Production Hub",
     "Hub", "Sala de dirección" are candidates.
   - Grep for `claude.ai/artifact/` in `~/.claude/projects/*/memory/*.md`, and in `CLAUDE.md`,
     `README.md` and `SYNC.md` under `G:/My Drive/WORK/*` and `H:/Shared drives/BROTACIONES/*`
     (depth ≤ 3). This catches hubs shared by link that the list doesn't show, like Opi's.
3. **Match each hub to a project:** match on the project name, accent-insensitive.
   Known mappings:
   - OPI AND THE QUIET ONES = `proj-silence`. Its hub moved off Claude artifacts to
     https://opi-hub-e5unvvjl.pages.dev/ (2026-11-06); never replace it with the old artifact.
   - TRUCCO = `TRC`

   If a match is ambiguous, or a hub has no matching project, ask the user. Never guess between
   two projects. Skip projects that already have the same hub URL, unless the thumbnail is
   missing.
4. **Pick a thumbnail per project** (first hit wins). Look in the project's Drive folder
   (`G:/My Drive/WORK/<NAME>`, `H:/Shared drives/BROTACIONES/<NAME>`) for:
   1. `CONCEPT ART/<name>.*` or `CONCEPT ART/COVER.*`
   2. a cover or key-art image in the hub's own folder, such as `img/kf/*-01*`
   3. `STORYBOARD/keyframes/*_01.*`
   4. `assets/img/*cover*` in a related GitHub repo under `~/GitHub`
   5. otherwise the first large jpg/png/webp in `CONCEPT ART/`

   When unsure, make a contact sheet with sharp, look at it, and choose.
5. **Gather the brief** for every project that has a hub of the user's own, or a Drive folder with
   a `CLAUDE.md`/`README.md`/`SYNC.md`. Read the hub's full HTML (`Artifact` read, then Read the
   saved file: its data is usually in JS arrays), the folder's docs, and the project's recent
   meetings (Wispr Flow `search_meetings` by the project's name and aliases, last 30 days).
   Use a subagent per project when there are several. In Spanish, short and plain:
   - `summary`: 1–2 sentences, what it is and where it stands now.
   - `facts`: 3–6 `{label, value, note?}` (dates, client, format, level in development…).
   - `milestones`: `{label, date}` with `date` as `YYYY-MM-DD` (or `YYYY-MM` when only the month is known).
   - `nextSteps`: open to-dos `{who?, text}`, max 8.
   - `meetings`: latest first, `{date, title, summary?}`, max 5.
   - `sources`: `{label, url}` — the hub first.

   Never invent facts or dates. Skip a project whose sources didn't change since `brief.syncedAt`.
   Also add the user's own artifacts that clearly belong to a project as hub `sections`
   (e.g. Banana's level artifacts), and propose a hub for any new `(mine)` artifact titled "… Hub".
6. **Write a plan** JSON (UTF-8 without BOM) to the scratchpad:
   `[{ "projectId", "hubUrl", "hubTitle", "imagePath", "aliases"?: [...], "stage"?: "…", "sections"?: [{"label","url"}], "brief"?: {…} }]`
   - `aliases` are short names used in calendar event titles (e.g. "Opi"). They let Dedicación
     assign meetings to the project automatically.
   - `brief` replaces the whole "Al día" block; it never touches the user's notes or tasks.
     Next steps become notes only when the user clicks "+ Nota" on the project page.
7. Run `node tools/mareo-sync.mjs --apply <plan.json> --dry-run`, then without `--dry-run`.
   In an interactive session show the dry-run summary first; in the scheduled run just apply.
8. Report which projects got a hub, thumbnail or brief, and list artifacts or folders you could
   not match to a project (ask, don't guess). The app picks changes up on reload.

## Notes
- The script authenticates with the Firebase CLI refresh token and calls the Firestore REST API
  as the owner, so security rules don't apply. Only write `projectMeta`, never `projects/` or
  `mareo_data/`; v1 owns those.
- Thumbnails are WebP data URLs, ≤640px wide and ≤90KB, so a Firestore doc stays small.
