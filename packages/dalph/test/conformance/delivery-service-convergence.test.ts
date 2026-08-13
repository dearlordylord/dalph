/* eslint-disable import/no-nodejs-modules -- These tests audit package source architecture. */
import { readdirSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const orchestratorSource = fileURLToPath(new URL("../../../orchestrator/src/", import.meta.url))
const dalphSource = fileURLToPath(new URL("../../src/", import.meta.url))
const runSourcePath = `${orchestratorSource}/coordination/run/run.ts`
const stabilizationSourcePath = `${orchestratorSource}/coordination/run/run-stabilization.ts`
const deliverySourcePath = `${orchestratorSource}/coordination/delivery/delivery.ts`
const deliveryRuntimeSourcePath = `${orchestratorSource}/coordination/delivery/run-delivery-runtime.ts`
const pauseObserverSourcePath = `${orchestratorSource}/coordination/run/pause-progress-observer.ts`

const sourceFilesUnder = (root: string): ReadonlyArray<string> =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(path)
    return extname(path) === ".ts" && !path.endsWith(".test.ts") ? [path] : []
  })

it("one idempotent Run entry installs the delivery service contracts", () => {
  const runSource = readFileSync(runSourcePath, "utf8")
  const stabilizationSource = readFileSync(stabilizationSourcePath, "utf8")

  expect(runSource.match(/\bconst consequences = yield\* delivery\b/g)).toHaveLength(1)
  expect(runSource.match(/\brunStabilizedDelivery\(/g)).toHaveLength(1)
  expect(stabilizationSource.match(/\brunDeliveryRuntimePhase\(/g)).toHaveLength(2)
  expect(runSource.match(/\brunJournaledDelivery\(/g)).toHaveLength(1)
  expect(runSource).toContain("bootstrap.activate")
  expect(runSource).not.toContain("bootstrap.fresh")
  expect(runSource).not.toContain("bootstrap.recovered")
  expect(runSource).not.toContain("bootstrap.controlled")
})

it("delivery consumers use the CurrentSignal attachment contract instead of local race protocols", () => {
  const deliveryRuntimeSource = readFileSync(deliveryRuntimeSourcePath, "utf8")
  const pauseObserverSource = readFileSync(pauseObserverSourcePath, "utf8")
  const stabilizationSource = readFileSync(stabilizationSourcePath, "utf8")

  expect(deliveryRuntimeSource).toContain("attachCurrentSignal(relation)")
  expect(deliveryRuntimeSource).not.toContain("Stream.drop(1)")
  expect(deliveryRuntimeSource).not.toContain("subscribedCurrent")
  expect(pauseObserverSource).toContain("attachCurrentSignal(resources.runtimeObservation)")
  expect(stabilizationSource).toContain("attachCurrentSignal(evaluations)")
  expect(stabilizationSource).not.toContain("Stream.concat(Stream.fromEffect(evaluations.get), evaluations.changes)")
})

it("keeps shared delivery and authored cassettes free of implementation-mode vocabulary", () => {
  const files = [...sourceFilesUnder(orchestratorSource), ...sourceFilesUnder(`${dalphSource}/cassettes`)]
  const violations = files.flatMap((path) => {
    const source = readFileSync(path, "utf8")
    return /\b(?:Synthetic|Simulated)\w*\b|\bflat\s+(?:Effect|composition|delivery|relation|runtime|workflow)\b|\bflat-delivery\b|\brunFlat\w*\b/i.test(
      source
    )
      ? [path]
      : []
  })

  expect(violations).toEqual([])
  expect(readFileSync(`${dalphSource}/cassettes/catalog.ts`, "utf8")).not.toMatch(
    /\b(?:controlled|dry[- ]run|fake|synthetic)\b/i
  )
})

it("keeps the descriptive delivery composition to its five ordered arrows", () => {
  const deliverySource = readFileSync(deliverySourcePath, "utf8")
  const body = deliverySource.slice(deliverySource.indexOf("export const delivery"))
  const arrows = [
    "frontierOf",
    "boundedParallelTickets",
    "executorResponsibilities",
    "deliverySettlements",
    "reflectDeliverySettlements"
  ]

  const positions = arrows.map((arrow) => body.indexOf(arrow))
  expect(
    positions.every((position) => position !== -1),
    `every arrow appears: ${arrows.join(", ")}`
  ).toBe(true)
  expect(positions).toEqual([...positions].toSorted((left, right) => left - right))
})
