# Paperino Chassis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fresh opencode-dev fork into "Paperino" — a paper-writing desktop app with a right-side live PDF preview of the LaTeX manuscript, a dedicated launch config, and a `/new-paper` workspace scaffold command.

**Architecture:** The opencode desktop app is **Electron** (main process `packages/desktop/src/main/`, preload bridge `packages/desktop/src/preload/`, SolidJS renderer in `packages/app`). All native work (Tectonic compile, file watching) lives in the Electron **main** process behind new IPC handlers; the renderer gets a self-contained `<PaperPreviewPanel>` (pdf.js) mounted as a sibling in the session page's flex row. Config/persona/commands live in a `paperino-config/` directory activated by `OPENCODE_CONFIG_DIR` from `paperino-dev.cmd`.

**Tech Stack:** Bun 1.3.14 workspaces, Electron 42 + electron-vite, SolidJS + Tailwind (renderer), `pdfjs-dist` (new dep), Tectonic 0.16.9 (LaTeX engine, standalone exe), node:fs.watch + node:child_process (main process).

## Global Constraints

- **Repo layout:** everything is inside the Documents mega-repo (git toplevel `C:\Users\azamk\Documents`). Work on branch **`feat/paperino`** (already exists and is checked out). Commit paths are relative to `C:\Users\azamk\Documents` (e.g. `Paperino/opencode-dev/...`).
- **The fork:** `C:\Users\azamk\Documents\Paperino\opencode-dev`. `bun install` has NOT been run yet — Task 1 does it.
- **Prettier (root package.json):** `semi: false`, `printWidth: 120`. No semicolons in TS/TSX.
- **Windows host.** Shell examples use PowerShell unless marked bash. Never rely on `.env` reaching the sidecar; env vars go in `paperino-dev.cmd` or config `environment` blocks.
- **Personal dev tool:** NO electron-builder/packaging changes, NO icon work, NO i18n sweep. Rebrand = app name + window title + in-app titlebar only.
- **Commit convention:** `feat(paperino): <what>` / `test(paperino): <what>`, each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. The mega-repo has a husky precommit — if it fails, fix the cause, don't `--no-verify`.
- **Verified source anchors (2026-07-09):** IPC deps pattern `packages/desktop/src/main/ipc.ts:44` (`registerIpcHandlers`); preload API object `packages/desktop/src/preload/index.ts:13-125` exposed as `window.api` (`contextBridge.exposeInMainWorld("api", api)` line 125); `ElectronAPI` type `packages/desktop/src/preload/types.ts:44-106`; session flex row `packages/app/src/pages/session.tsx:2186-2307` (mount point: before closing `</div>` at line 2307); app names `packages/desktop/src/main/index.ts:46-50`; window title `packages/desktop/src/main/windows.ts:179`; current-directory accessor `useSDK()` from `packages/app/src/context/sdk.tsx` (`sdk().directory`); MCP disable-by-merge shape `{"mcp": {"<name>": {"enabled": false}}}` (schema `packages/core/src/v1/config/config.ts:110-112`); command markdown discovery `{command,commands}/**/*.md` in `OPENCODE_CONFIG_DIR` (`packages/opencode/src/config/command.ts:13-39`).
- **Global MCP servers to disable (9, from `~/.config/opencode/opencode.jsonc`):** `freecad, kicad, partfetch, platformio, playwright, mongodb, thingsboard, embedded-debugger, stitch`.

---

### Task 1: Baseline — install deps, stock app launches

**Files:**
- No source changes. Produces `node_modules/` (not committed).

**Interfaces:**
- Produces: a working `bun run dev:desktop` baseline every later task depends on.

- [ ] **Step 1: Install workspace dependencies**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev
bun install
```

Expected: completes without errors (a few postinstall warnings are fine).

- [ ] **Step 2: Launch the stock desktop app**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev
bun run dev:desktop
```

Expected: `predev` builds the server (`script/build-node.ts`), then electron-vite opens an "OpenCode Dev" window with the chat UI. If the window opens and a session page renders, baseline is good. Close the app (and check Task Manager for orphaned `electron.exe`/`bun.exe` — kill them; orphans lock binaries on later launches).

- [ ] **Step 3: No commit** (nothing tracked changed). Mark task done.

---

### Task 2: Tectonic toolchain + fixture paper workspace

**Files:**
- Create: `C:\Users\azamk\Documents\Paperino\tools\tectonic\tectonic.exe` (downloaded, NOT committed)
- Create: `C:\Users\azamk\Documents\Paperino\.gitignore`
- Create: `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper\paperino.yaml`
- Create: `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper\main.tex`
- Create: `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper\sections\01-abstract.tex`
- Create: `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper\sections\02-introduction.tex`
- Create: `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper\artifacts\notes.md`

