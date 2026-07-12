import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "yaml"

// 96dpi print mapping: 312px = 3.25in (two-column width), 528px = 5.5in (NeurIPS/ICML
// text width). page.pdf sizes the PDF page from these px, so \includegraphics at
// \linewidth lands ~1:1 and a 9pt label is 9pt on the page by construction.
const VIEWPORTS = { narrow: 312, full: 528 } as const
const WORKER = join(import.meta.dir, "render-worker.mjs")

export type TextBox = {
  selector: string
  text: string
  rect: { x: number; y: number; w: number; h: number }
  fontSize: number
  color: string
  background: string
  derived: boolean
  /** Computed font-family — lint rule 13 fails a face outside the KaTeX_* allowlist. */
  fontFamily: string
  /** Inside KaTeX output: exempt from the 7pt floor and from intra-formula overlap. */
  inKatex: boolean
}
/** Elements carrying web chrome (radius/shadow) — lint rule 12. */
export type ElementBox = { selector: string; borderRadius: number; boxShadow: string }
export type Manifest = {
  viewport: { width: number; height: number }
  texts: TextBox[]
  strokes: { selector: string; width: number }[]
  elements: ElementBox[]
}
export type RenderResult =
  | { ok: true; png: string; pdf: string; svg: string | null; bboxes: string; consoleOutput: string[] }
  | { ok: false; error: string; consoleOutput: string[]; png: string | null }

const MARKER = "__RESULT__"

// The browser runs in a node child process; see render-worker.mjs for why.
function runWorker(jobPath: string): Promise<RenderResult> {
  return new Promise((resolve) => {
    execFile(
      "node",
      [WORKER, jobPath],
      { windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const at = stdout.lastIndexOf(MARKER)
        if (at !== -1) {
          try {
            return resolve(JSON.parse(stdout.slice(at + MARKER.length)))
          } catch (parseError) {
            return resolve({ ok: false, error: `worker returned unparseable result: ${parseError}`, consoleOutput: [], png: null })
          }
        }
        resolve({
          ok: false,
          error: `render worker failed: ${error?.message ?? "no result emitted"}`,
          consoleOutput: [stdout, stderr].filter(Boolean),
          png: null,
        })
      },
    )
  })
}

export async function render(workspace: string, name: string): Promise<RenderResult> {
  const figureDir = join(workspace, "figures", name)
  const htmlPath = join(figureDir, "figure.html")
  if (!existsSync(htmlPath)) return { ok: false, error: `no figure.html at ${htmlPath}`, consoleOutput: [], png: null }
  const meta = parse(readFileSync(join(figureDir, "meta.yaml"), "utf8"))
  const width = VIEWPORTS[(meta.width as "narrow" | "full") ?? "full"] ?? VIEWPORTS.full
  const data = existsSync(join(figureDir, "data.json")) ? readFileSync(join(figureDir, "data.json"), "utf8") : "{}"
  const buildDir = join(figureDir, "build")
  mkdirSync(buildDir, { recursive: true })

  const jobPath = join(tmpdir(), `paperino-figure-${name}-${process.pid}.json`)
  writeFileSync(
    jobPath,
    JSON.stringify({ figuresDir: join(workspace, "figures"), buildDir, name, width, archetype: meta.archetype, data }),
  )
  try {
    return await runWorker(jobPath)
  } finally {
    rmSync(jobPath, { force: true })
  }
}
