import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { JournalPosition } from "@dalph/orchestrator"
import { RunId, TaskId } from "@dalph/contracts"
import { compactFixturePrivateMarker, compactSnapshotFixture } from "../../test-support/compact-snapshot-fixture.js"
import { RequestId, type RunningHostEnvelope, runningHostFailureEnvelope } from "./running-host-contract.js"
import {
  CompactRunningHostEnvelope,
  compactRunningHostEnvelope,
  encodeCompactRunningHostEnvelope
} from "./running-host-compact.js"
import type { RunningHostSnapshot } from "./running-host-snapshot.js"

const envelope = (value: RunningHostSnapshot): RunningHostEnvelope => ({
  protocolVersion: 1,
  requestId: RequestId.make("compact-test"),
  runId: value.runId,
  result: { _tag: "Success", value }
})

it("preserves active facts and every blocked category", () => {
  const snapshot = compactSnapshotFixture()
  const compact = compactRunningHostEnvelope(envelope(snapshot))
  expect(compact.runId).toBe(snapshot.runId)
  expect(compact.result).toMatchObject({
    _tag: "Success",
    publication: "Ready",
    observation: {
      _tag: "Available",
      acceptedAt: { runId: snapshot.runId, position: 617 },
      graph: {
        _tag: "Available",
        total: 500,
        byLifecycle: { Open: 167, CompletedSuccessfully: 167, TerminalWithoutSuccess: 166 }
      },
      delivery: {
        _tag: "Available",
        byClassification: { Blocked: 5, Waiting: 1, Progressing: 1 },
        byKind: {
          ExecutorFailure: 1,
          ExecutorResultRejected: 1,
          TargetPromotionSafetyRefused: 1,
          EvidenceUnavailable: 1,
          EvidenceConflict: 1,
          DependencyWait: 1,
          LiveDeliveryAction: 1
        },
        byFailure: { ProviderFailed: 1 },
        blocked: { total: 5, omitted: 2 },
        waiting: { total: 1, omitted: 0 }
      },
      diagnostics: {
        byPhase: { Executing: 1, Failed: 2, Rejected: 1 },
        byRecovery: { NotApplicable: 1, Unavailable: 1, RestartOnly: 1, ExplicitDirectionRequired: 1 },
        trackerWait: "Throttled",
        baseAdmission: "QualificationRefused",
        baseRefusals: { TargetHead: 1 }
      },
      held: { total: 1 },
      retained: { total: 4, omitted: 1 },
      cleanup: { _tag: "Unavailable", reason: "CleanupNotInSnapshot" },
      retainedByKind: {
        WorkflowResponsibility: 1,
        AcceptedAwaitingIntegration: 1,
        QueuedIntegration: 1,
        StartedIntegration: 1
      }
    }
  })
  const all = compactRunningHostEnvelope(envelope(snapshot), 10)
  expect(all.result).toMatchObject({
    observation: {
      delivery: {
        blocked: { items: expect.arrayContaining([{ taskId: null, kind: "EvidenceUnavailable", failureCode: null }]) }
      }
    }
  })
})

it("keeps Closed and unavailable publication distinct", () => {
  const runId = RunId.make("unavailable-run")
  expect(compactRunningHostEnvelope(envelope({ _tag: "NotReady", runId })).result).toEqual({
    _tag: "Success",
    publication: "NotReady",
    observation: { _tag: "Unavailable" }
  })
  expect(compactRunningHostEnvelope(envelope({ _tag: "Closed", runId, final: null })).result).toEqual({
    _tag: "Success",
    publication: "Closed",
    observation: { _tag: "Unavailable" }
  })
  const ready = compactSnapshotFixture(0)
  expect(compactRunningHostEnvelope(envelope(ready)).result).toMatchObject({ publication: "Ready" })
  expect(
    compactRunningHostEnvelope(envelope({ _tag: "Closed", runId: ready.runId, final: ready })).result
  ).toMatchObject({ publication: "Closed", observation: { _tag: "Available" } })
  expect(
    compactRunningHostEnvelope(
      envelope({
        ...ready,
        graph: { _tag: "GraphNotEstablished" },
        delivery: {
          _tag: "DeliveryStatusAvailable",
          acceptedAt: JournalPosition.make(617),
          entries: [],
          subject: { _tag: "Run", runId: ready.runId }
        }
      })
    ).result
  ).toMatchObject({ observation: { graph: { _tag: "Unavailable" }, diagnostics: { _tag: "Unavailable" } } })
})

it.effect("retains failures while excluding free-form payloads", () =>
  Effect.gen(function* () {
    const failed = runningHostFailureEnvelope(null, {
      _tag: "TransportFailed",
      phase: "Response",
      reason: compactFixturePrivateMarker
    })
    const text = yield* encodeCompactRunningHostEnvelope(failed)
    expect(JSON.parse(text).result).toEqual({
      _tag: "Failure",
      category: "TransportFailed",
      phase: "Response",
      detailsOmitted: true
    })
    expect(text).not.toContain(compactFixturePrivateMarker)
    const snapshot = yield* encodeCompactRunningHostEnvelope(envelope(compactSnapshotFixture()))
    expect(snapshot).not.toContain(compactFixturePrivateMarker)
    expect(snapshot).not.toContain("/tmp/")
    expect(snapshot).not.toContain("refs/heads/")
    expect(Schema.decodeUnknownSync(CompactRunningHostEnvelope)(JSON.parse(snapshot)).result._tag).toBe("Success")
  })
)

it.effect("bounds oversized examples without dropping counts", () =>
  Effect.gen(function* () {
    const ready = compactSnapshotFixture(3000)
    const [held] = ready.held
    if (held === undefined) return expect.fail("requires fixture held responsibility")
    const longTaskId = TaskId.make("🦊".repeat(1000))
    const text = yield* encodeCompactRunningHostEnvelope(
      envelope({
        ...ready,
        held: Array.from({ length: 1000 }, () => ({ taskId: longTaskId, correlation: held.correlation }))
      })
    )
    expect(new TextEncoder().encode(text + "\n").byteLength).toBeLessThanOrEqual(8192)
    expect(JSON.parse(text).result.observation).toMatchObject({
      graph: { total: 3000 },
      held: { total: 1000, items: [], omitted: 1000 }
    })
    const ordinary = JSON.stringify(envelope(ready))
    expect(ordinary.length).toBeGreaterThan(1000000)
    expect(ordinary).toContain(compactFixturePrivateMarker)
  })
)

it.effect("reduces examples under escaped UTF-8 pressure and refuses oversized essential identity", () =>
  Effect.gen(function* () {
    const pressured = compactSnapshotFixture(0, "\u0001".repeat(128))
    const unbounded = JSON.stringify(compactRunningHostEnvelope(envelope(pressured)))
    const bounded = yield* encodeCompactRunningHostEnvelope(envelope(pressured))
    expect(new TextEncoder().encode(unbounded + "\n").byteLength).toBeGreaterThan(8192)
    expect(new TextEncoder().encode(bounded + "\n").byteLength).toBeLessThanOrEqual(8192)
    expect(JSON.parse(bounded).result.observation).toMatchObject({
      delivery: { blocked: { total: 5 }, byClassification: { Blocked: 5, Waiting: 1, Progressing: 1 } },
      diagnostics: { failures: { total: 3 } },
      retained: { total: 4 }
    })
    const source = envelope(pressured)
    const outcome = yield* encodeCompactRunningHostEnvelope({
      ...source,
      requestId: RequestId.make("identity".repeat(2000))
    }).pipe(Effect.result)
    expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "FrameTooLarge", maximumBytes: 8192 } })
  })
)
