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

/**
 * A detour is bounded by how far it travels. Past 4x the direct port-to-port distance it is
 * not a route a reader follows, it is a trek across the figure — and drawn, it leaves the
 * figure box, which is rule 2. Without this cap NO finite obstacle is ever unroutable: a
 * 400px wall between two 60px nodes gets "routed around" at x = -8, a 466px path for a 90px
 * edge, and `kind: "blocked"` becomes unreachable. An obstacle wide enough to force that is
 * reported instead, which hands the author the blocker's name; `edge()` with explicit
 * waypoints is there for the author who genuinely wants the long way round.
 */
export const DETOUR_LENGTH_LIMIT = 4

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
  /**
   * What the chosen route still intersects — obstacle selectors, plus `TEXT_BLOCKER` when a
   * text rect is what is in the way. Empty when clear, and NEVER empty when `kind` is
   * `"blocked"`: the reason is reported to the author, and a blocked route with an empty list
   * reads downstream as "degenerate", which sends them hunting a too-short edge that does not
   * exist. Text rects come from the manifest walk and carry no selector, hence the marker.
   */
  blocked: string[]
  degenerate: boolean
}

/** Stand-in selector for a text rect, which has none. See `RouteResult.blocked`. */
export const TEXT_BLOCKER = "a text label"

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
  // Displacing a route means moving its free corridor, and WHICH axis is free depends on the
  // route's shape. A straight edge has no corridor at all, so a lane offset has to bend it
  // ACROSS the flow: for a right→left pair the flow is x, so the jog parameter is y. Offset
  // the along-flow axis instead — which is what `hvh(midX + shift)` does to a right→left
  // pair sharing a y — and the "shifted" route is collinear with the original: a different
  // points array carrying identical ink.
  const acrossFlow = (v: number): Point[] => (horizontal(pa.side) ? vhv(midY + v) : hvh(midX + v))

  type Candidate = {
    points: Point[]
    kind: RouteResult["kind"]
    /**
     * Re-make this route with its free corridor moved by `delta`. Lane separation uses it.
     * `null` means IMMOVABLE, and the straight candidate under `mode: "straight"` is exactly
     * that: every displacement of a straight edge is a bend, so a lane offset would hand back
     * a 4-point Z reported as "ortho" — a different figure element, not a nudge. Two straight
     * edges in one gutter therefore stay coincident. That is the author's declared geometry;
     * silently redrawing it is the thing `mode: "straight"` exists to forbid.
     */
    shift: ((delta: number) => Point[]) | null
  }
  const candidates: Candidate[] = []
  // mode 'straight' means straight or nothing — an author who asked for a straight edge gets
  // a reported blocker, not a silent Z they did not ask for. That holds for lane separation
  // too, which is why the shift is withheld rather than the Z candidates merely being skipped.
  if (input.mode !== "ortho")
    candidates.push({ points: [a, b], kind: "straight", shift: input.mode === "straight" ? null : acrossFlow })
  if (input.mode !== "straight") {
    const z: Candidate = { points: hvh(midX), kind: "ortho", shift: (d) => hvh(midX + d) }
    const zAlt: Candidate = { points: vhv(midY), kind: "ortho", shift: (d) => vhv(midY + d) }
    if (horizontal(pa.side)) candidates.push(z, zAlt)
    else candidates.push(zAlt, z)
  }

  const obstacleRects = obstacles.map((o) => o.rect)
  const score = (points: Point[]) =>
    polylineHits(points, obstacleRects, clearance) + polylineHits(points, textRects, clearance)

  // Detours: run the corridor past a blocker's free side rather than between the two anchors.
  // `gap` keeps the turn off the obstacle's edge by more than the clearance.
  //
  // TEXT RECTS ARE BLOCKERS HERE, not only in `score`. A route that clears every node while
  // slicing a caption has not been routed — that is rule 14, and it is the exact defect this
  // module exists for. Only what a candidate actually hits earns a detour, so a glyph on the
  // far side of the figure cannot conjure one.
  const gap = clearance + 6
  const limit = Math.hypot(b[0] - a[0], b[1] - a[1]) * DETOUR_LENGTH_LIMIT
  if (input.mode !== "straight") {
    const blockers = [...obstacleRects, ...textRects].filter((r) =>
      candidates.some((c) => polylineHits(c.points, [r], clearance) > 0),
    )
    const detour = (at: number, make: (v: number) => Point[]) => {
      const points = make(at)
      if (length(points) > limit) return
      candidates.push({ points, kind: "detour", shift: (d) => make(at + d) })
    }
    for (const r of blockers) {
      if (horizontal(pa.side)) {
        detour(r.y - gap, vhv)
        detour(r.y + r.h + gap, vhv)
      } else {
        detour(r.x - gap, hvh)
        detour(r.x + r.w + gap, hvh)
      }
    }
  }

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
  const shift = best.shift
  if (bestScore > 0) {
    kind = "blocked"
  } else if (lanes.length && shift) {
    // Lane separation. A route sharing ink with N already-drawn corridors steps N lanes off,
    // sign alternating so a bundle spreads both ways instead of marching in one direction.
    // Deterministic, per the spec: no packing search.
    //
    // What is deliberately NOT required is that the shifted route stop touching the earlier
    // corridor. Two edges leaving the SAME anchor share that point by construction, so
    // "lane-clear" is unreachable and iterating until it holds just burns every attempt and
    // leaves the pair coincident — the overlap lanes exist to fix. What IS required is that
    // the shifted route still clear every obstacle and every text rect: a lane that cures an
    // overlap by running through a node is not a cure. If the natural lane is blocked, fall
    // back through the nearer ones rather than returning a route nothing checked.
    let occupied = 0
    for (const l of lanes) if (polylineHits(points, corridorRects(l), 0) > 0) occupied++
    const step = (input.strokeWidth ?? 1) * LANE_STEP_FACTOR
    for (let lane = occupied; lane >= 1; lane--) {
      const shifted = shift(lane * step * (lane % 2 === 0 ? -1 : 1))
      if (score(shifted) > 0) continue
      points = shifted
      // A displaced straight is a Z now; reporting it as "straight" would misdescribe the ink.
      if (kind === "straight" && shifted.length > 2) kind = "ortho"
      break
    }
  }

  const blocked: string[] = []
  if (bestScore > 0) {
    for (const o of obstacles) if (polylineHits(points, [o.rect], clearance) > 0) blocked.push(o.selector)
    // Text is a blocker in `score` and in the detour set, so it must be a blocker in the
    // report as well — a caption across the gutter is the single most common thing that makes
    // an edge unroutable, and it is the one blocker with no selector to name.
    if (polylineHits(points, textRects, clearance) > 0) blocked.push(TEXT_BLOCKER)
  }
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
