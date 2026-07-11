import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Icon } from "@opencode-ai/ui/v2/icon"
import FileTreeV2 from "@/components/file-tree-v2"
import { useSDK } from "@/context/sdk"
import { isPdfDataUrl, PAPERINO_DOCUMENT_PREVIEW_EVENT } from "./document-preview"
import { PdfPages } from "./pdf-pages"
import { FilePreview, type FilePreviewState } from "./file-preview"
import { CollapseDiagonalIcon, ExpandDiagonalIcon } from "./panel-icons"

type PaperinoCompileError = { file: string; line: number | null; message: string }
type PaperinoStatus =
  | { state: "empty" }
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string; source: "compile" | "preview" }
  | { state: "error"; errors: PaperinoCompileError[]; log: string; kind?: "compile" | "document" }
type ReadFileError = "invalid-path" | "not-found" | "too-large"
type PaperinoBridge = {
  detect: (dir: string) => Promise<boolean>
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  onStatus: (cb: (status: PaperinoStatus) => void) => () => void
  listFiles: (dir: string) => Promise<{ files: string[]; truncated: boolean }>
  readFile: (dir: string, relPath: string) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: ReadFileError }>
}

const bridge = (): PaperinoBridge | undefined => (window as { api?: { paperino?: PaperinoBridge } }).api?.paperino

const WIDTH_KEY = "paperino-panel-width"
const TREE_OPEN_KEY = "paperino-tree-open"
const TREE_WIDTH_KEY = "paperino-tree-width"
const OPEN_KEY = "paperino-panel-open"
const EXPANDED_KEY = "paperino-panel-expanded"

type PanelMode = { kind: "paper" } | { kind: "file"; path: string }