**Interfaces:**
- Produces: `tools\tectonic\tectonic.exe` (referenced by `PAPERINO_TECTONIC` env var in Tasks 3, 4, 7); `fixtures\demo-paper` — the compile target used by tests (Task 3) and manual verification (Tasks 5, 6, 9).

- [ ] **Step 1: Download and unpack Tectonic 0.16.9 (pinned)**

```powershell
New-Item -ItemType Directory -Force C:\Users\azamk\Documents\Paperino\tools\tectonic
Invoke-WebRequest -Uri "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.16.9/tectonic-0.16.9-x86_64-pc-windows-msvc.zip" -OutFile "$env:TEMP\tectonic.zip"
Expand-Archive "$env:TEMP\tectonic.zip" -DestinationPath C:\Users\azamk\Documents\Paperino\tools\tectonic -Force
& C:\Users\azamk\Documents\Paperino\tools\tectonic\tectonic.exe --version
```

Expected: `Tectonic 0.16.9`.

- [ ] **Step 2: Create `Paperino\.gitignore`**

```gitignore
tools/
**/.paperino/
```

- [ ] **Step 3: Create the fixture workspace**

`fixtures\demo-paper\paperino.yaml`:

```yaml
title: Paperino Demo Paper
venue: neurips
stage: drafting
```

`fixtures\demo-paper\main.tex`:

```latex
\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}

\title{Paperino Demo Paper}
\author{Azam Khan}

\begin{document}
\maketitle

\input{sections/01-abstract}
\input{sections/02-introduction}

\end{document}
```

`fixtures\demo-paper\sections\01-abstract.tex`:

```latex
\begin{abstract}
This fixture exercises the Paperino compile pipeline: a multi-file LaTeX
project with a main file that inputs section files.
\end{abstract}
```

`fixtures\demo-paper\sections\02-introduction.tex`:

```latex
\section{Introduction}
If this paragraph renders in the preview panel, the chassis works end to end.
```

`fixtures\demo-paper\artifacts\notes.md`:

```markdown
# Research artifacts
Placeholder — real paper workspaces put raw results, data and notes here.
```

- [ ] **Step 4: Compile the fixture manually (toolchain smoke test)**

```powershell
cd C:\Users\azamk\Documents\Paperino\fixtures\demo-paper
& C:\Users\azamk\Documents\Paperino\tools\tectonic\tectonic.exe --keep-logs --outdir .paperino main.tex
Test-Path .paperino\main.pdf
```

Expected: first run downloads TeX packages (takes a minute), then `Test-Path` prints `True`.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add .gitignore fixtures
git commit -m "feat(paperino): tectonic toolchain gitignore + demo-paper fixture workspace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Compile core in the Electron main process (pure logic, TDD)

**Files:**
- Create: `Paperino/opencode-dev/packages/desktop/src/main/paperino/core.ts`
- Test: `Paperino/opencode-dev/packages/desktop/src/main/paperino/core.test.ts`

