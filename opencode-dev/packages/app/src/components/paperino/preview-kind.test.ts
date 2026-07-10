import { describe, expect, test } from "bun:test"
import { classifyPreviewKind, extensionOf, imageMime, looksLikeUtf8Text } from "./preview-kind"

const utf8 = (s: string) => new TextEncoder().encode(s)

describe("extensionOf", () => {
  test("lowercases, handles dotfiles and multi-dot names", () => {
    expect(extensionOf("figures/plot.PNG")).toBe("png")
    expect(extensionOf(".gitignore")).toBe("")
    expect(extensionOf("archive.tar.gz")).toBe("gz")
    expect(extensionOf("README")).toBe("")
  })
})

describe("classifyPreviewKind", () => {
  test("dispatches pdf, image, docx, legacy doc by extension", () => {
    expect(classifyPreviewKind("out/main.pdf", utf8("%PDF-1.5"))).toBe("pdf")
    expect(classifyPreviewKind("figures/plot.PNG", new Uint8Array([0x89]))).toBe("image")
    expect(classifyPreviewKind("draft.docx", new Uint8Array([0x50, 0x4b]))).toBe("docx")
    expect(classifyPreviewKind("old.doc", new Uint8Array())).toBe("doc-legacy")
  })

  test("known text extensions are text regardless of content", () => {
    expect(classifyPreviewKind("main.tex", utf8("\\documentclass"))).toBe("text")
    expect(classifyPreviewKind("refs.bib", utf8("@article{}"))).toBe("text")
    expect(classifyPreviewKind("weird.log", new Uint8Array([0xff, 0xfe, 0x00]))).toBe("text")
  })

  test("known binary extensions never sniff as text", () => {
    expect(classifyPreviewKind("model.stl", utf8("solid ascii"))).toBe("binary")
    expect(classifyPreviewKind("bundle.zip", utf8("PK"))).toBe("binary")
  })

  test("unknown extensions sniff UTF-8", () => {
    expect(classifyPreviewKind("notes.whatever", utf8("plain text content"))).toBe("text")
    expect(classifyPreviewKind("Makefile", utf8("all:\n\techo hi"))).toBe("text")
    expect(classifyPreviewKind("blob.whatever", new Uint8Array([0x00, 0x01, 0x02]))).toBe("binary")
  })
})

describe("looksLikeUtf8Text", () => {
  test("NUL byte means binary", () => {
    expect(looksLikeUtf8Text(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false)
  })
  test("invalid UTF-8 means binary", () => {
    expect(looksLikeUtf8Text(new Uint8Array([0xc3, 0x28]))).toBe(false)
  })
  test("a multibyte char cut at the 8 KB sample boundary is still text", () => {
    const bytes = new Uint8Array(8195).fill(0x61)
    bytes.set([0xe2, 0x82], 8191) // 3-byte "€" starts at 8191; the 8192 sample cuts it mid-sequence
    bytes[8193] = 0xac
    expect(looksLikeUtf8Text(bytes)).toBe(true)
  })
})

describe("imageMime", () => {
  test("maps every supported image extension", () => {
    expect(imageMime("png")).toBe("image/png")
    expect(imageMime("jpg")).toBe("image/jpeg")
    expect(imageMime("jpeg")).toBe("image/jpeg")
    expect(imageMime("svg")).toBe("image/svg+xml")
    expect(imageMime("gif")).toBe("image/gif")
    expect(imageMime("webp")).toBe("image/webp")
    expect(imageMime("bmp")).toBe("image/bmp")
    expect(imageMime("ico")).toBe("image/x-icon")
  })
})
