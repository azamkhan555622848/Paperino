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

test("the checked-in copy is in sync with route.ts", async () => {
  // The drift the build step exists to prevent, and the one thing existence cannot catch:
  // route.ts edited, `build:lib` not re-run, route.test.ts still passing against the TS while
  // the browser loads yesterday's JS. Compiling through the SCRIPT rather than a second
  // Bun.build call here is deliberate — a duplicated build config drifts the same way.
  // If this fails, run `bun run build:lib` and commit the result.
  const { buildRouteLib } = await import("../scripts/build-lib")
  expect(readFileSync(LIB, "utf8")).toBe(await buildRouteLib())
})