**Interfaces:**
- Consumes: `tools\tectonic\tectonic.exe` + `fixtures\demo-paper` from Task 2 (via `PAPERINO_TECTONIC` env var).
- Produces (used by Task 4's IPC layer):
  - `type CompileError = { file: string; line: number | null; message: string }`
  - `type CompileResult = { ok: true; pdfPath: string; log: string } | { ok: false; errors: CompileError[]; log: string }`
  - `parseTectonicLog(log: string): CompileError[]`
  - `compile(dir: string): Promise<CompileResult>` — runs Tectonic, writes `<dir>/.paperino/compile.log`, PDF at `<dir>/.paperino/main.pdf`
  - `watchWorkspace(dir: string, onChange: () => void, debounceMs?: number): FSWatcher`
  - `isPaperWorkspace(dir: string): boolean` — true iff `paperino.yaml` AND `main.tex` exist in dir

No Electron imports in this file — that keeps it testable with plain `bun test`.

- [ ] **Step 1: Write the failing tests**

`packages/desktop/src/main/paperino/core.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { compile, isPaperWorkspace, parseTectonicLog } from "./core"

// core.test.ts lives at Paperino/opencode-dev/packages/desktop/src/main/paperino/
const PAPERINO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..", "..")
const FIXTURE = join(PAPERINO_ROOT, "fixtures", "demo-paper")
process.env.PAPERINO_TECTONIC = join(PAPERINO_ROOT, "tools", "tectonic", "tectonic.exe")

describe("parseTectonicLog", () => {
  test("extracts file, line and message from tectonic error lines", () => {
    const log = [
      "note: connecting to https://relay.fullyjustified.net",
      "error: sections/02-introduction.tex:3: Undefined control sequence.",
      "error: halted on potentially-recoverable error as specified",
    ].join("\n")
    const errors = parseTectonicLog(log)
    expect(errors[0]).toEqual({
      file: "sections/02-introduction.tex",
      line: 3,
      message: "Undefined control sequence.",
    })
  })

  test("errors without file:line still produce an entry", () => {
    const errors = parseTectonicLog('error: could not open "missing.tex"')
    expect(errors.length).toBe(1)
    expect(errors[0].line).toBe(null)
  })

  test("clean log produces no errors", () => {
    expect(parseTectonicLog("note: Running TeX ...\nnote: writing main.pdf")).toEqual([])
  })
})

describe("isPaperWorkspace", () => {
  test("true for the fixture, false for a non-workspace dir", () => {
    expect(isPaperWorkspace(FIXTURE)).toBe(true)
    expect(isPaperWorkspace(PAPERINO_ROOT)).toBe(false)
  })
})

describe("compile (integration, needs tectonic + network on first run)", () => {
  test("fixture compiles to .paperino/main.pdf and writes compile.log", async () => {
    const result = await compile(FIXTURE)
    expect(result.ok).toBe(true)
    if (result.ok) expect(existsSync(result.pdfPath)).toBe(true)
    expect(existsSync(join(FIXTURE, ".paperino", "compile.log"))).toBe(true)
  }, 180_000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev\packages\desktop
bun test src/main/paperino/core.test.ts
```

Expected: FAIL — `Cannot find module './core'`.

- [ ] **Step 3: Write the implementation**

`packages/desktop/src/main/paperino/core.ts`:

```ts
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"

export type CompileError = { file: string; line: number | null; message: string }

export type CompileResult = { ok: true; pdfPath: string; log: string } | { ok: false; errors: CompileError[]; log: string }

export const OUT_DIR = ".paperino"

function tectonicBinary() {
  return process.env.PAPERINO_TECTONIC || "tectonic"
}

export function isPaperWorkspace(dir: string): boolean {
  return existsSync(join(dir, "paperino.yaml")) && existsSync(join(dir, "main.tex"))
}

// Tectonic error lines: "error: <file>:<line>: <message>" or "error: <message>"
const ERROR_RE = /^error: (?:([^\s:]+\.(?:tex|bib|cls|sty)):(\d+):\s*)?(.+)$/gm
// This line follows real errors and adds no information of its own
const HALT_MESSAGE = "halted on potentially-recoverable error as specified"

export function parseTectonicLog(log: string): CompileError[] {
  const errors: CompileError[] = []
  for (const match of log.matchAll(ERROR_RE)) {
    const message = match[3].trim()
    if (message === HALT_MESSAGE && errors.length > 0) continue
    errors.push({ file: match[1] ?? "main.tex", line: match[2] ? Number(match[2]) : null, message })
  }
  return errors
}

export function compile(dir: string): Promise<CompileResult> {
  const outDir = join(dir, OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  return new Promise((resolve) => {
    execFile(
      tectonicBinary(),
      ["--keep-logs", "--outdir", outDir, "main.tex"],
      { cwd: dir, windowsHide: true, timeout: 120_000 },
      (error, stdout, stderr) => {
        const log = `${stdout}\n${stderr}`.trim()
        writeFileSync(join(outDir, "compile.log"), log)
        if (error) {
          const errors = parseTectonicLog(log)
          if (errors.length === 0) errors.push({ file: "main.tex", line: null, message: error.message })
          resolve({ ok: false, errors, log })
          return
        }
        resolve({ ok: true, pdfPath: join(outDir, "main.pdf"), log })
      },
    )
  })
}

// Files whose changes should trigger a recompile
const SOURCE_RE = /\.(tex|bib|yaml|png|jpe?g|pdf|svg)$/i

export function watchWorkspace(dir: string, onChange: () => void, debounceMs = 600): FSWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const name = filename.toString().replaceAll("\\", "/")
    if (name.startsWith(OUT_DIR)) return
    if (!SOURCE_RE.test(name)) return
    clearTimeout(timer)
    timer = setTimeout(onChange, debounceMs)
  })
  return watcher
}
```

Note: `.pdf` in `SOURCE_RE` is for user-supplied figure PDFs in `figures/`; the compiled output is excluded by the `OUT_DIR` check, so it cannot retrigger the watcher.

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev\packages\desktop
bun test src/main/paperino/core.test.ts
```

Expected: all tests PASS (the compile test may take ~1–2 min on first run while Tectonic downloads packages).

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add opencode-dev/packages/desktop/src/main/paperino
git commit -m "feat(paperino): tectonic compile core (parse/compile/watch) with tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: IPC handlers + preload bridge

**Files:**
- Create: `Paperino/opencode-dev/packages/desktop/src/main/paperino/ipc.ts`
- Modify: `Paperino/opencode-dev/packages/desktop/src/main/index.ts` (one import + one call, next to the existing `registerIpcHandlers(` call — find it with Grep)
- Modify: `Paperino/opencode-dev/packages/desktop/src/preload/types.ts` (add `PaperinoStatus`, `PaperinoCompileError`, and `paperino` field on `ElectronAPI`, types at lines 44-106)
- Modify: `Paperino/opencode-dev/packages/desktop/src/preload/index.ts` (add `paperino` implementation to the `api` object, lines 13-123)

**Interfaces:**
- Consumes (Task 3): `compile(dir)`, `isPaperWorkspace(dir)`, `watchWorkspace(dir, onChange)`, types `CompileError`, `CompileResult`.
- Produces (used by Task 5's renderer panel), on `window.api.paperino`:
  - `detect(dir: string): Promise<boolean>`
  - `watch(dir: string): Promise<void>` — starts watching + does an immediate first compile; statuses stream via `onStatus`
  - `unwatch(): Promise<void>`
  - `onStatus(cb: (status: PaperinoStatus) => void): () => void`
  - `type PaperinoCompileError = { file: string; line: number | null; message: string }`
  - `type PaperinoStatus = { state: "compiling" } | { state: "ok"; pdf: Uint8Array; log: string } | { state: "error"; errors: PaperinoCompileError[]; log: string }`

- [ ] **Step 1: Create the IPC module**

`packages/desktop/src/main/paperino/ipc.ts`:

```ts
import { readFile } from "node:fs/promises"
import type { FSWatcher } from "node:fs"
import { ipcMain } from "electron"
import type { WebContents } from "electron"
import { compile, isPaperWorkspace, watchWorkspace } from "./core"
import type { CompileError } from "./core"

type PaperinoStatus =
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string }
  | { state: "error"; errors: CompileError[]; log: string }

type WatchState = { watcher: FSWatcher }

const states = new Map<number, WatchState>()

function stop(id: number) {
  const state = states.get(id)
  if (!state) return
  state.watcher.close()
  states.delete(id)
}

export function registerPaperinoIpc() {
  ipcMain.handle("paperino-detect", (_event, dir: string) => isPaperWorkspace(dir))

  ipcMain.handle("paperino-watch", async (event, dir: string) => {
    const sender: WebContents = event.sender
    stop(sender.id)

    const send = (status: PaperinoStatus) => {
      if (!sender.isDestroyed()) sender.send("paperino-status", status)
    }

    let running = false
    let queued = false
    const run = async () => {
      if (running) {
        queued = true
        return
      }
      running = true
      send({ state: "compiling" })
      const result = await compile(dir)
      if (result.ok) {
        const pdf = new Uint8Array(await readFile(result.pdfPath))
        send({ state: "ok", pdf, log: result.log })
      } else {
        send({ state: "error", errors: result.errors, log: result.log })
      }
      running = false
      if (queued) {
        queued = false
        void run()
      }
    }

    const watcher = watchWorkspace(dir, () => void run())
    states.set(sender.id, { watcher })
    sender.once("destroyed", () => stop(sender.id))
    await run()
  })

  ipcMain.handle("paperino-unwatch", (event) => stop(event.sender.id))
}
```

- [ ] **Step 2: Register it in the main process**

Find the call site:

```
Grep pattern "registerIpcHandlers\(" in packages/desktop/src/main/index.ts (output_mode content, -n)
```

In `packages/desktop/src/main/index.ts`, add next to the existing import block:

```ts
import { registerPaperinoIpc } from "./paperino/ipc"
```

and immediately after the `registerIpcHandlers({ ... })` call add:

```ts
registerPaperinoIpc()
```

- [ ] **Step 3: Extend the preload types**

In `packages/desktop/src/preload/types.ts`, add above the `ElectronAPI` type:

```ts
export type PaperinoCompileError = { file: string; line: number | null; message: string }

export type PaperinoStatus =
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string }
  | { state: "error"; errors: PaperinoCompileError[]; log: string }
