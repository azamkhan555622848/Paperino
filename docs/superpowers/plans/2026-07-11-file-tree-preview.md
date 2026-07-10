# File Tree + Universal File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A folder icon in the Preview panel header opens a file tree of the project folder; clicking any file renders it in the panel (PDF, images, .docx as HTML, text), with a "← Paper" button back to the live paper.

**Architecture:** Two new IPC calls on the existing `window.api.paperino` main-process bridge supply the file listing and raw bytes. The renderer classifies each file with a pure function and dispatches to one of four renderers; the panel gains a `paper | file` mode signal so compile results never steal the screen. Spec: `docs/superpowers/specs/2026-07-11-file-tree-preview-design.md`.

**Tech Stack:** Electron main-process IPC (bun-typed TS), SolidJS renderer, pdf.js (existing), mammoth.js (new, .docx→HTML), existing `FileTreeV2` component, bun test.

## Global Constraints

- Git root is `C:/Users/azamk/Documents`; run git from `Paperino/`. **Never `git add -A` or `git commit -a`** — stage explicit paths only.
- All paths below are relative to `C:/Users/azamk/Documents/Paperino/` unless absolute.
- App-package tests: `cd opencode-dev/packages/app && bun test --preload ./happydom.ts <file>`. Desktop-package tests: `cd opencode-dev/packages/desktop && bun test <file>`.
- Typecheck: `bun run typecheck` inside the package you changed. Do not "fix" `packages/app/src/custom-elements.d.ts` (it intentionally holds copied content, not a symlink path string).
- Launch the app only via `opencode-dev\paperino-dev.cmd` (sets `OPENCODE_CONFIG_DIR` + `PAPERINO_TECTONIC`). Dev builds expose CDP on port 9222.
- Verify against the running app, not only tests — this repo has had three bugs that passed tests and failed in the app.
- Caps from the spec, verbatim: listing **5,000 entries**, read **50 MB**, text display **2 MB**.
- New dependency allowed: `mammoth` only (renderer bundle, BSD-2-Clause). No other new deps.

---

### Task 1: Main-process file access (`files.ts`) + IPC + preload

**Files:**
- Create: `opencode-dev/packages/desktop/src/main/paperino/files.ts`
- Test: `opencode-dev/packages/desktop/src/main/paperino/files.test.ts`
- Modify: `opencode-dev/packages/desktop/src/main/paperino/ipc.ts` (add two `ipcMain.handle` calls at the end of `registerPaperinoIpc`, after the `"paperino-unwatch"` handler at line 89)
- Modify: `opencode-dev/packages/desktop/src/preload/types.ts` (extend `PaperinoAPI`, ends line 57)
- Modify: `opencode-dev/packages/desktop/src/preload/index.ts` (extend the `paperino:` object, lines 14–23)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `listWorkspaceFiles(dir: string, cap?: number): Promise<{ files: string[]; truncated: boolean }>` — relative forward-slash paths, sorted per directory, `.git`/`node_modules` skipped, symlinks not traversed.
  - `resolveWithin(dir: string, relPath: string): string | undefined` — absolute path or undefined if escape attempt.
  - `readWorkspaceFile(dir: string, relPath: string, cap?: number): Promise<ReadFileResult>` where `type ReadFileResult = { ok: true; bytes: Uint8Array } | { ok: false; error: "invalid-path" | "not-found" | "too-large" }`.
  - Renderer-visible API (Task 5 consumes): `api.paperino.listFiles(dir)` → `{ files, truncated }`; `api.paperino.readFile(dir, relPath)` → `ReadFileResult`.

- [ ] **Step 1: Write the failing test**

Create `opencode-dev/packages/desktop/src/main/paperino/files.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listWorkspaceFiles, readWorkspaceFile, resolveWithin } from "./files"

const root = mkdtempSync(join(tmpdir(), "paperino-files-"))
mkdirSync(join(root, "figures"), { recursive: true })
mkdirSync(join(root, ".git"), { recursive: true })
mkdirSync(join(root, "node_modules", "pkg"), { recursive: true })
writeFileSync(join(root, "main.tex"), "\\documentclass{article}")
writeFileSync(join(root, "figures", "plot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
writeFileSync(join(root, ".git", "config"), "[core]")
writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module.exports = {}")

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("listWorkspaceFiles", () => {
  test("recursive, relative, forward slashes, skips .git and node_modules", async () => {
    const result = await listWorkspaceFiles(root)
    expect(result.files).toEqual(["figures/plot.png", "main.tex"])
    expect(result.truncated).toBe(false)
  })

  test("stops at the cap and reports truncation", async () => {
    const result = await listWorkspaceFiles(root, 1)
    expect(result.files.length).toBe(1)
    expect(result.truncated).toBe(true)
  })
})

describe("resolveWithin", () => {
  test("accepts nested relative paths", () => {
    expect(resolveWithin(root, "figures/plot.png")).toBe(join(root, "figures", "plot.png"))
  })
  test("rejects traversal, absolute paths, empty and the dir itself", () => {
    expect(resolveWithin(root, "../evil.txt")).toBeUndefined()
    expect(resolveWithin(root, "figures/../../evil.txt")).toBeUndefined()
    expect(resolveWithin(root, "C:/Windows/system.ini")).toBeUndefined()
    expect(resolveWithin(root, "")).toBeUndefined()
    expect(resolveWithin(root, ".")).toBeUndefined()
  })
})

describe("readWorkspaceFile", () => {
  test("returns bytes for a real file", async () => {
    const result = await readWorkspaceFile(root, "main.tex")
    if (!result.ok) throw new Error("expected ok")
    expect(new TextDecoder().decode(result.bytes)).toBe("\\documentclass{article}")
  })
  test("not-found for missing files and directories", async () => {
    expect(await readWorkspaceFile(root, "nope.txt")).toEqual({ ok: false, error: "not-found" })
    expect(await readWorkspaceFile(root, "figures")).toEqual({ ok: false, error: "not-found" })
  })
  test("invalid-path for traversal", async () => {
    expect(await readWorkspaceFile(root, "../evil.txt")).toEqual({ ok: false, error: "invalid-path" })
  })
  test("too-large above the cap", async () => {
    expect(await readWorkspaceFile(root, "main.tex", 4)).toEqual({ ok: false, error: "too-large" })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd opencode-dev/packages/desktop && bun test src/main/paperino/files.test.ts`
