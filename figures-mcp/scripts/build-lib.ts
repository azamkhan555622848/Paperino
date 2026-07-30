#!/usr/bin/env bun
// Compiles src/route.ts to a browser ES module at src/assets/lib/route.js, so annot.js and
// test/route.test.ts run ONE implementation. Two hand-maintained copies of a geometry
// routine drift, and the drift is invisible: the tests keep passing against the TS while
// the browser runs the stale JS.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
export const OUT = join(root, "src", "assets", "lib", "route.js")

/**
 * The compiled module's exact bytes. Exported — and the write below guarded by
 * `import.meta.main` — so `test/build-lib.test.ts` can compile route.ts and compare against
 * the checked-in copy WITHOUT importing this file rewriting it: a staleness check whose own
 * import cures the staleness proves nothing, and a test with the side effect of editing
 * tracked source is worse than no test.
 */
export async function buildRouteLib(): Promise<string> {
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
  const banner = "// GENERATED from src/route.ts by scripts/build-lib.ts — do not edit.\n"
  return banner + (await result.outputs[0].text())
}

if (import.meta.main) {
  writeFileSync(OUT, await buildRouteLib())
  console.log("lib ready: src/assets/lib/route.js")
}
