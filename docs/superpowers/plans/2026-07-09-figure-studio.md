# Paperino Figure Studio (figures-mcp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone TypeScript MCP stdio server (`figures-mcp`) that lets the Paperino agent author Anthropic-quality paper figures as HTML/CSS/SVG code, with a render→lint→vision-review loop, four archetype templates, a declarative annotation library, and data-bound tables/charts that make number hallucination a lint failure.

**Architecture:** Five MCP tools (`figure_scaffold`, `figure_render`, `figure_lint`, `figure_review`, `data_query`) over pure, separately-testable modules (`scaffold.ts`, `render.ts`, `lint.ts`). Playwright headless Chromium renders `figure.html` at a fixed viewport and dumps a bbox manifest; lint runs on the manifest + source; review returns the PNG as an MCP image block so the chat model critiques its own render. Figure sources live inside the paper workspace (`figures/<name>/`); `tokens.css` + `lib/` are vendored into the workspace on first scaffold so papers stay self-contained.

**Tech Stack:** Bun 1.3.14 (runtime + tests), `@modelcontextprotocol/sdk` (stdio server), `playwright` (chromium), `zod`, `yaml`, jq 1.8.2 binary (pinned download, like Tectonic).

## Global Constraints

- **Location:** the server is a new standalone package at `C:\Users\azamk\Documents\Paperino\figures-mcp\` (NOT inside opencode-dev; never chassis code). All commits go to the Documents mega-repo on branch **`feat/paperino`** (checked out); commit paths relative to `C:\Users\azamk\Documents`.
- **Spec:** `Paperino/docs/superpowers/specs/2026-07-09-figure-studio-design.md`. v1 = P0–P5. Registry/eval set (P6/P7) are OUT of scope.
- **Vision review is the chat model's job** — `figure_review` returns image blocks + rubric text; the server never calls any LLM. No API keys anywhere in this package.
- **Every tool takes `workspace` (absolute path to the paper project) as its first argument.** The server must not depend on its own cwd.
- **Browser code (`src/assets/lib/*.js`, templates) has no imports from npm** — self-contained ES modules; layout is HTML/flex/grid; SVG is connective tissue only; colors only via `var(--…)` from `tokens.css`.
- **Data reaches figures via `window.__DATA__`**, injected by `render.ts` from `figures/<name>/data.json` (file:// pages can't fetch). Templates never fetch.
- **Windows host.** PowerShell for downloads; bun for everything else. jq binary lives at `C:\Users\azamk\Documents\Paperino\tools\jq\jq.exe` (gitignored via existing `Paperino/.gitignore` `tools/` rule).
- **Prettier style:** no semicolons, printWidth 120 (match the rest of Paperino).
- **Commits:** `feat(figures): …` / `test(figures): …`, ending with `Co-Authored-By: Claude <noreply@anthropic.com>`. Mega-repo husky precommit: if it fails, fix the cause. Commits can take ~1 min (repo auto-gc) — use a 300s timeout, and if a commit command times out, check `git log` before retrying: it usually landed.

---

### Task 1: Package scaffold, toolchain, MCP skeleton

**Files:**
- Create: `Paperino/figures-mcp/package.json`
- Create: `Paperino/figures-mcp/tsconfig.json`
- Create: `Paperino/figures-mcp/src/server.ts` (skeleton: one `ping` tool; real tools land in Task 7)
- Create: `Paperino/figures-mcp/test/client.ts` (spawns the server over stdio, returns a connected MCP client — used by every later integration test)
- Create: `Paperino/figures-mcp/test/server.test.ts`
- Create: `C:\Users\azamk\Documents\Paperino\tools\jq\jq.exe` (downloaded, NOT committed)

**Interfaces:**
- Produces: `test/client.ts` exporting `connect(): Promise<{ client: Client; close: () => Promise<void> }>`; a running `bun src/server.ts` MCP stdio server; `tools/jq/jq.exe` for Task 6.

- [ ] **Step 1: Create the package**

`Paperino/figures-mcp/package.json`:

```json
{
  "name": "figures-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun src/server.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "playwright": "^1.50.0",
    "yaml": "^2.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bun": "^1.2.0",
    "typescript": "^5.7.0"
  }
}
```

`Paperino/figures-mcp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

```powershell
cd C:\Users\azamk\Documents\Paperino\figures-mcp
bun install
bunx playwright install chromium
```

Expected: install completes; chromium downloads (~120 MB). If `bun install` warns about the MCP SDK version not existing, run `bun add @modelcontextprotocol/sdk playwright yaml zod` to take current versions — the APIs used below (`McpServer`, `registerTool`, `StdioServerTransport`) are stable across 1.x.

- [ ] **Step 2: Download jq 1.8.2 (pinned)**

```powershell
New-Item -ItemType Directory -Force C:\Users\azamk\Documents\Paperino\tools\jq | Out-Null
Invoke-WebRequest -Uri "https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-windows-amd64.exe" -OutFile C:\Users\azamk\Documents\Paperino\tools\jq\jq.exe
& C:\Users\azamk\Documents\Paperino\tools\jq\jq.exe --version
```

Expected: `jq-1.8.2`.

- [ ] **Step 3: Write the failing server smoke test**

`Paperino/figures-mcp/test/client.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { join } from "node:path"

export async function connect() {
  const transport = new StdioClientTransport({
    command: "bun",
    args: [join(import.meta.dir, "..", "src", "server.ts")],
  })
  const client = new Client({ name: "figures-test", version: "0.0.0" })
  await client.connect(transport)
  return { client, close: () => client.close() }
}
```

`Paperino/figures-mcp/test/server.test.ts`:

```ts
import { expect, test } from "bun:test"
import { connect } from "./client"

test("server starts and lists tools over stdio", async () => {
  const { client, close } = await connect()
  try {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain("ping")
  } finally {
    await close()
  }
}, 30_000)
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd C:\Users\azamk\Documents\Paperino\figures-mcp; bun test test/server.test.ts`
Expected: FAIL (`src/server.ts` does not exist / connection error).

- [ ] **Step 5: Write the server skeleton**

`Paperino/figures-mcp/src/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

export const server = new McpServer({ name: "figures-mcp", version: "0.1.0" })

server.registerTool("ping", { description: "Liveness check" }, async () => ({
  content: [{ type: "text", text: "pong" }],
}))

await server.connect(new StdioServerTransport())
```

- [ ] **Step 6: Run to verify it passes**

Run: `bun test test/server.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add figures-mcp
git commit -m "feat(figures): figures-mcp package skeleton with stdio MCP server

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: The vendored browser library (tokens, annot, scale, table)

**Files:**
- Create: `Paperino/figures-mcp/src/assets/tokens.css`
- Create: `Paperino/figures-mcp/src/assets/lib/annot.js`
- Create: `Paperino/figures-mcp/src/assets/lib/scale.js`
- Create: `Paperino/figures-mcp/src/assets/lib/table.js`

**Interfaces:**
- Produces (used by all templates and by agents editing figures):
  - `annot.js`: `arrow(fromSel, toSel, {bow?, side?, tone?})`, `brace(sel, {side, label?, tone?})`, `highlight(sel, {style?, tone?})`, `figReady()` — figReady flushes the overlay then sets `window.__FIG_READY__ = true`
  - `scale.js`: `scaleLinear(domain, range)` (callable + `.ticks(n)`), `scaleBand(domain, range, padding?)` (callable + `.bandwidth()`), `derived(text)` → `<span data-derived>` for computed labels (axis ticks) that provenance-lint exempts
  - `table.js`: `renderTable(el, data, columns)` where `columns: [{key, label, align?, format?}]`
- No unit tests here (browser code); validated by Task 4's render smoke + Task 5's lint fixtures.

- [ ] **Step 1: tokens.css — the only place colors/type/strokes exist**

`Paperino/figures-mcp/src/assets/tokens.css`:

```css
/* Paperino figure design tokens — Anthropic-look defaults.
   Figures reference ONLY these vars; raw hex/rgb in figure.html is a lint failure. */
