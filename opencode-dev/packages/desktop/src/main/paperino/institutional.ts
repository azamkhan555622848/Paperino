import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

/**
 * The institutional-fetch rung: the one step of the full-text ladder an MCP server cannot perform,
 * because only the main process can open a window the user logs into.
 *
 * What this is: the user opening the publisher's page and downloading a paper their institution
 * subscribes to — inside the app instead of a separate browser tab. Their credentials go to their
 * university's SSO and the publisher; we keep nothing but the session cookies, in an isolated
 * persistent partition.
 *
 * What this is deliberately NOT: a crawler. One window, one paper, one explicit save. Automating it
 * over a list is what gets a university's whole IP range blocked, so the confirmation stays.
 */
export const FETCH_REQUEST_PATH = join(".paperino", "fetch-request.json")
const SHELF_DIR = "papers"
const PARTITION = "persist:institution"
const STALE_MS = 3_600_000

export type FetchRequest = { doi: string; url: string; publisher: string; requestedAt: string }

/** Mirrors literature-mcp's slugFor() — the two must agree, or a saved PDF is invisible to the shelf. */
export function shelfPathFor(doi: string): string {
  return `${SHELF_DIR}/${doi.toLowerCase().replace(/[\\/:*?"<>|]/g, "_")}.pdf`
}

/**
 * Read the request the MCP left, or undefined. Undefined covers absent, malformed, incomplete and
 * stale — a request from an hour ago must not pop a login window the user has no context for.
 */
export function readFetchRequest(workspace: string): FetchRequest | undefined {
  const path = join(workspace, FETCH_REQUEST_PATH)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<FetchRequest>
    if (!parsed.doi || !parsed.url || !parsed.requestedAt) return undefined
    if (Date.now() - Date.parse(parsed.requestedAt) > STALE_MS) return undefined
    return {
      doi: parsed.doi,
      url: parsed.url,
      publisher: parsed.publisher ?? "the publisher",
      requestedAt: parsed.requestedAt,
    }
  } catch {
    return undefined
  }
}

export function clearFetchRequest(workspace: string): void {
  rmSync(join(workspace, FETCH_REQUEST_PATH), { force: true })
}

/**
 * Open the publisher's page in a window with a PERSISTENT partition, so the user signs in through
 * their library's SSO once and subsequent papers are a click. Any PDF downloaded in that window
 * lands on the shelf under the requested DOI's slug, where `fulltext`'s first rung will find it.
 *
 * Resolves true if a PDF was saved, false if the user closed the window without one.
 *
 * `electron` is imported HERE, not at module scope: its index.js only resolves inside the Electron
 * runtime, so a top-level import makes this whole module unloadable under bun — and the pure
 * functions above, which the tests cover, would go untestable with it.
 */
export async function openInstitutionalFetch(workspace: string, request: FetchRequest): Promise<boolean> {
  const { BrowserWindow, session } = await import("electron")
  return new Promise((resolve) => {
    const partition = session.fromPartition(PARTITION)
    const target = join(workspace, shelfPathFor(request.doi))
    mkdirSync(join(workspace, SHELF_DIR), { recursive: true })

    let saved = false
    const onDownload = (_e: Electron.Event, item: Electron.DownloadItem) => {
      // Save through a temp name and rename, so the workspace watcher never sees a partial PDF.
      const tmp = `${target}.part`
      item.setSavePath(tmp)
      item.once("done", (_evt, state) => {
        if (state !== "completed") return
        try {
          renameSync(tmp, target)
          saved = true
          clearFetchRequest(workspace)
          win.close()
        } catch {
          rmSync(tmp, { force: true })
        }
      })
    }
    partition.on("will-download", onDownload)

    const win = new BrowserWindow({
      width: 1100,
      height: 850,
      title: `Sign in to ${request.publisher} — Paperino`,
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true },
    })

    win.once("closed", () => {
      partition.off("will-download", onDownload)
      resolve(saved)
    })
    void win.loadURL(request.url)
  })
}