export function PaperPreviewPanel() {
  const sdk = useSDK()
  const api = bridge()

  const [status, setStatus] = createSignal<PaperinoStatus>({ state: "empty" })
  const [pageCount, setPageCount] = createSignal(0)
  const [width, setWidth] = createSignal(Number(localStorage.getItem(WIDTH_KEY)) || 480)
  const [paperPdf, setPaperPdf] = createSignal<Uint8Array>()

  // The panel used to be permanently on screen. It can now be closed to a rail and
  // expanded over the whole window; both survive a restart.
  const [open, setOpen] = createSignal(localStorage.getItem(OPEN_KEY) !== "0")
  const [expanded, setExpanded] = createSignal(localStorage.getItem(EXPANDED_KEY) === "1")

  const [mode, setMode] = createSignal<PanelMode>({ kind: "paper" })
  const [treeOpen, setTreeOpen] = createSignal(localStorage.getItem(TREE_OPEN_KEY) === "1")
  const [treeWidth, setTreeWidth] = createSignal(Number(localStorage.getItem(TREE_WIDTH_KEY)) || 200)
  const [listing, setListing] = createSignal<{ files: string[]; truncated: boolean }>({ files: [], truncated: false })
  const [fileState, setFileState] = createSignal<FilePreviewState>()

  const filePath = () => {
    const m = mode()
    return m.kind === "file" ? m.path : undefined
  }

  const persistOpen = (next: boolean) => {
    setOpen(next)
    localStorage.setItem(OPEN_KEY, next ? "1" : "0")
  }

  const persistExpanded = (next: boolean) => {
    setExpanded(next)
    localStorage.setItem(EXPANDED_KEY, next ? "1" : "0")
  }

  // Closing drops the expanded state too: reopening from the rail should give back the
  // split view, not silently swallow the whole window.
  const closePanel = () => {
    persistExpanded(false)
    persistOpen(false)
  }

  let readToken = 0

  const refreshListing = async () => {
    const dir = sdk().directory
    if (!api || !dir) return
    setListing(await api.listFiles(dir))
  }

  const toggleTree = () => {
    const next = !treeOpen()
    setTreeOpen(next)
    localStorage.setItem(TREE_OPEN_KEY, next ? "1" : "0")
    if (next) void refreshListing()
  }

  const openFile = async (path: string) => {
    const dir = sdk().directory
    if (!api || !dir) return
    const token = ++readToken
    setMode({ kind: "file", path })
    setFileState({ path })
    const result = await api.readFile(dir, path)
    if (token !== readToken) return
    setFileState(result.ok ? { path, bytes: result.bytes } : { path, error: result.error })
  }

  const backToPaper = () => {
    readToken++
    setMode({ kind: "paper" })
    setFileState(undefined)
  }

  const previewDocument = async (source: string) => {
    if (!isPdfDataUrl(source)) return
    // An agent-pushed document preview is an explicit "show me this" — take over
    // even when a clicked file is on screen, and reopen the panel if the user closed
    // it, or the agent would answer "here it is" into a panel nobody can see.
    backToPaper()
    persistOpen(true)
    try {
      const response = await fetch(source)
      const pdf = new Uint8Array(await response.arrayBuffer())
      setStatus({ state: "ok", pdf, log: "", source: "preview" })
      setPaperPdf(pdf)
    } catch (error) {
      setStatus({
        state: "error",
        kind: "document",
        errors: [{ file: "document", line: null, message: error instanceof Error ? error.message : "Unable to preview PDF" }],
        log: "",
      })
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return
      void previewDocument(event.detail)
    }
    window.addEventListener(PAPERINO_DOCUMENT_PREVIEW_EVENT, handler)
    onCleanup(() => window.removeEventListener(PAPERINO_DOCUMENT_PREVIEW_EVENT, handler))
  })

  createEffect(() => {
    const dir = sdk().directory
    if (!api || !dir) return

    // Switching projects must not leave the previous paper on screen
    setPaperPdf(undefined)
    setStatus({ state: "empty" })
    backToPaper()
    setListing({ files: [], truncated: false })
    if (treeOpen()) void refreshListing()

    const unsubscribe = api.onStatus((next) => {
      setStatus(next)
      if (next.state === "ok") setPaperPdf(next.pdf)
    })
    void api.watch(dir)

    onCleanup(() => {
      unsubscribe()
      void api.unwatch()
    })
  })

  const errors = () => {
    const s = status()
    return s.state === "error" ? s.errors : []
  }

  const documentPreviewFailed = () => {
    const s = status()
    return s.state === "error" && s.kind === "document"
  }

  return (
    <Show when={api}>
      <Show
        when={open()}
        fallback={
          <div class="hidden md:flex h-full w-8 shrink-0 flex-col items-center border-l border-border-weaker-base bg-background-base pt-2">
            <button
              type="button"
              class="text-text-weak hover:text-text-base"
              title="Show preview"
              onClick={() => persistOpen(true)}
            >
              <Icon name="sidebar-right" class="size-4" />
            </button>
          </div>
        }
      >
      <div
        class="relative hidden md:flex h-full shrink-0 flex-col overflow-hidden border-l border-border-weaker-base bg-background-base"
        // Expanded, the panel claims the full row. The chat column is `flex-1 min-w-0`,
        // so it collapses to nothing — which is how the preview takes over the window
        // without this component having to reach into its siblings.
        style={{ width: expanded() ? "100%" : `${width()}px` }}
      >
        <div class="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-border-weaker-base">
          <Show
            when={filePath()}
            fallback={<div class="text-12-regular text-text-weak flex-1 truncate">Preview</div>}
          >
            {(path) => (
              <>
                <button
                  type="button"
                  class="text-12-regular text-text-weak hover:text-text-base shrink-0"
                  onClick={backToPaper}
                >
                  ← Paper
                </button>
                <div class="text-12-regular text-text-base flex-1 truncate" title={path()}>
                  {path()}
                </div>
              </>
            )}
          </Show>
          <Show when={!filePath()}>
            <Show when={status().state === "compiling"}>
              <div class="text-12-regular text-text-weak">compiling…</div>
            </Show>
            <Show when={status().state === "ok"}>
              <div class="text-12-regular text-text-weak">{pageCount() === 1 ? "1 page" : `${pageCount()} pages`}</div>
            </Show>
            <Show when={status().state === "error"}>
              <div class="text-12-regular text-red-500">
                {documentPreviewFailed() ? "preview failed" : "compile failed"}
              </div>
            </Show>
          </Show>
          <button
            type="button"
            class="shrink-0 flex items-center"
            classList={{ "text-text-base": treeOpen(), "text-text-weak hover:text-text-base": !treeOpen() }}
            title="Toggle file tree"
            aria-pressed={treeOpen()}
            onClick={toggleTree}
          >
            <Icon name="folder" class="size-4" />
          </button>
          <button
            type="button"
            class="shrink-0 flex items-center text-text-weak hover:text-text-base"
            title={expanded() ? "Restore split view" : "Expand preview"}
            aria-pressed={expanded()}
            onClick={() => persistExpanded(!expanded())}
          >
            <Show when={expanded()} fallback={<ExpandDiagonalIcon class="size-4" />}>
              <CollapseDiagonalIcon class="size-4" />
            </Show>
          </button>
          <button
            type="button"
            class="shrink-0 flex items-center text-text-weak hover:text-text-base"
            title="Close preview"
            onClick={closePanel}
          >
            <Icon name="close" class="size-4" />
          </button>
        </div>
        <div class="flex-1 min-h-0 flex">
          <Show when={treeOpen()}>
            <div
              class="relative h-full shrink-0 border-r border-border-weaker-base overflow-hidden flex flex-col"
              style={{ width: `${treeWidth()}px` }}
            >
              <div class="flex items-center justify-between gap-2 px-2 h-6 shrink-0">
                <Show when={listing().truncated}>
                  <span class="text-12-regular text-text-weak truncate">truncated at 5,000</span>
                </Show>
                <button
                  type="button"
                  class="text-12-regular text-text-weak hover:text-text-base ml-auto"
                  title="Refresh file list"
                  onClick={() => void refreshListing()}
                >
                  ↻
                </button>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto px-2 py-2">
                <FileTreeV2
                  allowed={listing().files}
                  draggable={false}
                  active={filePath()}
                  onFileClick={(node) => void openFile(node.path)}
                />
              </div>
              <ResizeHandle
                direction="horizontal"
                edge="end"
                size={treeWidth()}
                min={140}
                max={400}
                onResize={(w) => {
                  setTreeWidth(w)
                  localStorage.setItem(TREE_WIDTH_KEY, String(w))
                }}
              />
            </div>
          </Show>
          <div class="flex-1 min-w-0 min-h-0 flex flex-col relative">
            <Show
              when={filePath()}
              fallback={
                <>
                  <PdfPages data={paperPdf()} onPageCount={setPageCount} />
                  <Show when={status().state === "empty"}>
                    <div class="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
                      <div class="text-12-regular text-text-weak text-center max-w-64">
                        Nothing to preview yet. Open a paper workspace, run <span class="font-mono">/new-paper</span>, or
                        ask to see a document.
                      </div>
                    </div>
                  </Show>
                </>
              }
            >
              <Show when={fileState()}>{(state) => <FilePreview state={state()} />}</Show>
            </Show>
          </div>
        </div>
        <Show when={errors().length > 0 && !filePath()}>
          <div class="max-h-32 shrink-0 overflow-y-auto border-t border-border-weaker-base px-3 py-2">
            <For each={errors()}>
              {(err) => (
                <div class="text-12-regular text-red-500">
                  {err.file}
                  {err.line !== null ? `:${err.line}` : ""} — {err.message}
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={!expanded()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={width()}
            min={320}
            max={900}
            onResize={(w) => {
              setWidth(w)
              localStorage.setItem(WIDTH_KEY, String(w))
            }}
          />
        </Show>
      </div>
      </Show>
    </Show>
  )
}
