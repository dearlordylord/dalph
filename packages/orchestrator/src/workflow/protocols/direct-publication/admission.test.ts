import { RemotePublicationBranchRef, RemotePublicationEndpoint, RemotePublicationTarget, RunId } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { journalLayer } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { admitRemotePublicationTarget } from "./admission.js"
import { RemotePublicationGit, type RemotePublicationGitService } from "./events.js"

const runId = RunId.make("publication-admission-restart")
const trackerTarget = FixtureTarget.make("publication-admission-restart")
const target = remotePublicationTargetForTest
const remoteHead = integrationFinalityFixture.qualifiedCandidate.candidateCommit

const begin = Effect.gen(function* () {
  const store = yield* JournalStore
  yield* store.beginRun(
    runId,
    trackerTarget,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
    target
  )
  return store
})

const invoke = Effect.fn("AdmissionTest.invoke")(function* (
  store: JournalStore["Service"],
  git: RemotePublicationGitService,
  requestedTarget: RemotePublicationTarget = target
) {
  const records = yield* store.read(runId)
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die("invalid admission fixture prefix")
  return yield* admitRemotePublicationTarget(runId, requestedTarget).pipe(
    Effect.provide(journalLayer(runId, trackerTarget, history, store)),
    Effect.provideService(RemotePublicationGit, git)
  )
})

const gitFor = (admit: RemotePublicationGitService["admit"]): RemotePublicationGitService =>
  RemotePublicationGit.of({
    admit,
    observe: () => Effect.die("admission cannot observe a candidate"),
    prepareSenderCustody: () => Effect.die("admission cannot reserve a push"),
    reconcileSenderCustody: () => Effect.die("admission cannot reconcile a sender"),
    push: () => Effect.die("admission cannot push")
  })

it.effect(
  "admits one pinned endpoint and branch before claim and restores the prior admission without another Git read",
  () =>
    Effect.gen(function* () {
      const store = yield* begin
      const calls = yield* Ref.make(0)
      const git = gitFor(() =>
        Effect.gen(function* () {
          const records = yield* store.read(runId).pipe(Effect.orDie)
          expect(records.map(({ event }) => event._tag)).toEqual([
            "WorkflowRunBegan",
            "RemotePublicationAdmissionReadIntended"
          ])
          yield* Ref.update(calls, (count) => count + 1)
          return { _tag: "ExistingBranch" as const, remoteHead }
        })
      )
      expect((yield* invoke(store, git))._tag).toBe("ExistingBranch")
      const admitted = yield* store.read(runId)
      // Another process activates after external Git may have changed. Admission restores its immutable result.
      const restored = yield* invoke(
        store,
        gitFor(() => Effect.die("restart must not reread a conclusive admission"))
      )
      expect(restored._tag).toBe("ExistingBranch")
      expect(yield* store.read(runId)).toEqual(admitted)
      expect(yield* Ref.get(calls)).toBe(1)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("rejects a changed restart destination before appending or reading Git", () =>
  Effect.gen(function* () {
    const store = yield* begin
    const before = yield* store.read(runId)
    const changedTargets = [
      RemotePublicationTarget.make({ ...target, branch: RemotePublicationBranchRef.make("refs/heads/other") }),
      RemotePublicationTarget.make({
        ...target,
        endpoint: RemotePublicationEndpoint.make("ssh://git@example.invalid/another-repository.git")
      })
    ]
    for (const changed of changedTargets) {
      const result = yield* invoke(
        store,
        gitFor(() => Effect.die("changed Run target must fail before Git")),
        changed
      ).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      expect(yield* store.read(runId)).toEqual(before)
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect(
  "recovers a committed admission intent and preserves a missing-branch rejection without automatic reread",
  () =>
    Effect.gen(function* () {
      const store = yield* begin
      const interrupted = yield* invoke(
        store,
        gitFor(() => Effect.die("host stopped before read response"))
      ).pipe(Effect.exit)
      expect(interrupted._tag).toBe("Failure")
      expect((yield* store.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "RemotePublicationAdmissionReadIntended"
      ])
      const missing = gitFor(() => Effect.succeed({ _tag: "TargetMissing" }))
      expect((yield* invoke(store, missing).pipe(Effect.result))._tag).toBe("Failure")
      const rejected = yield* store.read(runId)
      expect(
        (yield* invoke(
          store,
          gitFor(() => Effect.die("conclusive rejection must remain retained"))
        ).pipe(Effect.result))._tag
      ).toBe("Failure")
      expect(yield* store.read(runId)).toEqual(rejected)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
)
