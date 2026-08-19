import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import * as Orchestrator from "@dalph/orchestrator"
import {
  CassetteIdentityRenaming,
  foldRecordedCassette,
  maintainedAuthoredCassetteCatalog,
  projectRecordedCassette,
  renameRecordedCassette,
  renderRecordedCassetteLyrics,
  runAuthoredScenarioCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"

const allMaintainedCassetteRoundTripTimeout = 600_000
const removedIntegrationSurfacePrefixes = [
  "IntegrationCandidate",
  "TargetVerification",
  "RepositoryResourceLock",
  "continueIntegrationCandidateConstruction"
] as const

const removedIntegrationSurfaceNames = (names: ReadonlyArray<string>) =>
  names.filter((name) => removedIntegrationSurfacePrefixes.some((prefix) => name.startsWith(prefix)))

it.effect(
  "keeps maintained authored and recorded catalogs and public exports free of legacy integration tags",
  () =>
    Effect.gen(function* () {
      const emptyRenaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [],
        integratorCandidateResourceLocators: [],
        integratorSessionIds: [],
        claimTokens: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [],
        worktreeLocators: []
      })
      expect(removedIntegrationSurfaceNames(Object.keys(Orchestrator))).toEqual([])

      for (const [name, cassette] of Object.entries(maintainedAuthoredCassetteCatalog)) {
        expect(removedIntegrationSurfaceNames(cassette.story.map(({ _tag }) => _tag)), name).toEqual([])
        const run = yield* runAuthoredScenarioCassette(cassette)
        const recorded = yield* projectRecordedCassette(run.records)
        expect(removedIntegrationSurfaceNames(recorded.entries.map(({ _tag }) => _tag)), name).toEqual([])
        const folded = foldRecordedCassette(recorded)
        expect(folded._tag, `${name} must fold through its recorded inverse`).toBe("ValidWorkflowJournalHistory")
        expect(renderRecordedCassetteLyrics(recorded), `${name} must render its recorded chronology`).not.toBe("")

        expect(
          verifyRecordedCassetteRoundTrip(run.records, recorded).every(
            ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
          ),
          `${name} must preserve state, selection, and history through projection`
        ).toBe(true)

        const renamed = yield* renameRecordedCassette(recorded, emptyRenaming)
        expect(
          (yield* verifyRecordedCassetteRoundTripWithRenaming(run.records, renamed, emptyRenaming)).every(
            ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
          ),
          `${name} must preserve state, selection, and history through empty alpha-renaming`
        ).toBe(true)
      }
    }).pipe(Effect.provide(NodeCrypto.layer)),
  allMaintainedCassetteRoundTripTimeout
)
