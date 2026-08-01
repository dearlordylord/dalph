/* eslint-disable import/no-nodejs-modules -- This test audits package source files rather than application runtime behavior. */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const orchestratorSourceDirectory = fileURLToPath(new URL("../../../orchestrator/src/", import.meta.url))
const dalphSourceDirectory = fileURLToPath(new URL("../../src/", import.meta.url))
const runDirectory = `${orchestratorSourceDirectory}/coordination/run`

const productionTypeScriptFiles = (directory: string) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".ts") && !file.name.endsWith(".test.ts"))
    .map((file) => `${file.parentPath}/${file.name}`)

it("removes the callback-linked fresh-stage implementation", () => {
  expect(existsSync(`${runDirectory}/fresh-activation.ts`)).toBe(false)
  expect(existsSync(`${runDirectory}/fresh-task-attempt-stages.ts`)).toBe(false)

  for (const path of productionTypeScriptFiles(orchestratorSourceDirectory)) {
    expect(readFileSync(path, "utf8"), `${path} must not restore the retired stage chain`).not.toMatch(
      /FreshWorkflowStage|makeFreshTaskAttemptStage/
    )
  }
})

it("keeps application entry points behind the delivery activation boundary", () => {
  for (const path of productionTypeScriptFiles(dalphSourceDirectory)) {
    expect(readFileSync(path, "utf8"), `${path} must not assemble delivery internals`).not.toMatch(
      /coordination\/(?:activation\/coordinator|run\/(?:current-delivery-relation|fresh-workflow|run-fresh-workflow-step))/
    )
  }

  const runSource = readFileSync(`${runDirectory}/run.ts`, "utf8")
  expect(runSource).toContain('Effect.fn("DeliveryActivation.run")')
  expect(runSource).toContain('Effect.fn("DeliveryActivation.readTurn")')
  expect(runSource).toContain('Effect.fn("DeliveryActivation.turn")')
  expect(runSource.match(/makeActivationCoordinator\(/g)).toHaveLength(1)
  expect(runSource).not.toContain("drainPausedRunTransitions")
  expect(runSource).toMatch(/admissionController\.resize\(turn\.policy\.taskExecutionCapacity\)/)
  expect(runSource).toMatch(/coordinator\.signal\(cause\)/)
})
