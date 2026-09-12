import * as fc from "fast-check"
import { NodeCrypto } from "@effect/platform-node"
import { it as effectIt } from "@effect/vitest"
import { Effect } from "effect"
import { expect, it } from "vitest"
import { RunId } from "@dalph/contracts"
import {
  InitialControlPolicy,
  JournalPosition,
  JournalRecordKey,
  RunPolicyRevision,
  TaskWorkCapacity,
  TaskWorkCapacityChangedEvent,
  WorkflowActor,
  describeJournalEvent,
  exportWorkflowHistoryRecords,
  initialRunPolicyRevision,
  reduceWorkflowJournalHistory,
  workflowJournalEventVersion,
  type JournalRecord
} from "@dalph/orchestrator"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { observeWorkflowJournalValidationSteps } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { makeWorkflowRunBeganRecord } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { observeJournalRecordSequenceOperations } from "../../../orchestrator/src/workflow-journal/record-sequence.js"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"
import {
  RecordedCassette,
  foldRecordedCassette,
  projectRecordedCassette,
  runAuthoredScenarioCassette,
  singletonTaskCompletesAuthoredCassette,
  verifyRecordedCassetteRoundTrip,
  type RecordedCassetteCheckpoint,
  type RecordedCassetteEntry
} from "../../src/cassettes/index.js"
import {
  appliedOccurrencePosition,
  semanticJson,
  semanticResponsibilityFacts,
  semanticState
} from "../../src/cassettes/recorded-semantic-state.js"

const historyMeanings = (history: ReturnType<typeof reduceWorkflowJournalHistory>) => {
  if (history._tag === "InvalidWorkflowJournalHistory")
    return { _tag: history._tag, issueKinds: history.issues.map(({ _tag }) => _tag) }
  const records = exportWorkflowHistoryRecords(history.runState.workflowHistory)
  return records.length === 0 ? [] : Effect.runSync(projectRecordedCassette(records)).entries
}

// Retained pre-optimization cold algorithm: both sides independently fold every
// complete prefix. The projection above only removes physical envelope fields.
const coldOracle = (
  records: ReadonlyArray<JournalRecord>,
  cassette: RecordedCassette
): ReadonlyArray<RecordedCassetteCheckpoint> =>
  records.map((_record, index) => {
    const checkpoint = index + 1
    const expected = reduceWorkflowJournalHistory(cassette.runId, records.slice(0, checkpoint))
    const actual = foldRecordedCassette(
      RecordedCassette.make({ ...cassette, entries: cassette.entries.slice(0, checkpoint) })
    )
    return {
      checkpoint,
      appliedOccurrencePositionEquivalent: appliedOccurrencePosition(expected) === appliedOccurrencePosition(actual),
      operationalStateEquivalent: semanticJson(semanticState(expected)) === semanticJson(semanticState(actual)),
      pureSelectionEquivalent:
        expected._tag === "ValidWorkflowJournalHistory" &&
        actual._tag === "ValidWorkflowJournalHistory" &&
        semanticJson(semanticResponsibilityFacts(expected)) === semanticJson(semanticResponsibilityFacts(actual)),
      workflowHistoryEquivalent: semanticJson(historyMeanings(expected)) === semanticJson(historyMeanings(actual))
    }
  })

const outcome = (run: () => ReadonlyArray<RecordedCassetteCheckpoint>) => {
  try {
    return { checkpoints: run() }
  } catch (error) {
    return { defect: String(error) }
  }
}

