import { expect, test } from "bun:test"
import { ABSOLUTE_RULES } from "../src/lint"
import { PRIMITIVE_CATALOGUE } from "../src/catalogue"

// The catalogue ships in figure_scaffold's response, which is the ONE place an author is
// told what the surface is. A primitive that is not named there does not exist as far as
// the model is concerned.
test("the catalogue names every primitive lib/annot.js exports", () => {
  for (const fn of ["arrow(", "edge(", "fan(", "place(", "label(", "dimension(", "brace(", "highlight("])
    expect(PRIMITIVE_CATALOGUE).toContain(fn)
  // Ports are the reason the geometry work exists: without them an author draws fake 9px
  // squares to manufacture a second anchor into one tall box.
  expect(PRIMITIVE_CATALOGUE).toContain("right:0.3")
})

// This is the finding that motivated the addition. `data-legend` lived in exactly two
// places in the repository — the render-worker line that reads it and a type comment — so
// rule 17 could never fire, because it fires only on a legend the author MARKED. An
// attribute the rules key off is part of the API, not an implementation detail.
test("the catalogue documents the attributes the rules key off", () => {
  expect(PRIMITIVE_CATALOGUE).toContain("data-node")
  expect(PRIMITIVE_CATALOGUE).toContain("data-legend")
  expect(PRIMITIVE_CATALOGUE).toContain("data-intent")
})

// The escape must be offered with its limits attached, or it reads as a universal opt-out.
// Driven off ABSOLUTE_RULES so a new absolute rule cannot be added without saying so here.
test("the catalogue names every rule an intent can never waive", () => {
  for (const rule of ABSOLUTE_RULES) expect(PRIMITIVE_CATALOGUE).toContain(rule)
  expect(PRIMITIVE_CATALOGUE).toContain("intent-not-permitted")
})