Expected: FAIL — `Cannot find module './files'`.

- [ ] **Step 3: Implement `files.ts`**

Create `opencode-dev/packages/desktop/src/main/paperino/files.ts`:

```ts
import { readFile as fsReadFile, readdir, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

export const LIST_CAP = 5000
export const READ_CAP = 50 * 1024 * 1024

const SKIP_DIRS = new Set([".git", "node_modules"])

export type ListFilesResult = { files: string[]; truncated: boolean }
export type ReadFileResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: "invalid-path" | "not-found" | "too-large" }

export async function listWorkspaceFiles(dir: string, cap = LIST_CAP): Promise<ListFilesResult> {
  const files: string[] = []
  let truncated = false
  const walk = async (abs: string, rel: string) => {
    if (truncated) return
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (truncated) return
      if (SKIP_DIRS.has(entry.name)) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      // withFileTypes reports symlinks as symlinks, not as their target,
      // so neither branch matches — links are never traversed or listed.
      if (entry.isDirectory()) {
        await walk(join(abs, entry.name), childRel)
      } else if (entry.isFile()) {
        if (files.length >= cap) {
          truncated = true
          return
        }
        files.push(childRel)
      }
    }
  }
  await walk(dir, "")
  return { files, truncated }
}

export function resolveWithin(dir: string, relPath: string): string | undefined {
  if (!relPath || typeof relPath !== "string") return undefined
  const base = resolve(dir)
  const target = resolve(base, relPath)
  if (target === base) return undefined
  if (!target.startsWith(base + sep)) return undefined
  return target
}

export async function readWorkspaceFile(dir: string, relPath: string, cap = READ_CAP): Promise<ReadFileResult> {
  const target = resolveWithin(dir, relPath)
  if (!target) return { ok: false, error: "invalid-path" }
  let info
  try {
    info = await stat(target)
  } catch {
    return { ok: false, error: "not-found" }
  }
  if (!info.isFile()) return { ok: false, error: "not-found" }
  if (info.size > cap) return { ok: false, error: "too-large" }
  try {
    return { ok: true, bytes: new Uint8Array(await fsReadFile(target)) }
  } catch {
    return { ok: false, error: "not-found" }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd opencode-dev/packages/desktop && bun test src/main/paperino/files.test.ts`
Expected: PASS (7 tests). Also run `bun test src/main/paperino/` to confirm `core.test.ts` still passes.

- [ ] **Step 5: Register the IPC handlers**

In `opencode-dev/packages/desktop/src/main/paperino/ipc.ts`, add to the imports:

```ts
import { listWorkspaceFiles, readWorkspaceFile } from "./files"
```

and inside `registerPaperinoIpc()`, directly after the `"paperino-unwatch"` handler line:

```ts
  ipcMain.handle("paperino-list-files", (_event, dir: string) => listWorkspaceFiles(dir))

  ipcMain.handle("paperino-read-file", (_event, dir: string, relPath: string) => readWorkspaceFile(dir, relPath))
```

- [ ] **Step 6: Expose the calls through the preload**

In `opencode-dev/packages/desktop/src/preload/types.ts`, the `PaperinoAPI` type currently ends with `onStatus`. Add two members before its closing brace:

```ts
  listFiles: (dir: string) => Promise<{ files: string[]; truncated: boolean }>
  readFile: (
    dir: string,
    relPath: string,
  ) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: "invalid-path" | "not-found" | "too-large" }>
```

In `opencode-dev/packages/desktop/src/preload/index.ts`, inside the `paperino: { ... }` object (after the `onStatus` entry), add:

```ts
    listFiles: (dir) => ipcRenderer.invoke("paperino-list-files", dir),
    readFile: (dir, relPath) => ipcRenderer.invoke("paperino-read-file", dir, relPath),
```

Note: Electron structured-clones the result; the renderer receives `bytes` as a `Uint8Array` (possibly a `Buffer` view — Task 4 copies it before handing it to `Blob`/pdf.js).

- [ ] **Step 7: Typecheck and commit**

Run: `cd opencode-dev/packages/desktop && bun run typecheck`
Expected: exit 0.

