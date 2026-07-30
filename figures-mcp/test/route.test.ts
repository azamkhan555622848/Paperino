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
