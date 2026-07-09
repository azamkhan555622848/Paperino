import { execFile } from "node:child_process"
import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"

export type CompileError = { file: string; line: number | null; message: string }

export type CompileResult =
  | { ok: true; pdfPath: string; log: string }
  | { ok: false; errors: CompileError[]; log: string }

export const OUT_DIR = ".paperino"

// Any PDF dropped here is previewed as-is, with no compile step. It is how the agent
// shows a document that is not a LaTeX manuscript (an existing draft, a downloaded paper).
export const PREVIEW_FILE = "preview.pdf"
export const PREVIEW_PATH = `${OUT_DIR}/${PREVIEW_FILE}`

function tectonicBinary() {
  return process.env.PAPERINO_TECTONIC || "tectonic"
}

export function isPaperWorkspace(dir: string): boolean {
  return existsSync(join(dir, "paperino.yaml")) && existsSync(join(dir, "main.tex"))
}

// Tectonic error lines: "error: <file>:<line>: <message>" or "error: <message>".
// The file often has no extension, because \input{sections/02-introduction} is reported verbatim.
const ERROR_RE = /^error: (?:([^\s:]+):(\d+):\s*)?(.+)$/gm
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

export type ChangeKind = "source" | "preview" | null

/**
 * Decides what a changed path means. `.paperino/` is build output and is ignored —
 * except for preview.pdf, the one file the agent writes there on purpose.
 */
export function classifyChange(filename: string): ChangeKind {
  const name = filename.replaceAll("\\", "/").replace(/^\.\//, "")
  if (name === PREVIEW_PATH) return "preview"
  if (name.startsWith(`${OUT_DIR}/`) || name === OUT_DIR) return null
  if (!SOURCE_RE.test(name)) return null
  return "source"
}

export type WatchHandlers = { onSource: () => void; onPreview: () => void }

export function watchWorkspace(dir: string, handlers: WatchHandlers, debounceMs = 600): FSWatcher {
  const timers: Partial<Record<"source" | "preview", ReturnType<typeof setTimeout>>> = {}
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const kind = classifyChange(filename.toString())
    if (!kind) return
    clearTimeout(timers[kind])
    timers[kind] = setTimeout(kind === "preview" ? handlers.onPreview : handlers.onSource, debounceMs)
  })
  return watcher
}
