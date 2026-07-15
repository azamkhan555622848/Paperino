# Onboarding feature tour — glass wizard

**Date:** 2026-07-15
**Status:** approved (flow shape chosen by user: interleaved)
**Builds on:** `2026-07-13-paperino-installer-onboarding-design.md` (the setup wizard this extends)

## Goal

First-run users should leave onboarding knowing what Paperino *is* — the Preview panel, the
writing-model subscription, real citations, the two figure pipelines — not just having pasted
keys into it. The wizard grows interleaved feature-tour slides, and the whole surface gets a
glassmorphism treatment so the first thing a user sees looks designed, not default.

## Decisions locked here

1. **Interleaved, not tour-then-setup.** Each feature slide sits immediately before the setup
   step it motivates, so the user learns a feature and then acts on it while it is still in
   their head. (User chose this over "tour first" and "enrich existing steps".)
2. **Vendor `packages/ui` is not modified.** The rebrand lesson: an upstream merge reverts
   vendor edits. The stock Dialog (v1, Kobalte — `@opencode-ai/ui/dialog` resolves via the
   `./*` wildcard export to `src/components/dialog.tsx`) already accepts `class`/`classList`
   on its content element and wraps itself in `[data-component="dialog"]` — the glass skin is
   applied from our own files through that surface.
3. **Vignettes are code-drawn** (CSS/SVG mini-mockups), never screenshots: theme-aware,
   weightless, and they cannot go stale the way committed PNGs do.
4. **Copy stays honest per product rules.** The figures slide says PaperBanana's raster output
   is not lint-checked; the citations slide says missing sources become questions. The tour is
   not marketing — it is the product's constraints, stated as features (which they are).
5. **Setup-step logic is untouched.** ChatGPT sign-in, Paperclip connect, runtime downloads and
   the figure-key form keep their exact behavior; they are restyled and re-ordered only.

## Flow

`WizardStep` gains four ids: `tour-preview`, `tour-models`, `tour-citations`, `tour-figures`.

Packaged order (9): `welcome, tour-preview, runtime, tour-models, chatgpt, tour-citations, paperclip, tour-figures, figure-key`
Dev order (8): same minus `runtime`.

| Step | Kind | One-line purpose |
|---|---|---|
| `welcome` | intro | What Paperino is (existing copy, restyled) |
| `tour-preview` | tour | The Preview panel: live compile, file tree, "show me X" |
| `runtime` | setup | Chromium + Python downloads (packaged only) |
| `tour-models` | tour | Writing models come from the ChatGPT subscription |
| `chatgpt` | setup | Sign in with ChatGPT |
| `tour-citations` | tour | Paperclip finds; `cite` resolves; the bib cannot be faked |
| `paperclip` | setup | Connect Paperclip |
| `tour-figures` | tour | Figure Studio (vector, checked) vs PaperBanana (raster, keyed) |
| `figure-key` | setup | Paste OpenRouter/Google key |

Unchanged: `nextStep` (it indexes into `wizardSteps`), the module-level once-per-run flag, the
`onboardingStatus` gating, dual mounting inside both ServerSync subtrees, and every step being
skippable (Continue and Skip are the same move).

## Tour slide content

Each tour slide = vignette (top) + headline + 2–3 short lines. Final copy:

**tour-preview — "Your paper, always on screen."**
The right-hand panel recompiles your LaTeX on every save and shows the PDF. Compile errors
point at the offending line. The folder icon opens a file tree — click any PDF, image or Word
file to view it — and asking the agent to *show* you a document puts it in the panel too.
*Vignette:* mini app window — chat lines on the left, a page thumbnail on the right with a
"Compiled ✓" badge.

**tour-models — "Your subscription writes the prose."**
Sign in once with ChatGPT and GPT-5.6 Terra, Sol and GPT-5.5 appear in the model picker,
billed against your existing plan — no API key, no per-token bill. Switch models any time.
*Vignette:* three model chips, Terra highlighted, with a check badge.

