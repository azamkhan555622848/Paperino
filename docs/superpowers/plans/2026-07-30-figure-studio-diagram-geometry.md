# Figure Studio v4: Diagram Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Figure Studio primitives that resolve geometry from real measurement — ports, obstacle-aware routing, lanes, ink anchoring, collision-aware placement — narrow enforcement to four objective geometry defects with one uniform declared-intent escape, and stop steering composition toward the exemplars.

**Architecture:** A new pure-geometry module (`src/route.ts`) does all routing arithmetic on plain rects, so it is testable under bun with no browser. `annot.js` imports nothing from it at runtime — the module is *bundled into* the vendored lib by a build step — and calls it inside `figReady()`'s existing double-rAF, where real `getBoundingClientRect()` values are available. The render worker's manifest grows four arrays (`paths`, `nodes`, `legend`, `intents`) so lint can see geometry rather than only ink. The measurement path is unchanged: everything still converges on an SVG measured in Chromium.

**Tech Stack:** TypeScript on bun (figures-mcp), vanilla ES modules for the vendored browser lib, Playwright under node for the worker, `bun test`.

## Global Constraints

Values copied verbatim from `docs/superpowers/specs/2026-07-30-figure-studio-diagram-geometry-design.md`. Every task's requirements implicitly include this section.

- **Absolute rules — `data-intent` must NOT exempt them, and attempting it is an error:** rule 2 `overflow`, rule 3 `min-type-size`, rule 8 `provenance`, rule 13 `font-allowlist`.
- **Escapable style rules:** rule 7 `palette`, rule 12 `web-chrome` (radius only — `box-shadow` stays absolute), and new rules 14–17.
- **Escape attribute:** `data-intent="<reason>"`. Reported in `lint.json` as `exemptions: [{rule, selector, reason}]`.
- **Clearance:** a path's corridor is the polyline inflated by `strokeWidth / 2 + 2` px.
- **Lane step:** `strokeWidth * 3`.
- **Dangling tolerance:** 3px from a node's visible boundary.
- **Empty-node minimum area:** 100 px².
- **Degenerate edge threshold:** port-to-port distance `< 21` px (3× the 7px arrowhead).
- **Unroutable and degenerate edges RENDER and report a lint finding. They never throw.**
- **Missing selectors still throw**, surfacing through `window.__FIG_ERROR__`.
- **No node-placement algorithm.** No dagre/elk/graphviz. The model composes with CSS.
- **`bow` is retained** on `arrow()`.
- **Vendored marker bumps to `v4.0`** on `tokens.css` line 1 and in `lib/`, which re-vendors into existing workspaces through the mechanism `scaffold.ts` already has.
- **Exemplars are craft references, not compositional targets.**
- Never `git add -A`. Stage explicit paths. No Claude co-author trailer on any commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `figures-mcp/src/route.ts` | **new.** Pure geometry: port parsing, anchors, segment/rect intersection, straight → ortho → detour routing, lane offsets, collision-aware placement. No DOM, no imports. |
| `figures-mcp/test/route.test.ts` | **new.** The contract for the above, the way `test/scale.test.ts` pins `niceDomain`. |
| `figures-mcp/src/assets/lib/annot.js` | Rewritten to consume `route.js`: ports, ink anchoring, obstacle collection, plus `edge`/`fan`/`place`/`label`/`dimension`. |
| `figures-mcp/src/assets/lib/route.js` | **new, generated.** `route.ts` compiled to a browser ES module by `scripts/build-lib.ts`. Never hand-edited. |
| `figures-mcp/scripts/build-lib.ts` | **new.** Compiles `route.ts` → `assets/lib/route.js` so the browser and the test suite share one implementation. |
| `figures-mcp/src/render-worker.mjs` | Manifest gains `paths`, `nodes`, `legend`, `intents`. |
| `figures-mcp/src/lint.ts` | Rules 14–17, exemption handling, `intent-not-permitted`, relaxations to 7/12/13. |
| `figures-mcp/src/scaffold.ts` | Minimal canvas by default; `from:` selects an optional template. |
| `figures-mcp/src/server.ts` | `figure_scaffold` gains `from`; response carries the primitive catalogue; `figure_review` rubric reframed. |
| `figures-mcp/src/venue.ts` | `mathFaces` unchanged; `meta.fonts` merges into the allowlist at the server. |
| `figures-mcp/src/templates/canvas/figure.html` | **new.** The minimal canvas. |
| `figures-mcp/test/author-exemplars.ts` | Schematic exemplar re-authored to demonstrate ports/routing/anchoring. |

---

### Task 1: Pure routing geometry

**Files:**
- Create: `figures-mcp/src/route.ts`
- Test: `figures-mcp/test/route.test.ts`

**Interfaces:**
- Consumes: nothing. This module is deliberately dependency-free so it runs identically in bun and in Chromium.
- Produces: `Rect`, `Side`, `Point`, `Corridor`, `RouteResult`, `parsePort`, `anchorAt`, `autoSides`, `segmentHitsRect`, `polylineHits`, `routePath`, `pickPlacement`, `LANE_STEP`.

- [ ] **Step 1: Write the failing test**

Create `figures-mcp/test/route.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { anchorAt, autoSides, parsePort, pickPlacement, polylineHits, routePath, segmentHitsRect } from "../src/route"

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

describe("ports", () => {
  test("a bare side anchors at the midpoint", () => {
    expect(parsePort("right")).toEqual({ side: "right", fraction: 0.5 })
    expect(anchorAt(R(0, 0, 100, 50), "right", 0.5)).toEqual([100, 25])
  })

  test("a fraction positions the anchor along that side", () => {
    expect(parsePort("right:0.3")).toEqual({ side: "right", fraction: 0.3 })
    // Two edges into one tall node at 0.3 and 0.7 is the case that made an author draw
    // fake 9px port squares.
    expect(anchorAt(R(0, 0, 100, 200), "right", 0.3)).toEqual([100, 60])
    expect(anchorAt(R(0, 0, 100, 200), "right", 0.7)).toEqual([100, 140])
  })

  test("fractions are clamped, and a bad port throws", () => {
    expect(parsePort("left:9")).toEqual({ side: "left", fraction: 1 })
    expect(parsePort("left:-2")).toEqual({ side: "left", fraction: 0 })
    expect(() => parsePort("diagonal")).toThrow(/unknown port/)
  })

  test("autoSides picks the dominant axis", () => {
    expect(autoSides(R(0, 0, 50, 50), R(200, 10, 50, 50))).toEqual(["right", "left"])
    expect(autoSides(R(0, 0, 50, 50), R(10, 200, 50, 50))).toEqual(["bottom", "top"])
  })
})

describe("segmentHitsRect", () => {
  test("detects a crossing, ignores a miss, and respects clearance", () => {
    const box = R(40, 40, 20, 20)
    expect(segmentHitsRect([0, 50], [100, 50], box, 0)).toBe(true)
    expect(segmentHitsRect([0, 0], [10, 5], box, 0)).toBe(false)
    // 2px short of the edge is a miss with no clearance and a hit with 3px of it.
    expect(segmentHitsRect([0, 38], [100, 38], box, 0)).toBe(false)
    expect(segmentHitsRect([0, 38], [100, 38], box, 3)).toBe(true)
  })

  test("a segment fully inside the rect counts as a hit", () => {
    expect(segmentHitsRect([45, 45], [55, 55], R(40, 40, 20, 20), 0)).toBe(true)
  })
})

describe("routePath", () => {
  const base = { clearance: 2, textRects: [], lanes: [] }

  test("draws straight when nothing is in the way", () => {
    const r = routePath({ ...base, from: R(0, 0, 60, 40), to: R(200, 0, 60, 40), obstacles: [] })
    expect(r.kind).toBe("straight")
    expect(r.points).toEqual([[60, 20], [200, 20]])
    expect(r.blocked).toEqual([])
  })

  test("routes orthogonally around a blocking node", () => {
    // This is the Fig. 2 defect: #capture -> #scores with #distortion between them.
    const capture = R(12, 120, 214, 40)
    const scores = R(12, 320, 214, 100)
    const distortion = { selector: "#distortion", rect: R(12, 190, 214, 100) }
    const r = routePath({ ...base, from: capture, to: scores, obstacles: [distortion] })
    expect(r.blocked).toEqual([])
    expect(r.kind).not.toBe("straight")
    expect(polylineHits(r.points, [distortion.rect], 2)).toBe(0)
  })

  test("a route is never claimed clear when it still crosses text", () => {
    const text = R(90, 60, 60, 12)
    const r = routePath({
      ...base,
      from: R(0, 0, 60, 40),
      to: R(200, 100, 60, 40),
      obstacles: [],
      textRects: [text],
    })
    expect(polylineHits(r.points, [text], 2)).toBe(0)
  })

  test("reports the blocker when no variant clears", () => {
    // A node that spans the entire corridor cannot be routed around.
    const wall = { selector: "#wall", rect: R(0, 40, 400, 40) }
    const r = routePath({ ...base, from: R(150, 0, 60, 30), to: R(150, 120, 60, 30), obstacles: [wall] })
    expect(r.kind).toBe("blocked")
    expect(r.blocked).toEqual(["#wall"])
    expect(r.points.length).toBeGreaterThan(1) // still renders something to look at
  })

  test("parallel edges in one gutter get distinct lanes", () => {
    const a = routePath({ ...base, from: R(0, 0, 60, 40), to: R(200, 0, 60, 40), obstacles: [] })
    const b = routePath({
      ...base,
      from: R(0, 0, 60, 40),
      to: R(200, 0, 60, 40),
      obstacles: [],
      lanes: [{ points: a.points, width: 1 }],
    })
    expect(b.points).not.toEqual(a.points)
  })

  test("degenerate edges are flagged, not thrown", () => {
    const r = routePath({ ...base, from: R(0, 0, 60, 40), to: R(0, 53, 60, 40), obstacles: [] })
    expect(r.degenerate).toBe(true)
  })
})

describe("pickPlacement", () => {
  test("chooses the first compass position that collides with nothing", () => {
    const target = { w: 40, h: 12 }
    const near = R(100, 100, 60, 30)
    const blocked = R(100, 60, 60, 30) // directly above
    const p = pickPlacement(target, near, [blocked], 6)
    expect(p).not.toBeNull()
    const placed = { x: p!.x, y: p!.y, w: target.w, h: target.h }
    const overlaps = (a: typeof placed, b: typeof blocked) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    expect(overlaps(placed, blocked)).toBe(false)
    expect(overlaps(placed, near)).toBe(false)
  })

  test("returns null when every candidate is blocked", () => {
    const near = R(100, 100, 60, 30)
    const everywhere = R(0, 0, 400, 400)
    expect(pickPlacement({ w: 40, h: 12 }, near, [everywhere], 6)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd figures-mcp && bun test test/route.test.ts`
