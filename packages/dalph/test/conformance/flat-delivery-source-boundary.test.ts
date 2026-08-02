/* eslint-disable import/no-nodejs-modules -- This test audits package source rather than application behavior. */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const orchestratorSource = fileURLToPath(new URL("../../../orchestrator/src/", import.meta.url))
const dalphSource = fileURLToPath(new URL("../../src/", import.meta.url))
const runDirectory = `${orchestratorSource}/coordination/run`
const deliveryDirectory = `${orchestratorSource}/coordination/delivery`

const productionTypeScriptFiles = (directory: string) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".ts") && !file.name.endsWith(".test.ts"))
    .map((file) => `${file.parentPath}/${file.name}`)

it("deletes the former scheduler and candidate application seams", () => {
  for (const retired of [
    `${runDirectory}/fresh-activation.ts`,
    `${runDirectory}/fresh-task-attempt-stages.ts`,
    `${runDirectory}/run-fresh-workflow-step.ts`,
    `${runDirectory}/current-delivery-relation.ts`,
    `${runDirectory}/integration-transition-runtime.ts`,
    `${orchestratorSource}/coordination/activation/coordinator.ts`,
    `${orchestratorSource}/coordination/admission/controller.ts`,
    `${deliveryDirectory}/boundary-delivery-shadow.ts`,
    `${deliveryDirectory}/quiescence-delivery-shadow.ts`,
    `${deliveryDirectory}/delivery-shadow.ts`,
    `${dalphSource}/cassettes/candidate-delivery-runtime-runner.ts`
  ]) {
    expect(existsSync(retired), retired).toBe(false)
  }

  for (const path of productionTypeScriptFiles(orchestratorSource)) {
    expect(readFileSync(path, "utf8"), `${path} must not restore an alternate scheduler`).not.toMatch(
      /runDeliveryActivation|readDeliveryActivationTurn|checkedTurn|makeActivationCoordinator|makeTaskAdmissionController|runFreshWorkflowStep/
    )
  }
})

it("connects all modes through one flat delivery runtime boundary", () => {
  const runSource = readFileSync(`${runDirectory}/run.ts`, "utf8")
  expect(runSource.match(/\bdelivery\.pipe\(/g)).toHaveLength(1)
  expect(runSource.match(/\brunDeliveryRuntime\(/g)).toHaveLength(1)
  expect(runSource).toContain("makeJournaledDeliveryRelations")
  expect(runSource).toContain("makeSyntheticDeliveryRelationsLayer")

  for (const path of productionTypeScriptFiles(dalphSource)) {
    expect(readFileSync(path, "utf8"), `${path} must use the package application boundary`).not.toMatch(
      /coordination\/(?:activation|delivery|frontier|run)\//
    )
  }
})

it("keeps the runtime consumer independent of domain projection implementations", () => {
  const runtimeSource = readFileSync(`${deliveryDirectory}/run-delivery-runtime.ts`, "utf8")
  expect(runtimeSource).not.toMatch(/from "\.\/(?:ticket-delivery-projection|delivery-shadow|delivery-settlement)/)
  expect(runtimeSource).not.toMatch(
    /from "\.\.\/(?:frontier\/(?:frontier|fresh-facts|integration-frontier|recovery|recovery-frontier)|reconstruction|run\/fresh-workflow)/
  )
})

it("keeps recovered action execution out of the read-only recovery projection", () => {
  const recoveryProjectionSource = readFileSync(`${runDirectory}/recovery-activation.ts`, "utf8")
  const recoveredActionAdapterSource = readFileSync(`${deliveryDirectory}/recovered-delivery-action-adapter.ts`, "utf8")

  expect(recoveryProjectionSource).not.toMatch(
    /runTaskClaimReacquisition|WorkflowInterpreter|OperationSelected|TaskClaimAcquisitionPlanner/
  )
  expect(recoveredActionAdapterSource).not.toMatch(/from "\.\.\/run\//)
  expect(recoveredActionAdapterSource).toContain('from "../../workflow/protocols/task-claim-reacquisition/execute.js"')
})
