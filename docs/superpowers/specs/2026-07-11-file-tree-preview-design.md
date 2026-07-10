# File tree + universal file preview in the Preview panel

**Date:** 2026-07-11
**Status:** Implemented (2026-07-11, branch `feat/paperino`)
**Owner:** Preview panel (`opencode-dev/packages/app/src/components/paperino/`, `opencode-dev/packages/desktop/src/main/paperino/`)

## Problem

Paperino removed the chassis's right-hand Review/file dock ("N Changes | All files") because a
paper workspace has no code diffs to review — the Paper preview took its slot. That also removed
the only way to *browse the project folder* from the UI. Users coming from the sibling forks
(SnipCut/TISS) expect a folder toggle that lists every file, and they expect clicking a file to
*show* it. Today the Preview panel renders exactly two things: the compiled paper and a PDF the
agent pushes to `.paperino/preview.pdf`. An existing `main_updated.pdf`, a figure PNG, a `.docx`
draft from a co-author — none of them are viewable without asking the agent.

## Decisions (locked)

1. **Placement — inside the Preview panel.** A folder icon in the Preview panel's own header
   toggles a file tree docked at the panel's left edge. No separate dock column; the chat/preview
   layout is untouched. Tree is resizable; open state and width persist (localStorage, like the
   existing panel width).
2. **Word rendering — in-app HTML.** `.docx` converts to styled HTML with **mammoth.js** (new
   bundled renderer dependency, BSD-2-Clause, pure JS). Text, headings, bold/italic, lists,
   tables and embedded images render; exact page breaks/margins are approximated. No dependency
   on installed Word/LibreOffice (an unbundled runtime dependency would be a shipping blocker).
   Legacy `.doc` is *not* supported — show a "save it as .docx" notice.
3. **Mode switching — back button, no yanking.** The panel has two modes:
   - `paper` — today's behavior (compiled PDF / agent-pushed preview).
   - `file` — a clicked file takes over the viewer; header shows **"← Paper"** + the file's
     relative path. Clicking another tree node switches the file.
   Compile/preview status events keep updating the *stored* paper state in the background but
   never steal the screen while in `file` mode. "← Paper" renders the freshest stored result.
4. **Plumbing — main-process bridge, not the sidecar.** File listing and byte reads go over the
   existing `window.api.paperino` IPC bridge (same channel the compiled PDF rides). The sidecar
   SDK's `file.read` is text-oriented and would mangle binaries; it also couples browsing to the
   sidecar being up.

## Architecture

### Main process (`packages/desktop/src/main/paperino/`)

Two new IPC handlers registered beside the existing watch/compile handlers:

- `paperino-list-files (dir)` → `string[]` of **relative, forward-slash** paths.
  Recursive; skips `.git` and `node_modules`; follows nothing (no symlink traversal);
  hard cap **5,000 entries** (stop walking, return what we have — the renderer shows a
  "listing truncated" note when the cap is hit).
- `paperino-read-file (dir, relPath)` → `{ bytes: Uint8Array }` or a typed error.
  **Path-traversal guard:** the resolved absolute path must stay inside `dir` (resolve + prefix
  check after normalization; reject `..`, absolute paths, drive changes). Size cap **50 MB**.

Preload exposes them as `api.paperino.listFiles(dir)` / `api.paperino.readFile(dir, relPath)`.

### Renderer (`packages/app/src/components/paperino/`)

- `paper-preview-panel.tsx` gains:
  - header folder-icon toggle (right side, next to the page count/status text),
  - `mode` signal: `{ kind: "paper" } | { kind: "file"; path: string }`,
  - tree sidebar: reuse **`FileTreeV2`** (`@/components/file-tree-v2`) fed by the flat path
    list from `listFiles` via its `allowed` prop; `onFileClick` → set file mode. Re-list every
    time the tree is opened, plus a small manual refresh button.
  - In `file` mode the existing pages container hosts the file viewer instead of the paper
    canvases. Paper state (last ok PDF, errors, compiling) is retained; returning re-renders it.
- New `file-preview.tsx`: given `(path, bytes)`, dispatches on a pure
  `classifyPreviewKind(path, bytes)`:

  | kind | trigger | renderer |
  |---|---|---|
  | `pdf` | `.pdf` | existing pdf.js canvas pipeline (shared with paper mode) |
  | `image` | `.png .jpg .jpeg .gif .svg .webp .bmp .ico` | `<img>` from object URL, `max-width: 100%`; URL revoked on cleanup/switch |
  | `docx` | `.docx` | mammoth `convertToHtml` on the ArrayBuffer, embedded images inlined as data URLs, output injected into a style-scoped container |
  | `doc-legacy` | `.doc` | notice: no JS renderer for the legacy binary format — save as .docx |
  | `text` | known text extensions (`tex bib txt md json jsonc yaml yml csv tsv toml py js ts tsx jsx mjs cls sty log cmd sh bat xml html css ini cfg r m`) **or** unknown extension that sniffs as valid UTF-8 without NUL bytes | monospace `<pre>`, scrollable; display cap **2 MB** (larger → "file too large to display") |
  | `binary` | everything else | "can't preview this file type" |

### Data flow

```
click node ──▶ api.paperino.readFile ──▶ classifyPreviewKind ──▶ renderer for kind
paperino watch status ──▶ stored paper state (always) ──▶ canvases (only when mode = paper)
"← Paper" ──▶ mode = paper ──▶ render stored PDF
```

## Error handling

Every failure shows an inline message in the viewer area — never a blank panel:
read failure ("file no longer exists" when ENOENT), size-cap exceeded, unrenderable type,
mammoth conversion error (fall back to the error notice, log details to console). Object URLs
are revoked when the file switches or the panel unmounts. A render token (same pattern the
paper renderer uses) prevents a slow read from clobbering a newer selection.

## Out of scope (deliberate)

- Thumbnails in the tree (SnipCut has them for video; papers don't need them v1).
- Editing files from the preview; the tree is read-only navigation.
- Markdown *rendered* view (`.md` shows as text v1).
- Watch-driven live tree updates (re-list on open + manual refresh is enough v1).

## Testing

- **Unit (bun test, app package):** `classifyPreviewKind` dispatch incl. UTF-8 sniff and 2 MB
  cap; listing filter (skips `.git`/`node_modules`, relative forward-slash output, 5,000 cap).
- **Unit (desktop package or extracted pure fn):** path-traversal guard (rejects `..`,
  absolute paths, backslash tricks; accepts nested legit paths).
- **Live (CDP :9222), acceptance in `TurboQuant-Research`:** open tree → click
  `main_updated.pdf` (15 pages render) → `figures/killer.pdf` → a `.tex` (text view) → a
  `.png` → a `.docx` (HTML view) → "← Paper" returns to the stored paper; recompile while in
  file mode does not steal the screen. Rule of this repo: verify against the running app, not
  only tests.

## New dependency

`mammoth` (renderer bundle only, BSD-2-Clause, no native modules).
