import { execFile } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { basename, join } from "node:path"

export type CompileError = { file: string; line: number | null; message: string }

export type CompileResult =
  // pdfPath is the build-directory PDF the panel renders. emittedPath is the copy beside
  // main.tex; it is absent when the copy failed (a viewer had the file locked).
  | { ok: true; pdfPath: string; emittedPath?: string; log: string }
  | { ok: false; errors: CompileError[]; log: string }

export const OUT_DIR = ".paperino"

// Any PDF dropped here is previewed as-is, with no compile step. It is how the agent
// shows a document that is not a LaTeX manuscript (an existing draft, a downloaded paper).
export const PREVIEW_FILE = "preview.pdf"
export const PREVIEW_PATH = `${OUT_DIR}/${PREVIEW_FILE}`

// The compiled paper is also written here, beside main.tex. Tectonic builds into .paperino/
// so its .aux/.log litter stays out of the project — but that is a hidden build directory,
// and a user who opens "the PDF of my paper" opens main.pdf in the folder. Emitting only
// into .paperino/ meant the panel showed a freshly compiled paper while main.pdf sat months
// stale, which reads exactly like "it edited the LaTeX but never updated the PDF".
export const OUTPUT_PDF = "main.pdf"

/**
 * Where the LaTeX engine lives. In dev, paperino-dev.cmd sets PAPERINO_TECTONIC; in a
 * packaged build, packagedEnv sets it to the Tectonic shipped in resources. The
 * packagedResources fallback exists so a caller holding the resources path but no env
 * still resolves it, instead of silently falling back to a `tectonic` on PATH that an end
 * user will not have.
 */
export function tectonicBinary(packagedResources?: string) {
  if (process.env.PAPERINO_TECTONIC) return process.env.PAPERINO_TECTONIC
  if (packagedResources) return `${packagedResources.replaceAll("\\", "/")}/bin/tectonic/tectonic.exe`
  return "tectonic"
}

// `root: paper.tex` in paperino.yaml. Deliberately a line-regex and not a YAML parse: this
// runs on the fs-watch path, the file is three keys long, and a parser here would be the only
// YAML reader in the main process.
const ROOT_KEY_RE = /^[ \t]*root:[ \t]*["']?([^"'#\r\n]+?)["']?[ \t]*(?:#.*)?$/m

/**
 * Which .tex the panel compiles, relative to `dir` — or null when this is not a paper
 * workspace. In order:
 *
 *   1. `root:` in paperino.yaml. It wins even when the file it names is missing: a typo'd
 *      root must surface as a compile error the user can see, not silently fall back to a
 *      different manuscript than the one they asked for.
 *   2. `main.tex` at the root. The /new-paper layout, and the historical whole rule.
 *   3. The single root-level .tex carrying a \documentclass. An imported submission is often
 *      one `paper.tex` with no main.tex at all, and should preview with no configuration.
 *      Two candidates is a real ambiguity — pick neither, and let the user name one.
 *
 * paperino.yaml is otherwise metadata for the agent, never a gate on the previewer: a LaTeX
 * project that predates /new-paper has no marker file and must still get a live preview.
 */
export function resolveRoot(dir: string): string | null {
  const yaml = join(dir, "paperino.yaml")
  if (existsSync(yaml)) {
    const named = readFileSync(yaml, "utf8").match(ROOT_KEY_RE)?.[1]?.trim()
    if (named) return named.replaceAll("\\", "/")
  }
  if (existsSync(join(dir, "main.tex"))) return "main.tex"

  const roots: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.tex$/i.test(entry.name)) continue
    try {
      if (/^[^%\n]*\\documentclass/m.test(readFileSync(join(dir, entry.name), "utf8"))) roots.push(entry.name)
    } catch {
      // Unreadable is not a root. A locked or half-written file must not take the panel down.
    }
  }
  return roots.length === 1 ? roots[0] : null
}

// The PDF a successful compile publishes beside its source, relative to `dir`: main.pdf for a
// main.tex root, paper.pdf for a paper.tex one.
export function emittedPdf(dir: string): string {
  const root = resolveRoot(dir)
  return root ? root.replace(/\.tex$/i, ".pdf") : OUTPUT_PDF
}

export function isPaperWorkspace(dir: string): boolean {
  return existsSync(dir) && resolveRoot(dir) !== null
}

// Tectonic error lines: "error: <file>:<line>: <message>" or "error: <message>".
// The file often has no extension, because \input{sections/02-introduction} is reported verbatim.
const ERROR_RE = /^error: (?:([^\s:]+):(\d+):\s*)?(.+)$/gm
// This line follows real errors and adds no information of its own
const HALT_MESSAGE = "halted on potentially-recoverable error as specified"

