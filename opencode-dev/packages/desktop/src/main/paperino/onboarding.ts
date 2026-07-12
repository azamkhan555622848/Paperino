import { PAPERINO_ONBOARDING_COMPLETE_KEY } from "../store-keys"

/**
 * The gate for Paperino's first-run wizard (welcome → runtime setup → ChatGPT → figure key).
 *
 * Deliberately NOT the fork's `firstLaunchOnboardingComplete` (main/onboarding.ts): that key is
 * set on the very first boot by the headless flow that creates the default project, so a wizard
 * keyed off it could never appear. This is our own key, and it alone decides whether the wizard
 * shows — including in dev, where it would otherwise be untestable without cutting an installer.
 */

/** The slice of electron-store this needs. Narrow, so the rules are testable without electron. */
export type OnboardingStore = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export function onboardingStatus(store: OnboardingStore, packaged: boolean) {
  return {
    // Anything but a literal true re-runs the wizard: a half-written store should cost the user
    // a second walk through it, not silently skip signing them in.
    pending: store.get(PAPERINO_ONBOARDING_COMPLETE_KEY) !== true,
    // The runtime-setup step is packaged-only — in dev, Chromium and Python come from the repo.
    packaged,
  }
}

export function completeOnboarding(store: OnboardingStore) {
  store.set(PAPERINO_ONBOARDING_COMPLETE_KEY, true)
}
