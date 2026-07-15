/**
 * The first-run wizard's shape, kept apart from its JSX so the order — the part with rules in it —
 * can be tested without a DOM. Same split as preview-kind.ts beside the preview panel.
 */

export type WizardStep = "welcome" | "runtime" | "chatgpt" | "paperclip" | "figure-key"

/**
 * Runtime setup exists only in a packaged install: a dev run takes Chromium and Python from the
 * repo, so offering to download them there would be theatre.
 */
export function wizardSteps(packaged: boolean): WizardStep[] {
  return packaged
    ? ["welcome", "runtime", "chatgpt", "paperclip", "figure-key"]
    : ["welcome", "chatgpt", "paperclip", "figure-key"]
}

/** The next step, or undefined when the wizard is over. Continuing and skipping land here alike. */
export function nextStep(current: WizardStep, packaged: boolean): WizardStep | undefined {
  const steps = wizardSteps(packaged)
  return steps[steps.indexOf(current) + 1]
}

export type KeyProvider = {
  /** MUST be the opencode provider id — it is the key paperbanana-mcp reads back out of auth.json. */
  id: "openrouter" | "google"
  label: string
  /** Where a user without a key goes to get one. */
  url: string
  hint: string
}

export const KEY_PROVIDERS: KeyProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    url: "https://openrouter.ai/keys",
    hint: "One key, many models. Images are billed per generation.",
  },
  {
    id: "google",
    label: "Google AI Studio",
    url: "https://aistudio.google.com/apikey",
    hint: "Straight from Google, with a free tier.",
  },
]
