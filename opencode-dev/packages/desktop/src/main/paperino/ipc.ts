import { readFile } from "node:fs/promises"
import type { FSWatcher } from "node:fs"
import { ipcMain } from "electron"
import type { WebContents } from "electron"
import { compile, isPaperWorkspace, watchWorkspace } from "./core"
import type { CompileError } from "./core"

type PaperinoStatus =
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string }
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

    let running = false
    let queued = false
    const run = async () => {
      if (running) {
        queued = true
        return
      }
      running = true
      send({ state: "compiling" })
      const result = await compile(dir)
      if (result.ok) {
        const pdf = new Uint8Array(await readFile(result.pdfPath))
        send({ state: "ok", pdf, log: result.log })
      } else {
        send({ state: "error", errors: result.errors, log: result.log })
      }
      running = false
      if (queued) {
        queued = false
        void run()
      }
    }

    const watcher = watchWorkspace(dir, () => void run())
    states.set(sender.id, { watcher })
    sender.once("destroyed", () => stop(sender.id))
    await run()
  })

  ipcMain.handle("paperino-unwatch", (event) => stop(event.sender.id))
}