:root {
  /* neutrals */
  --bg: #ffffff;
  --surface: #f7f7f8;
  --border: #d9d9de;
  --border-strong: #b3b3bc;
  --text: #1a1a1f;
  --text-muted: #6b6b76;
  /* categorical accents (lint: <= 5 in one figure) */
  --accent: #b45309;          /* amber — primary highlight */
  --accent-soft: #fdf3e3;     /* amber fill */
  --pos: #15803d;             /* green */
  --neg: #b91c1c;             /* red */
  --ref: #1d4ed8;             /* blue */
  /* type */
  --font-ui: "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, monospace;
  --fs-body: 15px;
  --fs-label: 13px;
  --fs-small: 11px;
  /* strokes */
  --stroke: 1.5px;
  --stroke-thin: 1px;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
}
.card {
  background: var(--surface);
  border: var(--stroke-thin) solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}
.card h3 { margin: 0 0 6px; font-size: var(--fs-body); font-weight: 600; }
.card p { margin: 0; color: var(--text-muted); font-size: var(--fs-label); }
.mono { font-family: var(--font-mono); font-size: var(--fs-label); }
.muted { color: var(--text-muted); }
```

- [ ] **Step 2: annot.js — declarative arrows/braces/highlights, zero coordinates**

`Paperino/figures-mcp/src/assets/lib/annot.js`:

```js
// Declarative annotations anchored to element IDs. One absolutely-positioned SVG
// overlay; geometry resolved at render time from getBoundingClientRect().
// The agent supplies IDs and one scalar (bow) — never a coordinate.

const queue = []
let overlay

function ensureOverlay() {
  if (overlay) return overlay
  overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  overlay.setAttribute("id", "annot-overlay")
  overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible"
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs")
  defs.innerHTML =
    '<marker id="arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0,0.5 L7.5,4 L0,7.5" fill="none" stroke="context-stroke" stroke-width="1.2" stroke-linecap="round"/></marker>'
  overlay.appendChild(defs)
  document.body.style.position = "relative"
  document.body.appendChild(overlay)
  return overlay
}

const toneColor = (tone) =>
  ({ accent: "var(--accent)", pos: "var(--pos)", neg: "var(--neg)", ref: "var(--ref)" })[tone ?? "muted"] ??
  "var(--border-strong)"

function anchor(rect, side) {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  if (side === "top") return [cx, rect.top]
  if (side === "bottom") return [cx, rect.bottom]
  if (side === "left") return [rect.left, cy]
  if (side === "right") return [rect.right, cy]
  return [cx, cy]
}

function autoSides(a, b) {
  const dx = b.left + b.width / 2 - (a.left + a.width / 2)
  const dy = b.top + b.height / 2 - (a.top + a.height / 2)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"]
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"]
}

function el(name, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

export function arrow(fromSel, toSel, opts = {}) {
  queue.push(() => {
    const a = document.querySelector(fromSel)?.getBoundingClientRect()
    const b = document.querySelector(toSel)?.getBoundingClientRect()
    if (!a || !b) throw new Error(`arrow: missing element ${!a ? fromSel : toSel}`)
    const [sideA, sideB] = opts.side
      ? [opts.side, opts.side === "left" ? "right" : opts.side === "right" ? "left" : opts.side === "top" ? "bottom" : "top"]
      : autoSides(a, b)
    const [x1, y1] = anchor(a, sideA)
    const [x2, y2] = anchor(b, sideB)
    // bow: signed swoop as a fraction of segment length; control point is the midpoint
    // pushed along the perpendicular. One scalar an LLM can reason about.
    const bow = opts.bow ?? 0.25
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const px = (-(y2 - y1) / len) * bow * len
    const py = ((x2 - x1) / len) * bow * len
    ensureOverlay().appendChild(
      el("path", {
        d: `M ${x1} ${y1} Q ${mx + px} ${my + py} ${x2} ${y2}`,
        fill: "none",
        stroke: toneColor(opts.tone),
        "stroke-width": "var(--stroke)",
        "marker-end": "url(#arrowhead)",
      }),
    )
  })
}

export function brace(sel, opts = {}) {
  queue.push(() => {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    if (!r) throw new Error(`brace: missing element ${sel}`)
    const side = opts.side ?? "left"
    const g = 8 // gap from the element
    const d = 7 // brace depth
    let path
    if (side === "left" || side === "right") {
      const s = side === "left" ? -1 : 1
      const x = side === "left" ? r.left - g : r.right + g
      const midY = r.top + r.height / 2
      path = `M ${x} ${r.top} q ${s * d} 0 ${s * d} ${d} L ${x + s * d} ${midY - d} q 0 ${d} ${s * d} ${d} q ${-s * d} 0 ${-s * d} ${d} L ${x + s * d} ${r.bottom - d} q 0 ${d} ${-s * d} ${d}`
    } else {
      const s = side === "top" ? -1 : 1
      const y = side === "top" ? r.top - g : r.bottom + g
      const midX = r.left + r.width / 2
      path = `M ${r.left} ${y} q 0 ${s * d} ${d} ${s * d} L ${midX - d} ${y + s * d} q ${d} 0 ${d} ${s * d} q 0 ${-s * d} ${d} ${-s * d} L ${r.right - d} ${y + s * d} q ${d} 0 ${d} ${-s * d}`
    }
    const ov = ensureOverlay()
    ov.appendChild(el("path", { d: path, fill: "none", stroke: toneColor(opts.tone), "stroke-width": "var(--stroke)" }))
    if (opts.label) {
      const lx = side === "left" ? r.left - g - d - 8 : side === "right" ? r.right + g + d + 8 : r.left + r.width / 2
      const ly = side === "top" ? r.top - g - d - 8 : side === "bottom" ? r.bottom + g + d + 8 : r.top + r.height / 2
      const text = el("text", {
        x: lx,
        y: ly,
        "text-anchor": side === "left" ? "end" : side === "right" ? "start" : "middle",
        "dominant-baseline": "middle",
        fill: "var(--text)",
        "font-size": "var(--fs-label)",
        "font-family": "var(--font-ui)",
      })
      opts.label.split("\n").forEach((line, i) => {
        const span = el("tspan", { x: lx, dy: i === 0 ? "0" : "1.25em" })
        span.textContent = line
        text.appendChild(span)
      })
      ov.appendChild(text)
    }
  })
}

export function highlight(sel, opts = {}) {
  queue.push(() => {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    if (!r) throw new Error(`highlight: missing element ${sel}`)
    const pad = 5
    ensureOverlay().appendChild(
      el("rect", {
        x: r.left - pad,
        y: r.top - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
        rx: 6,
        fill: opts.tone === "accent" ? "var(--accent-soft)" : "none",
        "fill-opacity": "0.5",
        stroke: toneColor(opts.tone ?? "accent"),
        "stroke-width": "var(--stroke)",
        "stroke-dasharray": (opts.style ?? "dashed") === "dashed" ? "5 4" : "none",
      }),
    )
  })
}

export function figReady() {
  // Two rAFs guarantee layout is final before geometry is read.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      try {
        for (const draw of queue) draw()
        window.__FIG_READY__ = true
      } catch (err) {
        window.__FIG_ERROR__ = String(err)
        throw err
      }
    }),
  )
}
```

- [ ] **Step 3: scale.js — data-bound positioning, self-contained**

`Paperino/figures-mcp/src/assets/lib/scale.js`:

```js
// Minimal d3-scale replacements. A hand-placed bar is a lint failure; these are
// the only way marks get positions.

export function scaleLinear(domain, range) {
  const [d0, d1] = domain
  const [r0, r1] = range
  const scale = (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)
  scale.ticks = (count = 5) => {
    const step = niceStep((d1 - d0) / Math.max(1, count))
    const start = Math.ceil(d0 / step) * step
    const out = []
    for (let v = start; v <= d1 + 1e-9; v += step) out.push(round(v))
    return out
  }
  return scale
}

export function scaleBand(domain, range, padding = 0.15) {
  const [r0, r1] = range
  const n = domain.length || 1
  const step = (r1 - r0) / n
  const bw = step * (1 - padding)
  const scale = (v) => r0 + domain.indexOf(v) * step + (step - bw) / 2
  scale.bandwidth = () => bw
  return scale
}

