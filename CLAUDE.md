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
  failure. It must still exempt data-sourced *string* cells (`"5C"`), see through
  thousands separators, and ignore digits inside a formula (the 2 in σ² is an exponent,
  not a cell). This rule is the point of the subsystem — do not weaken it to make a
  figure pass.
- **v2 (2026-07-13) is publication-grade** (spec `2026-07-13-figure-studio-publication-grade-design.md`).
  The old north star was transformer-circuits — a *blog* — so tokens shipped Segoe UI and
  rounded pastel cards, `.mono` was the only way to write a symbol (hence monospace
  pseudo-math), and the review exemplars were blog screenshots. Now: tokens are the KaTeX
  dist's Computer-Modern-derived faces, math is real KaTeX in `.math` spans, and figures
  are authored **print-true** (528px = 5.5in text width, 312px = 3.25in column; 12px = 9pt
  at Chromium's 96dpi PDF mapping, so `\includegraphics[width=\linewidth]` lands ~1:1).
  Lint is 13 rules — `pseudo-math`, `web-chrome` (radius/shadow) and a `KaTeX_*`
  `font-allowlist` are hard failures.
- **KaTeX's hidden MathML twin is not ink.** KaTeX emits a MathML copy of every formula
  for screen readers, *clipped* rather than `display:none`, so it still has client rects.
  The render worker skips `.katex-mathml` — left in, it duplicated every glyph (bogus
  overlap), carried `font-family: math` (bogus font-allowlist), and its exponents read as
  untraceable numbers (bogus provenance). KaTeX internals are also exempt from the 7pt
  floor and from intra-formula overlap: LaTeX itself sets scripts at 7/5pt, and KaTeX
  absolutely positions glyph boxes.
- `figure_scaffold` **auto-refreshes** vendored `tokens.css` + `lib/` when the version
  marker on line 1 of tokens.css differs. Vendoring only-if-absent would strand existing
  workspaces on the design system they were born with. Exemplars are self-authored —
  regenerate with `bun test/author-exemplars.ts` after touching tokens or templates, and
  **look at the PNGs**: they are the bar the vision review steers every figure toward.

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

## Brand

Paperino's mark is a **sheet with a turned corner** ("Fold"), replacing opencode's nested
squares. `brand/paperino-mark.svg` is the geometry's source of truth; the same path data is
duplicated in `packages/ui/src/components/logo.tsx` (themed with the app's ink tokens) and in
`brand/make-icons.mjs` (rendered onto an ink tile for the app icon). Change one, change all three.

- The text rules are **cut out with `fill-rule="evenodd"`**, never painted in a background
  colour — the mark renders on light and dark grounds, and a "white" rule would show as a white
  slab on dark.
- `logo.tsx` exports `Mark`, `Splash` and `Logo`. **The v2 layout — the screen you actually land
  on — renders none of them**; it had a bare text wordmark. The mark is now in the
  `session-new-design-view` lockup, which is the only place it is seen day to day.
- `packages/ui` is vendor code: an upstream merge will revert the logo, exactly as it does the
  rest of the rebrand.
- Icons: `node brand/make-icons.mjs` writes `packages/desktop/icons/{dev,beta,prod}/`, then
  `bun scripts/copy-icons.ts dev` publishes them to `resources/icons`. **`resources/icons` is
  build output** — `copy-icons.ts` does `rm -rf` on it, so editing it directly is pointless. The
  icon sets are inside the untracked vendor tree; `brand/` is what is tracked, so the brand is
  reproducible rather than committed as 4 MB of binaries.
- **The dev taskbar icon is a third thing again.** A dev run's process is
  `node_modules/.../electron/dist/electron.exe`, and Windows caches a taskbar button's icon
  against the executable — so the app kept showing Electron's atom even with a correct window
  icon. `brand/patch-electron-exe.cmd` stamps the icon (and ProductName) onto that exe with the
  rcedit vendored inside `electron-winstaller`. It must run with the app **closed**, and
  `bun install` reverts it. Packaged builds don't need it.
  If the taskbar still shows the atom after patching, that is **Windows' shell icon cache**, not
  the app: verify with `[System.Drawing.Icon]::ExtractAssociatedIcon(exe)` and the window's own
  `WM_GETICON` — if those are the sheet, only `ie4uinit.exe -show`, an Explorer restart, or a
  sign-out will refresh the button.

## Packaging (the installable build)

`OPENCODE_CHANNEL=prod bun run prebuild && bun run build && bun run package:win` in
`packages/desktop` produces `dist/paperino-win-x64.exe` (~164 MB, NSIS one-click, auto-update
from GitHub Releases at `azamkhan555622848/Paperino`). `prebuild` runs
`scripts/stage-paperino.ts`, which assembles `resources-paperino/` — config template, tectonic,
jq, the node-target figures-mcp bundle, PaperBanana — and electron-builder ships it as
`<resources>/paperino`. That directory is **build output**: it is wiped on every prebuild.

Chromium and a portable CPython are *not* bundled; first-run setup downloads them into
userData (`src/main/paperino/setup.ts`). That is what keeps the installer ~150 MB.

- **The packaged app has no bun and no node.** figures-mcp runs on the app's own
  `electron.exe` via `ELECTRON_RUN_AS_NODE`, and so does its render worker
  (`PAPERINO_FIGURES_NODE`). Anything shipped must run on that runtime.
- **No install-time path may be baked into an artifact.** `opencode.packaged.jsonc` is a token
  template (`{{RESOURCES}}`, `{{USERDATA}}`, `{{ELECTRON}}`) rendered into userData on *every*
  boot. A hardcoded fallback is the failure mode to watch: figures-mcp shipped
  `C:\Users\<me>\...\jq.exe` as its jq default, which exists on exactly one machine. `dist.test.ts`
  now greps the bundle for it — **unescape the text first**, since the path is stored as JS
  source (`C:\\Users\\...`) and a naive `includes(homedir())` passes against a bundle that
  provably contains the bug.
- **The template's own comment gets substituted too.** Don't spell `{{TOKEN}}` in the header, or
  the generated file ends up describing itself as a template.

### Isolation from InteJer — the part that keeps biting

InteJer is built on this same fork and lives on the same machines. Three separate channels leak
its world into Paperino, and only the first is obvious:

1. **The machine-global `~/.config/opencode`** (InteJer's nine hardware MCP servers). Closed by
   pointing `XDG_CONFIG_HOME`/`XDG_DATA_HOME` inside userData. This is the only leak XDG closes.
2. **`~/.opencode`** — a config dir for *every* session, keyed off `os.homedir()`, so XDG cannot
   move it; skills are scanned from every config dir. On this machine it holds InteJer's ten IoT
   skills, and `debug skill` listed all of them for the paper agent. Closed by
   `OPENCODE_DISABLE_HOME_CONFIG` (added to core's `Flag`). It must filter the *assembled*
   directory list, not just the home lookup — the desktop bootstraps an instance whose directory
   IS the home dir, so the ordinary project up-walk finds `~/.opencode` anyway.
3. **`migrate()`'s Tauri import**, which copies every `.dat` out of `%APPDATA%/ai.opencode.desktop`.
   That is InteJer's directory; a clean Paperino install came up holding InteJer's project list.
   Packaged builds skip it — Paperino has no Tauri predecessor.

**`main/index.ts` has its own `APP_IDS`, separate from electron-builder's, and userData is keyed
off that one.** They drifted, so a packaged Paperino would have installed as `ai.paperino.desktop`
while writing state into InteJer's `ai.opencode.desktop`. A test now pins the two tables equal.
Unpackaged dev deliberately keeps the old id so `paperino-dev.cmd`'s store is not orphaned.

Verify isolation by *running the packaged app*, never by the tests — every one of these leaks
passed the suite. The checks: the sidecar log's `loading path=` lines must all sit inside userData;
`debug skill` (with the packaged env) must list only `docx`, `pdf`, `xlsx` and built-ins; and the
rendered config must contain no `{{` and no dev path.

- **electron-builder cannot rewrite `win-unpacked` while the packaged app is running** — it fails
  with `EBUSY: unlink app.asar` and leaves the directory with no exe. Close the app *before*
  packaging. If the lock outlives the process (a scanner holds the fresh 164 MB asar, and neither
  delete nor rename works), package to another output dir with
  `-c.directories.output=dist2` rather than hunting the handle.

## Onboarding: the ChatGPT subscription and the figure key

The first-run wizard (`components/paperino/onboarding-wizard.tsx`) is welcome → runtime setup →
sign in with ChatGPT → Nano Banana key. It does **not** reimplement OAuth: it opens the fork's own
`DialogConnectProvider` with `openai` preselected, *pushed* onto the dialog stack so the wizard
survives underneath it.

- **It must be mounted inside a ServerSync/ServerSDK subtree.** Solid resolves context through the
  *owner* chain, and `dialog.show` mounts with the caller's owner — so a wizard mounted on the
  router root throws `ServerSync context must be used within a context provider` the moment a step
  calls `useProviders`. That takes the whole app into the root ErrorBoundary while the dialog keeps
  its last painted DOM, so the symptom is a footer that advances over frozen content. Those
  providers are **per route**: `SelectedServerProviders` (home/sessions) and `ResolvedDraftRoute`
  (`/new-session`). No single ancestor has them, so the wizard is mounted in both, with a
  module-level flag so it shows at most once per run.
- **models.dev listing a model does not mean the subscription serves it.** The picker is fed from
  models.dev (fetched at runtime), but the authority is `chatgpt.com/backend-api/codex/responses`,
  and a model it refuses fails *silently* — the user sends a message and simply gets nothing back.
  Probed against a real account (2026-07-13): **`gpt-5.6-terra`, `gpt-5.6-sol` and `gpt-5.5` are
  served**; `gpt-5.6-luna` 404s ("Model not found"), and `gpt-5.6`, `gpt-5.3-codex` and even
  `gpt-5.3-codex-spark` (*which upstream allowlists*) return 400 "not supported when using Codex
  with a ChatGPT account". `codex.ts`'s `DISALLOWED_MODELS` therefore names every refusal, and its
  comment carries the probe table. Re-probe before adding an id; do not trust the catalog. Terra and
  Sol need no allowlist entry — they clear the `> 5.4` version rule on their own.
- **The figure key is one paste, either provider.** The wizard writes it under the `openrouter` or
  `google` provider id, and `paperbanana-mcp/server.py:resolve_credentials` reads it back out of
  `auth.json` by those exact names (honoring `XDG_DATA_HOME`, so a packaged build reads its own
  isolated store). The choice is load-bearing: OpenRouter namespaces model ids
  (`google/gemini-3.1-flash-image-preview`) and Google's own API takes the bare id — so the ids are
  derived from the resolved source and **must not** be pinned in the config. `apply_credentials()`
  also *pops* a stale `OPENROUTER_API_KEY` when Google wins, because OpenRouter beats Gemini in
  PaperBanana's own auto-detection and would otherwise be handed a Google key.

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
