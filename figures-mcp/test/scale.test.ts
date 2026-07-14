import { expect, test } from "bun:test"
// scale.js is a browser module, but only derived() touches the DOM — the scale maths
// imports cleanly under bun.
import { niceDomain, scaleLinear } from "../src/assets/lib/scale.js"

// The bug this pins: niceStep used to round a raw step UP to the next of 1/2/5/10, so
// niceStep(2) was 5. A chart with a [0, 8] domain asking for 4 ticks therefore got
// [0, 5] — the step did not divide the domain, the top gridline was never labelled, and
// no bar's value could be read off the axis. The exemplar shipped in exactly that state.
test("the top of a niceDomain is always a labelled tick", () => {
  // Every max a real chart is likely to carry: awkward decimals, round numbers, orders
  // of magnitude apart. Each must produce an axis whose top is readable.
  const maxima = [0.35, 1, 1.4, 3, 4.2, 7.4, 8, 9.6, 12, 35, 55, 87, 100, 640, 1250]
  for (const max of maxima) {
    const domain = niceDomain([0, max], 4)
    const ticks = scaleLinear(domain, [0, 160]).ticks(4)
    expect(ticks.at(-1), `max=${max} domain=${JSON.stringify(domain)}`).toBe(domain[1])
    expect(ticks[0]).toBe(0)
    // Two ticks is an axis you cannot read a value off. Three is the floor.
    expect(ticks.length, `max=${max} produced ${JSON.stringify(ticks)}`).toBeGreaterThanOrEqual(3)
  }
})

test("niceDomain gives the tallest mark headroom unless it already sits on a tick", () => {
  // 7.4 must not map to the plot's top edge — that reads as a clipped bar.
  expect(niceDomain([0, 7.4], 4)[1]).toBeGreaterThan(7.4)
  // ...but a max that IS a tick boundary is left alone; inventing headroom above 100%
  // on a percentage axis is its own kind of wrong.
  expect(niceDomain([0, 100], 4)[1]).toBe(100)
})

test("ticks snap to the nearest of 1/2/5/10, not the next one up", () => {
  // raw step 2 -> 2 (it used to become 5, which is the whole bug)
  expect(scaleLinear([0, 8], [0, 160]).ticks(4)).toEqual([0, 2, 4, 6, 8])
  expect(scaleLinear([0, 100], [0, 160]).ticks(5)).toEqual([0, 20, 40, 60, 80, 100])
})