```

and inside the `ElectronAPI` type add the field:

```ts
paperino: {
  detect: (dir: string) => Promise<boolean>
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  onStatus: (cb: (status: PaperinoStatus) => void) => () => void
}
```

- [ ] **Step 4: Implement it in the preload bridge**

In `packages/desktop/src/preload/index.ts`, extend the type import on line 2 to include `PaperinoStatus`, and add to the `api` object (before the closing `}` at line 123):

```ts
paperino: {
  detect: (dir) => ipcRenderer.invoke("paperino-detect", dir),
  watch: (dir) => ipcRenderer.invoke("paperino-watch", dir),
  unwatch: () => ipcRenderer.invoke("paperino-unwatch"),
  onStatus: (cb) => {
    const handler = (_: unknown, status: PaperinoStatus) => cb(status)
    ipcRenderer.on("paperino-status", handler)
    return () => ipcRenderer.removeListener("paperino-status", handler)
  },
},
```

- [ ] **Step 5: Typecheck the desktop package**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev\packages\desktop
bun run typecheck
```

(If there is no `typecheck` script in `packages/desktop/package.json`, run `bun x tsc --noEmit -p .` instead.)
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add opencode-dev/packages/desktop/src/main/paperino/ipc.ts opencode-dev/packages/desktop/src/main/index.ts opencode-dev/packages/desktop/src/preload
git commit -m "feat(paperino): compile/watch IPC handlers + preload paperino bridge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Paper Preview panel in the renderer

