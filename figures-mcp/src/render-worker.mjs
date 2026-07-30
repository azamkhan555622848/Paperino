// Runs under NODE, not bun: Playwright drives Chrome over --remote-debugging-pipe
// (fds 3/4), which bun's spawn does not wire up, so chromium.launch() hangs forever.
// render.ts spawns this worker and reads one JSON line from stdout.
//
// Usage: node render-worker.mjs <job.json>
//   job = { figuresDir, buildDir, name, width, archetype, data }

import { createServer } from "node:http"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { extname, join, normalize, resolve } from "node:path"
import { chromium } from "playwright"

const job = JSON.parse(readFileSync(process.argv[2], "utf8"))
const { figuresDir, buildDir, name, width, archetype, data, engine } = job

const consoleOutput = []
const emit = (result) => {
  process.stdout.write(`\n__RESULT__${JSON.stringify(result)}`)
  process.exit(0) // exits the process, which tears down the static server too
}

// figure.html imports ../lib/annot.js as an ES module, which Chrome blocks over
// file:// (CORS). Serve figures/ over loopback HTTP instead.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
}
const root = resolve(figuresDir)
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[/\\]+/, "")
  const file = resolve(join(root, rel))
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end("not found")
    return
  }
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const origin = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ headless: true, args: ["--font-render-hinting=none"] })
try {
  // DSF only affects raster output (the review PNG the model looks at); the PDF and all
  // bbox geometry stay in CSS px, so print-true sizing is unaffected.
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 3 })
  page.on("console", (msg) => consoleOutput.push(`[${msg.type()}] ${msg.text()}`))
  page.on("pageerror", (err) => consoleOutput.push(`[pageerror] ${err.message}`))
  await page.addInitScript(`window.__DATA__ = ${data}`)
  if (engine === "mpl") {
    // An SVG document has no <body>, and the entire manifest walker below starts at
    // document.body. Inlining matplotlib's SVG into a one-line HTML shell keeps every line
    // of that extraction working unchanged — and pulls in tokens.css, without which
    // Chromium cannot resolve the face matplotlib named and every text node would report a
    // system-serif fallback and fail rule 13.
    const svgMarkup = readFileSync(join(buildDir, `${name}.svg`), "utf8").replace(/<\?xml[^>]*\?>/, "")
    writeFileSync(
      join(buildDir, `${name}.wrap.html`),
      `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../../tokens.css">` +
        // A little padding, because matplotlib tight-boxes the INK while a glyph's client
        // rect includes its ascent — a title flush against the top reports 2px above the
        // origin and trips the overflow rule. This shifts measurement only: the artifacts
        // LaTeX and the review see are matplotlib's own, written before the page loaded.
        `<style>html,body{margin:0;padding:4px;background:#fff}svg{display:block;max-width:100%;height:auto}</style>` +
        `<body>${svgMarkup}</body>`,
    )
    await page.goto(`${origin}/${name}/build/${name}.wrap.html`)
    // matplotlib emits static markup: nothing calls figReady(), so declare it ready once
    // the vendored face has actually loaded. Measuring before then reports fallback metrics.
    await page.evaluate(() =>
      document.fonts.ready.then(() => {
        window.__FIG_READY__ = true
      }),
    )
  } else {
    await page.goto(`${origin}/${name}/figure.html`)
  }

  let failure = null
  try {
    await page.evaluate(() => document.fonts.ready.then(() => true))
    // resolve as soon as the figure is ready OR has thrown — no need to burn the timeout
    await page.waitForFunction("window.__FIG_READY__ === true || Boolean(window.__FIG_ERROR__)", undefined, {
      timeout: 15_000,
    })
    const figError = await page.evaluate(() => window.__FIG_ERROR__ ?? null)
    if (figError) failure = `figure error: ${figError}`
  } catch {
    failure = "__FIG_READY__ never became true (JS error or missing figReady())"
  }

  if (failure) {
    const png = join(buildDir, `${name}.png`)
    await page.screenshot({ path: png, fullPage: true }).catch(() => {})
    await browser.close()
    emit({ ok: false, error: failure, consoleOutput, png: existsSync(png) ? png : null })
  }

  // bbox manifest: every visible text node + every SVG stroke width
  const manifest = await page.evaluate(() => {
    const cssPath = (node) => {
      if (node.id) return `#${node.id}`
      const parent = node.parentElement
      if (!parent) return node.tagName.toLowerCase()
      const idx = Array.from(parent.children).indexOf(node) + 1
      return `${cssPath(parent)} > ${node.tagName.toLowerCase()}:nth-child(${idx})`
    }
    const effectiveBackground = (node) => {
      let cur = node
      while (cur) {
        const bg = getComputedStyle(cur).backgroundColor
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg
        cur = cur.parentElement
      }
      return "rgb(255, 255, 255)"
    }
    const texts = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const tn = walker.currentNode
      if (!tn.textContent || !tn.textContent.trim()) continue
      const el = tn.parentElement
      if (!el) continue
      // KaTeX emits a hidden MathML twin of every formula for screen readers. It is
      // CLIPPED, not display:none, so it still has client rects — but it is not ink.
      // Left in, it duplicates every glyph (bogus overlap), carries font-family "math"
      // (bogus font-allowlist), and its exponents look like untraceable numbers (bogus
      // provenance). Only .katex-html is rendered.
      if (el.closest(".katex-mathml")) continue
      const range = document.createRange()
      range.selectNodeContents(tn)
      const cs = getComputedStyle(el)
      // One box per LINE, not one union box: a wrapped text node's bounding rect spans
      // every line it occupies, which would collide with inline siblings on other lines.
      for (const r of range.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue
        texts.push({
          selector: cssPath(el),
          text: tn.textContent.trim(),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          fontSize: parseFloat(cs.fontSize),
          color: cs.color,
          background: effectiveBackground(el),
          // Tick labels are COMPUTED, not experiment numbers, so provenance must exempt
          // them. The HTML engine declares that with data-derived; matplotlib says it
          // structurally through its own gids, so an mpl author can neither forget it nor
          // abuse it. closest() is required rather than a scan of the file: <g id="xtick_1">
          // WRAPS a <g id="text_N">, and a non-greedy match stops at the inner </g>.
          derived:
            el.closest("[data-derived]") !== null || el.closest('g[id^="xtick"], g[id^="ytick"]') !== null,
          fontFamily: cs.fontFamily,
          // "Typeset by a math engine, not by the author" — the flag is named for KaTeX
          // because that came first, but matplotlib's mathtext earns the same exemptions.
          //
          // A face test cannot detect it: with fontset=stix, matplotlib takes symbols from
          // STIX but upright glyphs inside a formula from the BODY face, so a superscript
          // reads as "TeX Gyre Termes" exactly like a plain label. The structural tell is
          // that mathtext lays out every glyph as a <tspan> with explicit x AND y, the same
          // absolute glyph positioning KaTeX does. Ordinary matplotlib labels are bare
          // <text> nodes with no tspans at all.
          inKatex:
            el.closest(".katex") !== null ||
            (el.tagName === "tspan" && el.hasAttribute("x") && el.hasAttribute("y")),
        })
      }
    }
    const strokes = Array.from(document.querySelectorAll("svg *")).flatMap((el) => {
      const cs = getComputedStyle(el)
      const w = parseFloat(cs.strokeWidth)
      if (!Number.isFinite(w) || cs.stroke === "none") return []
      return [{ selector: cssPath(el), width: w }]
    })
    // Web-chrome audit: record every element carrying a border radius or a shadow.
    // Paper figures have square corners and no shadows (lint rule 12).
    const elements = []
    for (const el of document.querySelectorAll("body *")) {
      const cs2 = getComputedStyle(el)
      const radius = Math.max(
        ...[cs2.borderTopLeftRadius, cs2.borderTopRightRadius, cs2.borderBottomLeftRadius, cs2.borderBottomRightRadius]
          .map((v) => parseFloat(v))
          .map((v) => (Number.isFinite(v) ? v : 0)),
      )
      const shadow = cs2.boxShadow
      const rr = el.getBoundingClientRect()
      if ((radius > 0 || (shadow && shadow !== "none")) && rr.width > 0 && rr.height > 0)
        elements.push({ selector: cssPath(el), borderRadius: radius, boxShadow: shadow })
    }

    // Overlay path GEOMETRY, not just stroke width. Rules 14 and 15 ask where a stroke
    // went, and the v3 manifest could only say how thick it was — which is why an arrow
    // through a text block linted clean.
    //
    // getPointAtLength handles every path type uniformly, so a bowed quadratic and a
    // mitred polyline are sampled the same way. 2px steps, capped, keeps a long detour
    // from producing thousands of points.
    //
    // A path inside <defs> is a DEFINITION, not ink. The arrowhead <marker> every arrow
    // points at holds one, in marker coordinate space at the page origin — sampled as a
    // real path it reports a stroke from (0,0.5) to (0,7.5), which rule 14 then reads as
    // crossing whatever glyph sits in the figure's top-left corner. Every figure that
    // draws an arrow carries that marker, so this filter is what keeps rule 14 from
    // failing all of them for a stroke nobody drew.
    const paths = []
    for (const p of document.querySelectorAll("#annot-overlay path")) {
      if (p.closest("defs, marker, clipPath, mask, pattern, symbol")) continue
      const total = p.getTotalLength()
      const steps = Math.min(400, Math.max(2, Math.ceil(total / 2)))
      const points = []
      for (let i = 0; i <= steps; i++) {
        const pt = p.getPointAtLength((total * i) / steps)
        points.push([pt.x, pt.y])
      }
      const cs = getComputedStyle(p)
      paths.push({
        selector: cssPath(p),
        points,
        width: parseFloat(cs.strokeWidth) || 0,
        // A leader deliberately ends in open space; rule 15 must not fail it.
        kind: p.hasAttribute("data-leader")
          ? "leader"
          : p.hasAttribute("data-dimension")
            ? "dimension"
            : p.hasAttribute("data-edge")
              ? "edge"
              : "other",
      })
    }

    // Declared nodes. Rule 16 needs to know what CLAIMS to be a node, and rule 15 needs
    // their boundaries to decide whether an endpoint is attached to anything at all.
    //
    // The LAYOUT box, not annot.js's ink rect: a borderless node's ink rect is its text
    // union, which sits strictly inside the box, so the layout box is the permissive of the
    // two and an endpoint anchored to either one lands inside it.
    const nodes = Array.from(document.querySelectorAll("[data-node]")).map((el) => {
      const r = el.getBoundingClientRect()
      return {
        selector: cssPath(el),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        hasText: Boolean(el.textContent && el.textContent.trim()),
        intent: el.getAttribute("data-intent") ?? null,
      }
    })

    // Legend swatches vs every other mark, for rule 17. The style triple is what a reader
    // matches by eye: colour, dash pattern, fill.
    const markStyle = (el) => {
      const cs = getComputedStyle(el)
      const border = ["Top", "Right", "Bottom", "Left"]
        .map((s) => (parseFloat(cs[`border${s}Width`]) > 0 ? cs[`border${s}Color`] : null))
        .find(Boolean)
      // stroke-dasharray computes to the string "none" on an HTML element, which is TRUTHY —
      // so `cs.strokeDasharray || cs.borderTopStyle` never reaches the border style, and a
      // dashed HTML swatch got the same triple as a solid HTML mark. Rule 17 compares these
      // triples, so collapsing dashed into solid is what would make it match the wrong mark
      // and go quiet. Fall through on "none", not on emptiness.
      const dash = cs.strokeDasharray && cs.strokeDasharray !== "none" ? cs.strokeDasharray : cs.borderTopStyle || ""
      return [cs.stroke !== "none" ? cs.stroke : (border ?? ""), dash, cs.backgroundColor].join("|")
    }
    // A MARK is an element with no text that actually puts ink on the page — a stroke, a
    // border, or its own background. Collecting `body *` wholesale would sweep in every
    // transparent layout wrapper, and a wrapper's style triple would then "match" a legend
    // swatch by accident, making rule 17 unfireable.
    const inked = (el) => {
      const cs = getComputedStyle(el)
      if (cs.stroke && cs.stroke !== "none") return true
      if (["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0)) return true
      return Boolean(cs.backgroundColor) && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent"
    }
    const legend = []
    for (const el of document.querySelectorAll("#annot-overlay *, body *")) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      if (el.textContent && el.textContent.trim()) continue // a swatch is ink, not a word
      if (!inked(el)) continue
      legend.push({ selector: cssPath(el), style: markStyle(el), inLegend: el.closest("[data-legend]") !== null })
    }

    // Every claimed exemption, so lint can honour it AND report it for review to question.
    const intents = Array.from(document.querySelectorAll("[data-intent]")).map((el) => ({
      selector: cssPath(el),
      reason: el.getAttribute("data-intent") ?? "",
    }))

    // The overlay is stretched to the initial viewport, so scrollHeight would pin the
    // page at 800px and pad the figure with dead space. Measure the real content.
    const content = Array.from(document.body.children)
      .filter((el) => el.id !== "annot-overlay")
      .reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0)
    const height = Math.ceil(Math.max(content, 100))
    return {
      viewport: { width: window.innerWidth, height },
      texts,
      strokes,
      elements,
      paths,
      nodes,
      legend,
      intents,
      findings: window.__FIG_FINDINGS__ ?? [],
    }
  })

  const contentHeight = Math.max(manifest.viewport.height, 100)
  await page.setViewportSize({ width, height: contentHeight })
  await page.evaluate((h) => {
    const overlay = document.querySelector("#annot-overlay")
    if (overlay) overlay.style.height = `${h}px`
  }, contentHeight)

  // The mpl engine already wrote both artifacts, and they are BETTER than anything the
  // browser can produce here: matplotlib's PDF is vector with Type-42 embedded fonts, which
  // is exactly what \includegraphics wants and the only reason pdf.fonttype is pinned, and
  // its PNG is 600dpi against a ~3x screenshot. Overwriting them with a browser re-render
  // silently threw both away — the page exists to MEASURE the figure, not to redraw it.
  const png = join(buildDir, `${name}.png`)
  const pdf = join(buildDir, `${name}.pdf`)
  if (engine !== "mpl") {
    await page.screenshot({ path: png, fullPage: true })
    await page.pdf({
      path: pdf,
      width: `${width}px`,
      height: `${contentHeight}px`,
      printBackground: true,
      pageRanges: "1",
    })
  }

  // The mpl engine already wrote a real SVG — that IS the figure, and it is what lint just
  // measured. The HTML engine can only offer its annotation overlay, best-effort.
  let svgPath = null
  if (engine === "mpl") {
    svgPath = join(buildDir, `${name}.svg`)
  } else if (archetype === "schematic") {
    const svgMarkup = await page.evaluate(() => document.querySelector("svg#annot-overlay")?.outerHTML ?? null)
    if (svgMarkup) {
      svgPath = join(buildDir, `${name}.svg`)
      writeFileSync(svgPath, svgMarkup)
    }
  }

  const bboxes = join(buildDir, "bboxes.json")
  writeFileSync(bboxes, JSON.stringify(manifest, null, 1))
  await browser.close()
  emit({ ok: true, png, pdf, svg: svgPath, bboxes, consoleOutput })
} catch (err) {
  await browser.close().catch(() => {})
  emit({ ok: false, error: String(err), consoleOutput, png: null })
}