Expected: FAIL — `Cannot find module '../src/route'`.

- [ ] **Step 3: Write the implementation**

Create `figures-mcp/src/route.ts`:

```ts
// Pure routing geometry. NO imports and NO DOM: this module is compiled verbatim into
// assets/lib/route.js (scripts/build-lib.ts) so the browser and the test suite run the
// SAME code. A second implementation is how the two drift.
//
// Why this exists at all: annot.js used to resolve two endpoints and know nothing else —
// no obstacle set, no clearance test — so `bow` was the only control over a path, and its
// correct value depends on a rect the authoring model cannot see. That is how an arrow
// came to cross the words "Reconstruction-distortion profiles" in a shipped paper.

export type Rect = { x: number; y: number; w: number; h: number }
export type Side = "top" | "right" | "bottom" | "left"
export type Point = [number, number]
export type Corridor = { points: Point[]; width: number }
export type Obstacle = { selector: string; rect: Rect }

export const LANE_STEP_FACTOR = 3

const SIDES: Side[] = ["top", "right", "bottom", "left"]
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** `"right"` or `"right:0.3"`. The fraction runs along the side, 0 = its top/left end. */
export function parsePort(port: string): { side: Side; fraction: number } {
  const [rawSide, rawFraction] = port.split(":")
  const side = rawSide.trim() as Side
  if (!SIDES.includes(side)) throw new Error(`unknown port side "${rawSide}" (use top|right|bottom|left[:0..1])`)
  if (rawFraction === undefined) return { side, fraction: 0.5 }
  const f = Number(rawFraction)
  if (!Number.isFinite(f)) throw new Error(`unknown port fraction "${rawFraction}"`)
  return { side, fraction: clamp01(f) }
}

export function anchorAt(r: Rect, side: Side, fraction: number): Point {
  const f = clamp01(fraction)
  if (side === "top") return [r.x + r.w * f, r.y]
  if (side === "bottom") return [r.x + r.w * f, r.y + r.h]
  if (side === "left") return [r.x, r.y + r.h * f]
  return [r.x + r.w, r.y + r.h * f]
}

export function autoSides(a: Rect, b: Rect): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"]
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"]
}

/**
 * Liang–Barsky segment/AABB clip. Returns true if the segment enters the rect inflated by
 * `clearance` — including the fully-contained case, which a naive edge-crossing test misses.
 */
export function segmentHitsRect(p: Point, q: Point, r: Rect, clearance = 0): boolean {
  const minX = r.x - clearance
  const minY = r.y - clearance
  const maxX = r.x + r.w + clearance
  const maxY = r.y + r.h + clearance
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const num = [p[0] - minX, maxX - p[0], p[1] - minY, maxY - p[1]]
  const den = [-dx, dx, -dy, dy]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    if (den[i] === 0) {
      if (num[i] < 0) return false // parallel to this slab and outside it
      continue
    }
    const t = num[i] / den[i]
    if (den[i] < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
  }
  return t0 <= t1
}

/** How many of `obstacles` the polyline touches. Used both to choose a route and to lint one. */
export function polylineHits(points: Point[], obstacles: Rect[], clearance = 0): number {
  let hits = 0
  for (const rect of obstacles) {
    for (let i = 0; i + 1 < points.length; i++) {
      if (segmentHitsRect(points[i], points[i + 1], rect, clearance)) {
        hits++
        break
      }
    }
  }
  return hits
}

const length = (points: Point[]) => {
  let total = 0
  for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
  return total
}

const horizontal = (side: Side) => side === "left" || side === "right"

export type RouteInput = {
  from: Rect
  to: Rect
  /** Omitted → autoSides. */
  portFrom?: string
  portTo?: string
  /** Every OTHER node. The endpoints' own rects must not be in here. */
  obstacles: Obstacle[]
  /** Text rects are obstacles too — a stroke through a glyph is rule 14. */
  textRects: Rect[]
  clearance: number
  mode?: "auto" | "straight" | "ortho"
  /** Corridors already drawn this figure, for lane separation. */
  lanes: Corridor[]
  strokeWidth?: number
}

export type RouteResult = {
  points: Point[]
  kind: "straight" | "ortho" | "detour" | "blocked"
  /** Selectors the chosen route still intersects. Empty when clear. */
  blocked: string[]
  degenerate: boolean
}

export function routePath(input: RouteInput): RouteResult {
  const { from, to, obstacles, textRects, clearance, lanes } = input
  const [autoA, autoB] = autoSides(from, to)
  const pa = parsePort(input.portFrom ?? autoA)
  const pb = parsePort(input.portTo ?? autoB)
  const a = anchorAt(from, pa.side, pa.fraction)
  const b = anchorAt(to, pb.side, pb.fraction)

  const degenerate = Math.hypot(b[0] - a[0], b[1] - a[1]) < 21

  // Z variants. Which one is natural depends on the port sides: a right→left pair wants
  // H-V-H through the mid-gutter, a bottom→top pair wants V-H-V.
  const midX = (a[0] + b[0]) / 2
  const midY = (a[1] + b[1]) / 2
  const hvh = (x: number): Point[] => [a, [x, a[1]], [x, b[1]], b]
  const vhv = (y: number): Point[] => [a, [a[0], y], [b[0], y], b]

  const candidates: { points: Point[]; kind: RouteResult["kind"] }[] = []
  if (input.mode !== "ortho") candidates.push({ points: [a, b], kind: "straight" })
  // mode 'straight' means straight or nothing — an author who asked for a straight edge gets
  // a reported blocker, not a silent Z they did not ask for.
  if (input.mode !== "straight") {
    if (horizontal(pa.side)) {
      candidates.push({ points: hvh(midX), kind: "ortho" })
      candidates.push({ points: vhv(midY), kind: "ortho" })
    } else {
      candidates.push({ points: vhv(midY), kind: "ortho" })
      candidates.push({ points: hvh(midX), kind: "ortho" })
    }
  }

  // Detours: run the corridor past each blocker's free side rather than between the two
  // anchors. `gap` keeps the turn off the obstacle's edge by more than the clearance.
  const gap = clearance + 6
  for (const o of input.mode === "straight" ? [] : obstacles) {
    const r = o.rect
    if (horizontal(pa.side)) {
      candidates.push({ points: vhv(r.y - gap), kind: "detour" })
      candidates.push({ points: vhv(r.y + r.h + gap), kind: "detour" })
    } else {
      candidates.push({ points: hvh(r.x - gap), kind: "detour" })
      candidates.push({ points: hvh(r.x + r.w + gap), kind: "detour" })
    }
  }

  const obstacleRects = obstacles.map((o) => o.rect)
  const score = (points: Point[]) =>
    polylineHits(points, obstacleRects, clearance) + polylineHits(points, textRects, clearance)

  let best = candidates[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    const s = score(c.points)
    // Ties go to the earlier candidate, which is why `candidates` is ordered
    // straight → natural ortho → alternate ortho → detours.
    if (s < bestScore || (s === bestScore && length(c.points) < length(best.points) - 0.5)) {
      best = c
      bestScore = s
    }
    if (s === 0 && c.kind === "straight") break // nothing beats a clear straight line
  }

  let points = best.points
  let kind = best.kind
  if (bestScore > 0) {
    kind = "blocked"
  } else if (points.length > 2) {
    // Lane separation: only for routes with a mid-corridor to move.
    const step = (input.strokeWidth ?? 1) * LANE_STEP_FACTOR
    for (let attempt = 1; attempt <= 4; attempt++) {
      const clash = lanes.some((l) => polylineHits(points, corridorRects(l), 0) > 0)
      if (!clash) break
      const shift = attempt * step * (attempt % 2 === 0 ? -1 : 1)
      const shifted = horizontal(pa.side) ? hvh(midX + shift) : vhv(midY + shift)
      if (score(shifted) > 0) continue
      points = shifted
    }
  }

  const blocked =
    bestScore > 0
      ? obstacles.filter((o) => polylineHits(points, [o.rect], clearance) > 0).map((o) => o.selector)
      : []
  return { points, kind, blocked, degenerate }
}

/** A corridor as thin rects, so lane clashes reuse the same intersection test. */
function corridorRects(c: Corridor): Rect[] {
  const half = Math.max(c.width, 1) / 2 + 1
  const out: Rect[] = []
  for (let i = 0; i + 1 < c.points.length; i++) {
    const [x1, y1] = c.points[i]
    const [x2, y2] = c.points[i + 1]
    out.push({
      x: Math.min(x1, x2) - half,
      y: Math.min(y1, y2) - half,
      w: Math.abs(x2 - x1) + half * 2,
      h: Math.abs(y2 - y1) + half * 2,
    })
  }
  return out
}

/**
 * Collision-aware placement. "Put this near that and don't overlap anything" is the sentence
 * a blind author cannot execute, and the reason a label ends up on top of a node.
 * Compass order prefers right, then below, then left, then above — reading order first.
 */
export function pickPlacement(
  size: { w: number; h: number },
  near: Rect,
  avoid: Rect[],
  gap: number,
): { x: number; y: number } | null {
  const cx = near.x + near.w / 2 - size.w / 2
  const cy = near.y + near.h / 2 - size.h / 2
  const candidates = [
    { x: near.x + near.w + gap, y: cy },
    { x: cx, y: near.y + near.h + gap },
    { x: near.x - gap - size.w, y: cy },
    { x: cx, y: near.y - gap - size.h },
    { x: near.x + near.w + gap, y: near.y - gap - size.h },
    { x: near.x + near.w + gap, y: near.y + near.h + gap },
    { x: near.x - gap - size.w, y: near.y - gap - size.h },
    { x: near.x - gap - size.w, y: near.y + near.h + gap },
  ]
  const hits = (c: { x: number; y: number }, r: Rect) =>
    c.x < r.x + r.w && r.x < c.x + size.w && c.y < r.y + r.h && r.y < c.y + size.h
  for (const c of candidates) if (!hits(c, near) && !avoid.some((r) => hits(c, r))) return c
  return null
}

/** SVG path data for a polyline. Mitred corners — rounded corners are web chrome. */
export function pathData(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ")
}
```

