export const PAPERINO_DOCUMENT_PREVIEW_EVENT = "paperino-document-preview"

const pdfDataUrl = /^data:application\/pdf(?:;[^,]*)?,/i

export function requestDocumentPreview(source: string) {
  if (!pdfDataUrl.test(source)) return
  window.dispatchEvent(new CustomEvent<string>(PAPERINO_DOCUMENT_PREVIEW_EVENT, { detail: source }))
}

export function isPdfDataUrl(source: string) {
  return pdfDataUrl.test(source)
}
