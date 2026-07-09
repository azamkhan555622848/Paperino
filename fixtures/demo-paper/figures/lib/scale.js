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
