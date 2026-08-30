import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RunId,
  TaskBranchRef,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalDatabaseLocator, JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { integratorSuccessorSessionFixedRecordKey } from "../../../workflow-journal/record-key.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupAuthorization,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner
} from "./disposition.js"
import {
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  branchCleanupTestLayer,
  runBranchCleanup
} from "./branch.js"
import {
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  runWorktreeCleanup,
  worktreeCleanupTestLayer
} from "./worktree.js"
import {
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  integratorCandidateCleanupTestLayer,
  runIntegratorCandidateCleanup
} from "./integrator-candidate.js"
import { attempt, authorization, baseSha, disposition, runId, successor } from "./fixtures.js"
import {
  appendAbandonedProvenance,
  appendCandidateProvenance,
  appendReplacementProvenance
} from "./provenance-fixtures.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  IntegratorSuccessorSessionFixedEvent
} from "../integrator/events.js"
import type {
  CompleteTaskTrackerFactsObserved,
  FocusedTaskClaimFactsObserved,
  FocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import {
  validateBranchCleanupHistory,
  validateIntegratorCandidateCleanupHistory,
  validateIntegratorCandidateCleanupProvenance,
  validateCleanupAuthorizationObservation,
  validateSettledWorktreeForBranch,
  validateWorktreeCleanupHistory,
  validateWorktreeCleanupProvenance
} from "./provenance.js"

type JournalEvent = JournalRecord["event"]
type JournalEventTag = JournalEvent["_tag"]
type TaggedEvent<Tag extends JournalEventTag> = Extract<JournalEvent, { readonly _tag: Tag }>
type TaggedRecord<Tag extends JournalEventTag> = Omit<JournalRecord, "event"> & { readonly event: TaggedEvent<Tag> }
type RecordWithEvent<Event> = Omit<JournalRecord, "event"> & { readonly event: Event }
type CompleteFactsRecord = RecordWithEvent<
  Omit<TaskTrackerFactsObservedEvent, "observation"> & { readonly observation: CompleteTaskTrackerFactsObserved }
>
type SpecificationFactsRecord = RecordWithEvent<
  Omit<TaskTrackerFactsObservedEvent, "observation"> & {
    readonly observation: FocusedTaskWorkSpecificationFactsObserved
  }
>
type ClaimFactsRecord = RecordWithEvent<
  Omit<TaskTrackerFactsObservedEvent, "observation"> & { readonly observation: FocusedTaskClaimFactsObserved }
>

const foreignKey = JournalRecordKey.make("provenance-history-foreign-key")

const hasTag =
  <Tag extends JournalEventTag>(name: Tag) =>
  (record: JournalRecord): record is TaggedRecord<Tag> =>
    record.event._tag === name

const tag = hasTag

const hasCompleteFacts = (record: JournalRecord): record is CompleteFactsRecord =>
  hasTag("TaskTrackerFactsObserved")(record) && record.event.observation._tag === "CompleteTaskTrackerFacts"

const hasSpecificationFacts = (record: JournalRecord): record is SpecificationFactsRecord =>
  hasTag("TaskTrackerFactsObserved")(record) && record.event.observation._tag === "FocusedTaskWorkSpecificationFacts"

const hasClaimFacts = (record: JournalRecord): record is ClaimFactsRecord =>
  hasTag("TaskTrackerFactsObserved")(record) && record.event.observation._tag === "FocusedTaskClaimFacts"

const nthTag = <Tag extends JournalEventTag>(name: Tag, ordinal: number) => {
  let seen = 0
  return (record: JournalRecord): record is TaggedRecord<Tag> => {
    if (!hasTag(name)(record)) return false
    return seen++ === ordinal
  }
}

function replace<Tag extends JournalEventTag>(
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => record is TaggedRecord<Tag>,
  update: (record: TaggedRecord<Tag>) => JournalRecord
): ReadonlyArray<JournalRecord>
function replace(
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => boolean,
  update: (record: JournalRecord) => JournalRecord
): ReadonlyArray<JournalRecord>
function replace(
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => boolean,
  update: (record: JournalRecord) => JournalRecord
): ReadonlyArray<JournalRecord> {
  return records.map((record) => (predicate(record) ? update(record) : record))
}

const duplicate = (records: ReadonlyArray<JournalRecord>, predicate: (record: JournalRecord) => boolean) => {
  const record = records.find(predicate)
  return record === undefined
    ? records
    : records.concat({ ...record, position: JournalPosition.make(Number(record.position) + 100) })
}

const duplicateAt = (
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => boolean,
  position: number
) => {
  const record = records.find(predicate)
  return record === undefined ? records : records.concat({ ...record, position: JournalPosition.make(position) })
}

function move<Tag extends JournalEventTag>(
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => record is TaggedRecord<Tag>,
  position: number
): ReadonlyArray<JournalRecord>
function move(
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => boolean,
  position: number
): ReadonlyArray<JournalRecord>
function move(
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => boolean,
  position: number
): ReadonlyArray<JournalRecord> {
  return replace(records, predicate, (record) => ({ ...record, position: JournalPosition.make(position) }))
}

const replaceTarget = <Tag extends JournalEventTag>(
  records: ReadonlyArray<JournalRecord>,
  target: TaggedRecord<Tag> | undefined,
  update: (record: TaggedRecord<Tag>) => JournalRecord
): ReadonlyArray<JournalRecord> => replace(records, (record): record is TaggedRecord<Tag> => record === target, update)

const moveTarget = <Tag extends JournalEventTag>(
  records: ReadonlyArray<JournalRecord>,
  target: TaggedRecord<Tag> | undefined,
  position: number
): ReadonlyArray<JournalRecord> => move(records, (record): record is TaggedRecord<Tag> => record === target, position)

/**
 * Negative tests must exercise records that the journal codec would reject.
 * This is the single runtime boundary for those deliberately malformed values;
 * all ordinary foreign or reordered records remain statically typed.
 */
type PropertyPath = readonly [string, ...ReadonlyArray<string>]

const malformedRecord = (
  record: JournalRecord,
  path: PropertyPath,
  value: unknown,
  configure?: (malformed: JournalRecord) => void
): JournalRecord => {
  const malformed = structuredClone(record)
  let target: object = malformed
  for (const property of path.slice(0, -1)) {
    const nested = Reflect.get(target, property)
    if (typeof nested !== "object" || nested === null) return malformed
    target = nested
  }
  const finalProperty = path.at(-1)
  if (finalProperty === undefined) return malformed
  Reflect.set(target, finalProperty, value)
  configure?.(malformed)
  return malformed
}

const begin = (target: string) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make(target),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    return journal
  })

