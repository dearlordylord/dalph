/* eslint-disable import/no-nodejs-modules -- This test audits package source rather than application behavior. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const orchestratorSource = fileURLToPath(new URL("../../../orchestrator/src/", import.meta.url))
const runSourcePath = `${orchestratorSource}/coordination/run/run.ts`
const deliverySourcePath = `${orchestratorSource}/coordination/delivery/delivery.ts`

/**
 * The flat delivery composition is a shape, not a behavior, so nothing else can
 * check it. One descriptive composition and one runtime consumer is the whole
 * architecture: a second `delivery.pipe(` or a second `runDeliveryRuntime(` is
 * an alternate scheduler, which is what the flat cutover removed.
 */
it("runs every mode through one descriptive delivery and one runtime consumer", () => {
  const runSource = readFileSync(runSourcePath, "utf8")

  expect(runSource.match(/\bconst consequences = yield\* delivery\b/g)).toHaveLength(1)
  expect(runSource.match(/\brunDeliveryRuntime\(/g)).toHaveLength(1)
  expect(runSource).toContain("makeJournaledDeliveryRelations")
  expect(runSource).toContain("makeSyntheticDeliveryRelations")
})

/**
 * The descriptive composition names its arrows in order. Each is a pure
 * projection covered per surface in
 * `research/verification-bakeoff/INVARIANTS.md`; reordering or dropping one
 * changes which invariants the chain can carry.
 */
it("keeps the descriptive delivery composition to its five ordered arrows", () => {
  const deliverySource = readFileSync(deliverySourcePath, "utf8")
  // Imports name the same arrows, so only the composition body is inspected.
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
