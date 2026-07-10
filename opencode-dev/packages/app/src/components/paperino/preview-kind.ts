export type PreviewKind = "pdf" | "image" | "docx" | "doc-legacy" | "text" | "binary"

export const TEXT_DISPLAY_CAP = 2 * 1024 * 1024

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"])

const TEXT_EXT = new Set([
  "tex", "bib", "txt", "md", "json", "jsonc", "yaml", "yml", "csv", "tsv", "toml",
  "py", "js", "ts", "tsx", "jsx", "mjs", "cls", "sty", "log", "cmd", "sh", "bat",
  "xml", "html", "css", "ini", "cfg", "r", "m",
])

// Extensions we know are binary — without this, formats whose header happens to
// decode as UTF-8 (ASCII STL, zip's "PK") would false-positive the text sniff.
const BINARY_EXT = new Set([
  "zip", "gz", "7z", "rar", "tar", "exe", "dll", "so", "dylib", "bin", "dat",
  "stl", "step", "stp", "fcstd", "pyc", "class", "o", "obj", "wasm",
  "ttf", "otf", "woff", "woff2", "eot",
  "mp4", "mov", "avi", "mkv", "webm", "mp3", "wav", "flac", "ogg",
])

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
}

export function extensionOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

export function imageMime(ext: string) {
  return MIME[ext] ?? "application/octet-stream"
}

export function looksLikeUtf8Text(bytes: Uint8Array) {
  const sample = bytes.subarray(0, 8192)
  if (sample.includes(0)) return false
  try {
    // stream: true tolerates a multibyte sequence cut off at the sample boundary
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true })
    return true
  } catch {
    return false
  }
}

export function classifyPreviewKind(path: string, bytes: Uint8Array): PreviewKind {
  const ext = extensionOf(path)
  if (ext === "pdf") return "pdf"
  if (IMAGE_EXT.has(ext)) return "image"
  if (ext === "docx") return "docx"
  if (ext === "doc") return "doc-legacy"
  if (TEXT_EXT.has(ext)) return "text"
  if (BINARY_EXT.has(ext)) return "binary"
  return looksLikeUtf8Text(bytes) ? "text" : "binary"
}
