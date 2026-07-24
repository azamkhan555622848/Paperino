import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"
import { BrowserWindow, app, ipcMain } from "electron"
import type { WebContents } from "electron"
import { OUT_DIR, PREVIEW_FILE, compile, isPaperWorkspace, watchWorkspace } from "./core"
import type { CompileError } from "./core"
import { listWorkspaceFiles, readWorkspaceFile } from "./files"
import { clearFetchRequest, openInstitutionalFetch, readFetchRequest } from "./institutional"
import { completeOnboarding, onboardingStatus } from "./onboarding"
import { runSetup, setupStatus } from "./setup"
import type { SetupComponent, SetupProgress } from "./setup"
import { getStore } from "../store"

type PaperinoStatus =
  | { state: "empty" }
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string; source: "compile" | "preview" }
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

    // A project can outlive its folder — the store keeps the entry after the directory is moved or
    // deleted. fs.watch would throw ENOENT here, and the renderer only ever gets an unhandled
    // rejection out of it. An empty panel is the right answer, not a crash.
    if (!existsSync(dir)) {
      send({ state: "empty" })
      return
    }

    // A PDF the agent placed at .paperino/preview.pdf is shown as-is, no compile.
    const showPreview = async () => {
      const path = join(dir, OUT_DIR, PREVIEW_FILE)
      if (!existsSync(path)) return false
      const pdf = new Uint8Array(await readFile(path))
      send({ state: "ok", pdf, log: "", source: "preview" })
      return true
    }

    let running = false
    let queued = false
    const runCompile = async () => {
      if (running) {
        queued = true
        return
      }
      running = true
      send({ state: "compiling" })
      const result = await compile(dir)
      if (result.ok) {
        const pdf = new Uint8Array(await readFile(result.pdfPath))
        send({ state: "ok", pdf, log: result.log, source: "compile" })
      } else {
        send({ state: "error", errors: result.errors, log: result.log })
      }
      running = false
      if (queued) {
        queued = false
        void runCompile()
      }
    }

    const watcher = watchWorkspace(dir, {
      // A project can become a paper workspace mid-session (e.g. /new-paper),
      // so re-check rather than capturing the answer at watch time.
      onSource: () => {
        if (isPaperWorkspace(dir)) void runCompile()
      },
      onPreview: () => void showPreview(),
    })
    states.set(sender.id, { watcher })
    sender.once("destroyed", () => stop(sender.id))

    if (isPaperWorkspace(dir)) {
      await runCompile()
      return
    }
    if (await showPreview()) return
    send({ state: "empty" })
  })

  ipcMain.handle("paperino-unwatch", (event) => stop(event.sender.id))

  ipcMain.handle("paperino-list-files", (_event, dir: string) => listWorkspaceFiles(dir))

  ipcMain.handle("paperino-read-file", (_event, dir: string, relPath: string) => readWorkspaceFile(dir, relPath))

  // Is there a paper the agent could not reach, waiting on the user's library login? The MCP
  // leaves the request in .paperino/; an MCP call cannot block on a human, so the app asks.
  ipcMain.handle("paperino-fetch-request", (_event, dir: string) => readFetchRequest(dir) ?? null)

  // Open the publisher's page for the user to sign in and save the PDF. Explicitly user-initiated:
  // the renderer calls this from a click, never on a timer, because an automated loop over paywalled
  // DOIs is precisely what publishers ban and what gets an institution blocked.
  ipcMain.handle("paperino-institutional-fetch", async (_event, dir: string) => {
    const request = readFetchRequest(dir)
    if (!request) return false
    const saved = await openInstitutionalFetch(dir, request)
    if (!saved) clearFetchRequest(dir)
    return saved
  })

  // The first-run wizard: welcome → runtime setup → sign in with ChatGPT → figure key. The
  // renderer asks whether to show it; `packaged` tells it whether the runtime-setup step is
  // even relevant (in dev, Chromium and Python come from the repo).
  ipcMain.handle("paperino-onboarding-status", () => onboardingStatus(getStore(), app.isPackaged))

  ipcMain.handle("paperino-onboarding-complete", () => completeOnboarding(getStore()))

  // First-run runtime setup (Chromium, portable Python). The onboarding wizard drives
  // these; Settings re-runs them after a skip. Progress is broadcast rather than returned
  // so a long install can paint a bar instead of freezing on one await.
  ipcMain.handle("paperino-setup-status", () => setupStatus(app.getPath("userData")))

  ipcMain.handle("paperino-setup-run", async (_event, component: SetupComponent) => {
    try {
      await runSetup(
        component,
        {
          userData: app.getPath("userData"),
          resources: join(process.resourcesPath, "paperino"),
          electronExe: process.execPath,
        },
        (progress: SetupProgress) => {
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send("paperino-setup-progress", progress)
        },
      )
      return { ok: true as const }
    } catch (error) {
      // A failed download must surface as a message the wizard can show, never as an
      // unhandled rejection that leaves the step spinning forever.
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