- [ ] **Step 4: Run the tests**

Run: `cd figures-mcp && bun test test/route.test.ts`
Expected: PASS, all cases in the four describes.

- [ ] **Step 5: Commit**

```bash
git add Paperino/figures-mcp/src/route.ts Paperino/figures-mcp/test/route.test.ts
git commit -m "feat(figures): pure routing geometry for diagram edges"
```

---

### Task 2: Ship route.ts into the browser lib

**Files:**
- Create: `figures-mcp/scripts/build-lib.ts`
- Create (generated): `figures-mcp/src/assets/lib/route.js`
- Modify: `figures-mcp/package.json` (add a `build:lib` script)
- Test: `figures-mcp/test/build-lib.test.ts`

**Interfaces:**
- Consumes: `src/route.ts` from Task 1.
- Produces: `assets/lib/route.js`, a browser ES module exporting the identical surface. `annot.js` (Task 3) imports `./route.js`.

**Why a build step rather than hand-porting:** two copies of an intersection test drift, and the drift is invisible — the tests would pass against `route.ts` while the browser ran the stale copy. One source, compiled.

- [ ] **Step 1: Write the failing test**

Create `figures-mcp/test/build-lib.test.ts`:

```ts
import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const LIB = join(import.meta.dir, "..", "src", "assets", "lib", "route.js")

test("route.js is generated and exports the surface annot.js needs", () => {
  expect(existsSync(LIB)).toBe(true)
  const src = readFileSync(LIB, "utf8")
  for (const name of ["parsePort", "anchorAt", "autoSides", "routePath", "pickPlacement", "pathData"])
    expect(src).toContain(name)
  // A generated file must say so: hand-editing it is silently discarded on the next build.
  expect(src.split("\n", 1)[0]).toContain("GENERATED")
  // No TypeScript may survive: the browser loads this as-is.
  expect(src).not.toMatch(/:\s*(Rect|Side|Point|RouteInput)\b/)
})

test("the browser copy can actually run", async () => {
  const mod = await import(LIB)
  expect(mod.anchorAt({ x: 0, y: 0, w: 100, h: 200 }, "right", 0.3)).toEqual([100, 60])
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd figures-mcp && bun test test/build-lib.test.ts`
Expected: FAIL — `existsSync(LIB)` is false.

- [ ] **Step 3: Write the build script**

Create `figures-mcp/scripts/build-lib.ts`:

```ts
#!/usr/bin/env bun
// Compiles src/route.ts to a browser ES module at src/assets/lib/route.js, so annot.js and
// test/route.test.ts run ONE implementation. Two hand-maintained copies of a geometry
// routine drift, and the drift is invisible: the tests keep passing against the TS while
// the browser runs the stale JS.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const result = await Bun.build({
  entrypoints: [join(root, "src", "route.ts")],
  target: "browser",
  format: "esm",
  minify: false, // the vendored lib is read by humans debugging a figure
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
const code = await result.outputs[0].text()
const banner = "// GENERATED from src/route.ts by scripts/build-lib.ts — do not edit.\n"
writeFileSync(join(root, "src", "assets", "lib", "route.js"), banner + code)
console.log("lib ready: src/assets/lib/route.js")
```

- [ ] **Step 4: Wire it into the package scripts**

In `figures-mcp/package.json`, add to `scripts`:

```json
"build:lib": "bun scripts/build-lib.ts"
```

and make the dist build depend on it — in `figures-mcp/scripts/build-dist.ts`, immediately after the imports and before `rmSync(dist, ...)`:

```ts
// route.js must be regenerated BEFORE assets/ is copied, or dist ships a stale browser lib.
await Bun.$`bun ${join(root, "scripts", "build-lib.ts")}`.quiet()
```

- [ ] **Step 5: Generate and run the tests**

Run: `cd figures-mcp && bun run build:lib && bun test test/build-lib.test.ts`
Expected: `lib ready: ...` then PASS.

- [ ] **Step 6: Commit**

```bash
git add Paperino/figures-mcp/scripts/build-lib.ts Paperino/figures-mcp/scripts/build-dist.ts Paperino/figures-mcp/package.json Paperino/figures-mcp/src/assets/lib/route.js Paperino/figures-mcp/test/build-lib.test.ts
git commit -m "build(figures): compile route.ts into the vendored browser lib"
```

---

### Task 3: Rewrite annot.js on the router

**Files:**
- Modify: `figures-mcp/src/assets/lib/annot.js`

**Interfaces:**
- Consumes: `./route.js` (Task 2) — `parsePort`, `anchorAt`, `routePath`, `pickPlacement`, `pathData`.
- Produces the authoring surface figures import:
  - `arrow(from, to, { port, to: toPort, route, bow, tone, style, head })`
  - `edge(from, waypoints[], to, opts)`
  - `fan(from, targets[], opts)`
  - `place(sel, { near, side, gap, avoid })`
  - `label(sel, text, { place, leader, tone })`
  - `dimension(a, b, { text, side, tone })`
  - `brace(sel, opts)`, `highlight(sel, opts)`, `figReady()` — unchanged signatures.

- [ ] **Step 1: Bump the marker and import the router**

At the top of `figures-mcp/src/assets/lib/annot.js`, replace the header comment's first line and add the import:

```js
// paperino-annot v4.0
// Declarative annotations anchored to element IDs. One absolutely-positioned SVG overlay;
// geometry resolved at render time from getBoundingClientRect().
//
// v4: the author names PORTS and the router solves the ROUTE. Previously an arrow resolved
// two endpoints and knew nothing else, so `bow` was the only control over its path — and
// its correct value depends on a rect the authoring model cannot see. That is how an arrow
// came to cross the words "Reconstruction-distortion profiles" in a shipped paper.
import { anchorAt, parsePort, pathData, pickPlacement, routePath } from "./route.js"
```

- [ ] **Step 2: Add ink anchoring and obstacle collection**

Insert after the existing `toneColor` definition:

