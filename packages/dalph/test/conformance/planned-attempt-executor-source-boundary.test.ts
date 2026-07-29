import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const orchestratorSourceDirectory = fileURLToPath(new URL("../../../orchestrator/src/", import.meta.url))
const packagesDirectory = fileURLToPath(new URL("../../../", import.meta.url))
const repositoryDirectory = fileURLToPath(new URL("../../../../", import.meta.url))

const displacedExecutorVocabulary =
  /ExecutorOuterInvocation|FreshCapacity|ImplementationConvergence|ImplementationReview|ImplementationEvidence|NonConvergent|OperationReservation|ProviderObservation|ReviewLoopInvocation|ReviewFindings|ReviewerSession|TaskExecution|TaskWorkProvider|TaskWorkSession|TechnicalRetry/
const displacedActivePolicyVocabulary = /task[- ]work(?:[- ]|\s)+(?:provider|session)|technical[- ]retry/i

it("generic orchestration uses a stage-name-free planned-attempt executor", () => {
  for (const file of readdirSync(orchestratorSourceDirectory, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".ts") || file.name.endsWith(".test.ts")) continue
    const path = `${file.parentPath}/${file.name}`
    expect(readFileSync(path, "utf8"), `${path} must remain outside executor internals`).not.toMatch(
      displacedExecutorVocabulary
    )
  }
})

it("active docs, models, and gates contain no displaced executor artifacts", () => {
  const roots = ["docs", "scripts", "specs"] as const
  for (const root of roots) {
    const directory = `${repositoryDirectory}/${root}`
    for (const file of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue
      const path = `${file.parentPath}/${file.name}`
      expect(path).not.toMatch(/frontierRecovery|taskWorkSessionRecovery|check-frontier-recovery-model/)
      expect(readFileSync(path, "utf8"), path).not.toMatch(displacedExecutorVocabulary)
      expect(readFileSync(path, "utf8"), path).not.toMatch(displacedActivePolicyVocabulary)
    }
  }
})

it("public emitted types expose no displaced executor contract", () => {
  for (const packageName of ["contracts", "orchestrator"]) {
    const emittedSourceDirectory = `${packagesDirectory}/${packageName}/dist/src`
    for (const file of readdirSync(emittedSourceDirectory, { recursive: true, withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".d.ts")) continue
      const path = `${file.parentPath}/${file.name}`
      expect(readFileSync(path, "utf8"), `${path} must expose no displaced executor contract`).not.toMatch(
        displacedExecutorVocabulary
      )
    }
  }
})
