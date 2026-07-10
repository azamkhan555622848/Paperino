import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useSDK } from "@/context/sdk"
import { isPdfDataUrl, PAPERINO_DOCUMENT_PREVIEW_EVENT } from "./document-preview"
import { PdfPages } from "./pdf-pages"

type PaperinoCompileError = { file: string; line: number | null; message: string }
type PaperinoStatus =
  | { state: "empty" }
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string; source: "compile" | "preview" }
  | { state: "error"; errors: PaperinoCompileError[]; log: string; kind?: "compile" | "document" }
type PaperinoBridge = {
  detect: (dir: string) => Promise<boolean>
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  onStatus: (cb: (status: PaperinoStatus) => void) => () => void
}

const bridge = (): PaperinoBridge | undefined => (window as { api?: { paperino?: PaperinoBridge } }).api?.paperino

const WIDTH_KEY = "paperino-panel-width"

export function PaperPreviewPanel() {
  const sdk = useSDK()
  const api = bridge()

  const [status, setStatus] = createSignal<PaperinoStatus>({ state: "empty" })
  const [pageCount, setPageCount] = createSignal(0)
  const [width, setWidth] = createSignal(Number(localStorage.getItem(WIDTH_KEY)) || 480)
  const [paperPdf, setPaperPdf] = createSignal<Uint8Array>()

  const previewDocument = async (source: string) => {
    if (!isPdfDataUrl(source)) return
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
      <div
        class="relative hidden md:flex h-full shrink-0 flex-col overflow-hidden border-l border-border-weaker-base bg-background-base"
        style={{ width: `${width()}px` }}
      >
        <div class="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-border-weaker-base">
          <div class="text-12-regular text-text-weak flex-1">Preview</div>
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
        </div>
        <PdfPages data={paperPdf()} onPageCount={setPageCount} />
        <Show when={status().state === "empty"}>
          <div class="absolute inset-x-0 top-8 bottom-0 flex items-center justify-center px-8 pointer-events-none">
            <div class="text-12-regular text-text-weak text-center max-w-64">
              Nothing to preview yet. Open a paper workspace, run <span class="font-mono">/new-paper</span>, or ask to
              see a document.
            </div>
          </div>
        </Show>
        <Show when={errors().length > 0}>
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
      </div>
    </Show>
  )
}
