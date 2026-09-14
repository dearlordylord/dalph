import { describe, expect, it } from "vitest"
// @ts-expect-error The canonical path order is shared with executable JavaScript runners.
import { canonicalPaths } from "./canonical-path-order.mjs"
// @ts-expect-error The diagnostics scope policy is shared with the executable JavaScript runner.
import { selectDiagnosticTargets } from "./effect-diagnostics-scope.mjs"

describe("effect diagnostics scope", () => {
  it("orders path evidence by stable code units rather than the host locale", () => {
    expect(canonicalPaths(["z.ts", "ä.ts", "A.ts", "z.ts", "Z.ts"])).toEqual(["A.ts", "Z.ts", "z.ts", "ä.ts"])
  })
  it("checks nothing when no diagnosable file changed", () => {
    expect(
      selectDiagnosticTargets({ changedFiles: ["docs/DEVELOPMENT.md", "scripts/run.mjs"], maximumFiles: 12 })
    ).toEqual({ files: [], scope: "none" })
  })

  it("checks the changed TypeScript files in a stable order", () => {
    expect(
      selectDiagnosticTargets({
        changedFiles: ["packages/dalph/src/b.ts", "packages/dalph/src/a.tsx", "packages/dalph/src/b.ts", "README.md"],
        maximumFiles: 12
      })
    ).toEqual({ files: ["packages/dalph/src/a.tsx", "packages/dalph/src/b.ts"], scope: "files" })
  })

  it("selects the project pass once the changed set exceeds the per-file budget", () => {
    const changedFiles = Array.from({ length: 5 }, (_unused, index) => `packages/dalph/src/file-${index}.ts`)
    expect(selectDiagnosticTargets({ changedFiles, maximumFiles: 4 })).toEqual({ files: [], scope: "project" })
  })
})