**Files:**
- Modify: `Paperino/opencode-dev/packages/app/package.json` (add `pdfjs-dist` dependency)
- Create: `Paperino/opencode-dev/packages/app/src/components/paperino/paper-preview-panel.tsx`
- Modify: `Paperino/opencode-dev/packages/app/src/pages/session.tsx` (one import + one mount line before the closing `</div>` of the flex row at line 2307)

**Interfaces:**
- Consumes (Task 4): `window.api.paperino` bridge (`detect`, `watch`, `unwatch`, `onStatus`) and the `PaperinoStatus` shape. The panel defines its own local structural type for the bridge — it must NOT import from `packages/desktop` (separate build).
- Produces: `<PaperPreviewPanel />` — fully self-contained (detects workspace itself via `useSDK()().directory`; renders nothing when the project is not a paper workspace or `window.api` is absent).

- [ ] **Step 1: Add pdf.js**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev\packages\app
bun add pdfjs-dist
```

Note the version bun records in `package.json` — pdfjs-dist ≥ 4 is ESM with `pdf.worker.min.mjs`; the import below assumes that.

- [ ] **Step 2: Create the panel component**

`packages/app/src/components/paperino/paper-preview-panel.tsx`:

```tsx
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import * as pdfjs from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useSDK } from "@/context/sdk"

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type PaperinoCompileError = { file: string; line: number | null; message: string }
type PaperinoStatus =
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string }
  | { state: "error"; errors: PaperinoCompileError[]; log: string }
type PaperinoBridge = {
  detect: (dir: string) => Promise<boolean>
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  onStatus: (cb: (status: PaperinoStatus) => void) => () => void
}

const bridge = (): PaperinoBridge | undefined =>
  (window as { api?: { paperino?: PaperinoBridge } }).api?.paperino

const WIDTH_KEY = "paperino-panel-width"

