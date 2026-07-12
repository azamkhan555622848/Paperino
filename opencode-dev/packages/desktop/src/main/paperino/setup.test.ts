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
