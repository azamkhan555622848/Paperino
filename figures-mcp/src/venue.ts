import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"

export type Venue = {
  id: string
  /** CSS family name AND the matplotlib family name — one string, so the two engines cannot drift. */
  textFace: string
  mathFontset: "cm" | "stix"
  inches: { narrow: number; full: number }
  px: { narrow: number; full: number }
}

// Print-true widths per venue: single column / full text width, in inches.
// 96dpi is Chromium's CSS-px-per-inch, which is what makes \includegraphics land ~1:1.
//
// The face matters as much as the width. v2 pinned KaTeX's Computer-Modern-derived
// faces, but IEEE, ACM, NeurIPS, ICML, ICLR and ACL all set body text in Times — so
// every figure in those papers was set in a different face from its own caption.
const DPI = 96
const VENUES: Record<string, { textFace: string; mathFontset: "cm" | "stix"; narrow: number; full: number }> = {
  ieee: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.5, full: 7.16 },
  acm: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.33, full: 7.0 },
  neurips: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.25, full: 5.5 },
  icml: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.25, full: 6.75 },
  iclr: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.25, full: 5.5 },
  acl: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.0, full: 6.3 },
  // Plain \documentclass{article}: Computer Modern, and KaTeX already ships those faces.
  article: { textFace: "KaTeX_Main", mathFontset: "cm", narrow: 3.25, full: 5.5 },
}

// neurips, because its 3.25/5.5in are exactly the 312/528px v2 hardcoded — an existing
// workspace with no `venue` key must not silently reflow every figure it already has.
const DEFAULT = "neurips"

export function resolveVenue(workspace: string): Venue {
  const file = join(workspace, "paperino.yaml")
  let id = DEFAULT
  if (existsSync(file)) {
    try {
      const named = parse(readFileSync(file, "utf8"))?.venue
      if (typeof named === "string" && VENUES[named.toLowerCase()]) id = named.toLowerCase()
    } catch {
      // A malformed paperino.yaml is the compile's problem to report, not the figure's:
      // refusing to draw a chart because the config has a typo helps nobody.
    }
  }
  const v = VENUES[id]
  return {
    id,
    textFace: v.textFace,
    mathFontset: v.mathFontset,
    inches: { narrow: v.narrow, full: v.full },
    px: { narrow: Math.round(v.narrow * DPI), full: Math.round(v.full * DPI) },
  }
}
