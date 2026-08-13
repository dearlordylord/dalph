import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

// @ts-expect-error The boundary checker is an executable JavaScript module.
import { sourceBoundaryViolations } from "./check-package-boundaries.mjs"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

const productionTypeScriptFilesUnder = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${entry.name}`
    if (entry.isDirectory()) return productionTypeScriptFilesUnder(`${path}/`)
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : []
  })

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

it("keeps implementation-private executor vocabulary outside the generic boundary", () => {
  const genericSources = [
    `${repositoryRoot}packages/contracts/src/executor.ts`,
    `${repositoryRoot}packages/dalph/src/application/composition.ts`,
    `${repositoryRoot}packages/dalph/src/application/production.ts`,
    ...productionTypeScriptFilesUnder(`${repositoryRoot}packages/orchestrator/src/`)
  ].map((path) => readFileSync(path, "utf8"))

  for (const source of genericSources) {
    expect(source).not.toContain("@dalph/executor")
    expect(source).not.toMatch(
      /\b(?:Codex|Claude|ReviewAgent|ReviewerInvocation|Reviewer|AgentSession|ProviderSession|ProviderRequest|SubprocessId|CommitStage|RetryPolicy)\b/u
    )
  }
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
