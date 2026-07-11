# Paperino

An agentic desktop app for writing research papers of submission quality for top venues
(Nature family, NeurIPS/ICML/ICLR/ACL, NEJM/Lancet/JAMA, IEEE/ACM). It is a fork of the
`opencode` desktop app with one added UI surface — a right-hand **Preview** panel that
live-compiles LaTeX — plus MCP servers that give the agent literature, figure and table
capabilities.

The product's guiding constraint: **the agent never invents results.** Numbers come from
`artifacts/`, citations come from resolved DOIs. Where possible this is enforced
structurally (lint rules, machine-owned files), not by asking the model nicely.

## Repository geography

The git root is `C:/Users/azamk/Documents` — a mega-repo holding many unrelated projects.
Paperino is a subdirectory of it, on branch `feat/paperino`.

**Only ~77 files under `Paperino/` are tracked.** The opencode fork's vendor tree and all
of `PaperBanana-main/` are present on disk but untracked. Consequences:

- `git status` is permanently noisy, both with sibling projects and with fork vendor files.
  This is expected. It is not something to clean up.
- **Never `git add -A` or `git commit -a`.** Stage explicit paths.
- `Paperino/.gitignore` ignores only `tools/` and `**/.paperino/`. The pinned Tectonic and
  jq binaries are therefore *not* in version control — a fresh clone will not have them.

```
Paperino/
  opencode-dev/          Electron 42 fork (the chassis). Only our ~20 files are tracked.
    paperino-config/     PRODUCT SURFACE — see below. Not instructions for you.
    paperino-dev.cmd     The only supported launcher.
  figures-mcp/           TypeScript MCP server (bun): code-authored figures. 5 tools.
  paperbanana-mcp/       Python MCP server (own .venv, 3.12): image-generated figures.
  fixtures/demo-paper/   LaTeX workspace used by acceptance tests.
  fixtures/plain-project/  Non-paper project, for empty-state tests.
  docs/superpowers/      specs/ and plans/. Read the spec before changing a subsystem.
  tools/{tectonic,jq}/   Pinned binaries. Gitignored.
```

`opencode-dev/paperino-config/` is the **shipped agent's** configuration: `AGENTS.md` is
the system prompt Paperino's own agent reads at runtime, and `opencode.jsonc` registers the
MCP servers. Editing those files changes what the end user's agent does. They have no
effect on your behaviour. Do not confuse them with this file.

The `AGENTS.md` at `opencode-dev/` and under `packages/*/` are upstream opencode's
contributor notes, inherited with the fork. They are not ours.

## Running it

```
opencode-dev\paperino-dev.cmd
```

Never plain `bun run dev:desktop` — the wrapper sets `OPENCODE_CONFIG_DIR` (which selects
`paperino-config/`, so the agent gets the paper persona instead of InteJer's embedded/IoT
one) and `PAPERINO_TECTONIC` (which the Electron main process shells out to on every save).
Without them you get the wrong agent and a preview panel that cannot compile.

Note that the *global* `~/.config/opencode/opencode.jsonc` still merges in — that path is
read from `Global.Path.config`, which the env var does not override. It belongs to InteJer
and registers nine hardware MCP servers, which is why `paperino-config/opencode.jsonc`
disables them by name.

Driving the running app: dev builds always expose the Chrome DevTools Protocol on **port
9222**. Use `Runtime.evaluate` over `/json/list`. The renderer uses MemoryRouter, so there
is no URL to navigate — seed a project with `window.api.storeSet(...)` plus the
`opencode.desktop.window.<id>.last-active-url` localStorage key.

## Build invariants (each of these cost an hour to find)

- **Electron's postinstall never runs under bun.** If you see `Error: Electron uninstall`,
  run `node install.js` inside `packages/desktop/node_modules/electron`. The artifact to
  check for is that package's `path.txt`.
- **`packages/app/src/custom-elements.d.ts` is a symlink upstream** and was extracted as a
  text stub, which breaks typecheck. It now holds a copy of the real content. Do not
  "restore" it to a path string; creating symlinks here needs admin.
- **The v2 layout renders `pages/new-session.tsx`, not `pages/session.tsx`,** until a
  session exists. Anything that must always be visible — the Preview panel — is mounted in
  **both**.
- **Tectonic's `--outdir` must already exist,** and its errors report `\input` paths
  *without* the `.tex` extension (`sections/02-introduction:2:`). The error-parsing regex
  must not require an extension, or every error is misattributed to `main.tex`.
- **`compile()` publishes the PDF twice: `.paperino/main.pdf` (what the panel renders) and
  `main.pdf` beside `main.tex` (what the user opens).** Building only into `.paperino/` is
  what made the panel show a fresh paper while the `main.pdf` in the folder stayed months
  stale. The copy is best-effort — a PDF viewer holding the file open locks it on Windows,
  and a failed copy must not fail the compile.
  **`classifyChange` must therefore ignore a root-level `main.pdf`.** `SOURCE_RE` matches
  `.pdf` on purpose (Figure Studio emits figures as PDFs), so without that rule the copy
  reads as a source edit and the compile retriggers itself forever.

## figures-mcp

