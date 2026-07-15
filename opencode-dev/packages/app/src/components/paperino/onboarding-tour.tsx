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

      /* The card: translucent theme surface + blur = glass in light AND dark. 80% (not lower) so
         copy stays legible when the wizard sits over a dense monospace region — the busiest
         possible backdrop, where 72% softened light-theme text. Still translucent + blurred. */
      [data-slot="dialog-content"].paperino-onboarding-glass {
        background: color-mix(in srgb, var(--background-strong) 80%, transparent);
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
