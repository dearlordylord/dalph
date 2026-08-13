import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

// @ts-expect-error The boundary checker is an executable JavaScript module.
import { sourceBoundaryViolations } from "./check-package-boundaries.mjs"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

it("accepts the checked-in package source roles", () => {
  const source = readFileSync(new URL("./fixtures/issue216-forbidden-dispatch.fixture.ts.txt", import.meta.url), "utf8")
  const violations = sourceBoundaryViolations([
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/live-delivery-action-executor.ts",
      source: readFileSync(
        `${repositoryRoot}packages/orchestrator/src/coordination/delivery/live-delivery-action-executor.ts`,
        "utf8"
      )
    },
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/recovered-delivery-action-adapter.ts",
      source: readFileSync(
        `${repositoryRoot}packages/orchestrator/src/coordination/delivery/recovered-delivery-action-adapter.ts`,
        "utf8"
      )
    },
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.ts",
      source: readFileSync(
        `${repositoryRoot}packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.ts`,
        "utf8"
      )
    }
  ])

  expect(violations).toEqual([])
  expect(source).toContain("runTargetPromotion")
})

it("rejects a dispatch fixture that imports and invokes target promotion", () => {
  const source = readFileSync(new URL("./fixtures/issue216-forbidden-dispatch.fixture.ts.txt", import.meta.url), "utf8")
  const violations = sourceBoundaryViolations([
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/live-delivery-action-executor.ts",
      source
    }
  ])

  expect(violations).toEqual([
    expect.stringContaining("integration-promotion-boundary"),
    expect.stringContaining("dispatch-source-boundary")
  ])
})

it("rejects integration dependencies crossing the executor package boundary", () => {
  const violations = sourceBoundaryViolations([
    {
      packageName: "executor",
      relativePath: "packages/executor/src/forbidden-integration-import.ts",
      source:
        'import { runTargetPromotion } from "../../orchestrator/src/workflow/protocols/target-promotion/protocol.js"'
    }
  ])

  expect(violations).toEqual([expect.stringContaining("executor-source-boundary")])
})

it("rejects mutation capabilities in passive, planning, and adapter roles", () => {
  const violations = sourceBoundaryViolations([
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/delivery.ts",
      source: "const capability = GitCommand"
    },
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/relations.ts",
      source: "const capability = TrackerMutation"
    },
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/delivery-action-planning.ts",
      source: "const capability = OperationIdAllocator"
    },
    {
      packageName: "orchestrator",
      relativePath: "packages/orchestrator/src/coordination/delivery/fresh-delivery-action-adapter.ts",
      source: "const capability = deliveryTransitionPolicy"
    },
    {
      packageName: "dalph",
      relativePath: "packages/dalph/src/presentation/forbidden-mutation.ts",
      source: "const capability = JournalAppend"
    }
  ])

  expect(violations).toEqual([
    expect.stringContaining("passive-source-boundary"),
    expect.stringContaining("passive-source-boundary"),
    expect.stringContaining("planning-source-boundary"),
    expect.stringContaining("action-adapter-source-boundary"),
    expect.stringContaining("passive-source-boundary")
  ])
})