```bash
cd /c/Users/azamk/Documents/Paperino
git add opencode-dev/packages/desktop/src/main/paperino/files.ts \
        opencode-dev/packages/desktop/src/main/paperino/files.test.ts \
        opencode-dev/packages/desktop/src/main/paperino/ipc.ts \
        opencode-dev/packages/desktop/src/preload/types.ts \
        opencode-dev/packages/desktop/src/preload/index.ts
git commit -m "feat(preview): main-process file listing + byte reads over the paperino bridge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `classifyPreviewKind` — pure file-type classification

**Files:**
- Create: `opencode-dev/packages/app/src/components/paperino/preview-kind.ts`
- Test: `opencode-dev/packages/app/src/components/paperino/preview-kind.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 4 consumes):
  - `type PreviewKind = "pdf" | "image" | "docx" | "doc-legacy" | "text" | "binary"`
  - `classifyPreviewKind(path: string, bytes: Uint8Array): PreviewKind`
  - `extensionOf(path: string): string` (lowercase, no dot, `""` for none/dotfiles)
  - `imageMime(ext: string): string`
  - `looksLikeUtf8Text(bytes: Uint8Array): boolean`
  - `TEXT_DISPLAY_CAP` = 2 MB (number of bytes)

- [ ] **Step 1: Write the failing test**

Create `opencode-dev/packages/app/src/components/paperino/preview-kind.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { classifyPreviewKind, extensionOf, imageMime, looksLikeUtf8Text } from "./preview-kind"

const utf8 = (s: string) => new TextEncoder().encode(s)

describe("extensionOf", () => {
  test("lowercases, handles dotfiles and multi-dot names", () => {
    expect(extensionOf("figures/plot.PNG")).toBe("png")
    expect(extensionOf(".gitignore")).toBe("")
    expect(extensionOf("archive.tar.gz")).toBe("gz")
    expect(extensionOf("README")).toBe("")
  })
})

describe("classifyPreviewKind", () => {
  test("dispatches pdf, image, docx, legacy doc by extension", () => {
    expect(classifyPreviewKind("out/main.pdf", utf8("%PDF-1.5"))).toBe("pdf")
    expect(classifyPreviewKind("figures/plot.PNG", new Uint8Array([0x89]))).toBe("image")
    expect(classifyPreviewKind("draft.docx", new Uint8Array([0x50, 0x4b]))).toBe("docx")
    expect(classifyPreviewKind("old.doc", new Uint8Array())).toBe("doc-legacy")
  })

  test("known text extensions are text regardless of content", () => {
    expect(classifyPreviewKind("main.tex", utf8("\\documentclass"))).toBe("text")
    expect(classifyPreviewKind("refs.bib", utf8("@article{}"))).toBe("text")
    expect(classifyPreviewKind("weird.log", new Uint8Array([0xff, 0xfe, 0x00]))).toBe("text")
  })

  test("known binary extensions never sniff as text", () => {
    expect(classifyPreviewKind("model.stl", utf8("solid ascii"))).toBe("binary")
    expect(classifyPreviewKind("bundle.zip", utf8("PK"))).toBe("binary")
  })

  test("unknown extensions sniff UTF-8", () => {
    expect(classifyPreviewKind("notes.whatever", utf8("plain text content"))).toBe("text")
    expect(classifyPreviewKind("Makefile", utf8("all:\n\techo hi"))).toBe("text")
    expect(classifyPreviewKind("blob.whatever", new Uint8Array([0x00, 0x01, 0x02]))).toBe("binary")
  })
})

describe("looksLikeUtf8Text", () => {
  test("NUL byte means binary", () => {
    expect(looksLikeUtf8Text(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false)
  })
  test("invalid UTF-8 means binary", () => {
    expect(looksLikeUtf8Text(new Uint8Array([0xc3, 0x28]))).toBe(false)
  })
  test("a multibyte char cut at the 8 KB sample boundary is still text", () => {
    const bytes = new Uint8Array(8195).fill(0x61)
    bytes.set([0xe2, 0x82], 8191) // 3-byte "€" starts at 8191; the 8192 sample cuts it mid-sequence
    bytes[8193] = 0xac
    expect(looksLikeUtf8Text(bytes)).toBe(true)
  })
})

describe("imageMime", () => {
  test("maps every supported image extension", () => {
    expect(imageMime("png")).toBe("image/png")
    expect(imageMime("jpg")).toBe("image/jpeg")
    expect(imageMime("jpeg")).toBe("image/jpeg")
    expect(imageMime("svg")).toBe("image/svg+xml")
    expect(imageMime("gif")).toBe("image/gif")
    expect(imageMime("webp")).toBe("image/webp")
    expect(imageMime("bmp")).toBe("image/bmp")
    expect(imageMime("ico")).toBe("image/x-icon")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd opencode-dev/packages/app && bun test --preload ./happydom.ts src/components/paperino/preview-kind.test.ts`
Expected: FAIL — `Cannot find module './preview-kind'`.

- [ ] **Step 3: Implement `preview-kind.ts`**

Create `opencode-dev/packages/app/src/components/paperino/preview-kind.ts`:

