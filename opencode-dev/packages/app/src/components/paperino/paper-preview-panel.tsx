import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import * as pdfjs from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useSDK } from "@/context/sdk"

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type PaperinoCompileError = { file: string; line: number | null; message: string }
type PaperinoStatus =
  | { state: "empty" }
  | { state: "compiling" }
  | { state: "ok"; pdf: Uint8Array; log: string; source: "compile" | "preview" }
  | { state: "error"; errors: PaperinoCompileError[]; log: string }
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

  let pages!: HTMLDivElement
  let renderToken = 0

  const renderPdf = async (data: Uint8Array) => {
    const token = ++renderToken
    // pdf.js transfers the buffer to its worker — hand it a copy
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise
    if (token !== renderToken) return
    const scroll = pages.scrollTop
    // clientWidth already excludes the vertical scrollbar; subtract the p-3 padding
    const available = Math.max(200, pages.clientWidth - 24)
    const canvases: HTMLCanvasElement[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const unscaled = page.getViewport({ scale: 1 })
      const scale = (available / unscaled.width) * window.devicePixelRatio
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement("canvas")
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / window.devicePixelRatio}px`
      canvas.style.height = `${viewport.height / window.devicePixelRatio}px`
      canvas.className = "block mx-auto mb-2 shadow"
      await page.render({ canvas, viewport }).promise
      canvases.push(canvas)
    }
    if (token !== renderToken) return
    pages.replaceChildren(...canvases)
    pages.scrollTop = scroll
    setPageCount(doc.numPages)
  }

  createEffect(() => {
    const dir = sdk().directory
    if (!api || !dir) return

    // Switching projects must not leave the previous paper on screen
    renderToken++
    pages?.replaceChildren()
    setPageCount(0)
    setStatus({ state: "empty" })

    const unsubscribe = api.onStatus((next) => {
      setStatus(next)
      if (next.state === "ok") void renderPdf(next.pdf)
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
            <div class="text-12-regular text-red-500">compile failed</div>
          </Show>
        </div>
        <div ref={pages} class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3" />
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