const capacityRecords = (capacities: ReadonlyArray<number>): ReadonlyArray<JournalRecord> => {
  const runId = RunId.make("recorded-prefix-capacity")
  return [
    makeWorkflowRunBeganRecord(
      runId,
      FixtureTarget.make("recorded-prefix-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    ),
    ...capacities.map((capacity, index) => {
      const event = TaskWorkCapacityChangedEvent.make({
        capacity: TaskWorkCapacity.make(capacity),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: RunPolicyRevision.make(initialRunPolicyRevision + index),
        revision: RunPolicyRevision.make(initialRunPolicyRevision + index + 1),
        version: workflowJournalEventVersion
      })
      return { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(index + 2), runId }
    })
  ]
}

it("preserves complete cold checkpoint arrays for generated capacities and removed, duplicated, reordered prefixes", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 8 }), { maxLength: 8 }),
      fc.nat({ max: 20 }),
      (capacities, offset) => {
        const records = capacityRecords(capacities)
        const cassette = Effect.runSync(projectRecordedCassette(records))
        const selected = offset % cassette.entries.length
        const variants = [
          cassette,
          RecordedCassette.make({
            ...cassette,
            entries: cassette.entries.filter((_entry, index) => index !== selected)
          }),
          RecordedCassette.make({
            ...cassette,
            entries: [
              ...cassette.entries.slice(0, selected),
              ...cassette.entries.slice(selected, selected + 1),
              ...cassette.entries.slice(selected)
            ]
          }),
          RecordedCassette.make({ ...cassette, entries: [...cassette.entries].reverse() }),
          RecordedCassette.make({ ...cassette, entries: cassette.entries.slice(0, selected) }),
          RecordedCassette.make({ ...cassette, runId: RunId.make("recorded-foreign-run") })
        ]
        for (const variant of variants)
          expect(outcome(() => verifyRecordedCassetteRoundTrip(records, variant))).toEqual(
            outcome(() => coldOracle(records, variant))
          )
      }
    )
  )
})

const sourcePerturbations: ReadonlyArray<
  readonly [string, (records: ReadonlyArray<JournalRecord>, selected: number) => ReadonlyArray<JournalRecord>]
> = [
  ["removed occurrence", (records, selected) => records.filter((_record, index) => index !== selected)],
  [
    "duplicate occurrence",
    (records, selected) => [
      ...records.slice(0, selected),
      ...records.slice(selected, selected + 1),
      ...records.slice(selected)
    ]
  ],
  ["reordered occurrences", (records) => [...records].reverse()],
  [
    "noncanonical position",
    (records, selected) =>
      records.map((record, index) => (index === selected ? { ...record, position: JournalPosition.make(99) } : record))
  ],
  [
    "noncanonical key",
    (records, selected) =>
      records.map((record, index) =>
        index === selected ? { ...record, key: JournalRecordKey.make("noncanonical-source-key") } : record
      )
  ],
  [
    "foreign Run",
    (records, selected) =>
      records.map((record, index) =>
        index === selected ? { ...record, runId: RunId.make("foreign-source-run") } : record
      )
  ]
]

it.each(sourcePerturbations)("preserves every cold checkpoint after a source %s", (_name, perturb) => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 8 }), { maxLength: 8 }),
      fc.nat({ max: 20 }),
      (capacities, offset) => {
        const records = capacityRecords(capacities)
        const cassette = Effect.runSync(projectRecordedCassette(records))
        const source = perturb(records, offset % records.length)
        expect(outcome(() => verifyRecordedCassetteRoundTrip(source, cassette))).toEqual(
          outcome(() => coldOracle(source, cassette))
        )
      }
    )
  )
})

it("preserves cold checkpoints through successive distinct invalid source prefixes", () => {
  const records = capacityRecords([2, 3, 4])
  const cassette = Effect.runSync(projectRecordedCassette(records))
  const source = records.map((record, index) =>
    index === 1
      ? { ...record, position: JournalPosition.make(99) }
      : index === 2
        ? { ...record, key: JournalRecordKey.make("second-source-error") }
        : index === 3
          ? { ...record, runId: RunId.make("third-source-error") }
          : record
  )
  const checkpoints = verifyRecordedCassetteRoundTrip(source, cassette)
  expect(checkpoints).toEqual(coldOracle(source, cassette))
  expect(checkpoints).toHaveLength(source.length)
  expect(
    checkpoints
      .slice(1)
      .every(
        ({ pureSelectionEquivalent, workflowHistoryEquivalent }) =>
          !pureSelectionEquivalent && !workflowHistoryEquivalent
      )
  ).toBe(true)
})

