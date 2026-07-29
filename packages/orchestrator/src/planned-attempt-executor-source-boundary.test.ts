import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const sourceDirectory = fileURLToPath(new URL(".", import.meta.url))
const packageDirectory = fileURLToPath(new URL("..", import.meta.url))
const repositoryDirectory = fileURLToPath(new URL("../../../", import.meta.url))

const genericOrchestrationFiles = [
  "activation-coordinator.ts",
  "fresh-task-attempt-stages.ts",
  "journal-event-descriptor.ts",
  "journal-record-key.ts",
  "journal-store.ts",
  "journaled-workflow-interpreter.ts",
  "managed-activation.ts",
  "managed-history-result.ts",
  "managed-history-transition.ts",
  "managed-history.ts",
  "planned-attempt-executor-journal.ts",
  "planned-attempt-executor-workflow.ts",
  "planned-attempt-executor.ts",
  "planned-attempt-recovery-authority.ts",
  "production-application.ts",
  "reconstructed-managed-run-state.ts",
  "reconstructed-managed-run.ts",
  "runnable-transition-recovery.ts",
  "runnable-frontier.ts",
  "task-admission-controller.ts",
  "workflow-interpreters.ts",
  "workflow-operation.ts",
  "workflow-outcome.ts",
  "workflow-run.ts",
  "workflow.ts"
] as const

const displacedExecutorVocabulary =
  /ExecutorOuterInvocation|FreshCapacity|ImplementationConvergence|ImplementationReview|ImplementationEvidence|NonConvergent|OperationReservation|ProviderObservation|ReviewLoopInvocation|ReviewFindings|ReviewerSession|TaskExecution|TaskWorkProvider|TaskWorkSession|TechnicalRetry/
const displacedActivePolicyVocabulary = /task[- ]work(?:[- ]|\s)+(?:provider|session)|technical[- ]retry/i

it("generic orchestration uses a stage-name-free planned-attempt executor", () => {
  for (const file of genericOrchestrationFiles) {
    expect(
      readFileSync(`${sourceDirectory}/${file}`, "utf8"),
      `${file} must remain outside executor internals`
    ).not.toMatch(displacedExecutorVocabulary)
  }
})

it("active docs, models, and gates contain no displaced executor artifacts", () => {
  const roots = ["docs", "scripts", "specs"] as const
  for (const root of roots) {
    const directory = `${repositoryDirectory}/${root}`
    for (
      const file of readdirSync(directory, {
        recursive: true,
        withFileTypes: true
      })
    ) {
      if (!file.isFile()) continue
      const path = `${file.parentPath}/${file.name}`
      expect(path).not.toMatch(
        /frontierRecovery|taskWorkSessionRecovery|check-frontier-recovery-model/
      )
      expect(readFileSync(path, "utf8"), path).not.toMatch(
        displacedExecutorVocabulary
      )
      expect(readFileSync(path, "utf8"), path).not.toMatch(
        displacedActivePolicyVocabulary
      )
    }
  }
})

it("public emitted types expose no displaced executor contract", () => {
  const emittedTypeFiles = readdirSync(`${packageDirectory}/dist/src`)
    .filter((file) => file.endsWith(".d.ts"))
  for (const file of emittedTypeFiles) {
    expect(
      readFileSync(`${packageDirectory}/dist/src/${file}`, "utf8"),
      `${file} must expose no displaced executor contract`
    ).not.toMatch(displacedExecutorVocabulary)
  }
})