```js
/**
 * The VISIBLE rect, not the layout box. `.evidence` carries only `border-left`, so its
 * layout `right` edge sits at the column boundary with no ink anywhere near it — which is
 * why v3's arrows appeared to start in an empty gutter. If a side has no border and the
 * element has no background of its own, fall back to the union of its text rects.
 */
function inkRect(el) {
  const cs = getComputedStyle(el)
  const bordered = ["Top", "Right", "Bottom", "Left"].some(
    (s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none",
  )
  const filled = cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent"
  const box = el.getBoundingClientRect()
  if (bordered || filled) return { x: box.x, y: box.y, w: box.width, h: box.height }

  let min = [Infinity, Infinity]
  let max = [-Infinity, -Infinity]
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const tn = walker.currentNode
    if (!tn.textContent || !tn.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(tn)
    for (const r of range.getClientRects()) {
      if (!r.width || !r.height) continue
      min = [Math.min(min[0], r.x), Math.min(min[1], r.y)]
      max = [Math.max(max[0], r.right), Math.max(max[1], r.bottom)]
    }
  }
  if (!Number.isFinite(min[0])) return { x: box.x, y: box.y, w: box.width, h: box.height }
  return { x: min[0], y: min[1], w: max[0] - min[0], h: max[1] - min[1] }
}

const need = (sel, who) => {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`${who}: missing element ${sel}`)
  return el
}

/** Every declared node except the two endpoints, plus every text rect. */
function obstaclesFor(exclude) {
  const nodes = []
  for (const el of document.querySelectorAll("[data-node]")) {
    if (exclude.includes(el)) continue
    const r = inkRect(el)
    if (r.w > 0 && r.h > 0) nodes.push({ selector: el.id ? `#${el.id}` : "[data-node]", rect: r })
  }
  const textRects = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const tn = walker.currentNode
    if (!tn.textContent || !tn.textContent.trim()) continue
    if (tn.parentElement?.closest("#annot-overlay, .katex-mathml")) continue
    const range = document.createRange()
    range.selectNodeContents(tn)
    for (const r of range.getClientRects())
      if (r.width && r.height) textRects.push({ x: r.x, y: r.y, w: r.width, h: r.height })
  }
  return { nodes, textRects }
}

// Corridors drawn so far this figure, so parallel edges separate into lanes.
const drawn = []
// Findings the router produced. render-worker reads these off window and lint turns them
// into rules 14/15 — a blocked route must not be silent, and must not abort the render
// either: a throw leaves the model with no picture to look at and nothing to act on.
const findings = []
```

- [ ] **Step 3: Replace `arrow()`**

Replace the whole existing `arrow` function with:

```js
export function arrow(fromSel, toSel, opts = {}) {
  queue.push(() => {
    const fromEl = need(fromSel, "arrow")
    const toEl = need(toSel, "arrow")
    const from = inkRect(fromEl)
    const to = inkRect(toEl)
    const { nodes, textRects } = obstaclesFor([fromEl, toEl])
    const strokeWidth = parseFloat(getComputedStyle(document.body).getPropertyValue("--stroke")) || 1
    const result = routePath({
      from,
      to,
      portFrom: opts.port,
      portTo: opts.to,
      obstacles: nodes,
      textRects,
      clearance: strokeWidth / 2 + 2,
      mode: opts.route ?? "auto",
      lanes: drawn,
      strokeWidth,
    })
    if (result.kind === "blocked")
      findings.push({ rule: "edge-unroutable", selector: `${fromSel} -> ${toSel}`, blocked: result.blocked })
    if (result.degenerate)
      findings.push({ rule: "edge-degenerate", selector: `${fromSel} -> ${toSel}`, blocked: [] })

    // A straight two-point route may still be BOWED on purpose: a feedback edge in a
    // recurrent architecture reads better as an arc. bow is retained for exactly that, and
    // is no longer what obstacle avoidance depends on, so a wrong value can no longer
    // produce a crossing — the router already cleared this geometry.
    let d
    if (result.points.length === 2 && opts.bow) {
      const [[x1, y1], [x2, y2]] = result.points
      const len = Math.hypot(x2 - x1, y2 - y1) || 1
      const mx = (x1 + x2) / 2 + (-(y2 - y1) / len) * opts.bow * len
      const my = (y1 + y2) / 2 + ((x2 - x1) / len) * opts.bow * len
      d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
    } else {
      d = pathData(result.points)
    }
    drawn.push({ points: result.points, width: strokeWidth })
    const attrs = { d, "data-edge": "" }
    if (opts.head !== "none") attrs["marker-end"] = "url(#arrowhead)"
    if (opts.head === "both") attrs["marker-start"] = "url(#arrowhead)"
    ensureOverlay().appendChild(
      el("path", attrs, {
        fill: "none",
        stroke: toneColor(opts.tone),
        "stroke-width": "var(--stroke)",
        "stroke-dasharray": opts.style === "dashed" ? "5 4" : "none",
      }),
    )
  })
}
```

- [ ] **Step 4: Add the four new primitives**

Append before `figReady`:

```js
/** A polyline through explicit waypoints — selectors, or [fx, fy] fractions of the figure box. */
export function edge(fromSel, waypoints, toSel, opts = {}) {
  queue.push(() => {
    const from = inkRect(need(fromSel, "edge"))
    const to = inkRect(need(toSel, "edge"))
    const box = document.querySelector("#fig-root").getBoundingClientRect()
    // Destructured explicitly: Object.values() on parsePort's result would depend on key
    // insertion order, so adding a field to that return type would silently reorder the args.
    const at = (r, port) => {
      const { side, fraction } = parsePort(port)
      return anchorAt(r, side, fraction)
    }
    const pts = [
      at(from, opts.port ?? "right"),
      ...waypoints.map((w) =>
        typeof w === "string"
          ? (() => {
              const r = inkRect(need(w, "edge"))
              return [r.x + r.w / 2, r.y + r.h / 2]
            })()
          : [box.x + box.width * w[0], box.y + box.height * w[1]],
      ),
      at(to, opts.to ?? "left"),
    ]
    ensureOverlay().appendChild(
      el(
        "path",
        { d: pathData(pts), "marker-end": "url(#arrowhead)", "data-edge": "" },
        { fill: "none", stroke: toneColor(opts.tone), "stroke-width": "var(--stroke)" },
      ),
    )
    drawn.push({ points: pts, width: 1 })
  })
}

/** One source, many targets. Ports are distributed along the source side so the edges fan. */
export function fan(fromSel, targetSels, opts = {}) {
  const side = opts.port ?? "right"
  targetSels.forEach((t, i) => {
    const fraction = (i + 1) / (targetSels.length + 1)
    arrow(fromSel, t, { ...opts, port: `${side}:${fraction.toFixed(3)}` })
  })
}

/** Absolute-position an element near another without overlapping anything. */
export function place(sel, opts = {}) {
  queue.push(() => {
    const target = need(sel, "place")
    const near = inkRect(need(opts.near, "place"))
    const size = target.getBoundingClientRect()
    const { nodes, textRects } = obstaclesFor([target])
    const avoid = [...nodes.map((n) => n.rect), ...textRects]
    const spot = pickPlacement({ w: size.width, h: size.height }, near, avoid, opts.gap ?? 6)
    if (!spot) {
      findings.push({ rule: "placement-blocked", selector: sel, blocked: [opts.near] })
      return
    }
    const host = document.body.getBoundingClientRect()
    target.style.position = "absolute"
    target.style.left = `${spot.x - host.x}px`
    target.style.top = `${spot.y - host.y}px`
  })
}

/** A callout with an optional leader line. The leader is exempt from rule 15 by construction. */
export function label(sel, text, opts = {}) {
  queue.push(() => {
    const anchorEl = need(sel, "label")
    const r = inkRect(anchorEl)
    const ov = ensureOverlay()
    const host = document.body.getBoundingClientRect()
    const t = el(
      "text",
      { x: r.x + r.w + 10 - host.x, y: r.y + r.h / 2 - host.y, "dominant-baseline": "middle", "data-label": "" },
      { fill: "var(--text)", "font-size": "var(--fs-label)", "font-family": "var(--font-text)" },
    )
    t.textContent = text
    ov.appendChild(t)
    if (opts.leader)
      ov.appendChild(
        el(
          "path",
          { d: pathData([[r.x + r.w, r.y + r.h / 2], [r.x + r.w + 8, r.y + r.h / 2]]), "data-leader": "" },
          { fill: "none", stroke: toneColor(opts.tone), "stroke-width": "var(--stroke)" },
        ),
      )
  })
}

/** A measured span with end ticks — "4096 dims" under a block, IEEE style. */
export function dimension(aSel, bSel, opts = {}) {
  queue.push(() => {
    const a = inkRect(need(aSel, "dimension"))
    const b = inkRect(need(bSel, "dimension"))
    const y = Math.max(a.y + a.h, b.y + b.h) + (opts.gap ?? 10)
    const x1 = Math.min(a.x, b.x)
    const x2 = Math.max(a.x + a.w, b.x + b.w)
    const tick = 4
    const ov = ensureOverlay()
    ov.appendChild(
      el(
        "path",
        {
          d: `M ${x1} ${y - tick} L ${x1} ${y + tick} M ${x1} ${y} L ${x2} ${y} M ${x2} ${y - tick} L ${x2} ${y + tick}`,
          "data-dimension": "",
        },
        { fill: "none", stroke: toneColor(opts.tone ?? "ref"), "stroke-width": "var(--stroke)" },
      ),
    )
    if (opts.text) {
      const t = el(
        "text",
        { x: (x1 + x2) / 2, y: y + tick + 10, "text-anchor": "middle" },
        { fill: "var(--text-muted)", "font-size": "var(--fs-small)", "font-family": "var(--font-text)" },
      )
      t.textContent = opts.text
      ov.appendChild(t)
    }
  })
}
```

- [ ] **Step 5: Publish the findings from `figReady`**

In `figReady`, inside the try block after the draw loop, before `window.__FIG_READY__ = true`:

```js
        window.__FIG_FINDINGS__ = findings
