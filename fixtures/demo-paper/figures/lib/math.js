// figures/lib/math.js — typeset every .math span with the vendored KaTeX (offline).
//
// Templates call `await renderMath()` BEFORE annotations and figReady(), so the bbox
// manifest and the PDF always see final glyph geometry. A .math span holds raw TeX:
//   <span class="math">\sigma^2_{\mathrm{ch}} \lesssim (d/g)\,\sigma^2_{\mathrm{vec}}</span>
// Add class "display" for display-mode math.
const here = new URL(".", import.meta.url)

export async function renderMath() {
  const spans = document.querySelectorAll(".math")
  if (spans.length === 0) return

  if (!document.getElementById("katex-css")) {
    const link = document.createElement("link")
    link.id = "katex-css"
    link.rel = "stylesheet"
    link.href = new URL("katex/katex.min.css", here).href
    document.head.appendChild(link)
    await new Promise((resolve) => {
      link.onload = resolve
      link.onerror = resolve
    })
  }

  const katex = (await import(new URL("katex/katex.mjs", here).href)).default
  for (const el of spans) {
    // throwOnError: a bad formula must fail the render loudly (render-worker surfaces
    // __FIG_ERROR__ / console), never paint garbage into a paper.
    katex.render(el.textContent, el, { throwOnError: true, displayMode: el.classList.contains("display") })
  }
  // KaTeX fonts load lazily as glyphs render; geometry is only final after this.
  await document.fonts.ready
}
