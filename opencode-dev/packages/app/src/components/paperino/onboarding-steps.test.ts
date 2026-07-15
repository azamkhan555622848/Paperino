import { describe, expect, test } from "bun:test"
import { KEY_PROVIDERS, nextStep, wizardSteps } from "./onboarding-steps"

describe("wizardSteps", () => {
  test("a packaged install is offered the runtime downloads", () => {
    expect(wizardSteps(true)).toEqual([
      "welcome",
      "tour-preview",
      "runtime",
      "tour-models",
      "chatgpt",
      "tour-citations",
      "paperclip",
      "tour-figures",
      "figure-key",
    ])
  })

  test("a dev run is not — Chromium and Python already come from the repo", () => {
    expect(wizardSteps(false)).toEqual([
      "welcome",
      "tour-preview",
      "tour-models",
      "chatgpt",
      "tour-citations",
      "paperclip",
      "tour-figures",
      "figure-key",
    ])
  })
})

describe("nextStep", () => {
  // Each tour slide leads into the setup step it motivates — that pairing IS the design,
  // so it is pinned move by move rather than as an array shape.
  test("walks the packaged order", () => {
    expect(nextStep("welcome", true)).toBe("tour-preview")
    expect(nextStep("tour-preview", true)).toBe("runtime")
    expect(nextStep("runtime", true)).toBe("tour-models")
    expect(nextStep("tour-models", true)).toBe("chatgpt")
    expect(nextStep("chatgpt", true)).toBe("tour-citations")
    expect(nextStep("tour-citations", true)).toBe("paperclip")
    expect(nextStep("paperclip", true)).toBe("tour-figures")
    expect(nextStep("tour-figures", true)).toBe("figure-key")
  })

  test("skips runtime in dev rather than dead-ending on it", () => {
    expect(nextStep("tour-preview", false)).toBe("tour-models")
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
