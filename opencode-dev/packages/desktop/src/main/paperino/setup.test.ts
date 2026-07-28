import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSetup, setupStatus, type SetupProgress } from "./setup"

// The real downloads are exercised by the packaged smoke (Task 8). Here the exec and
// download seams are injected, so the orchestration — what runs, with which env, and when
// the marker is written — is testable without pulling 200MB.
const ctx = (tmp: string) => ({
  userData: join(tmp, "ud"),
  resources: join(tmp, "res"),
  electronExe: "C:/app/Paperino.exe",
})

test("setupStatus reports installed only when markers exist", () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  expect(setupStatus(c.userData)).toEqual({ chromium: { installed: false }, python: { installed: false } })
  mkdirSync(join(c.userData, "setup"), { recursive: true })
  writeFileSync(join(c.userData, "setup", "chromium.done"), "1")
  expect(setupStatus(c.userData).chromium.installed).toBe(true)
})

/** Lay down the two requirement files setupStatus hashes into the python marker's stamp. */
const writeRequirements = (resources: string, lock: string) => {
  mkdirSync(join(resources, "paperbanana"), { recursive: true })
  mkdirSync(join(resources, "paperino-config", "skill"), { recursive: true })
  writeFileSync(join(resources, "paperbanana", "requirements.lock"), lock)
  writeFileSync(join(resources, "paperino-config", "skill", "requirements.txt"), "openpyxl==3.1.5\n")
}

test("adding a package to a lockfile re-runs the python step on an existing install", async () => {
  // The bug this pins: the marker used to be a bare existence check, so a new pin could
  // never reach anyone who had already run setup — pip never re-ran and the feature that
  // needed the package reported itself unavailable forever.
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  writeRequirements(c.resources, "numpy==2.5.1\n")

  let pipRuns = 0
  const exec = async (_exe: string, args: string[]) => {
    if (args[0] === "-m" && args[1] === "pip") pipRuns++
  }
  const download = async (_url: string, dest: string) => writeFileSync(dest, "")

  await runSetup("python", { ...c, exec, download }, () => {})
  expect(setupStatus(c.userData, c.resources).python.installed).toBe(true)

  // Same inputs: still installed, nothing re-runs.
  const afterFirst = pipRuns
  await runSetup("python", { ...c, exec, download }, () => {})
  expect(pipRuns).toBe(afterFirst)

  // A new pin moves the stamp, so the component reads as NOT installed and pip runs again.
  writeRequirements(c.resources, "numpy==2.5.1\nmatplotlib==3.11.1\n")
  expect(setupStatus(c.userData, c.resources).python.installed).toBe(false)
  await runSetup("python", { ...c, exec, download }, () => {})
  expect(pipRuns).toBeGreaterThan(afterFirst)
  expect(setupStatus(c.userData, c.resources).python.installed).toBe(true)
})

test("a lockfile top-up does not re-download the interpreter", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  writeRequirements(c.resources, "numpy==2.5.1\n")

  let downloads = 0
  const download = async (_url: string, dest: string) => {
    downloads++
    writeFileSync(dest, "")
  }
  // tar is stubbed, so stand the interpreter up by hand the way extraction would.
  const exec = async (exe: string) => {
    if (exe === "tar") {
      mkdirSync(join(c.userData, "python"), { recursive: true })
      writeFileSync(join(c.userData, "python", "python.exe"), "")
    }
  }

  await runSetup("python", { ...c, exec, download }, () => {})
  expect(downloads).toBe(1)

  // Only the wheels changed — re-fetching 25MB to install one of them would make every
  // upgrade feel like a fresh install.
  writeRequirements(c.resources, "numpy==2.5.1\nmatplotlib==3.11.1\n")
  await runSetup("python", { ...c, exec, download }, () => {})
  expect(downloads).toBe(1)
})

test("runSetup(chromium) drives the playwright CLI under electron-as-node and writes the marker", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  const calls: { exe: string; args: string[]; env: Record<string, string | undefined> }[] = []
  const events: SetupProgress[] = []

  await runSetup(
    "chromium",
    { ...c, exec: async (exe, args, env) => void calls.push({ exe, args, env }) },
    (p) => events.push(p),
  )

  // The app has no node: the playwright CLI runs on the app's own executable.
  expect(calls).toHaveLength(1)
  expect(calls[0].exe).toBe(c.electronExe)
  expect(calls[0].args.join(" ")).toContain("playwright")
  expect(calls[0].args).toContain("install")
  expect(calls[0].args).toContain("chromium")
  expect(calls[0].env.ELECTRON_RUN_AS_NODE).toBe("1")
  expect(calls[0].env.PLAYWRIGHT_BROWSERS_PATH).toBe(join(c.userData, "browsers"))
  expect(setupStatus(c.userData).chromium.installed).toBe(true)
  expect(events.at(-1)?.phase).toBe("done")
})

test("runSetup(python) downloads, extracts, pip-installs both locks, writes the marker", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  mkdirSync(join(c.resources, "paperbanana"), { recursive: true })
  writeFileSync(join(c.resources, "paperbanana", "requirements.lock"), "x==1")
  mkdirSync(join(c.resources, "paperino-config", "skill"), { recursive: true })
  writeFileSync(join(c.resources, "paperino-config", "skill", "requirements.txt"), "y==2")

  const execs: string[] = []
  const downloads: string[] = []
  await runSetup(
    "python",
    {
      ...c,
      download: async (url, dest) => {
        downloads.push(url)
        writeFileSync(dest, "fake-archive")
      },
      exec: async (exe, args) => void execs.push([exe, ...args].join(" ")),
    },
    () => {},
  )

  // One portable Python serves BOTH PaperBanana and the office skills.
  expect(downloads[0]).toContain("python-build-standalone")
  expect(execs[0]).toContain("tar")
  expect(execs[1]).toContain("requirements.lock")
  expect(execs[2]).toContain("requirements.txt")
  expect(setupStatus(c.userData).python.installed).toBe(true)
})

test("runSetup is a no-op when the marker already exists", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  mkdirSync(join(c.userData, "setup"), { recursive: true })
  writeFileSync(join(c.userData, "setup", "chromium.done"), "1")
  let called = 0
  await runSetup("chromium", { ...c, exec: async () => void called++ }, () => {})
  expect(called).toBe(0)
})
