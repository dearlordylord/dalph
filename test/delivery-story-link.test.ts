/* eslint-disable import/no-nodejs-modules -- This acceptance test audits the checked-in documentation contract. */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { maintainedAuthoredCassetteCatalog } from "../packages/dalph/src/cassettes/catalog.js"
import {
  deliveryStoryManifest,
  renderDeliveryStoryManifest
} from "../packages/dalph/src/cassettes/delivery-story-manifest.js"
import { maintainedIntegrationFinalityProtocolCassetteCatalog } from "../packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.js"
import { issue268ControlledDeliveryCassetteCatalog } from "../packages/dalph/test-support/issue-268-controlled-occurrence-cassette.js"
import { issue274RetainedCCassetteCatalog } from "../packages/dalph/test-support/issue-274-retained-c-cassette.js"
import { issue275ActiveGraphRefreshCassetteCatalog } from "../packages/dalph/test-support/issue-275-active-graph-refresh-cassette.js"
import {
  issue268AcceptedOccurrenceOrder,
  issue268AcceptedOccurrenceOrderDigest
} from "../packages/dalph/test-support/issue-268-controlled-occurrence-cassette-data.js"

it("keeps the issue 276 position slice alongside the complete DS-21 capstone", () => {
  const beat = deliveryStoryManifest.beats.find(({ beatId }) => beatId === "DS-21")
  expect(beat?.coverage._tag).toBe("DemonstratedByMaintainedSlice")
  if (beat?.coverage._tag !== "DemonstratedByMaintainedSlice") return expect.fail("DS-21 capstone coverage is missing")
  expect(beat.coverage.cassetteKeys).toContain("authored:deliveryInvariantStoryCapstone")
  const scenarioName = "issue-276-release-exact-task-positions.md"
  const index = readFileSync(new URL("../docs/scenarios/README.md", import.meta.url), "utf8")
  expect(index).toContain(scenarioName)
  const scenario = readFileSync(new URL(`../docs/scenarios/${scenarioName}`, import.meta.url), "utf8")
  const tests = readFileSync(
    new URL("../packages/dalph/test/cassettes/issue-276-position-release.test.ts", import.meta.url),
    "utf8"
  )
  for (const name of [
    "releases B C and D positions to E F and G while B holds integration",
    "serializes distinct B through G sessions resources and candidates in accepted order"
  ]) {
    expect(scenario).toContain(name)
    expect(tests).toContain(JSON.stringify(name))
  }
})

it("delivery story manifest names the executed capstone and contains no unsupported beat", () => {
  expect(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone).toBeDefined()
  expect(deliveryStoryManifest.beats).toHaveLength(22)
  const capstoneTests = readFileSync(
    new URL("../packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts", import.meta.url),
    "utf8"
  )
  for (const name of [
    "maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run",
    "completes the uninterrupted seven-task run after reconciling A FullRerun predecessor cleanup",
    "replays the maintained capstone with the same exact chronology"
  ]) {
    expect(capstoneTests).toContain(JSON.stringify(name))
  }
  for (const { coverage } of deliveryStoryManifest.beats) {
    expect(coverage._tag).toBe("DemonstratedByMaintainedSlice")
    if (coverage._tag !== "DemonstratedByMaintainedSlice") continue
    expect(coverage.cassetteKeys).toContain("authored:deliveryInvariantStoryCapstone")
  }
})

it("keeps every delivery-story beat linked to maintained evidence or an explicit implementation gap", () => {
  const document = readFileSync(new URL("../docs/DELIVERY-STORY.md", import.meta.url), "utf8")
  const documentedBeatIds = Array.from(
    document.matchAll(/^\*\*(\d+)\.\*\*/gm),
    ([, beat]) => `DS-${beat?.padStart(2, "0")}`
  )
  const manifestBlock = document.match(
    /<!-- DELIVERY-STORY-MANIFEST:START -->[\s\S]*?<!-- DELIVERY-STORY-MANIFEST:END -->/
  )?.[0]
  const catalogHas = (key: string): boolean => {
    const [catalog, name] = key.split(":")
    return (
      (catalog === "authored" && name !== undefined && name in maintainedAuthoredCassetteCatalog) ||
      (catalog === "controlled" &&
        name !== undefined &&
        (name in issue268ControlledDeliveryCassetteCatalog ||
          name in issue274RetainedCCassetteCatalog ||
          name in issue275ActiveGraphRefreshCassetteCatalog)) ||
      (catalog === "integration-finality" &&
        name !== undefined &&
        name in maintainedIntegrationFinalityProtocolCassetteCatalog)
    )
  }
  const acceptanceTestExists = (acceptance: {
    readonly declaration: "it" | "it.effect" | "scenario"
    readonly name: string
    readonly sourceFile: string
  }): boolean => {
    const source = readFileSync(new URL(`../${acceptance.sourceFile}`, import.meta.url), "utf8")
    const declaration = acceptance.declaration.replace(".", "\\.")
    return new RegExp(`${declaration}\\(\\s*${JSON.stringify(acceptance.name)}`).test(source)
  }

  expect(documentedBeatIds).toEqual(deliveryStoryManifest.beats.map(({ beatId }) => beatId))
  expect(manifestBlock).toBe(renderDeliveryStoryManifest())
  expect(document).toContain(`maintained catalog keys are \`${deliveryStoryManifest.cassetteKey}\``)
  expect(document).toContain("`authored:deliveryInvariantStoryCapstone`")
  expect(deliveryStoryManifest.cassetteAcceptanceTests.length).toBeGreaterThan(0)
  expect(deliveryStoryManifest.cassetteAcceptanceTests.every(acceptanceTestExists)).toBe(true)
  expect(createHash("sha256").update(JSON.stringify(issue268AcceptedOccurrenceOrder)).digest("hex")).toBe(
    issue268AcceptedOccurrenceOrderDigest
  )
  for (const { coverage } of deliveryStoryManifest.beats) {
    if (coverage._tag === "NotImplemented") {
      expect(coverage.reason.length).toBeGreaterThan(0)
      expect(coverage.cassetteKeys).toEqual([])
      expect(coverage.acceptanceTests).toEqual([])
    } else {
      expect(coverage.cassetteKeys.length).toBeGreaterThan(0)
      expect(coverage.cassetteKeys.every(catalogHas)).toBe(true)
      expect(coverage.acceptanceTests.length).toBeGreaterThan(0)
      expect(coverage.acceptanceTests.every(acceptanceTestExists)).toBe(true)
    }
  }
})