// Computed labels (axis ticks etc.) are not experiment numbers; stamp them so the
// provenance lint can exempt them.
export function derived(text) {
  const span = document.createElement("span")
  span.setAttribute("data-derived", "")
  span.textContent = String(text)
  return span
}

function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1))
  const norm = raw / mag
  return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
}
const round = (v) => Math.round(v * 1e6) / 1e6
```

- [ ] **Step 4: table.js — cells only ever come from data**

`Paperino/figures-mcp/src/assets/lib/table.js`:

```js
// Renders a table from window.__DATA__ records. Numeric literals typed into
// table cells by hand are a lint failure — this is the only path.

export function renderTable(el, data, columns) {
  const table = document.createElement("table")
  table.className = "fig-table"
  const thead = table.createTHead()
  const hr = thead.insertRow()
  for (const col of columns) {
    const th = document.createElement("th")
    th.textContent = col.label ?? col.key
    if (col.align) th.style.textAlign = col.align
    hr.appendChild(th)
  }
  const tbody = table.createTBody()
  for (const row of data) {
    const tr = tbody.insertRow()
    for (const col of columns) {
      const td = tr.insertCell()
      const raw = row[col.key]
      td.textContent = col.format ? col.format(raw) : String(raw)
      if (col.align) td.style.textAlign = col.align
    }
  }
  el.replaceChildren(table)
}
```

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add figures-mcp/src/assets
git commit -m "feat(figures): vendored browser library (tokens, annot, scale, table)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Archetype templates + figure_scaffold (TDD)

**Files:**
- Create: `Paperino/figures-mcp/src/templates/schematic/figure.html`
- Create: `Paperino/figures-mcp/src/templates/gallery/figure.html`
- Create: `Paperino/figures-mcp/src/templates/chart/figure.html`
- Create: `Paperino/figures-mcp/src/templates/table/figure.html`
- Create: `Paperino/figures-mcp/src/scaffold.ts`
- Test: `Paperino/figures-mcp/test/scaffold.test.ts`

**Interfaces:**
- Consumes: `src/assets/*` from Task 2.
- Produces: `scaffold(workspace: string, opts: {name, archetype, claim, caption, width}): Promise<{figureDir: string}>` — throws `ScaffoldError` naming the conflict if the figure exists. Every template ends by calling `figReady()`. Meta shape (yaml): `{id, archetype: "schematic"|"gallery"|"chart"|"table", width: "narrow"|"full", caption, alt, claim}`.

- [ ] **Step 1: Write the failing tests**

`Paperino/figures-mcp/test/scaffold.test.ts`:

```ts
import { beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { scaffold } from "../src/scaffold"

const WS = join(import.meta.dir, "tmp-ws")

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(WS, { recursive: true })
})

test("scaffold creates figure dir, meta.yaml, data.json and vendors the lib once", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "schematic", claim: "A precedes B", caption: "Demo.", width: "narrow" })
  expect(existsSync(join(WS, "figures", "fig01-demo", "figure.html"))).toBe(true)
  expect(existsSync(join(WS, "figures", "fig01-demo", "data.json"))).toBe(true)
  expect(existsSync(join(WS, "figures", "tokens.css"))).toBe(true)
  expect(existsSync(join(WS, "figures", "lib", "annot.js"))).toBe(true)
  const meta = parse(readFileSync(join(WS, "figures", "fig01-demo", "meta.yaml"), "utf8"))
  expect(meta).toEqual({
    id: "fig01-demo",
    archetype: "schematic",
    width: "narrow",
    caption: "Demo.",
    alt: "",
    claim: "A precedes B",
  })
})

test("scaffold refuses to overwrite an existing figure", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "gallery", claim: "c", caption: "c", width: "full" })
  expect(scaffold(WS, { name: "fig01-demo", archetype: "gallery", claim: "c", caption: "c", width: "full" })).rejects.toThrow(/exists/)
})

test("scaffold appends build ignore to workspace .gitignore", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "table", claim: "c", caption: "c", width: "full" })
  expect(readFileSync(join(WS, ".gitignore"), "utf8")).toContain("figures/*/build/")
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/scaffold.test.ts` — Expected: FAIL (`Cannot find module '../src/scaffold'`).

- [ ] **Step 3: Write the templates**

All four templates share this skeleton — `<link>` to `../tokens.css`, module script importing from `../lib/`, and `figReady()` at the end. Data-driven templates read `window.__DATA__` (injected by render.ts; `data.json` starts as `{}`).

`src/templates/schematic/figure.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    /* Layout only — colors/type/strokes come from tokens.css */
    #fig-root { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
    .col { display: flex; flex-direction: column; gap: 12px; }
  </style>
</head>
<body>
  <div id="fig-root">
    <div class="col">
      <div class="card" id="box-a"><h3>Stage A</h3><p>Replace me</p></div>
      <div class="card" id="box-b"><h3>Stage B</h3><p>Replace me</p></div>
    </div>
  </div>
  <script type="module">
    import { arrow, brace, highlight, figReady } from "../lib/annot.js"
    // Structure in HTML above; annotations here. Never type coordinates.
    arrow("#box-a", "#box-b", { bow: 0.3 })
    figReady()
  </script>
</body>
</html>
```

`src/templates/gallery/figure.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 16px; }
  </style>
</head>
<body>
  <div id="fig-root"></div>
  <script type="module">
    import { figReady } from "../lib/annot.js"
    // Records come from data.json (injected as window.__DATA__). Copying records
    // into HTML by hand is a lint failure.
    const root = document.querySelector("#fig-root")
    for (const [i, item] of (window.__DATA__.items ?? []).entries()) {
      const card = document.createElement("div")
      card.className = "card"
      card.id = `item-${i}`
      card.innerHTML = `<h3></h3><p class="mono"></p>`
      card.querySelector("h3").textContent = item.title ?? ""
      card.querySelector("p").textContent = item.body ?? ""
      root.appendChild(card)
    }
    figReady()
  </script>
</body>
</html>
```

`src/templates/chart/figure.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { padding: 16px; }
    .plot { position: relative; height: 240px; border-left: var(--stroke-thin) solid var(--border-strong); border-bottom: var(--stroke-thin) solid var(--border-strong); }
    .bar { position: absolute; bottom: 0; background: var(--accent); }
    .tick { position: absolute; font-size: var(--fs-small); color: var(--text-muted); }
  </style>
</head>
<body>
  <div id="fig-root"><div class="plot" id="plot"></div></div>
  <script type="module">
    import { scaleLinear, scaleBand, derived } from "../lib/scale.js"
    import { figReady } from "../lib/annot.js"
    // Marks are positioned ONLY through scales. A hand-placed bar is a lint failure.
    const data = window.__DATA__.series ?? []
    const plot = document.querySelector("#plot")
    const W = plot.clientWidth || 500
    const H = 240
    const x = scaleBand(data.map((d) => d.label), [0, W])
    const y = scaleLinear([0, Math.max(...data.map((d) => d.value), 1)], [0, H])
    for (const [i, d] of data.entries()) {
      const bar = document.createElement("div")
      bar.className = "bar"
      bar.id = `bar-${i}`
      bar.style.left = `${x(d.label)}px`
      bar.style.width = `${x.bandwidth()}px`
      bar.style.height = `${y(d.value)}px`
      plot.appendChild(bar)
      const lab = derived(d.label)
      lab.className = "tick"
      lab.style.left = `${x(d.label)}px`
      lab.style.bottom = "-20px"
      plot.appendChild(lab)
    }
    figReady()
  </script>
</body>
</html>
```

`src/templates/table/figure.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { padding: 16px; }
    .fig-table { border-collapse: collapse; width: 100%; font-size: var(--fs-label); }
    .fig-table th { text-align: left; border-bottom: var(--stroke-thin) solid var(--border-strong); padding: 6px 10px; }
    .fig-table td { border-bottom: var(--stroke-thin) solid var(--border); padding: 6px 10px; }
  </style>