const validWorktreeHistory = (target: string) =>
  Effect.gen(function* () {
    const journal = yield* begin(target)
    yield* appendReplacementProvenance(attempt, successor)
    yield* runWorktreeCleanup(authorization)
    return yield* journal.read(runId)
  })

const branchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId, ...authorization.causalPredecessors],
  disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.branch,
  observationAt: authorization.observationAt,
  observationOperationId: authorization.observationOperationId,
  operationId: OperationId.make("issue-69-provenance-history-branch"),
  owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
  worktreeCleanupOperationId: authorization.operationId,
  writerQuiescent: true
})

const validBranchHistory = (target: string) =>
  Effect.gen(function* () {
    const journal = yield* begin(target)
    yield* appendReplacementProvenance(attempt, successor)
    yield* runWorktreeCleanup(authorization)
    yield* runBranchCleanup(branchAuthorization)
    return yield* journal.read(runId)
  })

const candidateAcceptedResult = AcceptedResult.make({
  commit: baseSha,
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
})
const candidateTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("repo:issue-69-provenance-history"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: candidateAcceptedResult,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-history-p1"),
  expectedTargetHead: baseSha,
  integrationTarget: candidateTarget,
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-history-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const candidateSuccessor = IntegratorSessionCorrelation.make({
  ...candidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-history-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-history-p2"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-provenance-history-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: JournalPosition.make(4),
  observationOperationId: OperationId.make(`${candidatePredecessor.sessionId}:predecessor-lineage`),
  operationId: OperationId.make("issue-69-provenance-history-candidate"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})

const validCandidateHistory = (target: string) =>
  Effect.gen(function* () {
    const journal = yield* begin(target)
    yield* appendCandidateProvenance(candidatePredecessor, candidateSuccessor, "issue-69-provenance-history-full-rerun")
    yield* runIntegratorCandidateCleanup(candidateAuthorization)
    return yield* journal.read(runId)
  })

const expectInvalid = (
  records: ReadonlyArray<JournalRecord>,
  cases: ReadonlyArray<readonly [string, ReadonlyArray<JournalRecord>]>,
  validate: (candidate: ReadonlyArray<JournalRecord>) => { readonly _tag: string }
) => {
  for (const [name, candidate] of cases) expect(validate(candidate)._tag, name).toBe("Invalid")
  expect(validate(records)._tag).toBe("Valid")
}

it.effect("rejects malformed, foreign, duplicate, and reordered worktree settlement provenance", () =>
  Effect.gen(function* () {
    const records = yield* validWorktreeHistory("issue-69-provenance-history-worktree")
    const authorized = records.find(tag("WorktreeCleanupAuthorized"))
    const observed = records.filter(tag("WorktreeCleanupObserved"))
    const absence = records.find(tag("WorktreeCleanupAbsenceConfirmed"))
    const settled = records.find(tag("WorktreeCleanupSettled"))
    expect(authorized).toBeDefined()
    expect(observed).toHaveLength(2)
    expect(absence).toBeDefined()
    expect(settled).toBeDefined()

    const cases: Array<readonly [string, ReadonlyArray<JournalRecord>]> = [
      ["missing authorization", records.filter((record) => record !== authorized)],
      ["duplicate authorization", duplicate(records, tag("WorktreeCleanupAuthorized"))],
      [
        "mis-keyed authorization",
        replace(records, tag("WorktreeCleanupAuthorized"), (record) => ({ ...record, key: foreignKey }))
      ],
      ["event before authorization", move(records, tag("WorktreeCleanupObservationIntended"), 1)],
      [
        "mis-keyed observation intent",
        replace(records, tag("WorktreeCleanupObservationIntended"), (record) => ({ ...record, key: foreignKey }))
      ],
      ["duplicate observation intent", duplicate(records, tag("WorktreeCleanupObservationIntended"))],
      [
        "missing observation intent",
        records.filter((record) => record.event._tag !== "WorktreeCleanupObservationIntended")
      ],
      [
        "mis-keyed observation result",
        replace(records, tag("WorktreeCleanupObserved"), (record) => ({ ...record, key: foreignKey }))
      ],
      [
        "foreign present observation",
        replace(records, nthTag("WorktreeCleanupObserved", 0), (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: WorktreeCleanupObservation.cases.Present.make({
              attemptId: attempt.attemptId,
              branch: attempt.branch,
              headSha: GitCommitSha.make("2".repeat(40)),
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(1),
              writerQuiescent: true
            })
          }
        }))
      ],
      [
        "foreign absent observation",
        replace(records, nthTag("WorktreeCleanupObserved", 1), (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: WorktreeCleanupObservation.cases.Absent.make({
              locator: WorktreeLocator.make("/tmp/foreign-worktree"),
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          }
        }))
      ],
      ["duplicate observation result", duplicate(records, tag("WorktreeCleanupObserved"))],
      [
        "mis-keyed mutation intent",
        replace(records, tag("WorktreeCleanupMutationIntended"), (record) => ({ ...record, key: foreignKey }))
      ],
      ["duplicate mutation intent", duplicate(records, tag("WorktreeCleanupMutationIntended"))],
      ["reordered mutation intent", move(records, tag("WorktreeCleanupMutationIntended"), 1)],
      [
        "mis-keyed mutation result",
        replace(records, tag("WorktreeCleanupMutationResultRecorded"), (record) => ({ ...record, key: foreignKey }))
      ],
      [
        "foreign mutation result",
        replace(records, tag("WorktreeCleanupMutationResultRecorded"), (record) => ({
          ...record,
          event: {
            ...record.event,
            result: WorktreeCleanupMutationResult.cases.Removed.make({
              branch: attempt.branch,
              locator: WorktreeLocator.make("/tmp/foreign-worktree"),
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          }
        }))
      ],
      [
        "nonterminal mutation result",
        replace(records, tag("WorktreeCleanupMutationResultRecorded"), (record) => ({
          ...record,
          event: {
            ...record.event,
            result: WorktreeCleanupMutationResult.cases.DefinitelyNotApplied.make({
              branch: attempt.branch,
              detail: "provider rejected worktree removal",
              locator: attempt.worktree
            })
          }
        }))
      ],
      ["duplicate mutation result", duplicate(records, tag("WorktreeCleanupMutationResultRecorded"))],
      [
        "mis-keyed absence",
        replace(records, tag("WorktreeCleanupAbsenceConfirmed"), (record) => ({ ...record, key: foreignKey }))
      ],
      [
        "foreign absence",
        replace(records, tag("WorktreeCleanupAbsenceConfirmed"), (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: WorktreeCleanupObservation.cases.Absent.make({
              locator: WorktreeLocator.make("/tmp/foreign-worktree"),
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          }
        }))
      ],
      [
        "wrong absence cause",
        replace(records, tag("WorktreeCleanupAbsenceConfirmed"), (record) => ({
          ...record,
          event: { ...record.event, cause: "InitialAbsence" }
        }))
      ],
      [
        "reordered absence",
        absence === undefined
          ? records
          : move(records, tag("WorktreeCleanupAbsenceConfirmed"), Number(absence.position) - 1)
      ],
      [
        "malformed absence observation",
        replace(records, tag("WorktreeCleanupAbsenceConfirmed"), (record) =>
          malformedRecord(record, ["event", "observation"], undefined)
        )
      ],
      [
        "mis-keyed settlement",
        replace(records, tag("WorktreeCleanupSettled"), (record) => ({ ...record, key: foreignKey }))
      ],
      [
        "malformed settlement result",
        replace(records, tag("WorktreeCleanupSettled"), (record) =>
          malformedRecord(record, ["event", "result"], undefined)
        )
      ],
      [
        "stale settlement result",
        replace(records, tag("WorktreeCleanupSettled"), (record) => ({
          ...record,
          event: {
            ...record.event,
            result: { ...record.event.result, revision: WorktreeCleanupEvidenceRevision.make(1) }
          }
        }))
      ],
      ["reordered settlement", settled === undefined ? records : move(records, tag("WorktreeCleanupSettled"), 1)],
      ["event after settlement", duplicate(records, tag("WorktreeCleanupSettled"))]
    ]
    expectInvalid(records, cases, (candidate) => validateWorktreeCleanupHistory(candidate, authorization))
    expect(
      validateWorktreeCleanupProvenance(move(records, tag("WorktreeCleanupAuthorized"), 1), authorization)._tag
    ).toBe("Invalid")
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          WorktreeCleanupObservation.cases.Present.make({
            attemptId: attempt.attemptId,
            branch: attempt.branch,
            headSha: baseSha,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(1),
            writerQuiescent: true
          }),
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects malformed, foreign, mis-keyed, duplicate, and reordered P2 witness provenance", () =>
  Effect.gen(function* () {
    const journal = yield* begin("issue-69-provenance-history-p2")
    yield* appendReplacementProvenance(attempt, successor)
    const records = yield* journal.read(runId)
    const graph = records.find(
      (record): record is CompleteFactsRecord => hasCompleteFacts(record) && record.event.operationId.includes(":graph")
    )
    const claimIntent = records.find(tag("TaskClaimAcquisitionIntended"))
    const claimOutcome = records.find(tag("TaskClaimAcquired"))
    const specification = records.find(
      (record): record is SpecificationFactsRecord =>
        hasSpecificationFacts(record) && record.event.operationId.includes(":specification")
    )
    const claimObservation = records.find(
      (record): record is ClaimFactsRecord =>
        hasClaimFacts(record) && record.event.operationId.includes(":claim-observation")
    )
    const worktree = records.find(tag("PlannedAttemptWorktreeObserved"))
    const lineage = records.find(tag("TargetLineageObserved"))
    const replacement = records.find(tag("PlannedAttemptReplaced"))
    const cases: Array<readonly [string, ReadonlyArray<JournalRecord>]> = [
      ["missing P2", records.filter((record) => record.event._tag !== "PlannedAttemptReplaced")],
      ["duplicate P2", duplicate(records, tag("PlannedAttemptReplaced"))],
      ["mis-keyed P2", replace(records, tag("PlannedAttemptReplaced"), (record) => ({ ...record, key: foreignKey }))],
      [
        "foreign claim outcome run",
        replace(records, tag("TaskClaimAcquired"), (record) => ({ ...record, runId: RunId.make("foreign-run") }))
      ],
      [
        "foreign claim outcome key",
        replace(records, tag("TaskClaimAcquired"), (record) => ({ ...record, key: foreignKey }))
      ],
      ["reordered claim outcome", move(records, tag("TaskClaimAcquired"), 100)],
      [
        "foreign claim value",
        replace(records, tag("TaskClaimAcquired"), (record) => ({
          ...record,
          event: { ...record.event, claim: { ...record.event.claim, token: ClaimToken.make("foreign-token") } }
        }))
      ],
      ["duplicate claim outcome", duplicate(records, tag("TaskClaimAcquired"))],
      ["claim intent absent", records.filter((record) => record.event._tag !== "TaskClaimAcquisitionIntended")],
      [
        "duplicate claim intent before outcome",
        claimIntent === undefined || claimOutcome === undefined
          ? records
          : duplicateAt(records, (record) => record === claimIntent, Number(claimOutcome.position) - 1)
      ],
      [
        "foreign duplicate claim intent before outcome",
        claimIntent === undefined
          ? records
          : records.concat({
              ...claimIntent,
              position: JournalPosition.make(1),
              event: {
                ...claimIntent.event,
                operation: {
                  ...claimIntent.event.operation,
                  acquisition: {
                    ...claimIntent.event.operation.acquisition,
                    token: ClaimToken.make("foreign-intent-token")
                  }
                }
              }
            })
      ],
      [
        "claim intent mis-keyed",
        replace(records, tag("TaskClaimAcquisitionIntended"), (record) => ({ ...record, key: foreignKey }))
      ],
      ["duplicate claim intent before outcome", duplicateAt(records, tag("TaskClaimAcquisitionIntended"), 2)],
      [
        "graph outcome run",
        replaceTarget(records, graph, (record) => ({ ...record, runId: RunId.make("foreign-run") }))
      ],
      ["graph outcome key", replaceTarget(records, graph, (record) => ({ ...record, key: foreignKey }))],
      ["graph outcome before restart", moveTarget(records, graph, 1)],
      ["graph outcome after P2", moveTarget(records, graph, 100)],
      [
        "graph facts missing task",
        replaceTarget(records, graph, (record) =>
          malformedRecord(record, ["event", "observation", "factFamilies", "0", "taskIds"], [])
        )
      ],
      [
        "graph read intent mis-keyed",
        replace(
          records,
          (record) =>
            record.event._tag === "TaskTrackerReadIntentRecorded" &&
            record.event.operation.operationId.includes(":graph"),
          (record) => ({ ...record, key: foreignKey })
        )
      ],
      [
        "graph observation read mismatch",
        replaceTarget(records, graph, (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: { ...record.event.observation, target: FixtureTarget.make("foreign-target") }
          }
        }))
      ],
      [
        "specification outcome key",
        replaceTarget(records, specification, (record) => ({ ...record, key: foreignKey }))
      ],
      [
        "specification intent mis-keyed",
        replace(
          records,
          (record) =>
            record.event._tag === "TaskTrackerReadIntentRecorded" &&
            record.event.operation.operationId.includes(":specification"),
          (record) => ({ ...record, key: foreignKey })
        )
      ],
      [
        "specification facts mismatch",
        replaceTarget(records, specification, (record) =>
          malformedRecord(record, ["event", "observation", "factFamily", "fingerprint"], "foreign-fingerprint")
        )
      ],
      [
        "claim observation value malformed",
        replaceTarget(records, claimObservation, (record) =>
          malformedRecord(record, ["event", "observation", "observation"], [])
        )
      ],
      [
        "claim observation intent mis-keyed",
        replace(
          records,
          (record) =>
            record.event._tag === "TaskTrackerReadIntentRecorded" &&
            record.event.operation.operationId.includes(":claim-observation"),
          (record) => ({ ...record, key: foreignKey })
        )
      ],
      [
        "claim observation read mismatch",
        replaceTarget(records, claimObservation, (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: { ...record.event.observation, target: FixtureTarget.make("foreign-target") }
          }
        }))
      ],
      ["worktree outcome key", replaceTarget(records, worktree, (record) => ({ ...record, key: foreignKey }))],
      ["worktree outcome absent", records.filter((record) => record.event._tag !== "PlannedAttemptWorktreeObserved")],
      [
        "worktree proof mismatch",
        replaceTarget(records, worktree, (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: Object.assign({}, record.event.observation, { headSha: GitCommitSha.make("2".repeat(40)) })
          }
        }))
      ],
      [
        "worktree intent mis-keyed",
        replace(
          records,
          (record) =>
            record.event._tag === "GitReadIntentRecorded" && record.event.operation.operationId.includes(":worktree"),
          (record) => ({ ...record, key: foreignKey })
        )
      ],
      ["lineage outcome key", replaceTarget(records, lineage, (record) => ({ ...record, key: foreignKey }))],
      [
        "lineage planned attempt mismatch",
        replaceTarget(records, lineage, (record) => ({
          ...record,
          event: {
            ...record.event,
            plannedAttempt: { ...record.event.plannedAttempt, taskId: TaskId.make("foreign-task") }
          }
        }))
      ],
      [
        "lineage base mismatch",
        replaceTarget(records, lineage, (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: { ...record.event.observation, plannedBaseSha: GitCommitSha.make("2".repeat(40)) }
          }
        }))
      ],
      [
        "lineage target mismatch",
        replaceTarget(records, lineage, (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: { ...record.event.observation, targetHeadSha: GitCommitSha.make("2".repeat(40)) }
          }
        }))
      ],
      [
        "lineage ancestry false",
        replaceTarget(records, lineage, (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: { ...record.event.observation, plannedBaseIsAncestorOfTargetHead: false }
          }
        }))
      ],
      [
        "lineage intent mis-keyed",
        replace(
          records,
          (record) =>
            record.event._tag === "GitReadIntentRecorded" && record.event.operation._tag === "ReadTargetLineage",
          (record) => ({ ...record, key: foreignKey })
        )
      ]
    ]
    cases.push([
      "foreign successor attempt",
      replace(records, tag("PlannedAttemptReplaced"), (record) => ({
        ...record,
        event: {
          ...record.event,
          successorPlan: {
            ...record.event.successorPlan,
            plannedAttempt: { ...record.event.successorPlan.plannedAttempt, taskId: TaskId.make("foreign-successor") }
          }
        }
      }))
    ])
    cases.push([
      "foreign restart position",
      move(
        records,
        (record) => record.event._tag === "AttemptChoiceApplied" && record.event.choice === "RestartTaskImplementation",
        100
      )
    ])
    cases.push([
      "invented witness operation",
      replace(records, tag("PlannedAttemptReplaced"), (record) => ({
        ...record,
        event: {
          ...record.event,
          successorPlan: {
            ...record.event.successorPlan,
            predecessorOperationIds: [OperationId.make("invented-witness")]
          }
        }
      }))
    ])
    expectInvalid(records, cases, (candidate) => validateWorktreeCleanupProvenance(candidate, authorization))
    expect(replacement).toBeDefined()
    if (replacement !== undefined) {
      const foreignWorktreeOperationId = OperationId.make("foreign-worktree-witness")
      const alteredRecords = replaceTarget(records, replacement, (record) => ({
        ...record,
        event: {
          ...record.event,
          successorPlan: {
            ...record.event.successorPlan,
            predecessorOperationIds: record.event.successorPlan.predecessorOperationIds.map((operationId) =>
              operationId === record.event.witness.oldWorktreeObservationOperationId
                ? foreignWorktreeOperationId
                : operationId
            )
          },
          witness: { ...record.event.witness, oldWorktreeObservationOperationId: foreignWorktreeOperationId }
        }
      }))
      const alteredCausalPredecessors: readonly [OperationId, ...ReadonlyArray<OperationId>] = [
        authorization.causalPredecessors[0],
        ...authorization.causalPredecessors
          .slice(1)
          .map((operationId) =>
            operationId === replacement.event.witness.oldWorktreeObservationOperationId
              ? foreignWorktreeOperationId
              : operationId
          )
      ]
      const alteredAuthorization = WorktreeCleanupAuthorization.make({
        ...authorization,
        causalPredecessors: alteredCausalPredecessors
      })
      expect(validateWorktreeCleanupProvenance(alteredRecords, alteredAuthorization)._tag).toBe("Invalid")
      const foreignPredecessorAttempt = { ...attempt, taskId: TaskId.make("foreign-predecessor-attempt") }
      const foreignPredecessorRecords = records.map((record) =>
        record.event._tag === "GitReadIntentRecorded" &&
        record.event.operation._tag === "ReadTaskWorktree" &&
        record.event.operation.operationId === authorization.observationOperationId
          ? {
              ...record,
              event: {
                ...record.event,
                operation: { ...record.event.operation, plannedAttempt: foreignPredecessorAttempt }
              }
            }
          : record
      )
      const foreignPredecessorAuthorization = WorktreeCleanupAuthorization.make({
        ...authorization,
        disposition: { ...disposition, plannedAttempt: foreignPredecessorAttempt }
      })
      expect(validateWorktreeCleanupProvenance(foreignPredecessorRecords, foreignPredecessorAuthorization)._tag).toBe(
        "Invalid"
      )
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects abandoned provenance with a non-command quiescence proof", () =>
  Effect.gen(function* () {
    const journal = yield* begin("issue-69-provenance-history-abandoned")
    const abandoned = yield* appendAbandonedProvenance(attempt)
    const records = yield* journal.read(runId)
    const abandonment = records.find(tag("AttemptImplementationAbandoned"))
    expect(abandonment).toBeDefined()
    const cases: ReadonlyArray<readonly [string, ReadonlyArray<JournalRecord>]> = [
      [
        "state projection proof",
        replace(records, tag("AttemptImplementationAbandoned"), (record) =>
          malformedRecord(record, ["event", "proof", "_tag"], "StateProjection")
        )
      ],
      [
        "mis-keyed abandonment",
        replace(records, tag("AttemptImplementationAbandoned"), (record) => ({ ...record, key: foreignKey }))
      ],
      [
        "foreign stopped claim",
        replace(records, tag("AttemptImplementationAbandoned"), (record) => ({
          ...record,
          event: {
            ...record.event,
            expectedClaim: { ...record.event.expectedClaim, token: ClaimToken.make("foreign-token") }
          }
        }))
      ],
      [
        "foreign stopped attempt",
        replace(records, tag("AttemptImplementationAbandoned"), (record) => ({
          ...record,
          event: {
            ...record.event,
            subject: {
              ...record.event.subject,
              plannedAttempt: { ...record.event.subject.plannedAttempt, taskId: TaskId.make("foreign-stopped-attempt") }
            }
          }
        }))
      ],
      ["missing stop choice", records.filter((record) => record.event._tag !== "AttemptChoiceApplied")]
    ]
    expectInvalid(records, cases, (candidate) => validateWorktreeCleanupProvenance(candidate, abandoned))
    const settledDisposition = PlannedAttemptCleanupDisposition.cases.Settled.make({
      dispositionAt: abandoned.disposition.dispositionAt,
      plannedAttempt: attempt,
      settlementOperationId: OperationId.make("compatibility-settlement")
    })
    expect(
      validateWorktreeCleanupProvenance(
        records,
        WorktreeCleanupAuthorization.make({ ...abandoned, disposition: settledDisposition })
      )._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects malformed branch history identities while retaining valid settlement", () =>
  Effect.gen(function* () {
    const branchRecords = yield* validBranchHistory("issue-69-provenance-history-branch")
    const branchObserved = branchRecords.filter(tag("BranchCleanupObserved"))
    const branchSettled = branchRecords.find(tag("BranchCleanupSettled"))
    const branchCases: ReadonlyArray<readonly [string, ReadonlyArray<JournalRecord>]> = [
      [
        "branch missing authorization",
        branchRecords.filter((record) => record.event._tag !== "BranchCleanupAuthorized")
      ],
      ["branch duplicate authorization", duplicate(branchRecords, tag("BranchCleanupAuthorized"))],
      [
        "branch mis-keyed authorization",
        replace(branchRecords, tag("BranchCleanupAuthorized"), (record) => ({ ...record, key: foreignKey }))
      ],
      [
        "branch mis-keyed observed",
        replace(branchRecords, tag("BranchCleanupObserved"), (record) => ({ ...record, key: foreignKey }))
      ],
      ["branch duplicate observed", duplicate(branchRecords, tag("BranchCleanupObserved"))],
      [
        "branch foreign present",
        replace(branchRecords, nthTag("BranchCleanupObserved", 0), (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: BranchCleanupObservation.cases.Present.make({
              branch: attempt.branch,
              headSha: GitCommitSha.make("2".repeat(40)),
              registeredWorktree: null,
              revision: BranchCleanupEvidenceRevision.make(1)
            })
          }
        }))
      ],
      [
        "branch foreign absent",
        replace(branchRecords, nthTag("BranchCleanupObserved", 1), (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: BranchCleanupObservation.cases.Absent.make({
              branch: TaskBranchRef.make("refs/heads/foreign"),
              revision: BranchCleanupEvidenceRevision.make(2)
            })
          }
        }))
      ],
      [
        "branch malformed absence",
        replace(branchRecords, tag("BranchCleanupAbsenceConfirmed"), (record) =>
          malformedRecord(record, ["event", "observation"], undefined)
        )
      ],
      [
        "branch stale settlement",
        branchSettled === undefined
          ? branchRecords
          : replace(branchRecords, tag("BranchCleanupSettled"), (record) => ({
              ...record,
              event: {
                ...record.event,
                result: { ...record.event.result, revision: BranchCleanupEvidenceRevision.make(1) }
              }
            }))
      ],
      [
        "branch reordered settlement",
        branchSettled === undefined ? branchRecords : move(branchRecords, tag("BranchCleanupSettled"), 1)
      ],
      ["branch event after settlement", duplicate(branchRecords, tag("BranchCleanupSettled"))],
      [
        "branch reordered observed",
        branchObserved[1] === undefined
          ? branchRecords
          : move(branchRecords, nthTag("BranchCleanupObserved", 1), Number(branchObserved[0]?.position ?? 1))
      ]
    ]
    expectInvalid(branchRecords, branchCases, (candidate) =>
      validateBranchCleanupHistory(candidate, branchAuthorization)
    )
    expect(validateSettledWorktreeForBranch(branchRecords, branchAuthorization)._tag).toBe("Valid")
    expect(
      validateSettledWorktreeForBranch(
        replace(branchRecords, tag("WorktreeCleanupSettled"), (record) =>
          malformedRecord(record, ["event", "_tag"], "WorktreeCleanupSettled", (malformed) => {
            let reads = 0
            Object.defineProperty(malformed.event, "_tag", {
              configurable: true,
              enumerable: true,
              get: () => (reads++ === 0 ? "WorktreeCleanupSettled" : "ForeignWorktreeSettlement")
            })
          })
        ),
        branchAuthorization
      )._tag
    ).toBe("Invalid")
    expect(
      validateSettledWorktreeForBranch(
        replace(branchRecords, tag("WorktreeCleanupSettled"), (record) => ({
          ...record,
          event: {
            ...record.event,
            authorization: { ...record.event.authorization, expectedHead: GitCommitSha.make("2".repeat(40)) }
          }
        })),
        branchAuthorization
      )._tag
    ).toBe("Invalid")
    expect(
      validateSettledWorktreeForBranch(
        replace(branchRecords, tag("WorktreeCleanupSettled"), (record) => ({
          ...record,
          event: {
            ...record.event,
            authorization: WorktreeCleanupAuthorization.make({
              ...record.event.authorization,
              causalPredecessors: [OperationId.make("foreign-worktree-cause")]
            })
          }
        })),
        branchAuthorization
      )._tag
    ).toBe("Invalid")
    expect(
      validateSettledWorktreeForBranch(
        replace(branchRecords, tag("WorktreeCleanupSettled"), (record) => ({
          ...record,
          event: {
            ...record.event,
            result: { ...record.event.result, revision: WorktreeCleanupEvidenceRevision.make(99) }
          }
        })),
        branchAuthorization
      )._tag
    ).toBe("Invalid")
    expect(
      validateSettledWorktreeForBranch(move(branchRecords, tag("BranchCleanupAuthorized"), 1), branchAuthorization)._tag
    ).toBe("Invalid")
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          BranchCleanupObservation.cases.Present.make({
            branch: attempt.branch,
            headSha: baseSha,
            registeredWorktree: null,
            revision: BranchCleanupEvidenceRevision.make(1)
          }),
          BranchCleanupObservation.cases.Absent.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(1)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects malformed candidate history identities while retaining valid settlement", () =>
  Effect.gen(function* () {
    const candidateRecords = yield* validCandidateHistory("issue-69-provenance-history-candidate")
    const candidateObserved = candidateRecords.filter(tag("IntegratorCandidateCleanupObserved"))
    const candidateSettled = candidateRecords.find(tag("IntegratorCandidateCleanupSettled"))
    const candidateCases: ReadonlyArray<readonly [string, ReadonlyArray<JournalRecord>]> = [
      [
        "candidate missing authorization",
        candidateRecords.filter((record) => record.event._tag !== "IntegratorCandidateCleanupAuthorized")
      ],
      ["candidate duplicate authorization", duplicate(candidateRecords, tag("IntegratorCandidateCleanupAuthorized"))],
      [
        "candidate mis-keyed authorization",
        replace(candidateRecords, tag("IntegratorCandidateCleanupAuthorized"), (record) => ({
          ...record,
          key: foreignKey
        }))
      ],
      [
        "candidate mis-keyed observed",
        replace(candidateRecords, tag("IntegratorCandidateCleanupObserved"), (record) => ({
          ...record,
          key: foreignKey
        }))
      ],
      ["candidate duplicate observed", duplicate(candidateRecords, tag("IntegratorCandidateCleanupObserved"))],
      [
        "candidate foreign present",
        replace(candidateRecords, nthTag("IntegratorCandidateCleanupObserved", 0), (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: IntegratorCandidateCleanupObservation.cases.Present.make({
              locator: candidatePredecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
              sessionId: IntegratorSessionId.make("session:foreign"),
              writerQuiescent: true
            })
          }
        }))
      ],
      [
        "candidate foreign absent",
        replace(candidateRecords, nthTag("IntegratorCandidateCleanupObserved", 1), (record) => ({
          ...record,
          event: {
            ...record.event,
            observation: IntegratorCandidateCleanupObservation.cases.Absent.make({
              locator: IntegratorCandidateResourceLocator.make("candidate:foreign"),
              revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
            })
          }
        }))
      ],
      [
        "candidate malformed absence",
        replace(candidateRecords, tag("IntegratorCandidateCleanupAbsenceConfirmed"), (record) =>
          malformedRecord(record, ["event", "observation"], undefined)
        )
      ],
      [
        "candidate stale settlement",
        candidateSettled === undefined
          ? candidateRecords
          : replace(candidateRecords, tag("IntegratorCandidateCleanupSettled"), (record) => ({
              ...record,
              event: {
                ...record.event,
                result: { ...record.event.result, revision: IntegratorCandidateCleanupEvidenceRevision.make(1) }
              }
            }))
      ],
      [
        "candidate reordered settlement",
        candidateSettled === undefined
          ? candidateRecords
          : move(candidateRecords, tag("IntegratorCandidateCleanupSettled"), 1)
      ],
      ["candidate event after settlement", duplicate(candidateRecords, tag("IntegratorCandidateCleanupSettled"))],
      [
        "candidate reordered observed",
        candidateObserved[1] === undefined
          ? candidateRecords
          : move(
              candidateRecords,
              nthTag("IntegratorCandidateCleanupObserved", 1),
              Number(candidateObserved[0]?.position ?? 1)
            )
      ]
    ]
    expectInvalid(candidateRecords, candidateCases, (candidate) =>
      validateIntegratorCandidateCleanupHistory(candidate, candidateAuthorization)
    )
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          IntegratorCandidateCleanupObservation.cases.Present.make({
            locator: candidatePredecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
            sessionId: candidatePredecessor.sessionId,
            writerQuiescent: true
          }),
          IntegratorCandidateCleanupObservation.cases.Absent.make({
            locator: candidatePredecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
            locator: candidatePredecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2),
            sessionId: candidatePredecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects foreign, duplicate, and reordered FullRerun candidate provenance", () =>
  Effect.gen(function* () {
    const records = yield* validCandidateHistory("issue-69-provenance-history-candidate-provenance")
    const direction = records.find(tag("IntegrationQuarantineDirectionApplied"))
    const quarantine = records.find(tag("IntegrationQuarantined"))
    const successorRecord = records.find(tag("IntegratorSuccessorSessionFixed"))
    const absence = records.find(tag("IntegrationProviderRunActivityAbsent"))
    const cases: ReadonlyArray<readonly [string, ReadonlyArray<JournalRecord>]> = [
      ["duplicate direction", duplicate(records, tag("IntegrationQuarantineDirectionApplied"))],
      [
        "candidate authority observation after authorization",
        move(records, tag("IntegratorCandidateCleanupAuthorized"), 1)
      ],
      ["direction before quarantine", move(records, tag("IntegrationQuarantineDirectionApplied"), 1)],
      [
        "quarantine after direction",
        quarantine === undefined ? records : move(records, tag("IntegrationQuarantined"), 100)
      ],
      ["duplicate latest quarantine", duplicate(records, tag("IntegrationQuarantined"))],
      [
        "non-provider quarantine basis",
        replace(records, tag("IntegrationQuarantined"), (record) =>
          malformedRecord(record, ["event", "basis", "_tag"], "Other")
        )
      ],
      [
        "missing provider absence",
        records.filter((record) => record.event._tag !== "IntegrationProviderRunActivityAbsent")
      ],
      [
        "foreign provider absence",
        replace(records, tag("IntegrationProviderRunActivityAbsent"), (record) =>
          malformedRecord(record, ["event", "detail"], "foreign-provider-detail")
        )
      ],
      ["duplicate successor relation", duplicate(records, tag("IntegratorSuccessorSessionFixed"))],
      [
        "foreign successor relation",
        successorRecord === undefined
          ? records
          : records.concat({
              ...successorRecord,
              position: JournalPosition.make(Number(successorRecord.position) + 100),
              event: {
                ...successorRecord.event,
                successor: {
                  ...successorRecord.event.successor,
                  sessionId: IntegratorSessionId.make("session:foreign-successor")
                }
              }
            })
      ],
      [
        "successor before FullRerun",
        successorRecord === undefined ? records : move(records, tag("IntegratorSuccessorSessionFixed"), 1)
      ],
      [
        "missing successor target read",
        records.filter(
          (record) =>
            !(
              record.event._tag === "GitReadIntentRecorded" &&
              record.event.operation._tag === "ReadTargetLineage" &&
              record.event.operation.operationId.includes(":successor-lineage")
            )
        )
      ]
    ]
    expectInvalid(records, cases, (candidate) =>
      validateIntegratorCandidateCleanupProvenance(candidate, candidateAuthorization)
    )
    expect(validateCleanupAuthorizationObservation(records, candidateAuthorization)._tag).toBe("Valid")
    expect(
      validateIntegratorCandidateCleanupProvenance(
        records,
        IntegratorCandidateCleanupAuthorization.make({
          ...candidateAuthorization,
          causalPredecessors: [OperationId.make("foreign-full-rerun")]
        })
      )._tag
    ).toBe("Invalid")
    expect(direction).toBeDefined()
    expect(absence).toBeDefined()
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          IntegratorCandidateCleanupObservation.cases.Present.make({
            locator: candidatePredecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
            sessionId: candidatePredecessor.sessionId,
            writerQuiescent: true
          }),
          IntegratorCandidateCleanupObservation.cases.Absent.make({
            locator: candidatePredecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
            locator: candidatePredecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2),
            sessionId: candidatePredecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects a foreign FullRerun relation sharing the predecessor session after memory and SQLite reads", () => {
  const validateForeignHistory = (target: string) =>
    Effect.gen(function* () {
      const journal = yield* begin(target)
      yield* appendCandidateProvenance(
        candidatePredecessor,
        candidateSuccessor,
        "issue-69-provenance-history-full-rerun"
      )
      const records = yield* journal.read(runId)
      const successorRecord = records.find(tag("IntegratorSuccessorSessionFixed"))
      expect(successorRecord).toBeDefined()
      if (successorRecord === undefined) return "fixture is incomplete"

      const foreignPredecessor = IntegratorSessionCorrelation.make({
        ...candidatePredecessor,
        candidateResource: IntegratorCandidateResourceLocator.make("candidate:foreign-predecessor"),
        plannedAttempt: { ...attempt, attemptId: AttemptId.make("issue-69-foreign-predecessor") }
      })
      const foreignSuccessor = IntegratorSessionCorrelation.make({
        ...candidateSuccessor,
        candidateResource: IntegratorCandidateResourceLocator.make("candidate:foreign-successor"),
        plannedAttempt: foreignPredecessor.plannedAttempt
      })
      const foreignSuccessorEvent = IntegratorSuccessorSessionFixedEvent.make({
        ...successorRecord.event,
        predecessor: foreignPredecessor,
        successor: foreignSuccessor
      })
      yield* journal.append(
        runId,
        integratorSuccessorSessionFixedRecordKey(
          foreignPredecessor,
          foreignSuccessorEvent.quarantineAt,
          foreignSuccessorEvent.directionAppliedAt
        ),
        foreignSuccessorEvent
      )

      return validateIntegratorCandidateCleanupProvenance(yield* journal.read(runId), candidateAuthorization).detail
    })

  return Effect.gen(function* () {
    const [memoryDetail, sqliteDetail] = yield* Effect.all(
      [
        validateForeignHistory("issue-69-foreign-full-rerun-memory").pipe(Effect.provide(memoryJournalTestLayer)),
        validateForeignHistory("issue-69-foreign-full-rerun-sqlite").pipe(
          Effect.provide(sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") }))
        )
      ],
      { concurrency: 1 }
    )
    expect(memoryDetail).toBe("multiple FullRerun successors describe one Integrator predecessor")
    expect(sqliteDetail).toBe(memoryDetail)
  })
})
