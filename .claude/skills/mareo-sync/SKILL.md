---
name: mareo-sync
description: Sync production hubs (Claude artifacts) and thumbnails into MAREO v2 so every project shows its hub and key art automatically. Use when the user says /mareo-sync, "sincronizá los hubs", "actualizá MAREO con mis hubs", or added a new production hub.
---

# /mareo-sync — hubs + thumbnails into MAREO

MAREO v2 reads each project's hub and thumbnail from Firestore `projectMeta/{projectId}`.
This skill finds the hubs, matches them to MAREO projects, picks key art, and writes
them with `tools/mareo-sync.mjs`. Nothing has to be configured per project in the app.

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
   - OPI AND THE QUIET ONES = `proj-silence`
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
5. **Write a plan** JSON to the scratchpad:
   `[{ "projectId", "hubUrl", "hubTitle", "imagePath", "aliases"?: [...], "stage"?: "…", "sections"?: [{"label","url"}] }]`
   - `aliases` are short names used in calendar event titles (e.g. "Opi"). They let Dedicación
     assign meetings to the project automatically.
6. Run `node tools/mareo-sync.mjs --apply <plan.json> --dry-run`, show the user the summary,
   then run it without `--dry-run`.
7. Tell the user which projects got a hub and thumbnail. The app picks them up on reload or with
   the refresh button.

## Notes
- The script authenticates with the Firebase CLI refresh token and calls the Firestore REST API
  as the owner, so security rules don't apply. Only write `projectMeta`, never `projects/` or
  `mareo_data/`; v1 owns those.
- Thumbnails are WebP data URLs, ≤640px wide and ≤90KB, so a Firestore doc stays small.
