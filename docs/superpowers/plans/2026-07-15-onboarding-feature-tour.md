# Onboarding Feature Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first-run wizard gains four interleaved feature-tour slides (Preview panel, writing models, citations, figures) and a glassmorphism skin, so a new user learns what Paperino is while setting it up.

**Architecture:** Tour slides are new `WizardStep` ids interleaved into the existing step orders; all slide content and glass styling live in one new file (`onboarding-tour.tsx`) that the wizard composes. The glass skin reaches the vendor Dialog through its existing `class` prop and a wizard-scoped `<style>` block — zero edits to `packages/ui`.

**Tech Stack:** SolidJS, Tailwind (app package), plain CSS in a scoped `<style>` block (for `color-mix()` over theme custom properties), bun test, CDP for live verification.

**Spec:** `docs/superpowers/specs/2026-07-15-onboarding-feature-tour-design.md`

## Global Constraints

- **Never `git add -A` or `git commit -a`.** Stage explicit paths. Git root is `C:/Users/azamk/Documents`; branch `feat/paperino`.
- **No commit may carry a Claude co-author trailer** — the user is sole author.
- **Vendor `packages/ui` is not modified.** The glass skin uses only the Dialog's public `class` prop and CSS selectors on `[data-component="dialog-overlay"]` / `[data-slot="dialog-content"]`.
- **No new `.css` files.** The app package is Tailwind-only (zero `.css` files in `packages/app/src`); all custom CSS goes in the `GlassStyle` `<style>` block, `pg-` class prefix.
- **Use only Tailwind token classes that already appear in the wizard:** `text-14-regular`, `text-14-medium`, `text-12-regular`, `text-text-base`, `text-text-weak`. Theme-aware colors in custom CSS come from the theme's custom properties (`--background-base/strong/stronger`, `--surface-inset-base`, `--border-base`, `--border-weak-base`, `--border-active`, `--text-base`) via `color-mix()` — these flip with `html[data-theme]`, so both themes work for free.
- **Slide copy is verbatim from the spec** — do not paraphrase it (it is worded to satisfy product rules 1/2/4).
- **Setup-step logic is untouched:** `WelcomeStep`, `RuntimeStep`, `ChatGPTStep`, `PaperclipStep`, `FigureKeyStep` bodies do not change.
- Tests run from `Paperino/opencode-dev/packages/app` (a guard breaks `bun test` at the opencode-dev root). Typecheck: `bun run typecheck` (tsgo) in the same directory.
- Motion respects `prefers-reduced-motion`.

---

### Task 1: Step orders

**Files:**
- Modify: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.ts:6-14`
- Test: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.test.ts:4-29`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WizardStep` union now includes `"tour-preview" | "tour-models" | "tour-citations" | "tour-figures"`; `wizardSteps(packaged: boolean): WizardStep[]` returns the 9/8-step orders. Task 3 renders one `<Match>` per id. `nextStep` is unchanged (it indexes into `wizardSteps`).

- [ ] **Step 1: Update the failing test**

Replace the `wizardSteps` and `nextStep` describe blocks in `onboarding-steps.test.ts` (leave the `KEY_PROVIDERS` test at the bottom untouched):

```ts
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
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd Paperino/opencode-dev/packages/app && bun test src/components/paperino/onboarding-steps.test.ts`
Expected: FAIL — `wizardSteps(true)` still returns the 5-step order.

- [ ] **Step 3: Implement the new orders**

In `onboarding-steps.ts`, replace the `WizardStep` type and `wizardSteps` function (leave `nextStep`, `KeyProvider`, `KEY_PROVIDERS` untouched):

```ts
export type WizardStep =
  | "welcome"
  | "tour-preview"
  | "runtime"
  | "tour-models"
  | "chatgpt"
  | "tour-citations"
  | "paperclip"
  | "tour-figures"
  | "figure-key"

/**
 * Runtime setup exists only in a packaged install: a dev run takes Chromium and Python from the
 * repo, so offering to download them there would be theatre.
 *
 * Tour slides are interleaved, each immediately before the setup step it motivates — the user
 * learns a feature and then acts on it while it is still in their head.
 */
