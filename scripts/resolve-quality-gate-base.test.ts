import { describe, expect, it } from "vitest"
import { resolveQualityGateBase } from "./resolve-quality-gate-base.mjs"

describe("full-gate base resolution", () => {
  it("uses the hosted event base when it is earlier than HEAD", () => {
    expect(
      resolveQualityGateBase({
        canonicalize: (revision) => revision,
        hostedBase: "before",
        isAncestor: () => true,
        readHead: () => "head",
        resolveBase: (requested) => requested ?? "fallback"
      })
    ).toBe("before")
  })

  it("rejects an explicit self-baseline", () => {
    expect(() =>
      resolveQualityGateBase({
        canonicalize: (revision) => revision,
        hostedBase: "head",
        isAncestor: () => true,
        readHead: () => "head",
        resolveBase: (requested) => requested ?? "fallback"
      })
    ).toThrow("equals candidate HEAD")
  })

  it("rejects an explicit all-zero candidate instead of treating it as absent", () => {
    expect(() =>
      resolveQualityGateBase({
        candidateBase: "0000000000000000000000000000000000000000",
        canonicalize: (revision) => revision,
        isAncestor: () => true,
        readHead: () => "head",
        resolveBase: () => "parent"
      })
    ).toThrow("must be a nonzero revision")
  })

  it("skips a fallback that resolves to HEAD and uses the verified parent", () => {
    const resolveBase = (requested?: string) => (requested === "HEAD^" ? "parent" : "head")

    expect(
      resolveQualityGateBase({
        canonicalize: (revision) => revision,
        isAncestor: () => true,
        readHead: () => "head",
        resolveBase
      })
    ).toBe("parent")
  })
})