export function PaperPreviewPanel() {
  const sdk = useSDK()
  const api = bridge()

  const [isWorkspace, setIsWorkspace] = createSignal(false)
  const [status, setStatus] = createSignal<PaperinoStatus>({ state: "compiling" })
  const [pageCount, setPageCount] = createSignal(0)
  const [width, setWidth] = createSignal(Number(localStorage.getItem(WIDTH_KEY)) || 480)

  let pages!: HTMLDivElement
  let renderToken = 0

  const renderPdf = async (data: Uint8Array) => {
    const token = ++renderToken
    // pdf.js transfers the buffer to its worker — hand it a copy
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise
    if (token !== renderToken) return
    const scroll = pages.scrollTop
    const canvases: HTMLCanvasElement[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const unscaled = page.getViewport({ scale: 1 })
      const scale = ((width() - 24) / unscaled.width) * window.devicePixelRatio
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement("canvas")
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / window.devicePixelRatio}px`
      canvas.style.height = `${viewport.height / window.devicePixelRatio}px`
      canvas.className = "block mx-auto mb-2 shadow"
      await page.render({ canvas, viewport }).promise
      canvases.push(canvas)
    }
    if (token !== renderToken) return
    pages.replaceChildren(...canvases)
    pages.scrollTop = scroll
    setPageCount(doc.numPages)
  }

  createEffect(() => {
    const dir = sdk().directory
    if (!api || !dir) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void api.detect(dir).then((ok) => {
      if (disposed) return
      setIsWorkspace(ok)
      if (!ok) return
      unsubscribe = api.onStatus((next) => {
        setStatus(next)
        if (next.state === "ok") void renderPdf(next.pdf)
      })
      void api.watch(dir)
    })
    // onCleanup must be registered synchronously in the effect scope (Solid rule) —
    // never inside the async .then above
    onCleanup(() => {
      disposed = true
      unsubscribe?.()
      void api.unwatch()
    })
  })

  const errors = () => {
    const s = status()
    return s.state === "error" ? s.errors : []
  }

  return (
    <Show when={api && isWorkspace()}>
      <div
        class="relative hidden md:flex h-full shrink-0 flex-col overflow-hidden border-l border-border-weaker-base bg-background-base"
        style={{ width: `${width()}px` }}
      >
        <div class="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-border-weaker-base">
          <div class="text-12-regular text-text-weak flex-1">Paper</div>
          <Show when={status().state === "compiling"}>
            <div class="text-12-regular text-text-weak">compiling…</div>
          </Show>
          <Show when={status().state === "ok"}>
            <div class="text-12-regular text-text-weak">{pageCount()} pages</div>
          </Show>
          <Show when={status().state === "error"}>
            <div class="text-12-regular text-red-500">compile failed</div>
          </Show>
        </div>
        <div ref={pages} class="flex-1 min-h-0 overflow-y-auto p-3" />
        <Show when={errors().length > 0}>
          <div class="max-h-32 shrink-0 overflow-y-auto border-t border-border-weaker-base px-3 py-2">
            <For each={errors()}>
              {(err) => (
                <div class="text-12-regular text-red-500">
                  {err.file}
                  {err.line !== null ? `:${err.line}` : ""} — {err.message}
                </div>
              )}
            </For>
          </div>
        </Show>
        <ResizeHandle
          direction="horizontal"
          edge="start"
          size={width()}
          min={320}
          max={900}
          onResize={(w) => {
            setWidth(w)
            localStorage.setItem(WIDTH_KEY, String(w))
          }}
        />
      </div>
    </Show>
  )
}
```

Layout note: "last good PDF stays on error" falls out of the design — canvases are only replaced on an `ok` status, so an error status just shows the footer while the previous render remains.

- [ ] **Step 3: Mount it in the session page**

In `packages/app/src/pages/session.tsx`:
- Add to the imports: `import { PaperPreviewPanel } from "@/components/paperino/paper-preview-panel"`
- At the end of the flex row — immediately BEFORE the closing `</div>` at line 2307 (the one after the `newSessionDesign()` `</Show>`) — add:

```tsx
        <PaperPreviewPanel />
```

This mounts it in both the legacy and v2 layouts (the component hides itself on mobile via `hidden md:flex`).

- [ ] **Step 4: Typecheck the app package**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev\packages\app
bun run typecheck
```

(If no `typecheck` script exists, run `bun x tsc --noEmit -p .`.)
Expected: no errors. If `?url` imports are untyped, add `/// <reference types="vite/client" />` — check whether `src/vite-env.d.ts` already exists first.

- [ ] **Step 5: Manual verification — the money shot**

```powershell
cd C:\Users\azamk\Documents\Paperino\opencode-dev
$env:PAPERINO_TECTONIC = "C:\Users\azamk\Documents\Paperino\tools\tectonic\tectonic.exe"
bun run dev:desktop
```

In the app: add/open project `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper`, open a session.
Expected: right-side "Paper" panel appears, shows "compiling…", then renders the 1-page PDF.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add opencode-dev/packages/app/package.json opencode-dev/packages/app/src/components/paperino opencode-dev/packages/app/src/pages/session.tsx opencode-dev/bun.lock
git commit -m "feat(paperino): live PDF paper preview panel (pdf.js) in session view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live-reload acceptance (edit → recompile → error handling)

**Files:**
- No new files — this task verifies Tasks 3–5 behave as a system and fixes what doesn't.

**Interfaces:**
- Consumes: the running app from Task 5 Step 5.

- [ ] **Step 1: Edit-triggers-recompile check**

With the app open on `fixtures\demo-paper`: edit `sections\02-introduction.tex` in any editor — change the paragraph text — and save.
Expected: within ~1s the panel shows "compiling…", then the updated PDF.

- [ ] **Step 2: Error path check**

Add a bogus command to `sections\02-introduction.tex`: `\thiscommanddoesnotexist`
Expected: footer shows `sections/02-introduction.tex:<line> — Undefined control sequence.` (file and line present), the previous good PDF is still displayed. Also verify `fixtures\demo-paper\.paperino\compile.log` contains the error text (this is what agents will read to self-fix).

- [ ] **Step 3: Recovery check**

Remove the bogus command, save.
Expected: error footer disappears, PDF re-renders.

- [ ] **Step 4: Fix anything that failed, then commit fixes (if any)**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add -A opencode-dev/packages
git commit -m "fix(paperino): live-reload acceptance fixes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip the commit if nothing changed.)

---

### Task 7: paperino-config + launcher (config, persona, /new-paper)

**Files:**
- Create: `Paperino/opencode-dev/paperino-config/opencode.jsonc`
- Create: `Paperino/opencode-dev/paperino-config/AGENTS.md`
- Create: `Paperino/opencode-dev/paperino-config/command/new-paper.md`
- Create: `Paperino/opencode-dev/paperino-dev.cmd`

**Interfaces:**
- Consumes: opencode config mechanics (verified): `OPENCODE_CONFIG_DIR` dir supplies `opencode.jsonc` + `AGENTS.md` + `command/*.md`; `{"enabled": false}` disables an inherited MCP server; `OPENCODE_DISABLE_GLOBAL_AGENTS=1` drops the global InteJer persona (pattern proven in cutai-dev.cmd).
- Produces: `paperino-dev.cmd` — THE way to launch Paperino from now on.

- [ ] **Step 1: Create `paperino-config/opencode.jsonc`**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // Default writing model — change freely in the model picker
  "model": "openrouter/anthropic/claude-sonnet-4.5",
  // Paperino does not use InteJer's hardware/IoT MCP servers (from the shared
  // global ~/.config/opencode/opencode.jsonc). Disable them all here.
  "mcp": {
    "freecad": { "enabled": false },
    "kicad": { "enabled": false },
    "partfetch": { "enabled": false },
    "platformio": { "enabled": false },
    "playwright": { "enabled": false },
    "mongodb": { "enabled": false },
    "thingsboard": { "enabled": false },
    "embedded-debugger": { "enabled": false },
    "stitch": { "enabled": false }
  }
}
```

- [ ] **Step 2: Create `paperino-config/AGENTS.md`**

```markdown
# Paperino — research-paper writing assistant

You are the writing engine of Paperino, a desktop app for producing research
papers of submission quality for top venues (Nature family, NeurIPS/ICML/ICLR/ACL,
NEJM/Lancet/JAMA, IEEE/ACM journals).

## The paper workspace

A paper is a folder containing:

- `paperino.yaml` — venue family, stage, title
- `main.tex` — venue template; `\input`s the section files
- `sections/` — numbered section files (`01-abstract.tex`, …). Edit THESE, not `main.tex`, for prose.
- `figures/` — generated and user-supplied figures
- `references.bib` — machine-owned; never hand-edit it (the literature tools own it)
- `artifacts/` — the user's raw research materials. READ-ONLY ground truth.
- `.paperino/` — build output. `compile.log` holds the latest LaTeX compile log; read it to diagnose and fix compile errors.

## Non-negotiable rules

1. **Ground every scientific claim in `artifacts/`.** You contribute structure,
   argumentation, and prose craft. You NEVER invent results, numbers, datasets,
   or experimental outcomes. If material is missing for a section, say what is
   missing and ask — do not fill the gap with plausible fiction.
2. **Never fabricate citations.** Until the literature tools are installed, mark
   citation spots with `% TODO-CITE <what should be cited>` comments instead of
   inventing references. Never write entries into `references.bib` by hand.
3. **The preview compiles on every save.** After editing `.tex` files, if the
   user reports a compile failure (or you see one in `.paperino/compile.log`),
   fix it before continuing.
4. **One section at a time.** Draft or revise a single section per pass and let
   the user react. Never regenerate a whole paper in one shot.
```

- [ ] **Step 3: Create `paperino-config/command/new-paper.md`**

````markdown
---
description: Scaffold a new Paperino paper workspace in the current project directory
---

Create a Paperino paper workspace for: $ARGUMENTS
(Interpret $ARGUMENTS as the paper title, optionally followed by a venue
keyword: nature | neurips | nejm | ieee. Default venue: neurips.)

Create exactly these files in the project root (ask first if any already exist):

1. `paperino.yaml`:

```yaml
title: <the title>
venue: <the venue keyword>
stage: drafting
```

2. `main.tex`:

```latex
\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}

