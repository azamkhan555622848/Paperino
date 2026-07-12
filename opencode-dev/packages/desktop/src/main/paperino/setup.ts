import { execFile } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { get } from "node:https"
import { join } from "node:path"

// First-run runtime setup. The installer is deliberately slim (~150MB): Chromium (for
// Figure Studio) and a portable CPython (for PaperBanana and the office skills) are
// downloaded into userData with progress, not shipped. Each component is guarded by a
// marker file, so re-running is free and Settings can offer "Complete setup" after a skip
// or a failure without redoing work.

export type SetupComponent = "chromium" | "python"
export type SetupProgress = { component: SetupComponent; phase: string; percent?: number }
export type ExecFn = (exe: string, args: string[], env: Record<string, string | undefined>) => Promise<void>
export type DownloadFn = (url: string, dest: string, onPercent?: (p: number) => void) => Promise<void>
export type SetupContext = {
  userData: string
  resources: string
  electronExe: string
  /** Injected in tests; defaults to child_process.execFile. */
  exec?: ExecFn
  /** Injected in tests; defaults to an https GET that follows redirects. */
  download?: DownloadFn
}

// python-build-standalone, pinned to an exact release: `latest` would let two installs of
// the same Paperino version ship different interpreters.
const PYTHON_URL =
  "https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.12.13%2B20260623-x86_64-pc-windows-msvc-install_only.tar.gz"

const markerPath = (userData: string, component: SetupComponent) => join(userData, "setup", `${component}.done`)

export function setupStatus(userData: string): Record<SetupComponent, { installed: boolean }> {
  return {
    chromium: { installed: existsSync(markerPath(userData, "chromium")) },
    python: { installed: existsSync(markerPath(userData, "python")) },
  }
}

const defaultExec: ExecFn = (exe, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { env: env as NodeJS.ProcessEnv, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (error, _stdout, stderr) =>
        error ? reject(new Error(`${exe} ${args[0] ?? ""} failed: ${stderr || error.message}`)) : resolve(),
    )
  })

const defaultDownload: DownloadFn = (url, dest, onPercent) =>
  new Promise((resolve, reject) => {
    const request = (target: string, hops: number) => {
      if (hops > 5) return reject(new Error(`too many redirects for ${target}`))
      get(target, (res) => {
        // GitHub release assets always redirect to a CDN.
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          return request(res.headers.location, hops + 1)
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${target}`))

        const total = Number(res.headers["content-length"] ?? 0)
        let seen = 0
        const file = createWriteStream(dest)
        res.on("data", (chunk: Buffer) => {
          seen += chunk.length
          if (total && onPercent) onPercent(Math.round((seen / total) * 100))
        })
        res.pipe(file)
        file.on("finish", () => file.close(() => resolve()))
        file.on("error", reject)
      }).on("error", reject)
    }
    request(url, 0)
  })

export async function runSetup(
  component: SetupComponent,
  ctx: SetupContext,
  onProgress: (p: SetupProgress) => void,
): Promise<void> {
  const marker = markerPath(ctx.userData, component)
  if (existsSync(marker)) return

  const exec = ctx.exec ?? defaultExec
  const download = ctx.download ?? defaultDownload
  const emit = (phase: string, percent?: number) => onProgress({ component, phase, percent })

  if (component === "chromium") {
    emit("installing Chromium", 0)
    // No node on the user's machine: the playwright CLI runs on the app's own executable.
    await exec(
      ctx.electronExe,
      [join(ctx.resources, "figures-mcp", "node_modules", "playwright", "cli.js"), "install", "chromium"],
      {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PLAYWRIGHT_BROWSERS_PATH: join(ctx.userData, "browsers"),
      },
    )
  } else {
    mkdirSync(join(ctx.userData, "setup"), { recursive: true })
    const archive = join(ctx.userData, "setup", "python.tar.gz")

    emit("downloading Python", 0)
    await download(PYTHON_URL, archive, (p) => emit("downloading Python", p))

    emit("extracting Python")
    mkdirSync(join(ctx.userData, "python"), { recursive: true })
    // bsdtar ships with Windows 10+; --strip-components drops the archive's top-level dir.
    await exec("tar", ["-xzf", archive, "-C", join(ctx.userData, "python"), "--strip-components", "1"], {
      ...process.env,
    })

    // One interpreter serves BOTH PaperBanana and the office skills (xlsx/docx/pdf).
    const python = join(ctx.userData, "python", "python.exe")
    emit("installing PaperBanana packages")
    await exec(python, ["-m", "pip", "install", "-r", join(ctx.resources, "paperbanana", "requirements.lock")], {
      ...process.env,
    })
    emit("installing office-skill packages")
    await exec(
      python,
      ["-m", "pip", "install", "-r", join(ctx.resources, "paperino-config", "skill", "requirements.txt")],
      { ...process.env },
    )
  }

  mkdirSync(join(ctx.userData, "setup"), { recursive: true })
  writeFileSync(marker, new Date().toISOString())
  emit("done", 100)
}