```

- [ ] **Step 6: Regenerate the lib and run the whole suite**

Run: `cd figures-mcp && bun run build:lib && bun test`
Expected: PASS. Existing figure fixtures still render because `arrow(a, b)` with no options keeps its old meaning (autoSides, now routed).

- [ ] **Step 7: Commit**

```bash
git add Paperino/figures-mcp/src/assets/lib/annot.js
git commit -m "feat(figures): ports, routing, ink anchoring and four new primitives"
```

---

### Task 4: Manifest gains geometry

**Files:**
- Modify: `figures-mcp/src/render-worker.mjs`
- Test: `figures-mcp/test/render.test.ts` (extend)

**Interfaces:**
- Consumes: `window.__FIG_FINDINGS__` from Task 3.
- Produces on `manifest`: `paths: {selector, points, width, kind}[]`, `nodes: {selector, rect, hasText, intent}[]`, `legend: {selector, style, inLegend}[]`, `intents: {selector, reason}[]`, `findings: {rule, selector, blocked}[]`.

- [ ] **Step 1: Write the failing test**

Append to `figures-mcp/test/render.test.ts`:

```ts
test("the manifest carries path geometry, declared nodes and intents", async () => {
  const ws = await scaffoldFixture("geom", {
    body: `<div id="a" data-node style="border:1px solid #000">A</div>
           <div id="b" data-node style="border:1px solid #000;margin-top:120px">B</div>
           <div id="ghost" data-node data-intent="unfilled slot" style="border:1px solid #000;width:40px;height:40px"></div>`,
    script: `arrow("#a", "#b")`,
  })
  const m = JSON.parse(readFileSync(join(ws, "build", "bboxes.json"), "utf8"))
  expect(m.paths.length).toBe(1)
  expect(m.paths[0].points.length).toBeGreaterThanOrEqual(2)
  expect(m.paths[0].width).toBeGreaterThan(0)
  expect(m.nodes.map((n: any) => n.selector).sort()).toEqual(["#a", "#b", "#ghost"])
  expect(m.nodes.find((n: any) => n.selector === "#ghost").hasText).toBe(false)
  expect(m.intents).toEqual([{ selector: "#ghost", reason: "unfilled slot" }])
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd figures-mcp && bun test test/render.test.ts`
Expected: FAIL — `m.paths` is undefined.

- [ ] **Step 3: Extend the manifest walker**

In `figures-mcp/src/render-worker.mjs`, inside the `page.evaluate` that builds the manifest, after the `elements` loop and before the `content` height calculation, insert:

```js
    // Overlay path GEOMETRY, not just stroke width. Rules 14 and 15 ask where a stroke
    // went, and the v3 manifest could only say how thick it was — which is why an arrow
    // through a text block linted clean.
    //
    // getPointAtLength handles every path type uniformly, so a bowed quadratic and a
    // mitred polyline are sampled the same way. 2px steps, capped, keeps a long detour
    // from producing thousands of points.
    const paths = []
    for (const p of document.querySelectorAll("#annot-overlay path")) {
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
    // their boundaries to decide whether an endpoint attached to anything.
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
      return [cs.stroke !== "none" ? cs.stroke : (border ?? ""), cs.strokeDasharray || cs.borderTopStyle || "", cs.backgroundColor].join("|")
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
```

Then change the `return` of that evaluate to:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `cd figures-mcp && bun test test/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Paperino/figures-mcp/src/render-worker.mjs Paperino/figures-mcp/test/render.test.ts
git commit -m "feat(figures): manifest records path geometry, nodes, legend and intents"
```

---

### Task 5: Rules 14–17 and the escape mechanism

**Files:**
- Modify: `figures-mcp/src/lint.ts`
- Test: `figures-mcp/test/lint.test.ts` (extend)

**Interfaces:**
- Consumes: the manifest fields from Task 4.
- Produces: `LintResult = { passed: boolean; errors: LintError[]; exemptions: Exemption[] }` — note `lint()` now returns an object, not a bare array. Every existing caller (`server.ts`, tests) must be updated in this task.

- [ ] **Step 1: Write the failing tests**

Append to `figures-mcp/test/lint.test.ts`:

```ts
const emptyManifest = {
  viewport: { width: 528, height: 300 },
  texts: [],
  strokes: [],
  elements: [],
  paths: [],
  nodes: [],
  legend: [],
  intents: [],
  findings: [],
}
const baseInput = {
  source: "<div></div>",
  meta: { archetype: "schematic", caption: "c", alt: "a", claim: "k" },
  data: {},
  manifest: emptyManifest,
}
const ok = (o: object) => ({ ...baseInput, ...o })

test("14 stroke-over-text fails an arrow crossing a glyph", () => {
  const text = { ...textBox("#label", "Reconstruction-distortion profiles"), rect: { x: 100, y: 100, w: 120, h: 12 } }
  const input = ok({
    manifest: {
      ...emptyManifest,
      texts: [text],
      paths: [{ selector: "#annot-overlay > path", points: [[80, 106], [240, 106]], width: 1, kind: "edge" }],
    },
  })
  expect(lint(input).errors.map((e) => e.rule)).toContain("stroke-over-text")
})

test("14 permits a declared strikethrough", () => {
  const text = { ...textBox("#label", "old value"), rect: { x: 100, y: 100, w: 60, h: 12 } }
  const result = lint(
    ok({
      manifest: {
        ...emptyManifest,
        texts: [text],
        paths: [{ selector: "#strike", points: [[95, 106], [165, 106]], width: 1, kind: "edge" }],
        intents: [{ selector: "#strike", reason: "struck-through superseded value" }],
      },
    }),
  )
  expect(result.errors.map((e) => e.rule)).not.toContain("stroke-over-text")
  expect(result.exemptions).toEqual([
    { rule: "stroke-over-text", selector: "#strike", reason: "struck-through superseded value" },
  ])
})

test("15 dangling-edge fails an endpoint attached to nothing, but not a leader", () => {
  const node = { selector: "#a", rect: { x: 0, y: 0, w: 50, h: 50 }, hasText: true, intent: null }
  const edge = { selector: "#e", points: [[50, 25], [300, 25]], width: 1, kind: "edge" }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [node], paths: [edge] } })).errors.map((e) => e.rule)).toContain(
    "dangling-edge",
  )
  const leader = { ...edge, kind: "leader" }
  expect(
    lint(ok({ manifest: { ...emptyManifest, nodes: [node], paths: [leader] } })).errors.map((e) => e.rule),
  ).not.toContain("dangling-edge")
})

test("16 empty-node fails a bordered box with no text, unless declared", () => {
  const ghost = { selector: "#port", rect: { x: 0, y: 0, w: 40, h: 40 }, hasText: false, intent: null }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [ghost] } })).errors.map((e) => e.rule)).toContain("empty-node")
  // Under 100px^2 is a rule/tick, not a node.
  const tick = { ...ghost, rect: { x: 0, y: 0, w: 9, h: 9 } }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [tick] } })).errors.map((e) => e.rule)).not.toContain("empty-node")
  const declared = { ...ghost, intent: "unfilled slot" }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [declared] } })).errors.map((e) => e.rule)).not.toContain(
    "empty-node",
  )
})

test("17 orphan-legend fails a swatch matching no real mark", () => {
  const legend = [
    { selector: "#sw1", style: "rgb(0,0,255)|solid|rgba(0, 0, 0, 0)", inLegend: true },
    { selector: "#mark1", style: "rgb(0,0,255)|solid|rgba(0, 0, 0, 0)", inLegend: false },
    { selector: "#sw2", style: "rgb(200,0,0)|dashed|rgba(0, 0, 0, 0)", inLegend: true },
  ]
  const rules = lint(ok({ manifest: { ...emptyManifest, legend } })).errors
  expect(rules.filter((e) => e.rule === "orphan-legend").map((e) => e.selector)).toEqual(["#sw2"])
})

test("router findings become lint errors", () => {
  const findings = [{ rule: "edge-unroutable", selector: "#a -> #b", blocked: ["#c"] }]
  expect(lint(ok({ manifest: { ...emptyManifest, findings } })).errors.map((e) => e.rule)).toContain("edge-unroutable")
})

test("intent-not-permitted fires when an absolute rule is waived", () => {
  // 6px is below the 7pt floor. data-intent must not buy an exemption from it.
  const tiny = { ...textBox("#tiny", "x"), fontSize: 6 }
  const result = lint(
    ok({ manifest: { ...emptyManifest, texts: [tiny], intents: [{ selector: "#tiny", reason: "looks nicer" }] } }),
  )
  expect(result.errors.map((e) => e.rule)).toContain("min-type-size")
  expect(result.errors.map((e) => e.rule)).toContain("intent-not-permitted")
})

test("7 palette and 12 web-chrome accept a declared intent", () => {
  const six = ["255,0,0", "0,0,255", "0,128,0", "255,128,0", "128,0,255", "0,160,160"].map((c, i) => ({
    ...textBox(`#c${i}`, "x"),
    color: `rgb(${c})`,
  }))
  const declared = lint(
    ok({ manifest: { ...emptyManifest, texts: six, intents: [{ selector: "figure", reason: "six ablation conditions" }] } }),
  )
  expect(declared.errors.map((e) => e.rule)).not.toContain("palette")
})

