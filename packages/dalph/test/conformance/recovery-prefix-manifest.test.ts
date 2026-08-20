/* eslint-disable import/no-nodejs-modules -- The manifest test verifies repository-local evidence paths. */
import { readFileSync, existsSync } from "node:fs"
import { resolve, sep } from "node:path"
import { Result, Schema } from "effect"
import { expect, it } from "vitest"
import { maintainedAuthoredCassetteCatalog } from "../../src/cassettes/catalog.js"
import {
  currentWorkflowEventTags,
  decodeRecoveryPrefixManifest,
  RecoveryPrefixManifest as RecoveryPrefixManifestSchema,
  recoveryPrefixManifest,
  type RecoveryPrefixEvidenceReference,
  type RecoveryPrefixManifest
} from "./recovery-prefix-manifest.js"
import { recoveryPrefixCutLabels } from "./recovery-prefix-contract.js"
import { trackerCompletionRecoveryTrace } from "./tracker-completion-recovery-trace.js"

const repositoryRoot = resolve(import.meta.dirname, "../../../..")

const evidenceReferenceIssues = (manifest: RecoveryPrefixManifest): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const cassetteKeys = new Set(Object.keys(maintainedAuthoredCassetteCatalog))
  for (const boundary of manifest.boundaries) {
    for (const cut of recoveryPrefixCutLabels) {
      for (const evidence of boundary.cuts[cut].evidence) {
        switch (evidence._tag) {
          case "WorkflowEventTag":
            if (!currentWorkflowEventTags.has(evidence.tag)) {
              issues.push(`obsolete workflow event tag ${evidence.tag} at ${boundary.id}.${cut}`)
            }
            break
          case "MaintainedCassetteKey":
            if (!cassetteKeys.has(evidence.key)) {
              issues.push(`missing maintained cassette key ${evidence.key} at ${boundary.id}.${cut}`)
            }
            break
          case "FocusedTestSeam": {
            const path = resolve(repositoryRoot, evidence.path)
            if (!path.startsWith(`${repositoryRoot}${sep}`) || !existsSync(path)) {
              issues.push(`missing focused test path ${evidence.path} at ${boundary.id}.${cut}`)
              break
            }
            if (!readFileSync(path, "utf8").includes(evidence.reference)) {
              issues.push(`missing focused test reference ${evidence.path}#${evidence.reference}`)
            }
            break
          }
        }
      }
    }
  }
  return issues
}

const replaceFirstCellEvidence = (
  manifest: RecoveryPrefixManifest,
  evidence: RecoveryPrefixEvidenceReference
): unknown => {
  const [first, ...rest] = manifest.boundaries
  return {
    ...manifest,
    boundaries: [{ ...first, cuts: { ...first.cuts, P0: { ...first.cuts.P0, evidence: [evidence] } } }, ...rest]
  }
}

const decodeFailureMessage = (input: unknown): string => {
  const result = Schema.decodeUnknownResult(RecoveryPrefixManifestSchema, { onExcessProperty: "error" })(input)
  return Result.isFailure(result) ? result.failure.message : "decoded"
}

it("keeps the recovery-prefix manifest closed and tied to current evidence", () => {
  const decoded = decodeRecoveryPrefixManifest(recoveryPrefixManifest)
  expect(decoded.boundaries).toHaveLength(16)
  expect(decoded.boundaries.map(({ id }) => id)).toHaveLength(new Set(decoded.boundaries.map(({ id }) => id)).size)
  expect(evidenceReferenceIssues(decoded)).toEqual([])
  expect(
    decoded.boundaries.filter(({ qualification }) => qualification._tag === "RepresentativeDualStoreTrace")
  ).toHaveLength(1)
  expect(decoded.boundaries.filter(({ qualification }) => qualification._tag === "MetadataOnly")).toHaveLength(15)
  const representative = decoded.boundaries.find(
    ({ qualification }) => qualification._tag === "RepresentativeDualStoreTrace"
  )
  expect(representative?.id).toBe(trackerCompletionRecoveryTrace.boundaryId)
  expect(representative?.qualification).toMatchObject({
    cassetteKey: trackerCompletionRecoveryTrace.cassetteKey,
    executionCount: trackerCompletionRecoveryTrace.executionCount
  })
})

it("requires an applicability decision and reason for every boundary cut", () => {
  for (const boundary of recoveryPrefixManifest.boundaries) {
    for (const cut of recoveryPrefixCutLabels) {
      expect(["Applicable", "NotApplicable"]).toContain(boundary.cuts[cut]._tag)
      expect(boundary.cuts[cut].reason.length, `${boundary.id}.${cut}`).toBeGreaterThan(0)
      expect(boundary.cuts[cut].evidence.length, `${boundary.id}.${cut}`).toBeGreaterThan(0)
      if (boundary.cuts[cut]._tag === "Applicable") {
        expect(boundary.cuts[cut].endpoint.length, `${boundary.id}.${cut}`).toBeGreaterThan(0)
      }
    }
  }
})

it("rejects duplicate or unknown boundary identifiers and missing cut decisions", () => {
  const [first, ...rest] = recoveryPrefixManifest.boundaries

  expect(
    decodeFailureMessage({ ...recoveryPrefixManifest, boundaries: [...recoveryPrefixManifest.boundaries, first] })
  ).toContain("duplicate boundary identifier")

  expect(
    decodeFailureMessage({ ...recoveryPrefixManifest, boundaries: [{ ...first, id: "obsolete-boundary" }, ...rest] })
  ).toContain('["boundaries"][0]["id"]')

  const { P3: _omitted, ...withoutP3 } = first.cuts
  expect(
    decodeFailureMessage({ ...recoveryPrefixManifest, boundaries: [{ ...first, cuts: withoutP3 }, ...rest] })
  ).toContain("P3")
})

it("rejects obsolete event tags and missing focused paths or references", () => {
  const obsoleteEventManifest = decodeRecoveryPrefixManifest(
    replaceFirstCellEvidence(recoveryPrefixManifest, { _tag: "WorkflowEventTag", tag: "RemovedWorkflowEvent" })
  )
  expect(evidenceReferenceIssues(obsoleteEventManifest)).toContain(
    "obsolete workflow event tag RemovedWorkflowEvent at tracker-task-facts.P0"
  )

  expect(
    evidenceReferenceIssues(
      decodeRecoveryPrefixManifest(
        replaceFirstCellEvidence(recoveryPrefixManifest, {
          _tag: "FocusedTestSeam",
          path: "packages/dalph/test/conformance/missing.test.ts",
          reference: "missing focused test"
        })
      )
    )
  ).toContain("missing focused test path packages/dalph/test/conformance/missing.test.ts at tracker-task-facts.P0")

  expect(
    evidenceReferenceIssues(
      decodeRecoveryPrefixManifest(
        replaceFirstCellEvidence(recoveryPrefixManifest, {
          _tag: "FocusedTestSeam",
          path: "packages/dalph/test/conformance/recovery-prefix-manifest.ts",
          reference: ["__missing", "focused", "anchor", "9b2d__"].join("_")
        })
      )
    )
  ).toContain(
    "missing focused test reference packages/dalph/test/conformance/recovery-prefix-manifest.ts#__missing_focused_anchor_9b2d__"
  )
})