</head>
<body>
  <div id="fig-root"></div>
  <script type="module">
    import { renderTable } from "../lib/table.js"
    import { figReady } from "../lib/annot.js"
    // Cells come from data.json via renderTable. Typing a number here is a lint failure.
    renderTable(document.querySelector("#fig-root"), window.__DATA__.rows ?? [], window.__DATA__.columns ?? [])
    figReady()
  </script>
</body>
</html>
```

- [ ] **Step 4: Write scaffold.ts**

`Paperino/figures-mcp/src/scaffold.ts`:

```ts
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stringify } from "yaml"

const ASSETS = join(import.meta.dir, "assets")
const TEMPLATES = join(import.meta.dir, "templates")

export type Archetype = "schematic" | "gallery" | "chart" | "table"
export type ScaffoldOpts = { name: string; archetype: Archetype; claim: string; caption: string; width: "narrow" | "full" }

export class ScaffoldError extends Error {}

export async function scaffold(workspace: string, opts: ScaffoldOpts): Promise<{ figureDir: string }> {
  const figuresDir = join(workspace, "figures")
  const figureDir = join(figuresDir, opts.name)
  if (existsSync(figureDir)) throw new ScaffoldError(`figure "${opts.name}" already exists at ${figureDir}`)

  // Vendor the design system once per workspace — papers stay self-contained.
  mkdirSync(figuresDir, { recursive: true })
  if (!existsSync(join(figuresDir, "tokens.css"))) cpSync(join(ASSETS, "tokens.css"), join(figuresDir, "tokens.css"))
  if (!existsSync(join(figuresDir, "lib"))) cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })

  mkdirSync(figureDir)
  cpSync(join(TEMPLATES, opts.archetype, "figure.html"), join(figureDir, "figure.html"))
  writeFileSync(join(figureDir, "data.json"), "{}\n")
  writeFileSync(
    join(figureDir, "meta.yaml"),
    stringify({ id: opts.name, archetype: opts.archetype, width: opts.width, caption: opts.caption, alt: "", claim: opts.claim }),
  )

  const gitignore = join(workspace, ".gitignore")
  const line = "figures/*/build/"
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : ""
  if (!current.includes(line)) appendFileSync(gitignore, `${current.endsWith("\n") || current === "" ? "" : "\n"}${line}\n`)

  return { figureDir }
}
```

- [ ] **Step 5: Run tests** — `bun test test/scaffold.test.ts` — Expected: 3 pass.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add figures-mcp/src/templates figures-mcp/src/scaffold.ts figures-mcp/test/scaffold.test.ts
git commit -m "feat(figures): archetype templates + figure_scaffold with vendoring

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: render.ts — Playwright render + bbox manifest + PNG/PDF

**Files:**
- Create: `Paperino/figures-mcp/src/render.ts`
- Test: `Paperino/figures-mcp/test/render.test.ts`

**Interfaces:**
- Consumes: `scaffold()` (tests scaffold a temp workspace first); `meta.yaml` shape from Task 3.
- Produces:
  - `render(workspace: string, name: string): Promise<RenderResult>`
  - `type TextBox = { selector: string; text: string; rect: {x,y,w,h}; fontSize: number; color: string; background: string; derived: boolean }`
  - `type RenderResult = { ok: true; png: string; pdf: string; svg: string | null; bboxes: string; consoleOutput: string[] } | { ok: false; error: string; consoleOutput: string[]; png: string | null }`
  - `bboxes.json` shape: `{ viewport: {width, height}, texts: TextBox[], strokes: [{selector, width}] }`
  - Viewports: `narrow` → 550, `full` → 1100. Wait: `document.fonts.ready` AND `window.__FIG_READY__ === true` (15s timeout). On JS error or timeout → `ok:false` with console output + best-effort PNG (spec §7).

- [ ] **Step 1: Write the failing smoke test**

`Paperino/figures-mcp/test/render.test.ts`:

```ts
import { beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"

const WS = join(import.meta.dir, "tmp-render-ws")

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(WS, { recursive: true })
})

test(
  "each archetype template renders out of the box",
  async () => {
    for (const archetype of ["schematic", "gallery", "chart", "table"] as const) {
      const name = `fig-${archetype}`
      await scaffold(WS, { name, archetype, claim: "c", caption: "c", width: "narrow" })
      if (archetype === "gallery")
        writeFileSync(join(WS, "figures", name, "data.json"), JSON.stringify({ items: [{ title: "T", body: "b" }] }))
      if (archetype === "chart")
        writeFileSync(join(WS, "figures", name, "data.json"), JSON.stringify({ series: [{ label: "a", value: 3 }, { label: "b", value: 5 }] }))
      if (archetype === "table")
        writeFileSync(
          join(WS, "figures", name, "data.json"),
          JSON.stringify({ rows: [{ k: "speedup", v: 14617 }], columns: [{ key: "k", label: "Metric" }, { key: "v", label: "Value" }] }),
        )
      const result = await render(WS, name)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const manifest = JSON.parse(readFileSync(result.bboxes, "utf8"))
      expect(manifest.texts.length).toBeGreaterThan(0)
      expect(readFileSync(result.pdf).subarray(0, 5).toString()).toBe("%PDF-")
      expect(existsSync(result.png)).toBe(true)
    }
  },
  120_000,
)