it("compares current invalid-history summaries rather than stale equal valid meaning prefixes", () => {
  const records = capacityRecords([2, 3])
  const cassette = Effect.runSync(projectRecordedCassette(records))
  const source = records.map((record, index) =>
    index === 1 ? { ...record, position: JournalPosition.make(99) } : record
  )
  const actual = RecordedCassette.make({
    ...cassette,
    entries: cassette.entries.map((entry, index) =>
      index === 1 && entry._tag === "TaskWorkCapacityChanged"
        ? { ...entry, previousRevision: RunPolicyRevision.make(99) }
        : entry
    )
  })
  const checkpoints = verifyRecordedCassetteRoundTrip(source, actual)
  expect(checkpoints).toEqual(coldOracle(source, actual))
  expect(checkpoints.slice(1).every(({ workflowHistoryEquivalent }) => !workflowHistoryEquivalent)).toBe(true)
})

it("keeps empty sources and unvisited schema-invalid suffixes untouched and shorter final prefixes repeated", () => {
  const records = capacityRecords([2, 3])
  const cassette = Effect.runSync(projectRecordedCassette(records))
  let entriesReads = 0
  const unvisited: RecordedCassette = {
    ...cassette,
    get entries() {
      entriesReads += 1
      return cassette.entries
    }
  }
  expect(verifyRecordedCassetteRoundTrip([], unvisited)).toEqual([])
  expect(entriesReads).toBe(0)
  const invalidSuffix = RecordedCassette.make({ ...cassette, entries: [...cassette.entries, ...cassette.entries] })
  let suffixReads = 0
  Object.defineProperty(invalidSuffix.entries, 3, {
    get: () => {
      suffixReads += 1
      return { _tag: "NotARecordedOccurrence" }
    }
  })
  expect(verifyRecordedCassetteRoundTrip(records, invalidSuffix)).toEqual(coldOracle(records, cassette))
  expect(suffixReads).toBe(0)
  const visitsSuffix = capacityRecords([2, 3, 4])
  const actualOutcome = outcome(() => verifyRecordedCassetteRoundTrip(visitsSuffix, invalidSuffix))
  expect(suffixReads).toBe(1)
  expect(actualOutcome).toEqual(outcome(() => coldOracle(visitsSuffix, invalidSuffix)))
  expect(suffixReads).toBe(2)
  expect(actualOutcome).toHaveProperty("defect")
  expect(actualOutcome).toEqual(
    outcome(() => {
      RecordedCassette.make({ ...cassette, entries: invalidSuffix.entries.slice(0, 4) })
      return []
    })
  )
  expect(suffixReads).toBe(3)
  const shorter = RecordedCassette.make({ ...cassette, entries: cassette.entries.slice(0, 1) })
  expect(verifyRecordedCassetteRoundTrip(records, shorter)).toEqual(coldOracle(records, shorter))
})

it.each([1, 8, 32])("prepares %i valid history occurrences once without repeated whole-prefix exports", (size) => {
  const records = capacityRecords(Array.from({ length: size - 1 }, (_entry, index) => (index % 8) + 1))
  const cassette = Effect.runSync(projectRecordedCassette(records))
  const materializations: Array<number> = []
  const restore = observeJournalRecordSequenceOperations((operation) => {
    if (operation._tag === "HistoricalMaterialization") materializations.push(operation.length)
  })
  try {
    const checkpoints = verifyRecordedCassetteRoundTrip(records, cassette)
    expect(checkpoints).toHaveLength(size)
    expect(
      checkpoints.every(
        ({
          appliedOccurrencePositionEquivalent,
          operationalStateEquivalent,
          pureSelectionEquivalent,
          workflowHistoryEquivalent
        }) =>
          appliedOccurrencePositionEquivalent &&
          operationalStateEquivalent &&
          pureSelectionEquivalent &&
          workflowHistoryEquivalent
      )
    ).toBe(true)
    expect(materializations).toEqual([1, 1])
    expect(materializations.reduce((total, length) => total + length, 0)).toBe(2)
  } finally {
    restore()
  }
})