```ts
export type PreviewKind = "pdf" | "image" | "docx" | "doc-legacy" | "text" | "binary"

export const TEXT_DISPLAY_CAP = 2 * 1024 * 1024

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"])

const TEXT_EXT = new Set([
  "tex", "bib", "txt", "md", "json", "jsonc", "yaml", "yml", "csv", "tsv", "toml",
  "py", "js", "ts", "tsx", "jsx", "mjs", "cls", "sty", "log", "cmd", "sh", "bat",
  "xml", "html", "css", "ini", "cfg", "r", "m",
])

// Extensions we know are binary — without this, formats whose header happens to
// decode as UTF-8 (ASCII STL, zip's "PK") would false-positive the text sniff.
const BINARY_EXT = new Set([
  "zip", "gz", "7z", "rar", "tar", "exe", "dll", "so", "dylib", "bin", "dat",
  "stl", "step", "stp", "fcstd", "pyc", "class", "o", "obj", "wasm",
  "ttf", "otf", "woff", "woff2", "eot",
  "mp4", "mov", "avi", "mkv", "webm", "mp3", "wav", "flac", "ogg",
])

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
}

export function extensionOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

export function imageMime(ext: string) {
  return MIME[ext] ?? "application/octet-stream"
}

export function looksLikeUtf8Text(bytes: Uint8Array) {
  const sample = bytes.subarray(0, 8192)
  if (sample.includes(0)) return false
  try {
    // stream: true tolerates a multibyte sequence cut off at the sample boundary
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true })
    return true
  } catch {
    return false
  }
}

export function classifyPreviewKind(path: string, bytes: Uint8Array): PreviewKind {
  const ext = extensionOf(path)
  if (ext === "pdf") return "pdf"
  if (IMAGE_EXT.has(ext)) return "image"
  if (ext === "docx") return "docx"
  if (ext === "doc") return "doc-legacy"
  if (TEXT_EXT.has(ext)) return "text"
  if (BINARY_EXT.has(ext)) return "binary"
  return looksLikeUtf8Text(bytes) ? "text" : "binary"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd opencode-dev/packages/app && bun test --preload ./happydom.ts src/components/paperino/preview-kind.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents/Paperino
git add opencode-dev/packages/app/src/components/paperino/preview-kind.ts \
        opencode-dev/packages/app/src/components/paperino/preview-kind.test.ts
git commit -m "feat(preview): pure file-type classification for the file preview

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `PdfPages` from the panel (behavior-preserving refactor)

**Files:**
- Create: `opencode-dev/packages/app/src/components/paperino/pdf-pages.tsx`
- Modify: `opencode-dev/packages/app/src/components/paperino/paper-preview-panel.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 4 and 5 consume): `PdfPages(props: { data: Uint8Array | undefined; onPageCount?: (n: number) => void })` — renders PDF pages as canvases into its own scroll container; re-renders when `data` changes; clears when `data` is undefined. Owns the pdf.js worker registration.

- [ ] **Step 1: Create `pdf-pages.tsx`**

Move the pdf.js logic out of `paper-preview-panel.tsx` (the `renderPdf` function, lines 38–65, and the pdfjs imports/worker setup, lines 2–8) into a component:

```tsx
import { createEffect, onCleanup } from "solid-js"
import * as pdfjs from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export function PdfPages(props: { data: Uint8Array | undefined; onPageCount?: (n: number) => void }) {
  let pages!: HTMLDivElement
  let renderToken = 0

  const render = async (data: Uint8Array) => {
    const token = ++renderToken
    // pdf.js transfers the buffer to its worker — hand it a copy
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise
    if (token !== renderToken) return
    const scroll = pages.scrollTop
    // clientWidth already excludes the vertical scrollbar; subtract the p-3 padding
    const available = Math.max(200, pages.clientWidth - 24)
    const canvases: HTMLCanvasElement[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const unscaled = page.getViewport({ scale: 1 })
      const scale = (available / unscaled.width) * window.devicePixelRatio
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
    props.onPageCount?.(doc.numPages)
  }

  createEffect(() => {
    const data = props.data
    if (!data) {
      renderToken++
      pages.replaceChildren()
      props.onPageCount?.(0)
      return
    }
    void render(data)
  })

  onCleanup(() => {
    renderToken++
  })

  return <div ref={pages} class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3" />
}
```

- [ ] **Step 2: Rewire `paper-preview-panel.tsx` to use it**

In `paper-preview-panel.tsx`:
1. Delete the pdfjs imports (`import * as pdfjs ...`, `import workerUrl ...`) and the `pdfjs.GlobalWorkerOptions.workerSrc = workerUrl` line; import `{ PdfPages }` from `"./pdf-pages"` instead.
2. Delete the local `renderPdf`, the `pages` ref variable, and `renderToken`.
3. Add a signal holding the last good paper PDF:

```ts
const [paperPdf, setPaperPdf] = createSignal<Uint8Array>()
```

4. In the `onStatus` subscription (`api.onStatus((next) => ...)`), replace `if (next.state === "ok") void renderPdf(next.pdf)` with `if (next.state === "ok") setPaperPdf(next.pdf)`.
5. In `previewDocument`, replace `await renderPdf(pdf)` with `setPaperPdf(pdf)` (keep the `setStatus` call).
6. In the project-switch `createEffect`, replace the `renderToken++ / pages?.replaceChildren() / setPageCount(0)` lines with `setPaperPdf(undefined)` (keep `setStatus({ state: "empty" })`; `PdfPages` clears itself and reports page count 0).
7. Replace the JSX `<div ref={pages} class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3" />` with:

