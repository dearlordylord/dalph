/* eslint-disable import/no-nodejs-modules -- This acceptance test audits the checked-in documentation contract. */
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { maintainedAuthoredCassetteCatalog } from "../packages/dalph/src/cassettes/catalog.js"
import {
  deliveryStoryManifest,
  renderDeliveryStoryManifest
} from "../packages/dalph/src/cassettes/delivery-story-manifest.js"
import { maintainedIntegrationFinalityProtocolCassetteCatalog } from "../packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.js"

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
  expect(deliveryStoryManifest.cassetteKey).toBe("authored:deliveryInvariantStory")
  expect(document).toContain(`maintained catalog key is \`${deliveryStoryManifest.cassetteKey}\``)
  expect(deliveryStoryManifest.cassetteAcceptanceTests.length).toBeGreaterThan(0)
  expect(deliveryStoryManifest.cassetteAcceptanceTests.every(acceptanceTestExists)).toBe(true)
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
  expect(
    deliveryStoryManifest.beats
      .slice(0, 13)
      .map(({ beatId, coverage }) => ({ beatId, cassetteKeys: coverage.cassetteKeys, coverage: coverage._tag }))
  ).toEqual(
    Array.from({ length: 13 }, (_, index) =>
      index === 4
        ? { beatId: "DS-05", cassetteKeys: [], coverage: "NotImplemented" }
        : {
            beatId: `DS-${String(index + 1).padStart(2, "0")}`,
            cassetteKeys: ["authored:autonomousExecutorDeliveryCapstone"],
            coverage: "DemonstratedByMaintainedSlice"
          }
    )
  )
})
