/* eslint-disable import/no-nodejs-modules -- This candidate-only test audits its temporary source reachability. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect, it as vitestIt } from "vitest"
import { maintainedAuthoredCassetteCatalog } from "../../src/cassettes/catalog.js"
import { runCandidateDeliveryRuntimeCassette } from "../../src/cassettes/candidate-delivery-runtime-runner.js"

const dalphSource = fileURLToPath(new URL("../../src/", import.meta.url))

vitestIt("keeps the candidate runtime unreachable from public and production entrypoints", () => {
  for (const relativePath of ["index.ts", "cassettes/index.ts", "cassettes/authored.ts"]) {
    expect(readFileSync(`${dalphSource}/${relativePath}`, "utf8"), relativePath).not.toMatch(
      /CandidateDeliveryRuntime|runCandidateDeliveryRuntime/
    )
  }
  for (const relativePath of [
    "application/cli.ts",
    "application/composition.ts",
    "application/dry-run.ts",
    "application/production.ts"
  ]) {
    expect(readFileSync(`${dalphSource}/${relativePath}`, "utf8"), relativePath).not.toMatch(
      /CandidateDeliveryRuntime|runDeliveryRuntime/
    )
  }
})

for (const [catalogName, cassette] of Object.entries(maintainedAuthoredCassetteCatalog)) {
  it.effect(`candidate runtime preserves maintained chronology: ${catalogName}`, () =>
    Effect.gen(function* () {
      const run = yield* runCandidateDeliveryRuntimeCassette(cassette).pipe(Effect.provide(NodeCrypto.layer))

      expect(run.cassette.name).toBe(cassette.name)
    })
  )
}
