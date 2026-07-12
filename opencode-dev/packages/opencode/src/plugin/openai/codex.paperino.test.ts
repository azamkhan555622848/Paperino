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

// The verdicts below are not preferences — they are what chatgpt.com/backend-api/codex/responses
// answered to a one-token request per id on a real ChatGPT account (2026-07-13). A refused model
// that stays in the picker fails SILENTLY: the user sends a message and simply gets nothing back.
test("the gate admits exactly the models the subscription actually serves", () => {
  // Clear the > 5.4 version rule on their own, and the backend streams a response.
  expect(gate("gpt-5.6-terra")).toBe(true)
  expect(gate("gpt-5.6-sol")).toBe(true)
  // Allowlisted, and served.
  expect(gate("gpt-5.5")).toBe(true)
})

test("the gate hides every model the subscription refuses", () => {
  // 404 "Model not found" — offered by the picker, and the cause of an empty reply.
  expect(gate("gpt-5.6-luna")).toBe(false)
  // 400 "not supported when using Codex with a ChatGPT account".
  expect(gate("gpt-5.6")).toBe(false)
  expect(gate("gpt-5.3-codex")).toBe(false)
  // Allowlisted by UPSTREAM, and still refused by the account — so it must be named explicitly.
  expect(gate("gpt-5.3-codex-spark")).toBe(false)
})

test("the gate still rejects what upstream rejects", () => {
  expect(gate("gpt-5.5-pro")).toBe(false)
  expect(gate("gpt-4o")).toBe(false)
})
