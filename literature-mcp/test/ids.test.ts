import { expect, test } from "bun:test"
import { parseId } from "../src/ids"

test("DOIs parse, with or without their prefixes", () => {
  expect(parseId("10.48550/arXiv.2305.13245")).toEqual({ scheme: "doi", value: "10.48550/arXiv.2305.13245" })
  expect(parseId("doi:10.1038/s41586-021-03819-2")).toEqual({ scheme: "doi", value: "10.1038/s41586-021-03819-2" })
  expect(parseId("https://doi.org/10.1038/s41586-021-03819-2")).toEqual({
    scheme: "doi",
    value: "10.1038/s41586-021-03819-2",
  })
})

test("arXiv ids parse, new and old style", () => {
  expect(parseId("2305.13245")).toEqual({ scheme: "arxiv", value: "2305.13245" })
  expect(parseId("arXiv:2305.13245v3")).toEqual({ scheme: "arxiv", value: "2305.13245v3" })
  expect(parseId("https://arxiv.org/abs/2305.13245")).toEqual({ scheme: "arxiv", value: "2305.13245" })
  expect(parseId("cs/0501001")).toEqual({ scheme: "arxiv", value: "cs/0501001" })
  expect(parseId("math.GT/0309136")).toEqual({ scheme: "arxiv", value: "math.GT/0309136" })
})

// A bare integer is a plausible PMID and an equally plausible typo. Requiring the prefix means a
// mistyped id fails loudly instead of citing whatever paper happens to hold that number.
test("a PMID needs its prefix", () => {
  expect(parseId("PMID:34265844")).toEqual({ scheme: "pmid", value: "34265844" })
  expect(parseId("pmid: 34265844")).toEqual({ scheme: "pmid", value: "34265844" })
  expect(parseId("34265844")).toBeUndefined()
})

// The whole point of the tool surface: a "closest match" is how a wrong citation enters a paper.
test("fuzzy input is refused", () => {
  expect(parseId("Attention Is All You Need")).toBeUndefined()
  expect(parseId("vaswani 2017")).toBeUndefined()
  expect(parseId("10.1038")).toBeUndefined()
  expect(parseId("")).toBeUndefined()
})
