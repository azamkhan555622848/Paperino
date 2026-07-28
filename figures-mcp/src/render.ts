import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { runMpl } from "./engines/mpl"
import { resolveVenue } from "./venue"

// The 96dpi print mapping now comes from the workspace's venue (src/venue.ts): page.pdf
// sizes the PDF page from these px, so \includegraphics at \linewidth lands ~1:1 and a 9pt
// label is 9pt on the page by construction. A workspace with no `venue` resolves to
// neurips, whose 3.25/5.5in are exactly the 312/528px this used to hardcode.
// import.meta.dir is bun-only (undefined under node); import.meta.url works in both, and
// in the packaged bundle it points at dist/, where render-worker.mjs sits beside server.mjs.
const WORKER = join(dirname(fileURLToPath(import.meta.url)), "render-worker.mjs")

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
    // Packaged builds have no node on PATH: the app sets PAPERINO_FIGURES_NODE to its own
    // electron.exe, and ELECTRON_RUN_AS_NODE makes that behave as node. Plain node ignores
    // the variable, so setting it unconditionally is safe in dev.
    const workerExe = process.env.PAPERINO_FIGURES_NODE || "node"
    execFile(
      workerExe,
      [WORKER, jobPath],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
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
  const meta = parse(readFileSync(join(figureDir, "meta.yaml"), "utf8"))
  const engine: "html" | "mpl" = meta.engine === "mpl" ? "mpl" : "html"
  const widthName = (meta.width as "narrow" | "full") ?? "full"
  const width = resolveVenue(workspace).px[widthName] ?? resolveVenue(workspace).px.full
  const buildDir = join(figureDir, "build")
  mkdirSync(buildDir, { recursive: true })

  // The mpl engine draws first, in Python; Chromium then measures what it drew. The HTML
  // engine draws and is measured in the same pass. Both converge on an SVG in a browser,
  // which is the only reason one lint and one review loop cover both.
  if (engine === "mpl") {
    const script = join(figureDir, "figure.py")
    if (!existsSync(script)) return { ok: false, error: `no figure.py at ${script}`, consoleOutput: [], png: null }
    const built = await runMpl({ workspace, figureDir, name })
    if (!built.ok) return { ok: false, error: built.error, consoleOutput: [], png: null }
  } else {
    const htmlPath = join(figureDir, "figure.html")
    if (!existsSync(htmlPath)) return { ok: false, error: `no figure.html at ${htmlPath}`, consoleOutput: [], png: null }
  }

  const data = existsSync(join(figureDir, "data.json")) ? readFileSync(join(figureDir, "data.json"), "utf8") : "{}"
  const jobPath = join(tmpdir(), `paperino-figure-${name}-${process.pid}.json`)
  writeFileSync(
    jobPath,
    JSON.stringify({
      figuresDir: join(workspace, "figures"),
      buildDir,
      name,
      width,
      archetype: meta.archetype,
      data,
      engine,
    }),
  )
  try {
    return await runWorker(jobPath)
  } finally {
    rmSync(jobPath, { force: true })
  }
}
