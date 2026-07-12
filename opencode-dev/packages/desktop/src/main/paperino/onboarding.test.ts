import { expect, test } from "bun:test"
import { completeOnboarding, onboardingStatus, type OnboardingStore } from "./onboarding"

function fakeStore(initial: Record<string, unknown> = {}): OnboardingStore {
  const data = { ...initial }
  return { get: (key) => data[key], set: (key, value) => void (data[key] = value) }
}

test("the wizard is pending until it is completed", () => {
  const store = fakeStore()
  expect(onboardingStatus(store, true).pending).toBe(true)

  completeOnboarding(store)
  expect(onboardingStatus(store, true).pending).toBe(false)
})

test("only the literal true counts as done, so a half-written store re-runs the wizard", () => {
  expect(onboardingStatus(fakeStore({ "paperino.onboarding.complete": "yes" }), true).pending).toBe(true)
  expect(onboardingStatus(fakeStore({ "paperino.onboarding.complete": false }), true).pending).toBe(true)
  expect(onboardingStatus(fakeStore({ "paperino.onboarding.complete": true }), true).pending).toBe(false)
})

// The wizard runs in dev too — gated on the store key, not on isPackaged — or it could not be
// walked without cutting an installer first. But the runtime-setup step is packaged-only: in dev,
// Chromium and Python come from the repo and there is nothing to download.
test("packaged is reported to the renderer, so the wizard can hide the runtime step in dev", () => {
  expect(onboardingStatus(fakeStore(), true).packaged).toBe(true)
  expect(onboardingStatus(fakeStore(), false).packaged).toBe(false)
})