it("validates every source and recorded occurrence once while retaining all checkpoint comparisons", () => {
  const records = capacityRecords([2, 3, 4, 5, 6, 7])
  const cassette = Effect.runSync(projectRecordedCassette(records))
  let validations = 0
  const restore = observeWorkflowJournalValidationSteps(() => {
    validations += 1
  })
  try {
    const checkpoints = verifyRecordedCassetteRoundTrip(records, cassette)
    expect(checkpoints).toHaveLength(records.length)
    expect(
      checkpoints.every(
        ({
          appliedOccurrencePositionEquivalent,
          operationalStateEquivalent,
          pureSelectionEquivalent,
          workflowHistoryEquivalent
        }) =>
          appliedOccurrencePositionEquivalent &&
          operationalStateEquivalent &&
          pureSelectionEquivalent &&
          workflowHistoryEquivalent
      )
    ).toBe(true)
    expect(validations).toBe(2 * records.length)
  } finally {
    restore()
  }
})

effectIt.effect(
  "preserves typed workflow history, nested identity failures, causal defect cursor, and early-order negatives",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singletonTaskCompletesAuthoredCassette)
      const cassette = yield* projectRecordedCassette(run.records)
      const variants = [cassette]
      const responsibilityAt = cassette.entries.findIndex(
        ({ _tag }) => _tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )
      expect(responsibilityAt).toBeGreaterThan(0)
      const responsibility = cassette.entries[responsibilityAt]
      const first = cassette.entries[0]
      if (first === undefined) return yield* Effect.die("Expected first recorded occurrence")
      if (responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan")
        return yield* Effect.die("Expected executor responsibility")
      variants.push(
        RecordedCassette.make({
          ...cassette,
          entries: cassette.entries.filter((_entry, index) => index !== responsibilityAt)
        })
      )
      variants.push(
        RecordedCassette.make({
          ...cassette,
          entries: [
            first,
            responsibility,
            ...cassette.entries.slice(1).filter((_entry, index) => index + 1 !== responsibilityAt)
          ]
        })
      )
      variants.push(
        RecordedCassette.make({
          ...cassette,
          entries: cassette.entries.map((entry) =>
            entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
              ? { ...entry, plannedAttempt: { ...entry.plannedAttempt, runId: RunId.make("nested-foreign-run") } }
              : entry
          )
        })
      )
      for (const variant of variants)
        expect(outcome(() => verifyRecordedCassetteRoundTrip(run.records, variant))).toEqual(
          outcome(() => coldOracle(run.records, variant))
        )
      const sourceNestedIdentityFailure = run.records.map((record) =>
        record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          ? {
              ...record,
              event: {
                ...record.event,
                plannedAttempt: { ...record.event.plannedAttempt, runId: RunId.make("nested-source-foreign-run") }
              }
            }
          : record
      )
      expect(outcome(() => verifyRecordedCassetteRoundTrip(sourceNestedIdentityFailure, cassette))).toEqual(
        outcome(() => coldOracle(sourceNestedIdentityFailure, cassette))
      )
      const { integrationTarget, plannedAttempt, qualifiedCandidate } = integrationFinalityFixture
      const integrationFields: Omit<Extract<RecordedCassetteEntry, { readonly _tag: "IntegrationStarted" }>, "_tag"> = {
        plannedAttempt,
        integrationTarget,
        acceptedResult: qualifiedCandidate.run.session.acceptedResult,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction"
      }
      const missingPredecessor = RecordedCassette.make({
        ...cassette,
        entries: [
          first,
          { ...integrationFields, _tag: "IntegrationStarted" },
          { ...integrationFields, _tag: "IntegrationResponsibilityBegan" }
        ]
      })
      const failingAt = missingPredecessor.entries.findIndex(({ _tag }) => _tag === "IntegrationStarted")
      expect(outcome(() => verifyRecordedCassetteRoundTrip(run.records, missingPredecessor))).toEqual(
        outcome(() => coldOracle(run.records, missingPredecessor))
      )
      expect(outcome(() => verifyRecordedCassetteRoundTrip(run.records, missingPredecessor))).toHaveProperty(
        "defect",
        expect.stringContaining("RecordedCausalPositionMissing")
      )
      const beforeDefect = run.records.slice(0, failingAt)
      expect(outcome(() => verifyRecordedCassetteRoundTrip(beforeDefect, missingPredecessor))).toEqual(
        outcome(() => coldOracle(beforeDefect, missingPredecessor))
      )
    }).pipe(Effect.provide(NodeCrypto.layer))
)