test(
  "a JS error in figure.html returns ok:false with console output",
  async () => {
    await scaffold(WS, { name: "fig-broken", archetype: "schematic", claim: "c", caption: "c", width: "narrow" })
    const html = readFileSync(join(WS, "figures", "fig-broken", "figure.html"), "utf8")
    writeFileSync(join(WS, "figures", "fig-broken", "figure.html"), html.replace("#box-b", "#does-not-exist"))
    const result = await render(WS, "fig-broken")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.consoleOutput.join("\n")).toContain("does-not-exist")
  },
  60_000,
)
```

- [ ] **Step 2: Run to verify failure** — `bun test test/render.test.ts` — Expected: FAIL (`Cannot find module '../src/render'`).

- [ ] **Step 3: Write render.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "playwright"
import { parse } from "yaml"

const VIEWPORTS = { narrow: 550, full: 1100 } as const

export type TextBox = {
  selector: string
  text: string
  rect: { x: number; y: number; w: number; h: number }
  fontSize: number
  color: string
  background: string
  derived: boolean
}
export type RenderResult =
  | { ok: true; png: string; pdf: string; svg: string | null; bboxes: string; consoleOutput: string[] }
  | { ok: false; error: string; consoleOutput: string[]; png: string | null }

export async function render(workspace: string, name: string): Promise<RenderResult> {
  const figureDir = join(workspace, "figures", name)
  const htmlPath = join(figureDir, "figure.html")
  if (!existsSync(htmlPath)) return { ok: false, error: `no figure.html at ${htmlPath}`, consoleOutput: [], png: null }
  const meta = parse(readFileSync(join(figureDir, "meta.yaml"), "utf8"))
  const width = VIEWPORTS[(meta.width as "narrow" | "full") ?? "full"] ?? VIEWPORTS.full
  const data = existsSync(join(figureDir, "data.json")) ? readFileSync(join(figureDir, "data.json"), "utf8") : "{}"
  const buildDir = join(figureDir, "build")
  mkdirSync(buildDir, { recursive: true })

  const consoleOutput: string[] = []
  const browser = await chromium.launch({ headless: true, args: ["--font-render-hinting=none"] })
  try {
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    page.on("console", (msg) => consoleOutput.push(`[${msg.type()}] ${msg.text()}`))
    page.on("pageerror", (err) => consoleOutput.push(`[pageerror] ${err.message}`))
    await page.addInitScript(`window.__DATA__ = ${data}`)
    await page.goto(pathToFileURL(htmlPath).href)
    try {
      await page.evaluate(() => (document as any).fonts.ready)
      await page.waitForFunction("window.__FIG_READY__ === true", undefined, { timeout: 15_000 })
    } catch {
      const png = join(buildDir, `${name}.png`)
      await page.screenshot({ path: png, fullPage: true }).catch(() => {})
      const figError = await page.evaluate("window.__FIG_ERROR__ ?? null").catch(() => null)
      return {
        ok: false,
        error: figError ? `figure error: ${figError}` : "__FIG_READY__ never became true (JS error or missing figReady())",
        consoleOutput,
        png: existsSync(png) ? png : null,
      }
    }

    // bbox manifest: every visible text node + every SVG stroke width
    const manifest = await page.evaluate(() => {
      const cssPath = (node: Element): string => {
        if (node.id) return `#${node.id}`
        const parent = node.parentElement
        if (!parent) return node.tagName.toLowerCase()
        const idx = Array.from(parent.children).indexOf(node) + 1
        return `${cssPath(parent)} > ${node.tagName.toLowerCase()}:nth-child(${idx})`
      }
      const effectiveBackground = (node: Element): string => {
        let cur: Element | null = node
        while (cur) {
          const bg = getComputedStyle(cur).backgroundColor
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg
          cur = cur.parentElement
        }
        return "rgb(255, 255, 255)"
      }
      const texts: unknown[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const tn = walker.currentNode as Text
        if (!tn.textContent || !tn.textContent.trim()) continue
        const el = tn.parentElement
        if (!el) continue
        const range = document.createRange()
        range.selectNodeContents(tn)
        const r = range.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const cs = getComputedStyle(el)
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
      const strokes = Array.from(document.querySelectorAll("svg *")).flatMap((el) => {
        const cs = getComputedStyle(el)
        const w = parseFloat(cs.strokeWidth)
        if (!Number.isFinite(w) || cs.stroke === "none") return []
        return [{ selector: cssPath(el), width: w }]
      })
      const height = Math.ceil(document.documentElement.scrollHeight)
      return { viewport: { width: window.innerWidth, height }, texts, strokes }
    })

    const contentHeight = Math.max(manifest.viewport.height, 100)
    await page.setViewportSize({ width, height: contentHeight })

    const png = join(buildDir, `${name}.png`)
    await page.screenshot({ path: png, fullPage: true })
    const pdf = join(buildDir, `${name}.pdf`)
    await page.pdf({ path: pdf, width: `${width}px`, height: `${contentHeight}px`, printBackground: true, pageRanges: "1" })

    // best-effort SVG (schematic only): fetch the overlay markup in the page, write it in Node
    let svgPath: string | null = null
    if (meta.archetype === "schematic") {
      const svgMarkup = await page.evaluate(() => document.querySelector("svg#annot-overlay")?.outerHTML ?? null)
      if (svgMarkup) {
        svgPath = join(buildDir, `${name}.svg`)
        writeFileSync(svgPath, svgMarkup)
      }
    }

    const bboxes = join(buildDir, "bboxes.json")
    writeFileSync(bboxes, JSON.stringify(manifest, null, 1))
    return { ok: true, png, pdf, svg: svgPath, bboxes, consoleOutput }
  } finally {
    await browser.close()
  }
}
```

- [ ] **Step 4: Run tests** — `bun test test/render.test.ts` — Expected: 2 pass. If `chromium.launch()` fails under bun, re-verify `bunx playwright install chromium`; if it still fails, escalate to the user before proceeding — do not silently switch runtimes.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add figures-mcp/src/render.ts figures-mcp/test/render.test.ts
git commit -m "feat(figures): playwright render with bbox manifest and PNG/PDF output

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: lint.ts — the 10 rules (TDD, one fixture per rule)

**Files:**
- Create: `Paperino/figures-mcp/src/lint.ts`
- Test: `Paperino/figures-mcp/test/lint.test.ts`

**Interfaces:**
- Consumes: manifest shape from Task 4 (`bboxes.json`: `{viewport, texts: TextBox[], strokes}`).
- Produces:
  - `lint(input: LintInput): LintError[]`
  - `type LintInput = { source: string; meta: {archetype, caption, alt, claim}; data: unknown; manifest: {viewport, texts, strokes} }`
  - `type LintError = { rule: string; selector: string; actual: string; expected: string }`
  - Rule ids exactly: `text-overlap`, `overflow`, `min-type-size`, `contrast`, `no-raw-color`, `stroke-floor`, `palette`, `provenance`, `root-svg`, `meta-complete`.

- [ ] **Step 1: Write the failing tests** (pure-function tests; no browser)

`Paperino/figures-mcp/test/lint.test.ts`:

```ts
import { expect, test } from "bun:test"
import { lint, type LintInput } from "../src/lint"

const box = (over: Partial<any> = {}) => ({
  selector: "#t",
  text: "hello",
  rect: { x: 10, y: 10, w: 50, h: 14 },
  fontSize: 13,
  color: "rgb(26, 26, 31)",
  background: "rgb(255, 255, 255)",
  derived: false,
  ...over,
})

const base = (over: Partial<LintInput> = {}): LintInput => ({
  source: `<link rel="stylesheet" href="../tokens.css">`,
  meta: { archetype: "schematic", caption: "c", alt: "a", claim: "x" },
  data: {},
  manifest: { viewport: { width: 550, height: 300 }, texts: [box()], strokes: [] },
  ...over,
})

const rules = (input: LintInput) => lint(input).map((e) => e.rule)

test("clean input passes all rules", () => expect(lint(base())).toEqual([]))

test("text-overlap", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box(), box({ selector: "#u", rect: { x: 12, y: 12, w: 50, h: 14 } })], strokes: [] }
  expect(rules(base({ manifest: m }))).toContain("text-overlap")
})

test("overflow", () => {
  expect(
    rules(base({ manifest: { viewport: { width: 550, height: 300 }, texts: [box({ rect: { x: 540, y: 10, w: 50, h: 14 } })], strokes: [] } })),
  ).toContain("overflow")
})

test("min-type-size", () => {
  expect(rules(base({ manifest: { viewport: { width: 550, height: 300 }, texts: [box({ fontSize: 8 })], strokes: [] } }))).toContain("min-type-size")
})

test("contrast", () => {
  expect(rules(base({ manifest: { viewport: { width: 550, height: 300 }, texts: [box({ color: "rgb(200, 200, 200)" })], strokes: [] } }))).toContain("contrast")
})

test("no-raw-color", () => {
  expect(rules(base({ source: `<div style="color: #f59e0b">x</div>` }))).toContain("no-raw-color")
  expect(rules(base({ source: `<div style="color: rgb(1,2,3)">x</div>` }))).toContain("no-raw-color")
  expect(rules(base({ source: `<div style="color: var(--accent)">x</div>` }))).toEqual([])
})

test("stroke-floor", () => {
  expect(rules(base({ manifest: { viewport: { width: 550, height: 300 }, texts: [box()], strokes: [{ selector: "#p", width: 0.5 }] } }))).toContain("stroke-floor")
})

test("palette allows <=5 categorical colors", () => {
  const texts = ["rgb(180, 83, 9)", "rgb(21, 128, 61)", "rgb(185, 28, 28)", "rgb(29, 78, 216)", "rgb(120, 29, 216)", "rgb(216, 29, 150)"].map(
    (color, i) => box({ selector: `#c${i}`, color, rect: { x: 10, y: 10 + i * 30, w: 50, h: 14 } }),
  )
  expect(rules(base({ manifest: { viewport: { width: 550, height: 300 }, texts, strokes: [] } }))).toContain("palette")
})

test("provenance: table numbers must trace to data.json", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ text: "14617" })], strokes: [] }
  const good = base({ meta: { archetype: "table", caption: "c", alt: "a", claim: "x" }, data: { rows: [{ v: 14617 }] }, manifest: m })
  expect(rules(good)).toEqual([])
  const bad = base({ meta: { archetype: "table", caption: "c", alt: "a", claim: "x" }, data: { rows: [{ v: 999 }] }, manifest: m })
  expect(rules(bad)).toContain("provenance")
})

test("provenance exempts data-derived nodes", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ text: "20", derived: true })], strokes: [] }
  expect(rules(base({ meta: { archetype: "chart", caption: "c", alt: "a", claim: "x" }, data: {}, manifest: m }))).toEqual([])
})

test("root-svg", () => {
  expect(rules(base({ source: `<svg width="550" height="300"><rect/></svg>` }))).toContain("root-svg")
  expect(rules(base({ source: `<svg viewBox="0 0 550 300"><rect/></svg>` }))).toEqual([])
})

