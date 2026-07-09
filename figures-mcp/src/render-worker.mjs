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
const { figuresDir, buildDir, name, width, archetype, data } = job

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
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  page.on("console", (msg) => consoleOutput.push(`[${msg.type()}] ${msg.text()}`))
  page.on("pageerror", (err) => consoleOutput.push(`[pageerror] ${err.message}`))
  await page.addInitScript(`window.__DATA__ = ${data}`)
  await page.goto(`${origin}/${name}/figure.html`)

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
          derived: el.closest("[data-derived]") !== null,
        })
      }
    }
    const strokes = Array.from(document.querySelectorAll("svg *")).flatMap((el) => {
      const cs = getComputedStyle(el)
      const w = parseFloat(cs.strokeWidth)
      if (!Number.isFinite(w) || cs.stroke === "none") return []
      return [{ selector: cssPath(el), width: w }]
    })
    // The overlay is stretched to the initial viewport, so scrollHeight would pin the
    // page at 800px and pad the figure with dead space. Measure the real content.
    const content = Array.from(document.body.children)
      .filter((el) => el.id !== "annot-overlay")
      .reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0)
    const height = Math.ceil(Math.max(content, 100))
    return { viewport: { width: window.innerWidth, height }, texts, strokes }
  })

  const contentHeight = Math.max(manifest.viewport.height, 100)
  await page.setViewportSize({ width, height: contentHeight })
  await page.evaluate((h) => {
    const overlay = document.querySelector("#annot-overlay")
    if (overlay) overlay.style.height = `${h}px`
  }, contentHeight)

  const png = join(buildDir, `${name}.png`)
  await page.screenshot({ path: png, fullPage: true })
  const pdf = join(buildDir, `${name}.pdf`)
  await page.pdf({ path: pdf, width: `${width}px`, height: `${contentHeight}px`, printBackground: true, pageRanges: "1" })

  // best-effort SVG (schematic only): read the overlay markup in the page, write it here
  let svgPath = null
  if (archetype === "schematic") {
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