Code-authored figures: HTML for structure, CSS custom properties for style, `data.json` for
every number, one SVG overlay for arrows and braces. Five tools — `figure_scaffold`,
`figure_render`, `figure_lint`, `figure_review`, `data_query`. Tests: `bun test` (27).

- **Playwright hangs under bun.** It drives Chrome over `--remote-debugging-pipe` on fds
  3/4, which bun's spawn ignores; `chromium.launch()` simply never resolves. All browser
  work therefore runs in `src/render-worker.mjs`, spawned with **node**. Do not "simplify"
  this back into the bun process.
- Chrome blocks ES-module imports over `file://` (CORS), so the worker serves `figures/`
  over a loopback HTTP server.
- Text bounding boxes must be **one rect per `range.getClientRects()`**, not the union
  bbox — otherwise wrapped text false-positives the `text-overlap` rule.
- The annotation overlay pins page height to the initial viewport unless you measure the
  real content bottom (excluding `#annot-overlay`) and resize it. Skip that and every
  figure PDF carries dead whitespace.
- SVG presentation attributes do not resolve `var()`. Set stroke and fill via inline
  `style`.
- Lint rule 8 (`provenance`) makes a hallucinated number in a chart or table a hard
  failure. It must still exempt data-sourced *string* cells (`"5C"`) and see through
  thousands separators. This rule is the point of the subsystem — do not weaken it to make
  a figure pass.

## paperbanana-mcp

Wraps `PaperBanana-main`'s multi-agent pipeline (Planner → Stylist → Visualizer → Critic)
as one tool, `generate_figure`.

- **Do not import `demo.py`.** It imports streamlit and gradio at module top. The server
  constructs the `PaperVizProcessor` object graph directly instead.
- **The output is JPEG, not PNG,** despite result keys named `*_base64_jpg`. Sniff the
  magic bytes.
- Models are pinned in-process and are independent of the user's chat model: Nano Banana
  (`google/gemini-3.1-flash-image-preview`) for image synthesis, a vision-input VLM for the
  Critic. `OPENROUTER_API_KEY` is read from `~/.local/share/opencode/auth.json`, never from
  config.
- Generation takes a minute or more, so its MCP entry sets `timeout: 600000`.
- Its output is raster and therefore **exempt from figure lint** — nothing checks its
  numbers. That tradeoff is stated to the user, and the agent is required to offer both
  pipelines and wait for a choice before drawing anything.

## Office skills (xlsx / docx / pdf)

`paperino-config/skill/{xlsx,docx,pdf}/SKILL.md` — Anthropic's office skills, ported to
Windows. Nothing registers them: `discoverSkills()` scans every config dir for
`{skill,skills}/**/SKILL.md` and `OPENCODE_CONFIG_DIR` is one of those dirs, so dropping a
file in is enough. Verify with `bun packages/opencode/src/index.ts debug skill`.

- The originals target Anthropic's **Linux sandbox** — LibreOffice, pandoc, poppler, qpdf,
  plus `scripts/*.py` that were never shipped with the bodies. None of that exists here. The
  engines are Excel COM (`xlsx/scripts/recalc.py`), Word COM (`docx/scripts/word.py`) and
  pypdf/pypdfium2 (`pdf/scripts/render.py`). OCR is genuinely unsupported; the skill says so
  rather than faking it.
- **`DispatchEx`, never `Dispatch`.** `Dispatch` attaches to the Excel/Word the *user* already
  has open — and the script then sets `DisplayAlerts = False` and `Quit()`s it, taking their
  unsaved work with it. `DispatchEx` always spawns a private instance.
- **Office apps stay resident while any COM reference is alive.** Without an explicit reap,
  every run leaks a ~180 MB `EXCEL.EXE`. Both scripts kill **their own PID only** — never
  `taskkill /IM excel.exe`, which would close the user's workbooks.
- **Late-binding COM exposes `Range.Address` as a string property**, so `cell.Address(0, 0)` —
  the early-bound form in every tutorial — raises `'str' object is not callable`.
- The venv is `tools/pyoffice/.venv`, gitignored like Tectonic and jq, so a fresh clone lacks
  it. `paperino-config/skill/setup.cmd` rebuilds it from `requirements.txt`, and
  `paperino-dev.cmd` puts it first on `PATH` so a bare `python` in the app *is* that
  interpreter. Neither MCP server is disturbed (paperbanana uses an absolute python path,
  figures runs on bun).

## Product rules that must not regress

1. Agents never invent results, numbers, datasets or outcomes. Missing material is
   surfaced as a question, not filled with plausible fiction.
2. `references.bib` is machine-owned. Citations only come from a resolved DOI/arXiv/PMID.
3. Asked to *see* a document, the agent puts a PDF in `.paperino/preview.pdf` — it does not
   reply with a summary instead.
4. Asked for a figure, the agent offers Figure Studio vs PaperBanana and waits for the pick.

## Working here

Read the relevant file in `docs/superpowers/specs/` before changing a subsystem; the specs
record which decisions are locked and why. Verify against the running app, not only against
tests — the Tectonic path bug, the unmounted panel and the JPEG extension all passed tests
and failed in the app.