export function wizardSteps(packaged: boolean): WizardStep[] {
  return packaged
    ? [
        "welcome",
        "tour-preview",
        "runtime",
        "tour-models",
        "chatgpt",
        "tour-citations",
        "paperclip",
        "tour-figures",
        "figure-key",
      ]
    : ["welcome", "tour-preview", "tour-models", "chatgpt", "tour-citations", "paperclip", "tour-figures", "figure-key"]
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd Paperino/opencode-dev/packages/app && bun test src/components/paperino/onboarding-steps.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.ts \
        Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.test.ts
git commit -m "feat(onboarding): interleave four feature-tour steps into the wizard order"
```

---

### Task 2: Tour slides, vignettes, and the glass styles

**Files:**
- Create: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-tour.tsx`

**Interfaces:**
- Consumes: `WizardStep` from `./onboarding-steps` (Task 1).
- Produces, all imported by Task 3:
  - `export function GlassStyle(): JSX.Element` — the scoped `<style>` block; mounted once by the wizard.
  - `export function StepDots(props: { steps: WizardStep[]; current: WizardStep }): JSX.Element`
  - `export function TourPreview(): JSX.Element`
  - `export function TourModels(): JSX.Element`
  - `export function TourCitations(): JSX.Element`
  - `export function TourFigures(): JSX.Element`

Before writing the file, **load the `frontend-design` skill** — it calibrates the glass values and vignette composition; the numbers below are the starting point it may refine (mechanism and selectors are fixed, numeric values are tunable).

- [ ] **Step 1: Write the file**

`Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-tour.tsx`:

```tsx
import { For, type JSX } from "solid-js"
import type { WizardStep } from "./onboarding-steps"

/**
 * The feature-tour half of the first-run wizard: the glass skin, the progress dots, and the four
 * tour slides with their code-drawn vignettes. Kept apart from onboarding-wizard.tsx so the wizard
 * file stays a flow controller.
 *
 * Styling lives in the GlassStyle <style> block (plain CSS, `pg-` prefix) rather than in Tailwind
 * utilities: the glass surface needs color-mix() over the theme's own custom properties
 * (--background-*, --border-*), which is what keeps it correct in BOTH themes — the variables flip
 * with html[data-theme], so the glass follows for free. Vignettes are code-drawn, never
 * screenshots: theme-aware, weightless, and they cannot go stale the way committed PNGs do.
 */

/** Mounted once by the wizard. Scoped: every selector requires .paperino-onboarding-glass. */
export function GlassStyle() {
  return (
    <style>{`
      /* Backdrop: dim + blur the app behind the wizard. Guarded on the glass class being mounted
         anywhere, so no other dialog is affected — and the provider-connect dialog the ChatGPT
         step pushes on top inherits the same backdrop, which reads as one continuous flow. */
      body:has(.paperino-onboarding-glass) [data-component="dialog-overlay"] {
        backdrop-filter: blur(10px);
        background: color-mix(in srgb, var(--background-base) 30%, transparent);
      }

      /* The card: translucent theme surface + blur = glass in light AND dark. */
      [data-slot="dialog-content"].paperino-onboarding-glass {
        background: color-mix(in srgb, var(--background-strong) 72%, transparent);
        backdrop-filter: blur(28px) saturate(140%);
        border: 1px solid color-mix(in srgb, var(--border-weak-base) 55%, transparent);
        border-radius: 16px;
        box-shadow:
          0 24px 80px -24px rgba(0, 0, 0, 0.35),
          inset 0 1px 0 color-mix(in srgb, var(--background-stronger) 45%, transparent);
      }

      /* Step-change motion: the keyed wrapper remounts per step, re-running this animation. */
      .pg-enter { animation: pg-enter 180ms ease-out; }
      @keyframes pg-enter {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pg-enter { animation: none; }
      }

      .pg-headline { font-size: 17px; font-weight: 600; letter-spacing: -0.014em; }

      /* Progress dots. currentColor, so the parent's text token drives them in both themes. */
      .pg-dots { display: flex; align-items: center; gap: 6px; }
      .pg-dot {
        width: 6px; height: 6px; border-radius: 999px;
        background: currentColor; opacity: 0.25;
        transition: width 160ms ease, opacity 160ms ease;
      }
      .pg-dot[data-active] { width: 18px; opacity: 0.9; }
      .pg-dot[data-done] { opacity: 0.55; }
      @media (prefers-reduced-motion: reduce) {
        .pg-dot { transition: none; }
      }

      /* Vignette frame: a small inset pane above each tour slide's copy. */
      .pg-vignette {
        display: flex; align-items: center; justify-content: center;
        height: 132px; border-radius: 12px;
        background: var(--surface-inset-base);
        border: 1px solid color-mix(in srgb, var(--border-weak-base) 70%, transparent);
        overflow: hidden;
      }
      .pg-card {
        border-radius: 8px;
        border: 1px solid var(--border-weak-base);
        background: var(--background-stronger);
        box-shadow: 0 4px 16px -8px rgba(0, 0, 0, 0.25);
      }
      .pg-line { height: 6px; border-radius: 999px; background: var(--border-base); }
      .pg-badge {
        font-size: 10px; line-height: 1; padding: 4px 7px; border-radius: 999px;
        border: 1px solid var(--border-weak-base); background: var(--background-strong);
        color: var(--text-base); white-space: nowrap;
      }
      .pg-chip {
        font-size: 11px; line-height: 1; padding: 6px 10px; border-radius: 999px;
        border: 1px solid var(--border-weak-base); background: var(--background-stronger);
        color: var(--text-base); white-space: nowrap;
      }
      .pg-chip[data-active] { border-color: var(--border-active); font-weight: 600; }
    `}</style>
  )
}

/** Dots for N steps; the aria-label keeps "Step x of y" for screen readers. */
export function StepDots(props: { steps: WizardStep[]; current: WizardStep }) {
  const index = () => props.steps.indexOf(props.current)
  return (
    <div class="pg-dots text-text-weak" role="img" aria-label={`Step ${index() + 1} of ${props.steps.length}`}>
      <For each={props.steps}>
        {(s, i) => (
          <div class="pg-dot" data-active={s === props.current ? "" : undefined} data-done={i() < index() ? "" : undefined} />
        )}
      </For>
    </div>
  )
}

/** Shared slide scaffold: vignette on top, headline, then two short paragraphs of copy. */
function TourSlide(props: { vignette: JSX.Element; headline: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-4">
      <div class="pg-vignette">{props.vignette}</div>
      <div class="pg-headline text-text-base">{props.headline}</div>
      <div class="flex flex-col gap-2 text-14-regular text-text-weak">{props.children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vignettes — small code-drawn mockups. Every color is a theme variable.
// ---------------------------------------------------------------------------

/** Mini app window: chat lines on the left, a compiled page thumbnail on the right. */
function VignettePreview() {
  return (
    <div class="pg-card" style={{ display: "flex", gap: "10px", padding: "12px", width: "240px" }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "7px", flex: "1", "justify-content": "center" }}>
        <div class="pg-line" style={{ width: "80%" }} />
        <div class="pg-line" style={{ width: "60%" }} />
        <div class="pg-line" style={{ width: "72%", opacity: "0.5" }} />
      </div>
      <div
        style={{
          position: "relative",
          width: "84px",
          height: "104px",
          border: "1px solid var(--border-weak-base)",
          "border-radius": "4px",
          background: "var(--background-stronger)",
          padding: "10px",
          display: "flex",
          "flex-direction": "column",
          gap: "5px",
        }}
      >
        <div class="pg-line" style={{ width: "70%", height: "4px" }} />
        <div class="pg-line" style={{ width: "100%", height: "4px", opacity: "0.5" }} />
        <div class="pg-line" style={{ width: "100%", height: "4px", opacity: "0.5" }} />
        <div class="pg-line" style={{ width: "84%", height: "4px", opacity: "0.5" }} />
        <div class="pg-badge" style={{ position: "absolute", bottom: "6px", right: "6px" }}>
          Compiled ✓
        </div>
      </div>
    </div>
  )
}

/** Three model chips, Terra active. */
function VignetteModels() {
  return (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <div class="pg-chip" data-active="">
        GPT-5.6 Terra ✓
      </div>
      <div class="pg-chip">GPT-5.6 Sol</div>
      <div class="pg-chip">GPT-5.5</div>
    </div>
  )
}

/** A mini BibTeX entry with a lock — the machine-owned bib. */
function VignetteCitations() {
  return (
    <div
      class="pg-card"
      style={{ padding: "12px 14px", width: "250px", display: "flex", "flex-direction": "column", gap: "7px" }}
    >
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
        <span class="text-text-base" style={{ "font-family": "monospace", "font-size": "11px" }}>
          @article{"{"}jumper2021highly{"}"}
        </span>
        <span style={{ "font-size": "12px" }} aria-hidden="true">
          🔒
        </span>
      </div>
      <div class="pg-line" style={{ width: "88%" }} />
      <div class="pg-line" style={{ width: "70%", opacity: "0.5" }} />
      <div class="pg-badge" style={{ "align-self": "flex-start" }}>
        resolved from doi.org
      </div>
    </div>
  )
}

/** Two mini cards: a vector bar chart vs a painterly raster tile. */
function VignetteFigures() {
  const bar = (height: string) => (
    <div style={{ flex: "1", height, background: "var(--border-active)", "border-radius": "2px" }} />
  )
  return (
    <div style={{ display: "flex", gap: "10px" }}>
      <div
        class="pg-card"
        style={{ width: "104px", padding: "10px", display: "flex", "flex-direction": "column", gap: "6px" }}
      >
        <div style={{ display: "flex", "align-items": "flex-end", gap: "5px", height: "52px" }}>
          {bar("40%")}
          {bar("75%")}
          {bar("55%")}
          {bar("90%")}
        </div>
        <div class="pg-badge" style={{ "align-self": "center" }}>
          vector · checked
        </div>
      </div>
      <div
        class="pg-card"
        style={{ width: "104px", padding: "10px", display: "flex", "flex-direction": "column", gap: "6px" }}
      >
        <div
          style={{
            height: "52px",
            "border-radius": "3px",
            background: "linear-gradient(135deg, #7aa2ff55, #ff9a7a55 60%, #ffd27a55)",
          }}
        />
        <div class="pg-badge" style={{ "align-self": "center" }}>
          AI image · keyed
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The four tour slides. Copy is VERBATIM from the spec — it is worded to satisfy
// product rules (honest about what is and is not checked). Do not paraphrase.
// ---------------------------------------------------------------------------

export function TourPreview() {
  return (
    <TourSlide vignette={<VignettePreview />} headline="Your paper, always on screen.">
      <p>
        The right-hand panel recompiles your LaTeX on every save and shows the PDF. Compile errors point at the
        offending line.
      </p>
      <p>
        The folder icon opens a file tree — click any PDF, image or Word file to view it — and asking the agent to{" "}
        <em>show</em> you a document puts it in the panel too.
      </p>
    </TourSlide>
  )
}

export function TourModels() {
  return (
    <TourSlide vignette={<VignetteModels />} headline="Your subscription writes the prose.">
      <p>
        Sign in once with ChatGPT and GPT-5.6 Terra, Sol and GPT-5.5 appear in the model picker, billed against your
        existing plan — no API key, no per-token bill.
      </p>
      <p>Switch models any time.</p>
    </TourSlide>
  )
}

export function TourCitations() {
  return (
    <TourSlide vignette={<VignetteCitations />} headline="Citations it cannot fake.">
      <p>
        Paperclip searches millions of full-text papers. The agent cites by DOI, arXiv id or PMID, and each entry is
        fetched from the publisher's own record.
      </p>
      <p>
        <span class="text-text-base">references.bib</span> is machine-owned — the agent is denied write access to it,
        so an invented reference has no way in. A source it cannot find becomes a question to you, never a plausible
        guess.
      </p>
    </TourSlide>
  )
}

export function TourFigures() {
  return (
    <TourSlide vignette={<VignetteFigures />} headline="Two ways to draw a figure.">
      <p>
        Figure Studio builds vector figures from your own data — every number traced to its source, sized for print, no
        key needed.
      </p>
      <p>
        PaperBanana paints illustrative images with AI (that's what the key on the next screen is for) — striking, but
        its numbers aren't checked, and the agent will tell you so. It always asks which pipeline you want before
        drawing.
      </p>
    </TourSlide>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd Paperino/opencode-dev/packages/app && bun run typecheck`
Expected: clean (tsgo checks all of `src/`, so the new file is covered even though nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-tour.tsx
git commit -m "feat(onboarding): tour slides, code-drawn vignettes, and the glass styles"
```

---

### Task 3: Wizard integration — glass shell, dots, tour arms

**Files:**
- Modify: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-wizard.tsx` (imports; the `Wizard` component only)

**Interfaces:**
- Consumes: `GlassStyle`, `StepDots`, `TourPreview`, `TourModels`, `TourCitations`, `TourFigures` from `./onboarding-tour` (Task 2); the new `WizardStep` ids (Task 1).
- Produces: nothing new — `PaperinoOnboarding` export and all setup-step components are unchanged.

- [ ] **Step 1: Add the import**

After the existing `./onboarding-steps` import line, add:

```tsx
import { GlassStyle, StepDots, TourCitations, TourFigures, TourModels, TourPreview } from "./onboarding-tour"
```

- [ ] **Step 2: Replace the Wizard component's body**

Replace the current `Wizard` function's return statement (the `<Dialog size="large" ...>` block) and delete the now-unused `position` memo. The result — `Wizard` in full:

```tsx
function Wizard(props: { packaged: boolean }) {
  const dialog = useDialog()
  const [step, setStep] = createSignal<WizardStep>("welcome")

  const steps = createMemo(() => wizardSteps(props.packaged))
  const last = createMemo(() => steps().at(-1))

  // Continuing and skipping are the same move: every step is optional, and each stays reachable
  // (Settings re-runs the downloads; the model picker connects a provider).
  async function advance() {
    const next = nextStep(step(), props.packaged)
    if (next) {
      setStep(next)
      return
    }
    await bridge()?.onboardingComplete()
    dialog.close()
  }

  return (
    <Dialog
      size="large"
      class="paperino-onboarding-glass"
      title={
        <div class="flex items-center gap-2">
          <Mark class="size-5" />
          <span>Welcome to Paperino</span>
        </div>
      }
    >
      <GlassStyle />
      <div class="flex flex-col gap-6">
        {/* keyed: the wrapper remounts on every step change, re-running the .pg-enter animation */}
        <Show when={step()} keyed>
          {(current) => (
            <div class="pg-enter">
              <Switch>
                <Match when={current === "welcome"}>
                  <WelcomeStep />
                </Match>
                <Match when={current === "tour-preview"}>
                  <TourPreview />
                </Match>
                <Match when={current === "runtime"}>
                  <RuntimeStep />
                </Match>
                <Match when={current === "tour-models"}>
                  <TourModels />
                </Match>
                <Match when={current === "chatgpt"}>
                  <ChatGPTStep />
                </Match>
                <Match when={current === "tour-citations"}>
                  <TourCitations />
                </Match>
                <Match when={current === "paperclip"}>
                  <PaperclipStep />
                </Match>
                <Match when={current === "tour-figures"}>
                  <TourFigures />
                </Match>
                <Match when={current === "figure-key"}>
                  <FigureKeyStep onSaved={() => void advance()} />
                </Match>
              </Switch>
            </div>
          )}
        </Show>

        <div class="flex items-center justify-between">
          <StepDots steps={steps()} current={step()} />
          <div class="flex items-center gap-2">
            <Show when={step() !== "welcome"}>
              <Button variant="ghost" onClick={() => void advance()}>
                Skip
              </Button>
            </Show>
            <Button variant="primary" onClick={() => void advance()}>
              {step() === last() ? "Finish" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
```

Notes for the implementer:
- `Show keyed` with a string `when` is the Solid idiom for "remount children when the value changes" — `step()` is always truthy, so the branch never hides; it only re-creates, which re-runs the CSS entry animation.
- The `class` prop lands on the Dialog's Kobalte content element (see `packages/ui/src/components/dialog.tsx:30-33`), which carries `data-slot="dialog-content"` — exactly what `GlassStyle`'s card selector targets.
- The old footer text `Step {position()} of {steps().length}` is gone; `StepDots` carries the same information (including an aria-label).

- [ ] **Step 3: Run tests and typecheck**

Run: `cd Paperino/opencode-dev/packages/app && bun test src/components/paperino/onboarding-steps.test.ts && bun run typecheck`
Expected: 6 tests pass; typecheck clean. (If tsgo flags the unused `position` memo you forgot to delete, delete it.)

- [ ] **Step 4: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-wizard.tsx
git commit -m "feat(onboarding): glass wizard shell with progress dots and interleaved tour"
```

---

### Task 4: Live verification and docs

Glass is exactly the kind of change that passes typecheck and looks wrong. This task walks the real wizard in the dev app, screenshots every step in both themes, and tunes the numbers by eye. **Only numeric values inside `GlassStyle` may change during tuning** — selectors, class names, copy and step order are locked by Tasks 1–3.

**Files:**
- Modify: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-tour.tsx` (numeric tuning only, if needed)
- Modify: `Paperino/CLAUDE.md` (the onboarding wizard sentence)

- [ ] **Step 1: Launch the dev app**

Close any running Paperino dev instance first. Then:

```
opencode-dev\paperino-dev.cmd
```

Dev builds expose CDP on port **9222**. Before using it, confirm the target is Paperino and not InteJer (both forks use 9222): fetch `http://127.0.0.1:9222/json/list` and check a target URL/title belongs to the app just launched. If InteJer's dev app is already holding 9222, stop — ask the user rather than driving their other app.

- [ ] **Step 2: Reset the onboarding flag and reload**

The wizard is gated by the `paperino.onboarding.complete` key (`store-keys.ts:6`) in the `opencode.settings` electron-store, read via `onboardingStatus` (`main/paperino/onboarding.ts:18` — anything but literal `true` means pending). The preload exposes `storeSet(name, key, value)` (`preload/index.ts:92`). Over CDP `Runtime.evaluate` on the app page:

```js
await window.api.storeSet("opencode.settings", "paperino.onboarding.complete", false)
location.reload()
```

The reload also resets the wizard's module-level `shown` flag (fresh renderer), so the wizard appears on the next mount.

- [ ] **Step 3: Walk every step, screenshotting each**

8 steps in dev (no `runtime`). For each: `Page.captureScreenshot` → save PNG to the scratchpad → click Continue by evaluating a click on the primary footer button:

```js
[...document.querySelectorAll('[data-component="dialog"] button')].find((b) => /Continue|Finish/.test(b.textContent)).click()
```

On the `chatgpt` and `paperclip` steps do NOT click their connect buttons (they open OAuth flows) — screenshot and Continue past them.

- [ ] **Step 4: Flip the theme and re-walk**

The color scheme is stored in localStorage under `opencode-color-scheme` (`packages/ui/src/theme/context.tsx:16`). Set the opposite scheme, reset the flag again, reload, and re-walk:

```js
localStorage.setItem("opencode-color-scheme", "dark") // or "light"
await window.api.storeSet("opencode.settings", "paperino.onboarding.complete", false)
location.reload()
```

- [ ] **Step 5: LOOK at the PNGs and tune**

Open every screenshot. Check, in both themes: the card reads as glass (app visible but blurred behind the overlay; card surface translucent, not opaque or muddy); text meets contrast on the translucent surface; dots are visible but quiet; each vignette is legible (badges not clipped, chips not wrapped); the entry animation does not cause layout jump (compare consecutive screenshots). Tune numeric values in `GlassStyle` and re-walk until right. The known risk: `--background-strong` at 72% may be too transparent over busy dark-theme content — raise toward 85% before reaching for different selectors.

- [ ] **Step 6: Update CLAUDE.md's wizard description**

In `Paperino/CLAUDE.md`, the onboarding section opens:

```
The first-run wizard (`components/paperino/onboarding-wizard.tsx`) is welcome → runtime setup →
sign in with ChatGPT → Nano Banana key.
```

Replace that sentence with:

```
The first-run wizard (`components/paperino/onboarding-wizard.tsx`) interleaves feature-tour
slides with setup: welcome → tour:preview → runtime setup → tour:models → sign in with ChatGPT →
tour:citations → connect Paperclip → tour:figures → Nano Banana key. Tour slides, vignettes and
the glass skin live in `onboarding-tour.tsx`; the glass reaches the vendor Dialog through its
`class` prop plus a wizard-scoped `<style>` block on `[data-component="dialog-overlay"]` — never
by editing `packages/ui`.
```

- [ ] **Step 7: Restore the finished state and commit**

The walk ends with the wizard completed (Finish sets the flag) — leave it completed. Commit whatever Step 5 tuned plus the docs:

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-tour.tsx Paperino/CLAUDE.md
git commit -m "feat(onboarding): tune the glass by eye against both themes; document the tour"
```

(If Step 5 needed no tuning, commit only `Paperino/CLAUDE.md` with `docs: describe the feature-tour wizard`.)

---

## Self-review

**Spec coverage.** Flow/orders → Task 1. Slide copy, vignettes, dots, motion, glass mechanism (Dialog `class` prop + overlay `<style>` block, no vendor edits, no new `.css` files) → Tasks 2–3. Verification (order tests, typecheck, live CDP walk in both themes) → Tasks 1–4. Out-of-scope items (re-openable tour, restyling other dialogs) appear in no task — correct.

**Type consistency.** `WizardStep` ids in Task 1's union = Task 3's Match arms = `StepDots`' prop type. Task 2's six exports = Task 3's import line. `wizardSteps`/`nextStep` signatures unchanged from the existing file.

**Known judgment calls, stated:** the ChatGPT-pushed provider dialog inherits the blurred backdrop (reads as one flow — deliberate); tour steps show the Skip button like setup steps (Continue/Skip are the same move in this wizard); the `position` memo is deleted because dots replace the text.