test("meta-complete", () => {
  expect(rules(base({ meta: { archetype: "schematic", caption: "", alt: "a", claim: "x" } }))).toContain("meta-complete")
})
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL (module missing).

- [ ] **Step 3: Write lint.ts**

```ts
export type TextBox = {
  selector: string
  text: string
  rect: { x: number; y: number; w: number; h: number }
  fontSize: number
  color: string
  background: string
  derived: boolean
}
export type LintInput = {
  source: string
  meta: { archetype: string; caption: string; alt: string; claim: string }
  data: unknown
  manifest: { viewport: { width: number; height: number }; texts: TextBox[]; strokes: { selector: string; width: number }[] }
}
export type LintError = { rule: string; selector: string; actual: string; expected: string }

const rgb = (s: string): [number, number, number] | null => {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrastRatio = (a: string, b: string) => {
  const ca = rgb(a)
  const cb = rgb(b)
  if (!ca || !cb) return 21
  const [l1, l2] = [luminance(ca), luminance(cb)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
const isGray = (c: [number, number, number]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= 12

const flattenNumbers = (v: unknown, out: number[] = []): number[] => {
  if (typeof v === "number" && Number.isFinite(v)) out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => flattenNumbers(x, out))
  else if (v && typeof v === "object") Object.values(v).forEach((x) => flattenNumbers(x, out))
  return out
}
const traces = (rendered: number, values: number[]) =>
  values.some((v) => {
    if (Math.abs(v - rendered) <= Math.abs(v) * 1e-9 + 1e-9) return true
    for (let k = 0; k <= 4; k++) if (Number(v.toFixed(k)) === rendered) return true
    return false
  })

export function lint(input: LintInput): LintError[] {
  const errors: LintError[] = []
  const { texts, strokes, viewport } = input.manifest
  const err = (rule: string, selector: string, actual: string, expected: string) => errors.push({ rule, selector, actual, expected })

  // 1 text-overlap (shrink 1px each side to forgive adjacent glyph boxes)
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].rect
      const b = texts[j].rect
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - 2
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - 2
      if (ox > 0 && oy > 0)
        err("text-overlap", `${texts[i].selector} ~ ${texts[j].selector}`, `overlap ${ox.toFixed(0)}x${oy.toFixed(0)}px`, "no intersection")
    }

  // 2 overflow
  for (const t of texts) {
    const r = t.rect
    if (r.x < -1 || r.y < -1 || r.x + r.w > viewport.width + 1 || r.y + r.h > viewport.height + 1)
      err("overflow", t.selector, `bbox (${r.x.toFixed(0)},${r.y.toFixed(0)},${r.w.toFixed(0)},${r.h.toFixed(0)})`, `inside 0,0,${viewport.width},${viewport.height}`)
  }

  // 3 min-type-size
  for (const t of texts) if (t.fontSize < 9) err("min-type-size", t.selector, `${t.fontSize}px`, ">= 9px")

  // 4 contrast
  for (const t of texts) {
    const ratio = contrastRatio(t.color, t.background)
    if (ratio < 4.5) err("contrast", t.selector, ratio.toFixed(2), ">= 4.5")
  }

  // 5 no-raw-color (source check; ids like #token contain non-hex letters and don't match)
  const raw = input.source.match(/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|\brgba?\(/)
  if (raw) err("no-raw-color", "figure.html", raw[0], "var(--…) from tokens.css")

  // 6 stroke-floor (0 = intentionally invisible, skip)
  for (const s of strokes) if (s.width > 0 && s.width < 0.75) err("stroke-floor", s.selector, `${s.width}px`, ">= 0.75px")

  // 7 palette: distinct non-gray text colors <= 5
  const cats = new Set<string>()
  for (const t of texts) {
    const c = rgb(t.color)
    if (c && !isGray(c)) cats.add(c.join(","))
  }
  if (cats.size > 5) err("palette", "figure", `${cats.size} categorical colors`, "<= 5 (from tokens.css)")

  // 8 provenance (chart/table): every non-derived rendered number traces to data.json
  if (input.meta.archetype === "chart" || input.meta.archetype === "table") {
    const values = flattenNumbers(input.data)
    for (const t of texts) {
      if (t.derived) continue
      for (const m of t.text.matchAll(/-?\d+(?:\.\d+)?/g)) {
        const n = Number(m[0])
        if (!traces(n, values)) err("provenance", t.selector, m[0], "a value reachable in data.json")
      }
    }
  }

  // 9 root-svg
  for (const m of input.source.matchAll(/<svg\b[^>]*>/g)) {
    const tag = m[0]
    if (!/viewBox=/.test(tag)) err("root-svg", "svg", "no viewBox", "viewBox required")
    if (/\bwidth="\d+"/.test(tag) || /\bheight="\d+"/.test(tag)) err("root-svg", "svg", "fixed px width/height", "no fixed px dimensions")
  }

  // 10 meta-complete
  for (const key of ["caption", "alt", "claim"] as const)
    if (!input.meta[key] || !String(input.meta[key]).trim()) err("meta-complete", "meta.yaml", `${key} empty`, `${key} present`)

  return errors
}
```

- [ ] **Step 4: Run tests** — `bun test test/lint.test.ts` — Expected: all pass. Note the `root-svg` fixture with `viewBox` must not also trip `no-raw-color`; it doesn't (no hex/rgb in it).

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add figures-mcp/src/lint.ts figures-mcp/test/lint.test.ts
git commit -m "feat(figures): 10-rule deterministic figure lint with per-rule tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: data_query — jq over workspace JSON (TDD)

**Files:**
- Create: `Paperino/figures-mcp/src/data-query.ts`
- Test: `Paperino/figures-mcp/test/data-query.test.ts`

**Interfaces:**
- Produces: `dataQuery(workspace: string, path: string, jqExpr: string): Promise<string>` — `path` is workspace-relative, must resolve inside the workspace (reject `..` escapes); spawns `C:\Users\azamk\Documents\Paperino\tools\jq\jq.exe` (override via `PAPERINO_JQ` env); throws `Error` naming the file on missing file / jq failure.

- [ ] **Step 1: Failing tests**

`Paperino/figures-mcp/test/data-query.test.ts`:

```ts
import { beforeEach, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { dataQuery } from "../src/data-query"

const WS = join(import.meta.dir, "tmp-dq-ws")

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(join(WS, "artifacts"), { recursive: true })
  writeFileSync(join(WS, "artifacts", "results.json"), JSON.stringify({ runs: [{ id: "a", speedup: 14617 }, { id: "b", speedup: 639 }] }))
})

test("evaluates a jq expression against a workspace file", async () => {
  const out = await dataQuery(WS, "artifacts/results.json", "[.runs[].speedup]")
  expect(JSON.parse(out)).toEqual([14617, 639])
})

test("rejects paths escaping the workspace", async () => {
  expect(dataQuery(WS, "../outside.json", ".")).rejects.toThrow(/inside the workspace/)
})

test("names the file on jq errors", async () => {
  expect(dataQuery(WS, "artifacts/results.json", ".runs[")).rejects.toThrow(/results\.json/)
})
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`Paperino/figures-mcp/src/data-query.ts`:

```ts
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

const JQ = process.env.PAPERINO_JQ || "C:\\Users\\azamk\\Documents\\Paperino\\tools\\jq\\jq.exe"

