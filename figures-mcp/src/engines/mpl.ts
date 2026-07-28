import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveVenue } from "../venue"

export type MplResult = { ok: true; svg: string } | { ok: false; error: string }

// import.meta.dir is bun-only; import.meta.url works under node too, which is what the
// packaged bundle runs on via ELECTRON_RUN_AS_NODE. In the bundle this points at dist/,
// where assets/ sits beside server.mjs.
const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, "assets")
const DEV_ASSETS = join(HERE, "..", "assets")

/**
 * Resolution order: an explicit override, then the dev venv, then the runtime the packaged
 * installer downloads into userData.
 *
 * The dev venv comes FIRST on purpose. Both can exist on one machine — a developer who has
 * also installed the packaged app — and userData-first meant running from source picked the
 * installed app's interpreter, which has its own separately-managed packages. In a packaged
 * build the dev path does not exist, so userData wins there without needing a mode flag.
 *
 * Absolute paths only. A bare `python` on PATH could be any interpreter on the machine, and
 * picking the wrong one surfaces as a missing-matplotlib error rather than as the
 * mis-resolution it actually is.
 */
export function findPython(): string | null {
  const appdata = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
  const venv = join("tools", "pyoffice", ".venv", "Scripts", "python.exe")
  const candidates = [
    process.env.PAPERINO_PYTHON,
    // src/engines/ -> src/ -> figures-mcp/ -> Paperino/
    join(HERE, "..", "..", "..", venv),
    // dist/ -> figures-mcp/ -> Paperino/  (the bundled layout flattens one level)
    join(HERE, "..", "..", venv),
    join(appdata, "ai.paperino.desktop", "python", "python.exe"),
  ].filter((p): p is string => Boolean(p))
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

export async function runMpl(opts: {
  workspace: string
  figureDir: string
  name: string
  /** Injected in tests; omit in production so findPython() runs. */
  python?: string | null
}): Promise<MplResult> {
  const python = opts.python === undefined ? findPython() : opts.python
  if (!python)
    return {
      ok: false,
      // Never "a chart is impossible" — that would be a false report about the machine,
      // the same breach as claiming the LaTeX compiler is unavailable. Say what is missing
      // and name the path that still works.
      error:
        "Figure Studio's chart engine needs setup: no Python runtime was found. " +
        "The HTML engine still works — re-scaffold with engine=html to draw this as a diagram.",
    }

  const venue = resolveVenue(opts.workspace)
  const env = {
    ...process.env,
    // The workspace's vendored copy wins; the shipped copy is the fallback so a workspace
    // that predates the module still renders instead of failing on an import.
    PYTHONPATH: [join(opts.workspace, "figures"), ASSETS, DEV_ASSETS, process.env.PYTHONPATH]
      .filter(Boolean)
      .join(";"),
    PAPERINO_FIG_DIR: opts.figureDir,
    PAPERINO_FIG_NAME: opts.name,
    PAPERINO_FIG_FACE: venue.textFace,
    PAPERINO_FIG_MATH: venue.mathFontset,
    PAPERINO_FIG_FONTS: join(opts.workspace, "figures", "fonts"),
    PAPERINO_FIG_INCHES: JSON.stringify(venue.inches),
    MPLBACKEND: "Agg",
  }

  const failure = await new Promise<string | null>((resolve) => {
    execFile(
      python,
      [join(opts.figureDir, "figure.py")],
      { cwd: opts.figureDir, env, windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
      (error, _stdout, stderr) => resolve(error ? stderr || String(error) : null),
    )
  })

  if (failure !== null) {
    if (/No module named ['"]?matplotlib/.test(failure))
      return {
        ok: false,
        error:
          "Figure Studio's chart engine needs setup: matplotlib is not installed in " +
          `${python}. The HTML engine still works — re-scaffold with engine=html.`,
      }
    // Everything else is the author's bug, and the traceback names the line. Passing it
    // through verbatim is what lets the agent patch it; a summarised error would not.
    return { ok: false, error: failure.trim() }
  }

  const svg = join(opts.figureDir, "build", `${opts.name}.svg`)
  if (!existsSync(svg))
    return { ok: false, error: `figure.py ran but wrote no SVG to build/${opts.name}.svg — did you call save(fig)?` }
  return { ok: true, svg }
}
