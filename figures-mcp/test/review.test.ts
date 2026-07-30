import { expect, test } from "bun:test"
import { buildRubric } from "../src/server"

test("the rubric asks about composition and does not present exemplars as a target", () => {
  const rubric = buildRubric({ claim: "c", caption: "p", engine: "html" }, [
    { rule: "empty-node", selector: "#slot", reason: "unfilled slot" },
  ])
  expect(rubric).toContain("dominant reading direction")
  expect(rubric).toContain("visible ink")
  expect(rubric).toContain("exactly one job")
  expect(rubric).toContain("#slot")
  expect(rubric).toContain("craft reference")
  // The v2/v3 framing is retired: steering composition toward a fixed picture is a ceiling.
  expect(rubric).not.toContain("exemplars of the bar")
})

test("the rubric names the file the engine actually authors", () => {
  const html = buildRubric({ claim: "c", caption: "p", engine: "html" }, [])
  expect(html).toContain("patch figure.html")
  expect(html).toContain("a .math span")

  // An mpl figure has no figure.html and no .math span. Telling its author to patch one is
  // an instruction to edit a file that does not exist.
  const mpl = buildRubric({ claim: "c", caption: "p", engine: "mpl" }, [])
  expect(mpl).toContain("patch figure.py")
  expect(mpl).not.toContain("figure.html")
  expect(mpl).toContain("$…$ mathtext")
})

test("with no exemptions the rubric does not invent a waiver section", () => {
  const rubric = buildRubric({ claim: "c", caption: "p", engine: "html" }, [])
  expect(rubric).not.toContain("DECLARED EXEMPTIONS")
})