export function dataQuery(workspace: string, path: string, jqExpr: string): Promise<string> {
  const abs = isAbsolute(path) ? path : resolve(join(workspace, path))
  if (!abs.startsWith(resolve(workspace))) return Promise.reject(new Error(`path must stay inside the workspace: ${path}`))
  if (!existsSync(abs)) return Promise.reject(new Error(`no such file: ${abs}`))
  return new Promise((resolvePromise, reject) => {
    execFile(JQ, [jqExpr, abs], { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`jq failed on ${abs}: ${stderr || error.message}`))
      else resolvePromise(stdout.trim())
    })
  })
}
```

- [ ] **Step 4: Run tests** — Expected: 3 pass.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add figures-mcp/src/data-query.ts figures-mcp/test/data-query.test.ts
git commit -m "feat(figures): data_query via pinned jq binary with workspace jail

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Wire the five MCP tools + figure_review

**Files:**
- Create: `Paperino/figures-mcp/src/assets/exemplars/exemplar-schematic.png` (copy of `C:\Users\azamk\Pictures\Screenshots\Screenshot 2026-07-09 195559.png`)
- Create: `Paperino/figures-mcp/src/assets/exemplars/exemplar-gallery.png` (copy of `C:\Users\azamk\Pictures\Screenshots\Screenshot 2026-07-09 195705.png`)
- Modify: `Paperino/figures-mcp/src/server.ts` (replace skeleton entirely with the version below)
- Test: `Paperino/figures-mcp/test/server.test.ts` (extend)

**Interfaces:**
- Consumes: `scaffold`, `render`, `lint`, `dataQuery` exactly as typed in Tasks 3–6.
- Produces: MCP tools `figure_scaffold`, `figure_render`, `figure_lint`, `figure_review`, `data_query` (drop `ping`). `figure_lint` persists its result to `figures/<name>/build/lint.json` so `figure_review` can gate on it.

- [ ] **Step 1: Copy the exemplars**

```powershell
New-Item -ItemType Directory -Force C:\Users\azamk\Documents\Paperino\figures-mcp\src\assets\exemplars | Out-Null
Copy-Item "C:\Users\azamk\Pictures\Screenshots\Screenshot 2026-07-09 195559.png" C:\Users\azamk\Documents\Paperino\figures-mcp\src\assets\exemplars\exemplar-schematic.png
Copy-Item "C:\Users\azamk\Pictures\Screenshots\Screenshot 2026-07-09 195705.png" C:\Users\azamk\Documents\Paperino\figures-mcp\src\assets\exemplars\exemplar-gallery.png
```

- [ ] **Step 2: Extend the failing test**

Append to `test/server.test.ts`:

```ts
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const WS = join(import.meta.dir, "tmp-server-ws")

test(
  "full loop over MCP: scaffold -> render -> lint -> review",
  async () => {
    rmSync(WS, { recursive: true, force: true })
    mkdirSync(WS, { recursive: true })
    const { client, close } = await connect()
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort()
      expect(names).toEqual(["data_query", "figure_lint", "figure_render", "figure_review", "figure_scaffold"])

      await client.callTool({
        name: "figure_scaffold",
        arguments: { workspace: WS, name: "fig-x", archetype: "schematic", claim: "A precedes B", caption: "cap", width: "narrow" },
      })
      const rendered = await client.callTool({ name: "figure_render", arguments: { workspace: WS, name: "fig-x" } })
      expect(JSON.stringify(rendered.content)).toContain("png")

      const linted = await client.callTool({ name: "figure_lint", arguments: { workspace: WS, name: "fig-x" } })
      const lintText = (linted.content as any[]).find((c) => c.type === "text").text
      expect(JSON.parse(lintText).passed).toBe(true)

      const review = await client.callTool({ name: "figure_review", arguments: { workspace: WS, name: "fig-x" } })
      const types = (review.content as any[]).map((c) => c.type)
      expect(types.filter((t) => t === "image").length).toBe(3) // render + 2 exemplars
      expect(JSON.stringify(review.content)).toContain("A precedes B")
    } finally {
      await close()
    }
  },
  180_000,
)

test("figure_review refuses when lint has not passed", async () => {
  const { client, close } = await connect()
  try {
    const res = await client.callTool({ name: "figure_review", arguments: { workspace: WS, name: "never-linted" } })
    expect(JSON.stringify(res.content)).toMatch(/lint|render/i)
  } finally {
    await close()
  }
}, 30_000)
```

Also update the first test's assertion from `toContain("ping")` to `toContain("figure_scaffold")` (the `ping` tool is removed in this task).

- [ ] **Step 3: Run to verify failure** — the loop test fails (`figure_scaffold` unknown tool).

- [ ] **Step 4: Replace server.ts**

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { parse } from "yaml"
import { scaffold } from "./scaffold"
import { render } from "./render"
import { lint } from "./lint"
import { dataQuery } from "./data-query"

const server = new McpServer({ name: "figures-mcp", version: "0.1.0" })
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] })
const image = (path: string) => ({ type: "image" as const, data: readFileSync(path).toString("base64"), mimeType: "image/png" })
const EXEMPLARS = join(import.meta.dir, "assets", "exemplars")

const ws = z.string().describe("Absolute path to the paper workspace (the project root)")
const figName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case")

server.registerTool(
  "figure_scaffold",
  {
    description:
      "Create a new figure from an archetype template (schematic|gallery|chart|table). Write the claim — the one sentence the figure must demonstrate — BEFORE designing. Vendors tokens.css + lib/ into the workspace on first use.",
    inputSchema: {
      workspace: ws,
      name: figName,
      archetype: z.enum(["schematic", "gallery", "chart", "table"]),
      claim: z.string().min(1),
      caption: z.string().min(1),
      width: z.enum(["narrow", "full"]).describe("narrow=550px (single column), full=1100px"),
    },
  },
  async (a) => {
    const { figureDir } = await scaffold(a.workspace, a)
    return text(
      `scaffolded ${figureDir}. Edit figure.html (layout=HTML/flex/grid, annotations=lib/annot.js, colors=var(--…) only), put numbers in data.json, then figure_render.`,
    )
  },
)

server.registerTool(
  "figure_render",
  {
    description:
      "Render figures/<name>/figure.html headless at its fixed viewport. Produces build/<name>.png + .pdf + bboxes.json. Data from data.json is injected as window.__DATA__.",
    inputSchema: { workspace: ws, name: figName },
  },
  async (a) => {
    const result = await render(a.workspace, a.name)
    if (!result.ok) return text(`RENDER FAILED: ${result.error}\nconsole:\n${result.consoleOutput.join("\n") || "(empty)"}`)
    return text(`rendered: ${result.png}\npdf: ${result.pdf}\nNow run figure_lint.`)
  },
)

server.registerTool(
  "figure_lint",
  {
    description:
      "Deterministic quality gate (10 rules: overlap, overflow, type size, contrast, raw colors, stroke floor, palette, number provenance, svg viewBox, meta). Must pass before figure_review. Patch by selector.",
    inputSchema: { workspace: ws, name: figName },
  },
  async (a) => {
    const dir = join(a.workspace, "figures", a.name)
    const bboxPath = join(dir, "build", "bboxes.json")
    if (!existsSync(bboxPath)) return text(`no render found — run figure_render first`)
    const errors = lint({
      source: readFileSync(join(dir, "figure.html"), "utf8"),
      meta: parse(readFileSync(join(dir, "meta.yaml"), "utf8")),
      data: JSON.parse(readFileSync(join(dir, "data.json"), "utf8")),
      manifest: JSON.parse(readFileSync(bboxPath, "utf8")),
    })
    const result = { passed: errors.length === 0, errors }
    writeFileSync(join(dir, "build", "lint.json"), JSON.stringify(result, null, 1))
    return text(JSON.stringify(result, null, 1))
  },
)

server.registerTool(
  "figure_review",
  {
    description:
      "Vision review. Returns the rendered PNG + the figure's claim + rubric + 2 exemplar figures. YOU review the image against the rubric and patch figure.html by selector. Hard cap: 4 review iterations per figure, then stop and show the user.",
    inputSchema: { workspace: ws, name: figName },
  },
  async (a) => {
    const dir = join(a.workspace, "figures", a.name)
    const lintPath = join(dir, "build", "lint.json")
    if (!existsSync(lintPath)) return text("refused: run figure_render then figure_lint first")
    const lintResult = JSON.parse(readFileSync(lintPath, "utf8"))
    if (!lintResult.passed) return text(`refused: lint has ${lintResult.errors.length} failure(s) — fix those first`)
    const meta = parse(readFileSync(join(dir, "meta.yaml"), "utf8"))
    const rubric = [
      `CLAIM this figure must demonstrate: "${meta.claim}"`,
      `Caption: "${meta.caption}"`,
      "",
      "Review the FIRST image (the render). The other two images are exemplars of the target quality bar.",
      'Answer as JSON: {"demonstrates_claim": bool, "issues": [{"severity", "selector", "problem", "fix"}], "readable_at_50pct": bool}',
      "- Is the element the caption is about the most salient thing?",
      "- Is anything encoded twice (color + position for the same variable)?",
      "- Would it survive at 50% scale? In grayscale?",
      "If issues remain, patch figure.html by selector and rerun figure_render + figure_lint. Max 4 iterations, then stop and surface to the user.",
    ].join("\n")
    return {
      content: [
        image(join(dir, "build", `${a.name}.png`)),
        image(join(EXEMPLARS, "exemplar-schematic.png")),
        image(join(EXEMPLARS, "exemplar-gallery.png")),
        { type: "text" as const, text: rubric },
      ],
    }
  },
)

server.registerTool(
  "data_query",
  {
    description:
      "Read-only jq over JSON files in the workspace (artifacts/, figures/*/data.json). This is how numbers travel into figures — never retype them.",
    inputSchema: { workspace: ws, path: z.string(), jq_expr: z.string() },
  },
  async (a) => text(await dataQuery(a.workspace, a.path, a.jq_expr)),
)

await server.connect(new StdioServerTransport())
```

