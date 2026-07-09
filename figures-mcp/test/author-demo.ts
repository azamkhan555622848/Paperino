// Acceptance driver: scaffolds the three demo-paper figures, then renders + lints
// whatever figure.html currently is. Run: bun test/author-demo.ts [scaffold|check] [name...]
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { scaffold, type Archetype } from "../src/scaffold"
import { render } from "../src/render"
import { lint } from "../src/lint"

const WS = "C:/Users/azamk/Documents/Paperino/fixtures/demo-paper"

const FIGURES: { name: string; archetype: Archetype; width: "narrow" | "full"; claim: string; caption: string }[] = [
  {
    name: "fig-jspace",
    archetype: "schematic",
    width: "full",
    claim: "J-space carries workspace-like content only at intermediate depths",
    caption: "Stylized illustration of the three structural properties of the J-space.",
  },
  {
    name: "fig-lens-gallery",
    archetype: "gallery",
    width: "full",
    claim: "The lens reveals interpretable intermediate readouts across tasks",
    caption: "J-lens readouts at intermediate layers on six different prompts.",
  },
  {
    name: "tab-results",
    archetype: "table",
    width: "narrow",
    claim: "GPU speedups grow with batch size",
    caption: "Measured speedups over the CPU reference implementation.",
  },
]

const mode = process.argv[2] ?? "check"
const only = process.argv.slice(3)

if (mode === "scaffold") {
  for (const f of FIGURES) {
    if (existsSync(join(WS, "figures", f.name))) {
      console.log(`skip ${f.name} (exists)`)
      continue
    }
    await scaffold(WS, f)
    console.log(`scaffolded ${f.name}`)
  }
  process.exit(0)
}

let failed = false
for (const f of FIGURES) {
  if (only.length && !only.includes(f.name)) continue
  const r = await render(WS, f.name)
  if (!r.ok) {
    failed = true
    console.log(`\n${f.name}: RENDER FAILED — ${r.error}`)
    console.log(r.consoleOutput.slice(0, 6).join("\n"))
    continue
  }
  const dir = join(WS, "figures", f.name)
  const errors = lint({
    source: readFileSync(join(dir, "figure.html"), "utf8"),
    meta: parse(readFileSync(join(dir, "meta.yaml"), "utf8")),
    data: JSON.parse(readFileSync(join(dir, "data.json"), "utf8")),
    manifest: JSON.parse(readFileSync(r.bboxes, "utf8")),
  })
  if (errors.length === 0) console.log(`\n${f.name}: RENDER ok, LINT clean -> ${r.pdf}`)
  else {
    failed = true
    console.log(`\n${f.name}: ${errors.length} lint error(s)`)
    for (const e of errors.slice(0, 12)) console.log(` - ${e.rule} ${e.selector}: ${e.actual} (expected ${e.expected})`)
  }
}
process.exit(failed ? 1 : 0)