```tsx
<PdfPages data={paperPdf()} onPageCount={setPageCount} />
```

Behavior note (must hold): on a compile **error**, `paperPdf` is not cleared — the last good render stays visible with the error strip below, exactly as today.

- [ ] **Step 3: Typecheck and run existing app unit tests**

Run: `cd opencode-dev/packages/app && bun run typecheck && bun run test:unit`
Expected: exit 0; no test regressions (this refactor has no unit tests of its own — pdf.js rendering is only verifiable live, which Task 6 covers).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents/Paperino
git add opencode-dev/packages/app/src/components/paperino/pdf-pages.tsx \
        opencode-dev/packages/app/src/components/paperino/paper-preview-panel.tsx
git commit -m "refactor(preview): extract PdfPages so paper and file previews share one PDF renderer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `FilePreview` component + mammoth dependency + docx fixture

**Files:**
- Create: `opencode-dev/packages/app/src/components/paperino/file-preview.tsx`
- Create (only if typecheck demands it): `opencode-dev/packages/app/src/types/mammoth-browser.d.ts`
- Create: `fixtures/demo-paper/notes.docx` (committed binary fixture for acceptance testing)
- Modify: `opencode-dev/packages/app/package.json` (via `bun add mammoth`)

**Interfaces:**
- Consumes: `classifyPreviewKind`, `extensionOf`, `imageMime`, `TEXT_DISPLAY_CAP` (Task 2); `PdfPages` (Task 3).
- Produces (Task 5 consumes):
  - `type FilePreviewState = { path: string; bytes?: Uint8Array; error?: "invalid-path" | "not-found" | "too-large" | "read-failed" }`
  - `FilePreview(props: { state: FilePreviewState })` — renders the file (or an inline error/notice), fills its flex parent.

- [ ] **Step 1: Add the mammoth dependency**

Run: `cd opencode-dev/packages/app && bun add mammoth`
Expected: `mammoth` appears in `package.json` dependencies. (Renderer bundle only; BSD-2-Clause; pure JS.)

- [ ] **Step 2: Implement `file-preview.tsx`**

```tsx
import { Match, Show, Switch, createEffect, createResource, createSignal, onCleanup } from "solid-js"
import { PdfPages } from "./pdf-pages"
import { TEXT_DISPLAY_CAP, classifyPreviewKind, extensionOf, imageMime } from "./preview-kind"

export type FilePreviewState = {
  path: string
  bytes?: Uint8Array
  error?: "invalid-path" | "not-found" | "too-large" | "read-failed"
}

function Notice(props: { children: string }) {
  return (
    <div class="flex-1 min-h-0 flex items-center justify-center px-8">
      <div class="text-12-regular text-text-weak text-center max-w-64">{props.children}</div>
    </div>
  )
}

const ERROR_TEXT: Record<NonNullable<FilePreviewState["error"]>, string> = {
  "invalid-path": "This path is outside the project folder.",
  "not-found": "This file no longer exists.",
  "too-large": "This file is larger than 50 MB and cannot be previewed.",
  "read-failed": "The file could not be read.",
}

export function FilePreview(props: { state: FilePreviewState }) {
  const kind = () => {
    const bytes = props.state.bytes
    if (!bytes) return undefined
    return classifyPreviewKind(props.state.path, bytes)
  }

  // Image object URL: created per (path, bytes), revoked on switch/unmount.
  const [imgUrl, setImgUrl] = createSignal<string>()
  createEffect(() => {
    const bytes = props.state.bytes
    if (kind() !== "image" || !bytes) {
      setImgUrl(undefined)
      return
    }
    // IPC hands back a Buffer view over a shared pool — copy before wrapping
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: imageMime(extensionOf(props.state.path)) }))
    setImgUrl(url)
    onCleanup(() => URL.revokeObjectURL(url))
  })

  const [docxHtml] = createResource(
    () => (kind() === "docx" ? { path: props.state.path, bytes: props.state.bytes! } : undefined),
    async (input) => {
      const mammoth = await import("mammoth/mammoth.browser")
      const copy = input.bytes.slice()
      const result = await mammoth.convertToHtml({ arrayBuffer: copy.buffer })
      return result.value
    },
  )

  const text = () => {
    const bytes = props.state.bytes
    if (!bytes) return ""
    return new TextDecoder().decode(bytes)
  }

  return (
    <Switch fallback={<Notice>Reading file…</Notice>}>
      <Match when={props.state.error}>{(error) => <Notice>{ERROR_TEXT[error()]}</Notice>}</Match>
      <Match when={kind() === "pdf"}>
        <PdfPages data={props.state.bytes} />
      </Match>
      <Match when={kind() === "image"}>
        <div class="flex-1 min-h-0 overflow-auto p-3">
          <Show when={imgUrl()}>
            {(url) => <img src={url()} alt={props.state.path} class="max-w-full mx-auto shadow" />}
          </Show>
        </div>
      </Match>
      <Match when={kind() === "docx"}>
        <div class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <Switch>
            <Match when={docxHtml.error}>
              <Notice>Could not convert this Word document.</Notice>
            </Match>
            <Match when={docxHtml()}>
              {(html) => (
                <div
                  class="text-14-regular leading-relaxed [&_h1]:text-20-medium [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-16-medium [&_h2]:mt-3 [&_h2]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:border-collapse [&_td]:border [&_td]:border-border-weak-base [&_td]:px-2 [&_td]:py-1 [&_img]:max-w-full"
                  innerHTML={html()}
                />
              )}
            </Match>
            <Match when={docxHtml.loading}>
              <Notice>Converting Word document…</Notice>
            </Match>
          </Switch>
        </div>
      </Match>
      <Match when={kind() === "doc-legacy"}>
        <Notice>Legacy .doc files cannot be previewed — save the document as .docx and try again.</Notice>
      </Match>
      <Match when={kind() === "text" && (props.state.bytes?.length ?? 0) > TEXT_DISPLAY_CAP}>
        <Notice>This file is too large to display as text (over 2 MB).</Notice>
      </Match>
      <Match when={kind() === "text"}>
        <pre class="flex-1 min-h-0 overflow-auto px-4 py-3 text-12-regular font-mono whitespace-pre-wrap break-words">
          {text()}
        </pre>
      </Match>
      <Match when={kind() === "binary"}>
        <Notice>This file type cannot be previewed.</Notice>
      </Match>
    </Switch>
  )
}
```