- [ ] **Step 5: Run all tests** — `bun test` — Expected: all green (scaffold 3, render 2, lint 12, data-query 3, server 3).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add figures-mcp
git commit -m "feat(figures): wire the five MCP tools with lint-gated vision review

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Register in Paperino + teach the agent

**Files:**
- Modify: `Paperino/opencode-dev/paperino-config/opencode.jsonc` (add the `figures` MCP entry inside the existing `mcp` object)
- Modify: `Paperino/opencode-dev/paperino-config/AGENTS.md` (append the Figures section)

**Interfaces:**
- Consumes: the running server from Task 7. MCP local config shape (verified in this repo): `{"type": "local", "command": [...], "enabled": true}`.

- [ ] **Step 1: Register the server**

In `paperino-config/opencode.jsonc`, add to the existing `"mcp"` object (before the disabled InteJer entries):

```jsonc
    "figures": {
      "type": "local",
      "command": ["bun", "C:/Users/azamk/Documents/Paperino/figures-mcp/src/server.ts"],
      "enabled": true
    },
```

- [ ] **Step 2: Teach the workflow in AGENTS.md**

Append to `paperino-config/AGENTS.md`:

```markdown
## Figures (the figures-mcp tools)

Figures are code, not images: HTML for structure, CSS custom properties for style,
`data.json` for every number, one SVG overlay (lib/annot.js) for arrows/braces/
highlights. You never type a coordinate or a hex color.

The workflow — never skip a step, never draw blind:

1. Classify the figure: schematic | gallery | chart | table. Freestyling is a bug.
2. `figure_scaffold` with the **claim** — the one sentence the figure must
   demonstrate — written before any drawing.
3. Get numbers with `data_query` into `data.json`. Retyping a number is a bug;
   for tables/charts the lint will fail it.
4. Edit `figure.html`. Layout = HTML/flex/grid. Annotations = `arrow()`, `brace()`,
   `highlight()` from `../lib/annot.js` anchored to element IDs, with one scalar
   `bow` for the swoop. Colors = `var(--…)` from `../tokens.css` only.
5. `figure_render` → `figure_lint`. Patch by the selector in each lint error.
   Repeat until lint passes.
6. `figure_review` — you receive the render plus two exemplars. Judge it against
   the claim and the rubric. Patch and rerun. **Hard cap: 4 review rounds**, then
   stop and show the user what you have.
7. Reference it from LaTeX: `\includegraphics[width=\linewidth]{figures/<name>/build/<name>.pdf}`
   and copy that PDF to `.paperino/preview.pdf` when the user wants to see it.
```

- [ ] **Step 3: Verify registration live**

Close any running instance; run `paperino-dev.cmd`; ask the agent "list your MCP servers and figure tools".
Expected: `figures` server connected with the five tools; InteJer servers still disabled. (Programmatic alternative: query the sidecar `GET /mcp` with the session's basic auth — `figures` should show `"status":"connected"`.)

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add opencode-dev/paperino-config
git commit -m "feat(figures): register figures-mcp in Paperino config + agent workflow

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Acceptance — reproduce the two Anthropic reference figures + a data-bound table

The exit gate from the spec (§8). Work inside `C:\Users\azamk\Documents\Paperino\fixtures\demo-paper` (already a paper workspace). Reference images: `figures-mcp/src/assets/exemplars/exemplar-schematic.png` (Figure 2: three side cards, dashed amber J-space highlight, left braces for Motor/Workspace/Sensory, swoopy layer arrows) and `exemplar-gallery.png` (Figure 3: six prompt cards, boxed tokens, connector curves to layer-readout boxes, red/green/blue mono tokens).

**Files:**
- Create (via the tools, not by hand-copying template output): `fixtures/demo-paper/figures/fig-jspace/**`, `fixtures/demo-paper/figures/fig-lens-gallery/**`, `fixtures/demo-paper/figures/tab-results/**`
- Create: `fixtures/demo-paper/artifacts/results.json`
- Modify: `fixtures/demo-paper/sections/02-introduction.tex` (add the includegraphics)

- [ ] **Step 1: Seed results data**

`fixtures/demo-paper/artifacts/results.json`:

```json
{
  "benchmarks": [
    { "step": "5C", "batch": 8192, "speedup": 14617 },
    { "step": "9C", "batch": 512, "speedup": 1136 },
    { "step": "9C", "batch": 256, "speedup": 639 }
  ]
}
```

- [ ] **Step 2: Author the three figures using ONLY the MCP tools** (drive them through a scratch script using `test/client.ts`, or through the running app's agent). For each: scaffold → extract data via `data_query` → edit `figure.html` → render → lint (fix until clean) → review (judge against the exemplar).
  - `fig-jspace` (`schematic`, `full`, claim: "J-space carries workspace-like content only at intermediate depths"): left column = tall rounded rect with a dashed amber `highlight()` over its middle span + `brace()` labels Motor/Workspace/Sensory; right column = three `.card`s; swoopy `arrow()`s (`bow` 0.4–0.5) alongside the column.
  - `fig-lens-gallery` (`gallery`, `full`, claim: "The lens reveals interpretable intermediate readouts across tasks"): 3×2 card grid from `data.json` items `{title, prompt, readouts: [{layer, token, tone}], caption}` — extend the gallery template's item rendering; connector curves via `arrow()` from a boxed token span to the readout box; readouts in `.mono` with tone colors.
  - `tab-results` (`table`, `narrow`, claim: "GPU speedups grow with batch size"): `data_query` the numbers out of `artifacts/results.json` into `data.json` `{rows, columns}`; render via `renderTable`. Then verify the provenance rule end-to-end: temporarily change one speedup in `data.json` to 12345, re-render, confirm `figure_lint` fails with rule `provenance`, restore, re-render, confirm clean.

- [ ] **Step 3: Wire into the manuscript**

In `fixtures/demo-paper/sections/02-introduction.tex` add:

```latex
\begin{figure}[h]
  \centering
  \includegraphics[width=\linewidth]{figures/fig-jspace/build/fig-jspace.pdf}
  \caption{Stylized illustration of the three structural properties of the J-space.}
\end{figure}
```

Expected: the Preview panel recompiles and the schematic appears inside the paper PDF.

- [ ] **Step 4: Acceptance checklist** (report pass/fail per line to the user)

1. All three figures lint-clean (`figure_lint` → `passed: true`).
2. `fig-jspace` and `fig-lens-gallery` structurally match the exemplars (braces, dashed highlight, swoopy arrows; card grid with connectors) — judged via `figure_review`.
3. `tab-results` contains no number absent from `artifacts/results.json`; the doctored-number check failed lint as expected.
4. The manuscript compiles with the embedded figure PDF and shows in the Preview panel.
5. `bun test` in `figures-mcp` fully green.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\azamk\Documents\Paperino
git add fixtures/demo-paper
git commit -m "feat(figures): acceptance — Anthropic reference figures + provenance-checked table in demo paper

Co-Authored-By: Claude <noreply@anthropic.com>"
```
