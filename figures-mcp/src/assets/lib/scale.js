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

// Expand a domain outward to tick boundaries — pgfplots' "enlarge limits". Without it
// the tallest mark maps exactly to the plot edge and reads as clipped, sticking past
// the last labelled gridline. Use as: scaleLinear(niceDomain([0, max]), range).
//
// Iterated to a fixed point, because widening the domain changes the step ticks() will
// pick from it: [0, 1250] snaps to [0, 1400] at step 200, but ticks() then re-derives
// 1400/4 -> step 500 and stops at 1000, leaving the top of the axis unlabelled. Looping
// until the domain is unchanged means it is a multiple of the SAME step ticks() computes,
// so the top is always a tick. It settles in two or three passes; the cap is a backstop.
export function niceDomain([d0, d1], count = 5) {
  let lo = d0
  let hi = d1
  for (let i = 0; i < 8; i++) {
    const step = niceStep((hi - lo) / Math.max(1, count) || 1)
    const nextLo = Math.floor(lo / step + 1e-9) * step
    const nextHi = Math.ceil(hi / step - 1e-9) * step
    if (nextLo === lo && nextHi === hi) break
    lo = nextLo
    hi = nextHi
  }
  return [lo, hi]
}

// Computed labels (axis ticks etc.) are not experiment numbers; stamp them so the
// provenance lint can exempt them.
export function derived(text) {
  const span = document.createElement("span")
  span.setAttribute("data-derived", "")
  span.textContent = String(text)
  return span
}

// Snap to the NEAREST of 1/2/5/10 (d3's ladder — thresholds are the geometric midpoints
// √2, √10, √50), not the next one up. Rounding up made niceStep(2) = 5, which is how a
// [0, 8] axis asked for 4 ticks and got [0, 5]: the step no longer divided the domain, so
// the top gridline could never be labelled and no bar's value was readable. It also keeps
// ticks() and niceDomain() in agreement — both snap the same raw step — which is what puts
// the top of a niceDomain on a tick instead of leaving it floating.
function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1))
  const norm = raw / mag
  return (norm >= Math.SQRT2 * 5 ? 10 : norm >= Math.sqrt(10) ? 5 : norm >= Math.SQRT2 ? 2 : 1) * mag
}
const round = (v) => Math.round(v * 1e6) / 1e6
