import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"
import { ipcMain } from "electron"
import type { WebContents } from "electron"
import { OUT_DIR, PREVIEW_FILE, compile, isPaperWorkspace, watchWorkspace } from "./core"
import type { CompileError } from "./core"

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
}