export function parseTectonicLog(log: string, root = "main.tex"): CompileError[] {
  const errors: CompileError[] = []
  for (const match of log.matchAll(ERROR_RE)) {
    const message = match[3].trim()
    if (message === HALT_MESSAGE && errors.length > 0) continue
    errors.push({ file: match[1] ?? root, line: match[2] ? Number(match[2]) : null, message })
  }
  return errors
}

export function compile(dir: string): Promise<CompileResult> {
  const outDir = join(dir, OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  // Never compiled unless isPaperWorkspace() said yes, so the fallback is unreachable in the
  // app; it keeps compile() total rather than throwing on a workspace that changed under it.
  const root = resolveRoot(dir) ?? "main.tex"
  const output = root.replace(/\.tex$/i, ".pdf")
  return new Promise((resolve) => {
    execFile(
      tectonicBinary(),
      ["--keep-logs", "--outdir", outDir, root],
      { cwd: dir, windowsHide: true, timeout: 120_000 },
      (error, stdout, stderr) => {
        const log = `${stdout}\n${stderr}`.trim()
        writeFileSync(join(outDir, "compile.log"), log)
        if (error) {
          const errors = parseTectonicLog(log, root)
          if (errors.length === 0) errors.push({ file: root, line: null, message: error.message })
          resolve({ ok: false, errors, log })
          return
        }
        // Tectonic names its output after the source's basename, whatever subdirectory the
        // source came from, and drops it flat into --outdir.
        const built = join(outDir, basename(output))

        // Publish the paper where the user looks for it. A viewer holding that PDF open
        // locks it on Windows (EBUSY/EPERM), so a failed copy must not fail the compile —
        // the panel still has the build-directory PDF. Say so in the log instead of
        // silently leaving a stale file behind.
        let emitted: string | undefined
        try {
          copyFileSync(built, join(dir, output))
          emitted = join(dir, output)
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          writeFileSync(join(outDir, "compile.log"), `${log}\n\ncould not update ${output}: ${reason}`)
        }

        resolve({ ok: true, pdfPath: built, emittedPath: emitted, log })
      },
    )
  })
}

// Files whose changes should trigger a recompile
const SOURCE_RE = /\.(tex|bib|yaml|png|jpe?g|pdf|svg)$/i
// The full-text shelf: papers the ladder fetched or the user dropped. Reading material, not source.
const SHELF_DIR = "papers"

export type ChangeKind = "source" | "preview" | null

/**
 * Decides what a changed path means. `.paperino/` is build output and is ignored —
 * except for preview.pdf, the one file the agent writes there on purpose.
 *
 * `output` is the PDF this workspace's compile publishes beside its source (emittedPdf()).
 * It is a thunk because resolving it reads the disk, and the overwhelming majority of watch
 * events are settled without ever needing it.
 */
export function classifyChange(filename: string, output: () => string = () => OUTPUT_PDF): ChangeKind {
  const name = filename.replaceAll("\\", "/").replace(/^\.\//, "")
  if (name === PREVIEW_PATH) return "preview"
  if (name.startsWith(`${OUT_DIR}/`) || name === OUT_DIR) return null
  // papers/ holds fetched full texts. They are PDFs, and a PDF is otherwise a source (Figure
  // Studio emits figures as PDFs) — so without this the shelf would retrigger the compile on
  // every fetch. Anchored at the top level: figures/papers/x.pdf is still a figure.
  if (name.startsWith(`${SHELF_DIR}/`)) return null
  if (!SOURCE_RE.test(name)) return null
  // The paper's own PDF is compile OUTPUT, not source. Every other .pdf still is a source —
  // Figure Studio emits figures as PDFs — so without this line the copy compile() drops
  // beside the manuscript would look like an edit and the compile would retrigger itself
  // forever. It follows the root's name, so a paper.tex workspace must ignore paper.pdf.
  if (/\.pdf$/i.test(name) && name === output()) return null
  return "source"
}

export type WatchHandlers = { onSource: () => void; onPreview: () => void }

export function watchWorkspace(dir: string, handlers: WatchHandlers, debounceMs = 600): FSWatcher {
  const timers: Partial<Record<"source" | "preview", ReturnType<typeof setTimeout>>> = {}
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    // Resolved per event, not captured: a workspace can gain a paperino.yaml — or have its
    // root: line rewritten — while the panel is watching it.
    const kind = classifyChange(filename.toString(), () => emittedPdf(dir))
    if (!kind) return
    clearTimeout(timers[kind])
    timers[kind] = setTimeout(kind === "preview" ? handlers.onPreview : handlers.onSource, debounceMs)
  })
  return watcher
}