**tour-citations — "Citations it cannot fake."**
Paperclip searches millions of full-text papers. The agent cites by DOI, arXiv id or PMID, and
each entry is fetched from the publisher's own record. `references.bib` is machine-owned — the
agent is *denied* write access to it, so an invented reference has no way in. A source it
cannot find becomes a question to you, never a plausible guess.
*Vignette:* a mini BibTeX entry card with a small lock, tagged "resolved from doi.org".

**tour-figures — "Two ways to draw a figure."**
Figure Studio builds vector figures from your own data — every number traced to its source,
sized for print, no key needed. PaperBanana paints illustrative images with AI (that's what the
key on the next screen is for) — striking, but its numbers aren't checked, and the agent will
tell you so. It always asks which pipeline you want before drawing.
*Vignette:* two mini cards side by side — a small bar chart (vector) vs a painterly gradient
tile (raster), labeled.

## Glass visual system

- **Backdrop:** the dialog overlay dims and blurs the app behind it (`backdrop-filter: blur`
  + dim). The app under it is the product; letting it glow through *is* the tour's first frame.
- **Card:** translucent surface — light theme ≈ white glass, dark theme ≈ ink glass — with
  `backdrop-filter: blur + saturate`, a 1px translucent border, generous radius, soft wide
  shadow. Exact values are tuned by eye at implementation (the `frontend-design` skill is
  loaded then); the spec pins the *mechanism*, not the pixel values.
- **Mechanism:** the *card* is styled with Tailwind utilities through the Dialog's existing
  `class` prop (the app package is Tailwind-only — it contains zero `.css` files, so no new
  stylesheet convention is invented). The *backdrop* — rendered by the vendor DialogProvider as
  `[data-component="dialog-overlay"]` — is styled by a small `<style>` block the wizard itself
  mounts, guarded with `:has(.paperino-onboarding-glass)` so no other dialog is affected. Zero
  vendor edits. Electron 42's Chromium supports `backdrop-filter` and `:has()` unconditionally
  — no fallback path needed.
- **Progress:** dots (active dot elongated), replacing "Step N of M" text — 9 steps make the
  text form clunky. A visually-hidden "Step N of M" remains for accessibility.
- **Motion:** a subtle fade/slide (~160ms) on step change, disabled under
  `prefers-reduced-motion`.
- **Theme-aware:** all colors derive from the app's existing ink tokens; both themes verified
  by eye.

## Code changes

- `packages/app/src/components/paperino/onboarding-steps.ts` — `WizardStep` union + orders.
- `packages/app/src/components/paperino/onboarding-steps.test.ts` — the pinned orders.
- `packages/app/src/components/paperino/onboarding-wizard.tsx` — four tour-step components,
  glass shell class, dots, transitions.
- `packages/app/src/components/paperino/onboarding-tour.tsx` (new) — the vignettes, the tour
  slide scaffold, and the wizard-scoped `<style>` block for the overlay, kept apart so the
  wizard file stays readable.

Nothing else moves: no config, no packaged template, no main-process code, no vendor files.

## Verification

1. `bun test src/components/paperino/onboarding-steps.test.ts` — new orders.
2. `bun run typecheck` in `packages/app`.
3. **Look at it live.** Drive the dev app (CDP; dev Paperino — not port 9222's InteJer) with
   the onboarding flag reset, walk every step (8 in dev — `runtime` is packaged-only),
   screenshot dark and light. Glass is exactly the
   kind of change that passes typecheck and looks wrong: contrast on the translucent surface,
   halo on the dots, vignette legibility are all eye-only checks. The packaged build needs no
   re-verification beyond the existing suite — this feature ships entirely inside the app
   bundle; config and staging are untouched.

## Out of scope

- A re-openable "tour" entry point (help menu) — YAGNI until asked.
- Restyling other dialogs (settings, provider connect) — the glass skin is scoped to onboarding.
- Screenshots or video in slides.
