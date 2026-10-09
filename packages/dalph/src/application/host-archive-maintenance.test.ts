import { RunId } from "@dalph/contracts"
import {
  JournalStore,
  JournalStorageUnavailable,
  InitialControlPolicy,
  TaskWorkCapacity,
  observeArchiveRetention,
  type JournalMaintenanceDiagnostic,
  memoryJournalStoreLayer
} from "@dalph/orchestrator"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { remotePublicationTargetForTest } from "../../../orchestrator/test/support/direct-publication.js"
import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { makeHostArchiveMaintenance } from "./host-archive-maintenance.js"

it.effect("the host runs startup maintenance once, waits a finite interval and stops on Exit", () =>
  Effect.gen(function* () {
    const count = yield* Ref.make(0)
    const owner = yield* makeHostArchiveMaintenance(() => Ref.update(count, (n) => n + 1))
    expect(yield* Ref.get(count)).toBe(1)
    yield* TestClock.adjust("59 seconds")
    expect(yield* Ref.get(count)).toBe(1)
    yield* TestClock.adjust("1 second")
    expect(yield* Ref.get(count)).toBe(2)
    yield* TestClock.adjust("1 minute")
    expect(yield* Ref.get(count)).toBe(3)
    yield* owner.stop
    yield* TestClock.adjust("2 minutes")
    expect(yield* Ref.get(count)).toBe(3)
  })
)

it.effect("the owning host observes one storage failure without retrying before the next normal pass", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const calls = yield* Ref.make(0)
    const diagnostics = yield* Ref.make<ReadonlyArray<JournalMaintenanceDiagnostic>>([])
    const lifecycle = {
      ...journal,
      maintainArchive: () =>
        Ref.updateAndGet(calls, (n) => n + 1).pipe(
          Effect.flatMap((n) =>
            n === 1
              ? Effect.fail(
                  new JournalStorageUnavailable({
                    operation: "JournalStore.maintainArchive",
                    detail: "controlled startup failure"
                  })
                )
              : journal.maintainArchive()
          )
        )
    }
    const owner = yield* makeHostArchiveMaintenance(() =>
      observeArchiveRetention(RunId.make("host-observation"), lifecycle, {
        observe: (diagnostic) => Ref.update(diagnostics, (items) => [...items, diagnostic])
      })
    )
    expect(yield* Ref.get(diagnostics)).toMatchObject([
      { operation: "JournalStore.maintainArchive", failure: { _tag: "JournalStorageUnavailable" } }
    ])
    const active = RunId.make("unrelated-active")
    yield* journal.beginRun(
      active,
      FixtureTarget.make("unrelated"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      remotePublicationTargetForTest
    )
    expect((yield* journal.read(active)).length).toBe(1)
    yield* TestClock.adjust("59 seconds")
    expect(yield* Ref.get(calls)).toBe(1)
    yield* TestClock.adjust("1 second")
    expect(yield* Ref.get(calls)).toBe(2)
    expect((yield* journal.read(active)).length).toBe(1)
    expect((yield* Ref.get(diagnostics)).length).toBe(1)
    yield* owner.stop
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