- [ ] **Step 3: Typecheck; add a module declaration only if needed**

Run: `cd opencode-dev/packages/app && bun run typecheck`

If it fails with `Cannot find module 'mammoth/mammoth.browser'`, first try changing the dynamic import to `await import("mammoth")` (Vite's browser-field resolution usually makes the plain specifier work in the renderer) and re-run. If only the *types* are missing, create `opencode-dev/packages/app/src/types/mammoth-browser.d.ts`:

```ts
declare module "mammoth/mammoth.browser" {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string
    messages: Array<{ type: string; message: string }>
  }>
}
```

Expected end state: typecheck exit 0.

- [ ] **Step 4: Generate the docx fixture**

The paperbanana venv has Python 3.12. Install python-docx there (dev-only, harmless to the MCP server) and generate a small fixture:

```bash
cd /c/Users/azamk/Documents/Paperino
paperbanana-mcp/.venv/Scripts/python.exe -m pip install --quiet python-docx
paperbanana-mcp/.venv/Scripts/python.exe -c "
from docx import Document
d = Document()
d.add_heading('Paperino docx preview fixture', 0)
p = d.add_paragraph('This paragraph proves the Word preview pipeline works. ')
p.add_run('This run is bold.').bold = True
d.add_paragraph('Bullet one', style='List Bullet')
d.add_paragraph('Bullet two', style='List Bullet')
t = d.add_table(rows=2, cols=2)
t.cell(0, 0).text = 'metric'; t.cell(0, 1).text = 'value'
t.cell(1, 0).text = 'pages';  t.cell(1, 1).text = '2'
d.save('fixtures/demo-paper/notes.docx')
"
```

Expected: `fixtures/demo-paper/notes.docx` exists (~36 KB). Note: `.docx` does not match the watcher's `SOURCE_RE`, so it cannot trigger paper compiles.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents/Paperino
git add opencode-dev/packages/app/src/components/paperino/file-preview.tsx \
        opencode-dev/packages/app/package.json \
        opencode-dev/bun.lock \
        fixtures/demo-paper/notes.docx
# plus opencode-dev/packages/app/src/types/mammoth-browser.d.ts if Step 3 created it
git commit -m "feat(preview): FilePreview renderer — pdf, images, docx via mammoth, text

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(If the lockfile is named differently — check `git status opencode-dev` for the exact lock file the `bun add` touched — stage that path instead.)

---

### Task 5: Panel integration — folder toggle, tree sidebar, mode switching

**Files:**
- Modify: `opencode-dev/packages/app/src/components/paperino/paper-preview-panel.tsx`

**Interfaces:**
- Consumes: `api.paperino.listFiles/readFile` (Task 1), `FilePreview`/`FilePreviewState` (Task 4), `PdfPages` (Task 3), `FileTreeV2` (`@/components/file-tree-v2`, existing — props: `allowed: readonly string[]`, `active?: string`, `draggable?: boolean`, `onFileClick?: (node: FileNode) => void`; requires the app-level `FileProvider`, which wraps everything at `app.tsx:357`).
- Produces: the finished user-facing feature.

- [ ] **Step 1: Extend the bridge type in the panel**

In `paper-preview-panel.tsx`, extend the local `PaperinoBridge` type (lines 16–21) with the two new calls:

```ts
type ReadFileError = "invalid-path" | "not-found" | "too-large"
type PaperinoBridge = {
  detect: (dir: string) => Promise<boolean>
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  onStatus: (cb: (status: PaperinoStatus) => void) => () => void
  listFiles: (dir: string) => Promise<{ files: string[]; truncated: boolean }>
  readFile: (dir: string, relPath: string) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: ReadFileError }>
}
```

- [ ] **Step 2: Add mode, tree, and file state**

Inside `PaperPreviewPanel()`, next to the existing signals (the two localStorage keys go at module scope beside `WIDTH_KEY`):

```ts
const TREE_OPEN_KEY = "paperino-tree-open"
const TREE_WIDTH_KEY = "paperino-tree-width"

type PanelMode = { kind: "paper" } | { kind: "file"; path: string }

const [mode, setMode] = createSignal<PanelMode>({ kind: "paper" })
const [treeOpen, setTreeOpen] = createSignal(localStorage.getItem(TREE_OPEN_KEY) === "1")
const [treeWidth, setTreeWidth] = createSignal(Number(localStorage.getItem(TREE_WIDTH_KEY)) || 200)
const [listing, setListing] = createSignal<{ files: string[]; truncated: boolean }>({ files: [], truncated: false })
const [fileState, setFileState] = createSignal<FilePreviewState>()

const filePath = () => {
  const m = mode()
  return m.kind === "file" ? m.path : undefined
}

let readToken = 0

const refreshListing = async () => {
  const dir = sdk().directory
  if (!api || !dir) return
  setListing(await api.listFiles(dir))
}

const toggleTree = () => {
  const next = !treeOpen()
  setTreeOpen(next)
  localStorage.setItem(TREE_OPEN_KEY, next ? "1" : "0")
  if (next) void refreshListing()
}

const openFile = async (path: string) => {
  const dir = sdk().directory
  if (!api || !dir) return
  const token = ++readToken
  setMode({ kind: "file", path })
  setFileState({ path })
  const result = await api.readFile(dir, path)
  if (token !== readToken) return
  setFileState(result.ok ? { path, bytes: result.bytes } : { path, error: result.error })
}

const backToPaper = () => {
  readToken++
  setMode({ kind: "paper" })
  setFileState(undefined)
}
```

Imports to add: `import FileTreeV2 from "@/components/file-tree-v2"`, `import { FilePreview, type FilePreviewState } from "./file-preview"`, and `Icon` from `@opencode-ai/ui/v2/icon`.

- [ ] **Step 3: Reset on project switch**

In the existing project-switch `createEffect` (the one keyed on `sdk().directory`), after `setStatus({ state: "empty" })`, add:

```ts
backToPaper()
setListing({ files: [], truncated: false })
if (treeOpen()) void refreshListing()
```

Also add `backToPaper()` as the first statement of the existing `previewDocument` function — an
agent-pushed document preview is an explicit "show me this" request and must take over even when
a clicked file is on screen.

- [ ] **Step 4: Rebuild the header**

Replace the current header contents (the `"Preview"` label + status texts) with a mode-aware version. Keep every existing status indicator for paper mode:

```tsx
<div class="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-border-weaker-base">
  <Show
    when={filePath()}
    fallback={<div class="text-12-regular text-text-weak flex-1 truncate">Preview</div>}
  >
    {(path) => (
      <>
        <button
          type="button"
          class="text-12-regular text-text-weak hover:text-text-base shrink-0"
          onClick={backToPaper}
        >
          ← Paper
        </button>
        <div class="text-12-regular text-text-base flex-1 truncate" title={path()}>
          {path()}
        </div>
      </>
    )}
  </Show>
  <Show when={!filePath()}>
    <Show when={status().state === "compiling"}>
      <div class="text-12-regular text-text-weak">compiling…</div>
    </Show>
    <Show when={status().state === "ok"}>
      <div class="text-12-regular text-text-weak">{pageCount() === 1 ? "1 page" : `${pageCount()} pages`}</div>
    </Show>
    <Show when={status().state === "error"}>
      <div class="text-12-regular text-red-500">
        {documentPreviewFailed() ? "preview failed" : "compile failed"}
      </div>
    </Show>
  </Show>
  <button
    type="button"
    class="text-12-regular shrink-0"
    classList={{ "text-text-base": treeOpen(), "text-text-weak hover:text-text-base": !treeOpen() }}
    title="Toggle file tree"
    aria-pressed={treeOpen()}
    onClick={toggleTree}
  >
    <Icon name="folder" />
  </button>
</div>
```

Icon: check the icon set for the exact name first:
`rg -o '"folder[a-z-]*"' opencode-dev/packages/ui/src | sort -u` — use `"folder"` if it exists, otherwise the closest (e.g. `"folder-open"`); if the set has no folder glyph at all, fall back to the text label `Files`.

- [ ] **Step 5: Rebuild the content area**

Replace the single `<PdfPages data={paperPdf()} onPageCount={setPageCount} />` (from Task 3) with a tree + viewer row. The empty-state and error-strip blocks stay, but become paper-mode-only:

```tsx
<div class="flex-1 min-h-0 flex">
  <Show when={treeOpen()}>
    <div
      class="relative h-full shrink-0 border-r border-border-weaker-base overflow-hidden flex flex-col"
      style={{ width: `${treeWidth()}px` }}
    >
      <Show when={listing().truncated}>
        <div class="px-2 py-1 text-12-regular text-text-weak shrink-0">Listing truncated at 5,000 files</div>
      </Show>
      <div class="flex items-center justify-end px-2 h-6 shrink-0">
        <button
          type="button"
          class="text-12-regular text-text-weak hover:text-text-base"
          title="Refresh file list"
          onClick={() => void refreshListing()}
        >
          ↻
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        <FileTreeV2 allowed={listing().files} draggable={false} active={filePath()} onFileClick={(node) => void openFile(node.path)} />
      </div>
      <ResizeHandle
        direction="horizontal"
        edge="end"
        size={treeWidth()}
        min={140}
        max={400}
        onResize={(w) => {
          setTreeWidth(w)
          localStorage.setItem(TREE_WIDTH_KEY, String(w))
        }}
      />
    </div>
  </Show>
  <div class="flex-1 min-w-0 min-h-0 flex flex-col relative">
    <Show
      when={filePath()}
      fallback={
        <>
          <PdfPages data={paperPdf()} onPageCount={setPageCount} />
          {/* existing empty-state <Show when={status().state === "empty"}> block goes here, unchanged
              except its top offset: it is now inside the content column, so use "inset-0" */}
        </>
      }
    >
      <Show when={fileState()}>{(state) => <FilePreview state={state()} />}</Show>
    </Show>
  </div>
</div>
{/* existing error strip (<Show when={errors().length > 0}>) stays below, but wrap its condition:
    errors().length > 0 && !filePath() — compile errors are paper-mode information */}
```

Two behavioral requirements to preserve (from the spec):
- A status event arriving while `mode().kind === "file"` only updates `status`/`paperPdf` signals — nothing about the visible file changes (this falls out of the structure above; do not add any `setMode` call to the status handler).
- "← Paper" must show the *latest* stored PDF (falls out of `PdfPages data={paperPdf()}` re-mounting with the current signal value).

- [ ] **Step 6: Typecheck and unit tests**

Run: `cd opencode-dev/packages/app && bun run typecheck && bun run test:unit`
Expected: exit 0, no regressions.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/azamk/Documents/Paperino
git add opencode-dev/packages/app/src/components/paperino/paper-preview-panel.tsx
git commit -m "feat(preview): file tree sidebar + paper/file mode switching in the Preview panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live acceptance over CDP

**Files:**
- No source changes expected. Fixes discovered here get their own minimal commits.

**Interfaces:**
- Consumes: the running app (`opencode-dev\paperino-dev.cmd`, CDP on 9222), `fixtures/demo-paper/notes.docx` (Task 4), the `TurboQuant-Research` folder (`C:/Users/azamk/Documents/TurboQuant-Research` — contains `main_updated.pdf`, `figures/killer.pdf`, `main.tex`, `.paperino/preview.pdf`).

- [ ] **Step 1: Restart the app with the new code**

Kill any running instance, then launch `opencode-dev\paperino-dev.cmd` in the background. Wait for CDP: `curl -s http://127.0.0.1:9222/json/list` returns a page list. (Orphan electron processes can lock the binary — kill `electron.exe` processes if the relaunch fails.)

- [ ] **Step 2: Open the TurboQuant-Research project**

In the app (or via CDP `Runtime.evaluate` with `window.api.storeSet` + the `opencode.desktop.window.<id>.last-active-url` localStorage key — see CLAUDE.md), open the `TurboQuant-Research` folder as the active project. Confirm the Preview panel shows the existing `.paperino/preview.pdf` (15 pages).

- [ ] **Step 3: Walk the acceptance checklist via CDP screenshots + DOM queries**

For each check, drive with `Runtime.evaluate` (dispatch `click()` on the element) and verify with a DOM query and/or `Page.captureScreenshot`:

1. Click the folder icon → `document.querySelector('[data-component="file-tree-v2"]')` exists; tree lists `main.tex`, `figures/`, `.paperino/`; `.git`/`node_modules` absent.
2. Click `main_updated.pdf` → header shows `← Paper` + `main_updated.pdf`; pages container fills with canvases (15).
3. Click `figures/killer.pdf` → canvases re-render (1 page); no flash of the old file.
4. Click `main.tex` → `<pre>` with LaTeX source visible.
5. Click a `.png` (any in `figures/` or `tables/`; if none exists, drop a small PNG into the folder first) → `<img>` visible, fits panel width.
6. Switch project to `fixtures/demo-paper`, click `notes.docx` → converted HTML visible: heading, bold run, two bullets, 2×2 table.
7. While viewing a file in `demo-paper`, touch a source file (append `% comment` to `fixtures/demo-paper/main.tex`) → panel does **not** leave the file view; then click `← Paper` → freshly compiled paper renders.
8. Click a file that no longer exists (delete one after the tree was listed, then click it) → inline "This file no longer exists." notice, no blank panel, no renderer crash in the console.
9. Toggle the tree closed and reopen — width and open-state persist; resize the tree and the panel; both handles work.

- [ ] **Step 4: Run the full test + typecheck sweep**

```bash
cd /c/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun test src/main/paperino/ && bun run typecheck
cd ../app && bun run test:unit && bun run typecheck
```
Expected: all pass.

- [ ] **Step 5: Update docs and commit**

Update the spec's status line to `Implemented`. Add a note to `Paperino/CLAUDE.md` only if acceptance uncovered a new invariant (e.g. an IPC serialization gotcha). Commit:

```bash
cd /c/Users/azamk/Documents/Paperino
git add docs/superpowers/specs/2026-07-11-file-tree-preview-design.md
# plus CLAUDE.md if touched
git commit -m "docs(preview): mark file-tree preview spec implemented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
