import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Which models a ChatGPT-subscription user is offered is decided by one filter in codex.ts: an
// explicit allowlist, an explicit denylist, then a version rule. That filter lives inside a plugin
// factory needing a live provider + auth context, so the rule itself is the seam — re-derive it
// from the source and assert on the ids Paperino actually ships.
function gate(id: string): boolean {
  const source = readFileSync(join(import.meta.dir, "codex.ts"), "utf8")
  const set = (name: string) =>
    new Set(
      [...source.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`))![1]!.matchAll(/"([^"]+)"/g)].map(
        (m) => m[1]!,
      ),
    )

  if (set("ALLOWED_MODELS").has(id)) return true
  if (set("DISALLOWED_MODELS").has(id)) return false
  const match = id.match(/^gpt-(\d+\.\d+)/)
  return match ? parseFloat(match[1]!) > 5.4 : false
}

test("the subscription gate admits the models Paperino ships", () => {
  // The 5.6 family clears the version rule on its own — no allowlist entry needed.
  for (const id of ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"]) expect(gate(id)).toBe(true)
  // 5.3 <= 5.4, so the newest Codex reaches a subscription user ONLY if it is allowlisted.
  expect(gate("gpt-5.3-codex")).toBe(true)
})

test("the gate still rejects what upstream rejects", () => {
  expect(gate("gpt-5.5-pro")).toBe(false)
  expect(gate("gpt-4o")).toBe(false)
})