test("a box-shadow can never be waived", () => {
  const result = lint(
    ok({
      manifest: {
        ...emptyManifest,
        elements: [{ selector: "#card", borderRadius: 0, boxShadow: "rgba(0,0,0,0.2) 0px 2px 6px" }],
        intents: [{ selector: "#card", reason: "depth" }],
      },
    }),
  )
  expect(result.errors.map((e) => e.rule)).toContain("web-chrome")
  expect(result.errors.map((e) => e.rule)).toContain("intent-not-permitted")
})
```

Add the `textBox` helper near the top of the file if it is not already there:

```ts
const textBox = (selector: string, text: string) => ({
  selector,
  text,
  rect: { x: 10, y: 10, w: 80, h: 12 },
  fontSize: 12,
  color: "rgb(20, 20, 20)",
  background: "rgb(255, 255, 255)",
  derived: false,
  fontFamily: "KaTeX_Main",
  inKatex: false,
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd figures-mcp && bun test test/lint.test.ts`
Expected: FAIL — `lint(...).errors` is undefined (lint still returns an array).

- [ ] **Step 3: Implement**

In `figures-mcp/src/lint.ts`:

(a) Extend the types:

```ts
export type PathBox = { selector: string; points: [number, number][]; width: number; kind: "edge" | "leader" | "dimension" | "other" }
export type NodeBox = { selector: string; rect: { x: number; y: number; w: number; h: number }; hasText: boolean; intent: string | null }
export type LegendMark = { selector: string; style: string; inLegend: boolean }
export type Exemption = { rule: string; selector: string; reason: string }
export type LintResult = { passed: boolean; errors: LintError[]; exemptions: Exemption[] }

/**
 * Rules a `data-intent` may NEVER waive. Two are honesty (a fabricated number, a face we
 * did not ship), two are physics (text below 7pt cannot be read in print; content outside
 * the box is clipped at compile time). No creative intent requires any of them, so an
 * attempt to declare one is itself a finding.
 */
const ABSOLUTE_RULES = ["overflow", "min-type-size", "provenance", "font-allowlist"] as const
```

Add to `LintInput.manifest`: `paths?: PathBox[]`, `nodes?: NodeBox[]`, `legend?: LegendMark[]`, `intents?: Exemption[]` (reason+selector; `rule` is filled in when the exemption is consumed), `findings?: { rule: string; selector: string; blocked: string[] }[]`.

Add to `LintInput.meta`: `fonts?: string[]`.

(b) At the top of `lint()`, after `const errors: LintError[] = []`:

```ts
  const exemptions: Exemption[] = []
  const intents = new Map((input.manifest.intents ?? []).map((i) => [i.selector, i.reason]))
  /**
   * Honour a declared intent and RECORD it. The record is the safeguard: `lint.json` carries
   * every waiver, and figure_review is asked whether each one is justified — so an escape is
   * visible to a reviewer rather than a silent bypass.
   */
  const waived = (rule: string, selector: string) => {
    const reason = intents.get(selector)
    if (reason === undefined) return false
    exemptions.push({ rule, selector, reason })
    return true
  }
```

(c) Guard rule 7 and rule 12's radius. Replace the rule 7 body's failure line with:

```ts
  if (cats.size > 5 && !waived("palette", "figure"))
    err("palette", "figure", `${cats.size} categorical colors`, "<= 5 (from tokens.css)")
```

and in rule 12:

```ts
    if (e.borderRadius > 3 && !waived("web-chrome", e.selector))
      err("web-chrome", e.selector, `border-radius ${e.borderRadius}px`, "<= 3px (square corners)")
    // Shadows are absolute. No paper idiom needs one, so there is nothing to declare.
    if (e.boxShadow && e.boxShadow !== "none")
      err("web-chrome", e.selector, `box-shadow ${e.boxShadow.slice(0, 40)}`, "none")
```

(d) Rule 13 merges `meta.fonts`:

```ts
  // A deliberate extra face is an INPUT to the allowlist, declared in meta.yaml — not an
  // escape from the rule. The rule still catches an undeclared silent fallback, which is
  // the whole reason it exists.
  const allowed = [...(input.allowedFaces ?? SHIPPED_FACES), ...(input.meta.fonts ?? [])]
```

(e) Append rules 14–17 and the finding pass, after rule 13:

```ts
  const paths = input.manifest.paths ?? []
  const nodes = input.manifest.nodes ?? []

  // 14 stroke-over-text: a stroke through a glyph. Rule 1 compares text to text only, which
  // is why an arrow crossing "Reconstruction-distortion profiles" linted clean.
  //
  // A crossing is a defect in every visual idiom ever invented — no composition requires one
  // — but a strikethrough is real, so the escape is declared per path.
  for (const p of paths) {
    if (p.kind === "dimension") continue
    const clearance = p.width / 2 + 2
    const hit = texts.find((t) => {
      if (inMath(t)) return false // KaTeX positions glyph boxes; its own internals are not ink to route around
      for (let i = 0; i + 1 < p.points.length; i++)
        if (segmentHitsRect(p.points[i], p.points[i + 1], t.rect, clearance)) return true
      return false
    })
    if (hit && !waived("stroke-over-text", p.selector))
      err("stroke-over-text", p.selector, `crosses ${hit.selector} ("${hit.text.slice(0, 24)}")`, "route around text")
  }

  // 15 dangling-edge: an endpoint attached to nothing. A leader deliberately points at a
  // region rather than a node, so leaders and dimensions are exempt by kind, not by declaration.
  const NEAR = 3
  const touchesANode = (pt: [number, number]) =>
    nodes.some((n) => {
      const r = n.rect
      const dx = Math.max(r.x - pt[0], 0, pt[0] - (r.x + r.w))
      const dy = Math.max(r.y - pt[1], 0, pt[1] - (r.y + r.h))
      return Math.hypot(dx, dy) <= NEAR
    })
  for (const p of paths) {
    if (p.kind !== "edge" || p.points.length < 2) continue
    for (const pt of [p.points[0], p.points[p.points.length - 1]])
      if (!touchesANode(pt) && !waived("dangling-edge", p.selector))
        err("dangling-edge", p.selector, `endpoint (${pt[0].toFixed(0)},${pt[1].toFixed(0)}) touches no node`, `within ${NEAR}px of a node edge`)
  }

  // 16 empty-node: a node with no text. The two 9px squares that shipped in Fig. 3 were
  // `.port` elements the author drew to manufacture anchor targets, because arrow() could
  // only anchor to whole-box edges. Ports now make that unnecessary; the rule makes it visible.
  for (const n of nodes) {
    const area = n.rect.w * n.rect.h
    if (area <= 100 || n.hasText) continue
    if (n.intent !== null) {
      exemptions.push({ rule: "empty-node", selector: n.selector, reason: n.intent })
      continue
    }
    err("empty-node", n.selector, `${n.rect.w.toFixed(0)}x${n.rect.h.toFixed(0)}px, no text`, "text content, or data-intent")
  }

  // 17 orphan-legend: a legend entry for a mark the figure does not contain. A legend that
  // describes an absent mark is a false statement about the figure, which puts it in the
  // same family as provenance rather than in the same family as taste.
  const legend = input.manifest.legend ?? []
  const realStyles = new Set(legend.filter((m) => !m.inLegend).map((m) => m.style))
  for (const m of legend) {
    if (!m.inLegend || realStyles.has(m.style)) continue
    if (!waived("orphan-legend", m.selector))
      err("orphan-legend", m.selector, `style ${m.style} matches no mark`, "a mark drawn in the figure")
  }

  // Router findings. A blocked route renders and reports: a throw would leave the model
  // with no picture to look at and nothing actionable.
  for (const f of input.manifest.findings ?? [])
    err(f.rule, f.selector, f.blocked.length ? `blocked by ${f.blocked.join(", ")}` : "degenerate", "a clear route")

  // An intent aimed at an absolute rule. Checked LAST so `errors` is complete.
  const raised = new Set(errors.map((e) => `${e.rule}\u0000${e.selector}`))
  for (const [selector, reason] of intents)
    for (const rule of ABSOLUTE_RULES)
      if (raised.has(`${rule}\u0000${selector}`))
        err(
          "intent-not-permitted",
          selector,
          `data-intent="${reason}" against ${rule}`,
          `${rule} has no exemption — fix the figure`,
        )

  return { passed: errors.length === 0, errors, exemptions }
```

(f) Export `segmentHitsRect` from `route.ts` into `lint.ts` by adding at the top:

```ts
import { segmentHitsRect } from "./route"
```

(g) Change the signature: `export function lint(input: LintInput): LintResult`.

- [ ] **Step 4: Update every caller**

In `figures-mcp/src/server.ts`, the `figure_lint` handler writes `lint.json`. Change it to write the new shape:

```ts
    const result = lint({ ... })
    writeFileSync(join(dir, "build", "lint.json"), JSON.stringify(result, null, 1))
```

and its response text to report `result.errors.length` and, when non-empty, `result.exemptions`.

Run `cd figures-mcp && bunx tsgo --noEmit` (or `bun run typecheck` if defined) and fix every call site the compiler flags — existing tests that did `lint(x).length` become `lint(x).errors.length`.

- [ ] **Step 5: Run the whole suite**

Run: `cd figures-mcp && bun test`
Expected: PASS, with the new lint tests green and every pre-existing test updated to the object shape.

- [ ] **Step 6: Commit**

```bash
git add Paperino/figures-mcp/src/lint.ts Paperino/figures-mcp/src/server.ts Paperino/figures-mcp/test/lint.test.ts
git commit -m "feat(figures): four geometry rules and one declared-intent escape"
```

---

### Task 6: Scaffold a canvas, not a mould

**Files:**
- Create: `figures-mcp/src/templates/canvas/figure.html`
- Modify: `figures-mcp/src/scaffold.ts`, `figures-mcp/src/server.ts`
- Test: `figures-mcp/test/scaffold.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `scaffold(opts)` gains `from?: string`. Absent → the canvas. Present → the named archetype template, as today.

- [ ] **Step 1: Write the failing test**

```ts
const META = { caption: "c", alt: "a", claim: "k" }

test("scaffold emits a canvas by default and a template on request", async () => {
  await scaffold({ workspace: ws, name: "plain", archetype: "schematic", width: "column", ...META })
  const html = readFileSync(join(ws, "figures", "plain", "figure.html"), "utf8")
  expect(html).toContain('id="fig-root"')
  expect(html).toContain("tokens.css")
  expect(html).toContain("annot.js")
  // No pre-built structure: the model composes.
  expect(html).not.toContain("panel-head")

  await scaffold({ workspace: ws, name: "tpl", archetype: "schematic", width: "column", from: "schematic", ...META })
  expect(readFileSync(join(ws, "figures", "tpl", "figure.html"), "utf8")).toContain("panel-label")
})
```

- [ ] **Step 2: Confirm it fails**

Run: `cd figures-mcp && bun test test/scaffold.test.ts` → FAIL (`from` unknown; default copies the schematic template).

- [ ] **Step 3: Write the canvas**

Create `figures-mcp/src/templates/canvas/figure.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    /* Layout is yours. tokens.css owns colour, type and stroke — never restate them here.
       Mark every box you will connect with data-node: the router treats those as obstacles,
       so an edge is guaranteed to clear them.
       Symbols go in .math spans. Square corners, no shadows, no UI fonts. */
    #fig-root { padding: 10px 12px; }
  </style>
</head>
<body>
  <div id="fig-root"></div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { arrow, edge, fan, place, label, dimension, brace, highlight, figReady } from "../lib/annot.js"
    await renderMath()
    figReady()
  </script>
</body>
</html>
```

- [ ] **Step 4: Branch in scaffold.ts**

In `figures-mcp/src/scaffold.ts`, replace the html-engine template copy with:

```ts
    // A template is a starting point the author may ASK for, not a mould they must fill.
    // Defaulting to one is what made every schematic a two-column plate with a panel-head
    // rule, whatever the figure actually needed.
    const template = opts.from ?? "canvas"
    cpSync(join(TEMPLATES, template, "figure.html"), join(figureDir, "figure.html"))
```

and thread `from?: string` through the options type.

- [ ] **Step 5: Add `from` to the tool and ship the catalogue**

In `figures-mcp/src/server.ts`, add to `figure_scaffold`'s input schema:

```ts
      from: z
        .enum(["canvas", "schematic", "chart", "table", "gallery"])
        .optional()
        .describe(
          "Optional STARTING POINT. Omit for a blank canvas — you compose the layout, which is " +
            "usually what a specific figure needs. Name an archetype only to start from its structure.",
        ),
```

and append the catalogue to the scaffold response text:

```ts
      "",
      "PRIMITIVES (lib/annot.js). You name intent; the page resolves geometry from measured layout:",
      "  arrow(from, to, {port, to, route, bow, tone, style, head})",
      "     port/to: 'right' or 'right:0.3' — a fraction along that side. Two edges into one tall",
      "     node at :0.3 and :0.7 need no helper elements. The route clears every [data-node]",
      "     and every text rect automatically; you never compute a path.",
      "  edge(from, [waypoints], to)   polyline through selectors or [fx,fy] fractions",
      "  fan(from, [targets])          one source to many, ports distributed",
      "  place(sel, {near, gap})       position without overlapping anything",
      "  label(sel, text, {leader})    callout, optionally with a leader line",
      "  dimension(a, b, {text})       measured span with end ticks",
      "  brace(sel), highlight(sel)",
      "",
      "MARK your connectable boxes with data-node — that is what the router avoids.",
      "",
      "If a rule blocks something you meant, declare it: data-intent=\"<reason>\" on the element",
      "or path. It is recorded in lint.json and the review is asked to justify it. It does NOT",
      "waive provenance, the 7pt floor, overflow or the font allowlist — those have no exemption.",
```

- [ ] **Step 6: Run the tests**

Run: `cd figures-mcp && bun test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add Paperino/figures-mcp/src/templates/canvas/figure.html Paperino/figures-mcp/src/scaffold.ts Paperino/figures-mcp/src/server.ts Paperino/figures-mcp/test/scaffold.test.ts
git commit -m "feat(figures): scaffold a canvas with a primitive catalogue"
```

---

### Task 7: Review asks about composition, not conformity

**Files:**
- Modify: `figures-mcp/src/server.ts`
- Test: `figures-mcp/test/server.test.ts` (extend, or add `test/review.test.ts`)

**Interfaces:**
- Consumes: `lint.json`'s new `exemptions` array (Task 5).
- Produces: no API change; the rubric string changes.

- [ ] **Step 1: Write the failing test**

```ts
test("the rubric asks about composition and does not present exemplars as a target", () => {
  const rubric = buildRubric({ claim: "c", caption: "p", engine: "html" }, [
    { rule: "empty-node", selector: "#slot", reason: "unfilled slot" },
  ])
  expect(rubric).toContain("dominant reading direction")
  expect(rubric).toContain("visible ink")
  expect(rubric).toContain("exactly one job")
  expect(rubric).toContain("#slot")
  expect(rubric).toContain("craft reference")
  // The v2/v3 framing is retired: steering composition toward a fixed picture is a ceiling.
  expect(rubric).not.toContain("exemplars of the bar")
})
```

This requires extracting the rubric into an exported `buildRubric(meta, exemptions)` — do that as part of the implementation.

- [ ] **Step 2: Confirm it fails**

Run: `cd figures-mcp && bun test test/review.test.ts` → FAIL (`buildRubric` not exported).

- [ ] **Step 3: Implement**

Extract and rewrite in `figures-mcp/src/server.ts`:

```ts
/**
 * The reference images are CRAFT references, not compositional targets. v2/v3 introduced them
 * as "exemplars of the bar" and steered every figure toward them — which caps a figure at
 * "similar to the reference" when the goal is "right for this claim". Composition is judged
 * against the caption and the claim; the images only show how a paper figure is SET.
 */
export function buildRubric(
  meta: { claim: string; caption: string; engine?: string },
  exemptions: { rule: string; selector: string; reason: string }[],
): string {
  const lines = [
    `CLAIM this figure must demonstrate: "${meta.claim}"`,
    `Caption: "${meta.caption}"`,
    "",
    "Review the FIRST image (the render) against the claim and caption. The other two images are",
    "a craft reference — how a paper figure is set: stroke weights, type density, scale next to a",
    "caption. Do NOT imitate their composition. A better composition for this claim is the goal.",
    'Answer as JSON: {"demonstrates_claim": bool, "issues": [{"severity", "selector", "problem", "fix"}], "readable_at_50pct": bool}',
    "",
    "STRUCTURE",
    "- Is there one dominant reading direction, and does the geometry state it?",
    "- Does every edge leave and enter visible ink?",
    "- Is each colour doing exactly one job? Identity and flow on the same hue reads as neither.",
    "- Is any stroke present that carries no information?",
    "- Is the element the caption is about the most salient thing?",
    "- Is anything encoded twice (colour AND position for one variable)?",
    "",
    "EXECUTION",
    "- Would a reviewer notice this was NOT made with TikZ/pgfplots? A web-app look = reject.",
    "- Any pseudo-math (sigma_ch, x^2 as plain text)? Every symbol goes in a .math span.",
    "- Minimal in-figure prose: the caption explains, the figure shows. Panels are (a), (b).",
    "- Is this the RIGHT ENGINE? A plot drawn as boxes, or a diagram forced onto axes, is a",
    "  wrong-engine failure: say so and re-scaffold on the other engine rather than patching.",
    "- Would it survive at 50% scale? In greyscale?",
  ]
  if (exemptions.length) {
    lines.push(
      "",
      "DECLARED EXEMPTIONS — each waived a lint rule. Judge whether the reason actually holds;",
      "say so in `issues` if it does not:",
      ...exemptions.map((e) => `- ${e.selector} waived ${e.rule}: "${e.reason}"`),
    )
  }
  lines.push(
    "",
    "If issues remain, patch figure.html by selector and rerun figure_render + figure_lint.",
    "Max 4 iterations, then stop and surface to the user.",
  )
  return lines.join("\n")
}
```

Then in the `figure_review` handler, replace the inline rubric with `buildRubric(meta, lintResult.exemptions ?? [])`.

- [ ] **Step 4: Run the tests**

Run: `cd figures-mcp && bun test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add Paperino/figures-mcp/src/server.ts Paperino/figures-mcp/test/review.test.ts
git commit -m "feat(figures): review judges composition against the claim, not the exemplar"
```

---

### Task 8: Re-author the schematic exemplar

**Files:**
- Modify: `figures-mcp/test/author-exemplars.ts`
- Regenerate: `figures-mcp/src/assets/exemplars/exemplar-schematic.png`
- Modify: `figures-mcp/src/assets/tokens.css` (marker → `v4.0`)

**Interfaces:**
- Consumes: every primitive from Task 3.
- Produces: an exemplar that demonstrates ports, routing and ink anchoring — and passes rules 14–17, which `author-exemplars.ts` already gates.

- [ ] **Step 1: Bump the vendored marker**

`figures-mcp/src/assets/tokens.css` line 1:

```css
/* paperino-tokens v4.0 venue=PLACEHOLDER */
```

This is what re-vendors the new `annot.js` + `route.js` into workspaces created under v3. Update the two tests that pin the marker string (they pinned `v3.0 venue=neurips` in the v3 work).

- [ ] **Step 2: Re-author the schematic exemplar**

In `figures-mcp/test/author-exemplars.ts`, replace the schematic exemplar's body with a 1→2→2 fan that exercises the new surface. It must:

- mark every box `data-node`
- use `fan()` from one source to two evidence blocks
- use `arrow(..., { port: 'right:0.3' })` and `{ port: 'right:0.7' }` into one tall node
- include one borderless node, to demonstrate ink anchoring
- contain **no** decorative rules, **no** spacer divs, **no** legend
- set math at `--fs-body`, not `--fs-label`

The structural skeleton — exact CSS values are iterated against the render, which is inherent:
a figure cannot be authored blind, and that is this spec's whole premise.

```html
<div id="fig-root">
  <div class="stage">
    <div class="node" data-node id="capture"><strong>Pre-RoPE capture</strong></div>
  </div>
  <div class="stage">
    <!-- borderless on purpose: exercises ink anchoring, since its layout box extends to the
         column edge while its ink stops at the text -->
    <div class="evidence" data-node id="distortion">
      <strong>Distortion profiles</strong>
      <span class="math">\mathcal{D}_K^{(\ell)}(b)</span>
    </div>
    <div class="evidence" data-node id="scores">
      <strong>Channel scores</strong>
      <span class="math">s_{K,d}^{(\ell)}</span>
    </div>
  </div>
  <div class="stage">
    <div class="node tall" data-node id="policy"><strong>Compression policy</strong></div>
  </div>
</div>
<script type="module">
  import { renderMath } from "../lib/math.js"
  import { arrow, fan, figReady } from "../lib/annot.js"
  await renderMath()
  fan("#capture", ["#distortion", "#scores"], { tone: "ref" })
  // Two edges into ONE tall node — the case that made an author draw fake 9px port squares.
  arrow("#distortion", "#policy", { port: "right", to: "left:0.3", tone: "ref" })
  arrow("#scores", "#policy", { port: "right", to: "left:0.7", tone: "ref" })
  figReady()
</script>
```

- [ ] **Step 3: Regenerate and LOOK AT THE PNG**

Run: `cd figures-mcp && bun test/author-exemplars.ts`
Expected: exemplars written, and the lint gate passes for each.

Then **open `src/assets/exemplars/exemplar-schematic.png` and look at it.** Per CLAUDE.md this step is not optional: the unlabelled top gridline shipped for weeks and the log-minor-tick axis shipped too, both passing every test. Check specifically: does every arrow visibly touch both boxes? Is there any stroke crossing a glyph? Any box without content? Is there a single reading direction?

- [ ] **Step 4: Run the full suite**

Run: `cd figures-mcp && bun test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add Paperino/figures-mcp/test/author-exemplars.ts Paperino/figures-mcp/src/assets/exemplars Paperino/figures-mcp/src/assets/tokens.css
git commit -m "feat(figures): re-author the schematic exemplar on the v4 primitives"
```

---

### Task 9: Acceptance — the rules must fail the figures that motivated them

**Files:**
- Create: `figures-mcp/test/regression-turboquant.test.ts`
- Modify: `C:/Users/azamk/Documents/TurboQuant-Research/figures/method-overview-plate/figure.html`
- Modify: `C:/Users/azamk/Documents/TurboQuant-Research/figures/adaptive-allocation-vector/figure.html`

**Interfaces:**
- Consumes: everything above.
- Produces: proof.

**A rule that does not fail the figure that motivated it is not implemented.** This task establishes that before anything is rewritten.

- [ ] **Step 1: Write the regression test against the ORIGINAL sources**

Copy the two current `figure.html` files into `figures-mcp/test/fixtures/regression/` first, so the evidence is version-controlled and does not depend on the user's paper directory. Then:

```ts
import { expect, test } from "bun:test"

// The two schematics that motivated v4 both recorded {"passed": true, "errors": []} under
// the 13-rule linter. These fixtures are their sources, frozen. If v4 ever stops failing
// them, a geometry rule has regressed.
test("v4 fails the shipped Fig. 2 for the arrow through the text block", async () => {
  const result = await renderAndLint("regression/method-overview-plate")
  const rules = result.errors.map((e) => e.rule)
  expect(rules).toContain("stroke-over-text")
  expect(result.passed).toBe(false)
})

test("v4 fails the shipped Fig. 3 for its empty port squares", async () => {
  const result = await renderAndLint("regression/adaptive-allocation-vector")
  const rules = result.errors.map((e) => e.rule)
  // The .port elements are 9x9 = 81px^2, under the 100px^2 node floor, so empty-node does
  // NOT fire on them. What fires is dangling-edge: the arrows terminate on elements that are
  // not declared nodes at all.
  expect(rules).toContain("dangling-edge")
  expect(result.passed).toBe(false)
})
```

> **Note for the implementer:** if `empty-node` does not fire on the 9×9 ports because of the 100px² floor, that is correct and the test above already accounts for it. Do **not** lower the floor to make a rule fire — a 9×9 mark is a tick, and lowering the floor would fail every legitimate tick and rule. `dangling-edge` is the rule that catches this case, because the ports were never `[data-node]`.

- [ ] **Step 2: Run it — it must fail the fixtures**

Run: `cd figures-mcp && bun test test/regression-turboquant.test.ts`
Expected: PASS (i.e. the fixtures are confirmed failing). If a rule does not fire, fix the rule before proceeding — not the test.

- [ ] **Step 3: Re-author Fig. 2**

Rewrite `method-overview-plate/figure.html` as the 1→2→2 fan:

- columns are pipeline stages, rows are the K/V split, so **every arrow runs left→right** and no edge needs to pass a box
- `data-node` on capture, both evidence blocks, both policy boxes
- `fan("#capture", ["#distortion", "#scores"])`
- delete `<div class="empty">`, both `.panel-head` bottom rules, and the `.bit-pairs` legend
- flow arrows in neutral ink; blue/red stay reserved for Key/Value identity
- math at `--fs-body`

Then: `figure_render` → `figure_lint` → look at the PNG.

- [ ] **Step 4: Re-author Fig. 3**

Rewrite `adaptive-allocation-vector/figure.html`:

- delete `.ports`, `.port`, `#key-port`, `#value-port` entirely
- replace with `arrow("#key-profile", "#optimizer", { port: "right", to: "left:0.3" })` and `arrow("#value-profile", "#optimizer", { port: "right", to: "left:0.7" })`
- delete the `.pair-lines` legend
- give `arrow("#optimizer", "#assignment")` an explicit `tone` so it stops defaulting to a third colour

Then: `figure_render` → `figure_lint` → look at the PNG.

- [ ] **Step 5: Verify in the app, not only in the tests**

Launch `Paperino\opencode-dev\paperino-dev.cmd`, open the TurboQuant workspace, and confirm the recompiled `main.pdf` shows both figures correctly in the Preview panel. CLAUDE.md is explicit that the Tectonic path bug, the unmounted panel and the JPEG extension all passed tests and failed in the app.

- [ ] **Step 6: Commit**

```bash
git add Paperino/figures-mcp/test/regression-turboquant.test.ts Paperino/figures-mcp/test/fixtures/regression
git commit -m "test(figures): pin the two figures that motivated v4 as failing fixtures"
```

The re-authored figures live in `TurboQuant-Research/`, which is a separate untracked directory — commit them only if that project is under version control.

---

## Post-implementation

- [ ] Update `Paperino/CLAUDE.md`: a `### The v4 diagram router` subsection under `## figures-mcp` recording the traps — the manifest had stroke widths but no geometry, `.port` squares as a symptom of missing multi-port anchoring, the layout-box-vs-ink anchor, `data-intent`'s absolute-rule boundary, and that `route.ts` is compiled into `lib/route.js` rather than hand-ported.
- [ ] Update the memory file `project_paperino.md` with the v4 milestone.
- [ ] Rebuild the installer if this is to ship: `OPENCODE_CHANNEL=prod bun run prebuild && bun run build && bun run package:win` in `packages/desktop`. `prebuild` runs `build-dist.ts`, which now regenerates `route.js` first.
