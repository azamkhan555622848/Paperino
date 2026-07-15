import { describe, expect, test } from "bun:test"
import { KEY_PROVIDERS, nextStep, wizardSteps } from "./onboarding-steps"

describe("wizardSteps", () => {
  test("a packaged install is offered the runtime downloads", () => {
    expect(wizardSteps(true)).toEqual(["welcome", "runtime", "chatgpt", "paperclip", "figure-key"])
  })

  test("a dev run is not — Chromium and Python already come from the repo", () => {
    expect(wizardSteps(false)).toEqual(["welcome", "chatgpt", "paperclip", "figure-key"])
  })
})

describe("nextStep", () => {
  test("walks the packaged order", () => {
    expect(nextStep("welcome", true)).toBe("runtime")
    expect(nextStep("runtime", true)).toBe("chatgpt")
    expect(nextStep("chatgpt", true)).toBe("paperclip")
    expect(nextStep("paperclip", true)).toBe("figure-key")
  })

  test("skips runtime in dev rather than dead-ending on it", () => {
    expect(nextStep("welcome", false)).toBe("chatgpt")
  })

  test("the last step ends the wizard", () => {
    expect(nextStep("figure-key", true)).toBeUndefined()
    expect(nextStep("figure-key", false)).toBeUndefined()
  })
})

// The wizard writes the pasted key under these ids, and paperbanana-mcp's resolve_credentials()
// reads it back out of auth.json by the same names. If they ever drift, the user pastes a key into
// a store nothing looks in — and the failure surfaces a minute later as "no figure-generation key".
test("the key providers are the ids paperbanana reads", () => {
  expect(KEY_PROVIDERS.map((p) => p.id)).toEqual(["openrouter", "google"])
  for (const provider of KEY_PROVIDERS) expect(provider.url).toStartWith("https://")
})