\title{<the title>}
\author{}

\begin{document}
\maketitle

\input{sections/01-abstract}
\input{sections/02-introduction}
\input{sections/03-methods}
\input{sections/04-results}
\input{sections/05-discussion}

\end{document}
```

3. `sections/01-abstract.tex` through `sections/05-discussion.tex` — each
containing only its section header (e.g. `\section{Introduction}`; the abstract
file uses `\begin{abstract}\end{abstract}` instead) and a one-line
`% TODO: draft from artifacts/` comment. The abstract/section files must compile
as-is.

4. `artifacts/README.md` — explaining the user should drop raw research
materials (results, data, notes, code) here, and that everything written in the
paper must be grounded in this folder.

5. `.gitignore` containing `.paperino/`

After creating the files, tell the user the workspace is ready and that the
Paper panel will render the (skeleton) PDF once they save any `.tex` file —
then ask what research artifacts they want to add.
````

- [ ] **Step 4: Create `paperino-dev.cmd`** (modeled on the proven cutai-dev.cmd)

```bat
@echo off
REM ===========================================================================
REM Paperino - dev launcher for the research-paper-writing desktop app.
REM
REM Why a wrapper instead of plain `bun run dev:desktop`:
REM   - The opencode sidecar reads MCP servers from the shared global config
REM     (~/.config/opencode/opencode.jsonc), which belongs to InteJer and
REM     registers hardware servers. paperino-config/opencode.jsonc disables
REM     them and sets the writing model, without touching the global file.
REM   - OPENCODE_DISABLE_GLOBAL_AGENTS drops InteJer's embedded/IoT persona;
REM     OPENCODE_CONFIG_DIR points at paperino-config/, whose AGENTS.md defines
REM     the paper-writing persona and whose command/ dir has /new-paper.
REM   - PAPERINO_TECTONIC tells the desktop main process where the LaTeX
REM     engine lives (used by the Paper preview panel's compile pipeline).
REM
REM Usage:  paperino-dev.cmd      (run from anywhere; it cd's to its own folder)
REM ===========================================================================
setlocal
set "OPENCODE_CONFIG_DIR=C:/Users/azamk/Documents/Paperino/opencode-dev/paperino-config"
set "OPENCODE_DISABLE_GLOBAL_AGENTS=1"
set "PAPERINO_TECTONIC=C:\Users\azamk\Documents\Paperino\tools\tectonic\tectonic.exe"
set "PATH=C:\Users\azamk\Documents\Paperino\tools\tectonic;%PATH%"
cd /d "%~dp0"
call bun run dev:desktop
```

- [ ] **Step 5: Verify config takes effect**

Close any running instance, then run `paperino-dev.cmd`. In the app:
- MCP/tools list must NOT show the 9 disabled servers (check settings/MCP UI, or ask the agent "list your MCP servers").
- Type `/new-paper` in the prompt — the command must appear in the command list.
- Ask the agent "what are your grounding rules?" — the answer must reflect `paperino-config/AGENTS.md` (artifacts-only claims, TODO-CITE, one section at a time), not InteJer's hardware persona.
- Model picker should default to the OpenRouter model (needs the OpenRouter key configured once via the app's provider settings; `auth.json` is shared global state, so it may already be there).

- [ ] **Step 6: Run /new-paper end-to-end**

In the app, open a fresh empty folder as the project, run `/new-paper Demo Chassis Paper neurips`, let the agent scaffold, then save any `.tex` file.
Expected: workspace files created per the command spec; Paper panel appears and renders the skeleton PDF.

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add opencode-dev/paperino-config opencode-dev/paperino-dev.cmd
git commit -m "feat(paperino): launch config, writing persona, /new-paper scaffold command

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Minimal rebrand

**Files:**
- Modify: `Paperino/opencode-dev/packages/desktop/src/main/index.ts:46-50` (APP_NAMES)
- Modify: `Paperino/opencode-dev/packages/desktop/src/main/windows.ts:179` (window title)
- Modify: `Paperino/opencode-dev/packages/app/src/components/titlebar.tsx` (in-app brand text)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the app presents as "Paperino" (OS window title + in-app titlebar).

- [ ] **Step 1: App names in the main process**

In `packages/desktop/src/main/index.ts` lines 46-50, change the `APP_NAMES` values: `"OpenCode Dev"` → `"Paperino Dev"`, `"OpenCode Beta"` → `"Paperino Beta"`, `"OpenCode"` → `"Paperino"` (keys/structure unchanged).

- [ ] **Step 2: Window title**

In `packages/desktop/src/main/windows.ts` line 179, change `title: "OpenCode"` → `title: "Paperino"`.

- [ ] **Step 3: In-app titlebar brand**

Open `packages/app/src/components/titlebar.tsx` and locate the brand region (grep for `Mark` — the logo component from `@opencode-ai/ui/logo` — or the visible product name). Replace the rendered brand text with `Paperino` styled like the existing element (keep classes; this is the same lightweight swap the TISS fork did). If the titlebar renders only the `Mark` logo with no text, wrap it with a sibling `<span class="text-12-regular">Paperino</span>` inside the same flex container.

- [ ] **Step 4: Verify**

Run `paperino-dev.cmd`.
Expected: OS window title bar / taskbar shows "Paperino Dev" (dev channel name), in-app titlebar shows "Paperino".

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add opencode-dev/packages/desktop/src/main/index.ts opencode-dev/packages/desktop/src/main/windows.ts opencode-dev/packages/app/src/components/titlebar.tsx
git commit -m "feat(paperino): rebrand app name, window title and titlebar to Paperino

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Chassis exit gate

**Files:**
- None — final acceptance of the sub-project 1 exit criterion from the spec: *"edit a .tex file → PDF updates in-pane"*, via the real launcher.

- [ ] **Step 1: Cold-start acceptance run**

Kill all electron/bun orphans. Run `paperino-dev.cmd`. Open `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper` as the project.
Checklist:
1. Window titled "Paperino Dev"; titlebar shows "Paperino".
2. Paper panel renders the fixture PDF without any manual step.
3. Edit `sections\02-introduction.tex` → panel recompiles and updates.
4. `/new-paper` visible in the command menu; agent persona = paper-writing.
5. Agent has no InteJer hardware MCP tools.

- [ ] **Step 2: Regression check on stock behavior**

In the same session: chat responds, file tree opens, terminal panel opens — i.e. the fork didn't break stock opencode features touched by session.tsx.

- [ ] **Step 3: Report**

Summarize pass/fail per checklist item to the user. Any failure → fix, commit as `fix(paperino): ...`, re-run this task.
