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
