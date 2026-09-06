import { Schema, SchemaAST } from "effect"
import { WorkflowJournalEvent } from "@dalph/orchestrator"
import {
  recoveryPrefixCutMeaning,
  recoveryPrefixDualStoreExecutionCount,
  type RecoveryPrefixCutLabel
} from "./recovery-prefix-contract.js"
import { currentRecoveryPrefixEvidence as currentEvidence } from "./recovery-prefix-evidence.js"
import { trackerCompletionRecoveryTrace } from "./tracker-completion-recovery-trace.js"

/** The maintained ambiguity-crossing families represented by the recovery evidence denominator. */
const recoveryPrefixBoundaryIds = [
  "tracker-task-facts",
  "tracker-claim-acquisition",
  "tracker-claim-release",
  "git-worktree",
  "git-target-lineage",
  "planned-attempt-executor",
  "integrator-session",
  "target-promotion",
  "tracker-completion-finality",
  "control-direction",
  "attempt-choice",
  "planned-attempt-worktree-cleanup",
  "planned-attempt-branch-cleanup",
  "integrator-candidate-cleanup",
  "run-establishment",
  "run-cancellation-finality",
  "application-exit"
] as const
const RecoveryPrefixBoundaryId = Schema.Literals(recoveryPrefixBoundaryIds)
type RecoveryPrefixBoundaryId = typeof RecoveryPrefixBoundaryId.Type

/** A current event tag, maintained cassette key, or focused test seam is the only accepted evidence kind. */
const RecoveryPrefixEvidenceReference = Schema.TaggedUnion({
  WorkflowEventTag: { tag: Schema.NonEmptyString },
  MaintainedCassetteKey: { key: Schema.NonEmptyString },
  FocusedTestSeam: { path: Schema.NonEmptyString, reference: Schema.NonEmptyString }
})
export type RecoveryPrefixEvidenceReference = typeof RecoveryPrefixEvidenceReference.Type

/** One cut decision carries a reason even when the protocol has no distinct durable endpoint there. */
const RecoveryPrefixApplicabilityDecision = Schema.TaggedUnion({
  Applicable: {
    endpoint: Schema.NonEmptyString,
    evidence: Schema.NonEmptyArray(RecoveryPrefixEvidenceReference),
    reason: Schema.NonEmptyString
  },
  NotApplicable: { evidence: Schema.NonEmptyArray(RecoveryPrefixEvidenceReference), reason: Schema.NonEmptyString }
})

const RecoveryPrefixCuts = Schema.Struct({
  P0: RecoveryPrefixApplicabilityDecision,
  P1: RecoveryPrefixApplicabilityDecision,
  P2: RecoveryPrefixApplicabilityDecision,
  P3: RecoveryPrefixApplicabilityDecision,
  P4: RecoveryPrefixApplicabilityDecision,
  P5: RecoveryPrefixApplicabilityDecision,
  P6: RecoveryPrefixApplicabilityDecision
})
type RecoveryPrefixCuts = typeof RecoveryPrefixCuts.Type

const RecoveryPrefixQualification = Schema.TaggedUnion({
  MetadataOnly: { reason: Schema.NonEmptyString },
  RepresentativeDualStoreTrace: {
    cassetteKey: Schema.NonEmptyString,
    executionCount: Schema.Literal(recoveryPrefixDualStoreExecutionCount)
  }
})

/** One ambiguity-crossing family and all seven test-only retained-history decisions. */
const RecoveryPrefixBoundary = Schema.Struct({
  cuts: RecoveryPrefixCuts,
  description: Schema.NonEmptyString,
  id: RecoveryPrefixBoundaryId,
  qualification: RecoveryPrefixQualification
})
type RecoveryPrefixBoundary = typeof RecoveryPrefixBoundary.Type

const noDuplicateOrMissingBoundaryIds = Schema.makeFilter(
  (manifest: { readonly boundaries: ReadonlyArray<RecoveryPrefixBoundary> }) => {
    const ids = manifest.boundaries.map(({ id }) => id)
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
    if (duplicate !== undefined) return `duplicate boundary identifier ${duplicate}`

    const missing = recoveryPrefixBoundaryIds.find((id) => !ids.includes(id))
    return missing === undefined ? undefined : `missing boundary identifier ${missing}`
  }
)

/** Closed, test-only manifest. It is never imported by production packages. */
export const RecoveryPrefixManifest = Schema.Struct({
  boundaries: Schema.NonEmptyArray(RecoveryPrefixBoundary),
  schemaVersion: Schema.Literal(1)
}).check(noDuplicateOrMissingBoundaryIds)
export type RecoveryPrefixManifest = typeof RecoveryPrefixManifest.Type

/** Decode with excess-property errors so the checked-in manifest cannot grow an unreviewed vocabulary. */
export const decodeRecoveryPrefixManifest = (input: unknown): RecoveryPrefixManifest =>
  Schema.decodeUnknownSync(RecoveryPrefixManifest, { onExcessProperty: "error" })(input)

const applicable = (endpoint: string, reason: string, evidence: ReadonlyArray<RecoveryPrefixEvidenceReference>) => ({
  _tag: "Applicable" as const,
  endpoint,
  evidence,
  reason
})

const notApplicable = (reason: string, evidence: ReadonlyArray<RecoveryPrefixEvidenceReference>) => ({
  _tag: "NotApplicable" as const,
  evidence,
  reason
})

const makeCuts = (input: {
  readonly endpoints: Partial<Record<RecoveryPrefixCutLabel, string>>
  readonly evidence: (cut: RecoveryPrefixCutLabel) => ReadonlyArray<RecoveryPrefixEvidenceReference>
  readonly family: string
  readonly notApplicableReason: (cut: RecoveryPrefixCutLabel) => string
}) => {
  const make = (cut: RecoveryPrefixCutLabel) => {
    const endpoint = input.endpoints[cut]
    const evidence = input.evidence(cut)
    return endpoint === undefined
      ? notApplicable(input.notApplicableReason(cut), evidence)
      : applicable(
          endpoint,
          `${input.family}: ${recoveryPrefixCutMeaning[cut]} is retained through ${endpoint}.`,
          evidence
        )
  }
  return {
    P0: make("P0"),
    P1: make("P1"),
    P2: make("P2"),
    P3: make("P3"),
    P4: make("P4"),
    P5: make("P5"),
    P6: make("P6")
  }
}

const boundary = (input: {
  readonly description: string
  readonly endpoints: Partial<Record<RecoveryPrefixCutLabel, string>>
  readonly evidence: (cut: RecoveryPrefixCutLabel) => ReadonlyArray<RecoveryPrefixEvidenceReference>
  readonly family: string
  readonly id: RecoveryPrefixBoundaryId
  readonly notApplicableReason: (cut: RecoveryPrefixCutLabel) => string
  readonly qualification: typeof RecoveryPrefixQualification.Type
}) => ({ id: input.id, description: input.description, cuts: makeCuts(input), qualification: input.qualification })

const metadataOnly = (reason: string): typeof RecoveryPrefixQualification.Type => ({ _tag: "MetadataOnly", reason })

const noEndpointReasonFor = (family: string, cut: RecoveryPrefixCutLabel): string =>
  `${family} does not record ${recoveryPrefixCutMeaning[cut]}; no event in this row's evidence represents that cut.`
const metadataReasonFor = (family: string) =>
  metadataOnly(`${family}: #142 covers both stores through tracker completion; no dual-store matrix is claimed.`)

const runCancellationEvidence: ReadonlyArray<RecoveryPrefixEvidenceReference> = [
  { _tag: "WorkflowEventTag", tag: "RunCancellationApplied" },
  { _tag: "WorkflowEventTag", tag: "TaskTrackerReadIntentRecorded" },
  { _tag: "WorkflowEventTag", tag: "TaskTrackerFactsObserved" },
  { _tag: "WorkflowEventTag", tag: "WorkflowRunTerminated" },
  {
    _tag: "FocusedTestSeam",
    path: "packages/dalph/test/cassettes/run-cancellation.test.ts",
    reference: "re-enters once after an unacknowledged cancellation termination append"
  },
  {
    _tag: "FocusedTestSeam",
    path: "packages/dalph/test/conformance/run-cancellation-recovery-prefixes.test.ts",
    reference: "replays cancellation recovery prefixes P0-P6 through memory and SQLite"
  }
]

const sourceManifest = {
  schemaVersion: 1,
  boundaries: [
    boundary({
      id: "tracker-task-facts",
      family: "Tracker task-facts reads",
      description: "Tracker graph and task-fact reads that may return a lost or unreadable response.",
      evidence: () => currentEvidence.trackerFacts,
      endpoints: {
        P0: "the record before TaskTrackerReadIntentRecorded",
        P1: "TaskTrackerReadIntentRecorded",
        P4: "TaskTrackerReadIntentRecorded for the repeated read",
        P5: "TaskTrackerFactsObserved"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Tracker task-facts reads", cut),
      qualification: metadataReasonFor("Tracker task-facts reads")
    }),
    boundary({
      id: "tracker-claim-acquisition",
      family: "Tracker claim acquisition",
      description: "Task-claim acquisition after a tracker read and before accepting the exact claim.",
      evidence: () => currentEvidence.claimAcquisition,
      endpoints: {
        P0: "the TaskTrackerFactsObserved record before acquisition",
        P1: "TaskClaimAcquisitionIntended",
        P3: "TaskClaimAcquired or TaskClaimAcquisitionRejected",
        P4: "TaskTrackerReadIntentRecorded for claim reconciliation",
        P5: "TaskTrackerFactsObserved for claim reconciliation",
        P6: "TaskClaimAcquired or TaskClaimAcquisitionRejected"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Tracker claim acquisition", cut),
      qualification: metadataReasonFor("Tracker claim acquisition")
    }),
    boundary({
      id: "tracker-claim-release",
      family: "Tracker claim release",
      description: "Exact task-claim release with a fresh absence check after an uncertain deletion response.",
      evidence: () => currentEvidence.claimRelease,
      endpoints: {
        P0: "the record before TaskClaimReleaseIntended",
        P1: "TaskClaimReleaseIntended",
        P3: "TaskClaimReleased or the retained uncertain request intent",
        P4: "TaskTrackerReadIntentRecorded for release reconciliation",
        P5: "TaskTrackerFactsObserved for release reconciliation",
        P6: "TaskClaimReleased"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Tracker claim release", cut),
      qualification: metadataReasonFor("Tracker claim release")
    }),
    boundary({
      id: "git-worktree",
      family: "Git worktree reconciliation",
      description: "Git worktree reconciliation and observation for one immutable planned attempt.",
      evidence: (cut) => currentEvidence.worktree[cut],
      endpoints: {
        P0: "the record before TaskWorktreeReconciliationIntended",
        P1: "TaskWorktreeReconciliationIntended",
        P4: "GitReadIntentRecorded for the planned worktree",
        P5: "PlannedAttemptWorktreeObserved",
        P6: "TaskWorktreeReady"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Git worktree reconciliation", cut),
      qualification: metadataReasonFor("Git worktree reconciliation")
    }),
    boundary({
      id: "git-target-lineage",
      family: "Git target-lineage reads",
      description: "Git target-head and ancestry reads that decide whether a planned Base SHA remains compatible.",
      evidence: () => currentEvidence.targetLineage,
      endpoints: {
        P0: "the record before GitReadIntentRecorded",
        P1: "GitReadIntentRecorded",
        P4: "GitReadIntentRecorded for the repeated lineage read",
        P5: "TargetLineageObserved"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Git target-lineage reads", cut),
      qualification: metadataReasonFor("Git target-lineage reads")
    }),
    boundary({
      id: "planned-attempt-executor",
      family: "Planned-attempt executor work",
      description: "Opaque planned-attempt executor commands, projections, and reports.",
      evidence: () => currentEvidence.executor,
      endpoints: {
        P0: "PlannedAttemptExecutorWorkResponsibilityBegan",
        P1: "PlannedAttemptExecutorCommandIntended",
        P3: "PlannedAttemptExecutorCommandResponseContradicted or the retained command intent",
        P4: "PlannedAttemptExecutorCommandIntended for Observe",
        P5: "PlannedAttemptExecutorCommandProjectionObserved or PlannedAttemptExecutorStateObserved",
        P6: "PlannedAttemptExecutorWorkReported"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Planned-attempt executor work", cut),
      qualification: metadataReasonFor("Planned-attempt executor work")
    }),
    boundary({
      id: "integrator-session",
      family: "Integrator session",
      description: "One fixed outer Integrator session and its durable run/result and candidate-read evidence.",
      evidence: () => currentEvidence.integrator,
      endpoints: {
        P0: "IntegratorSessionFixed",
        P1: "IntegratorRunStarted",
        P3: "IntegratorRunResultRecorded",
        P4: "IntegratorRunCandidateGitReadIntended",
        P5: "IntegratorRunCandidateGitObserved",
        P6: "IntegratorRunCandidateGitObserved"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Integrator session", cut),
      qualification: metadataReasonFor("Integrator session")
    }),
    boundary({
      id: "target-promotion",
      family: "Target promotion",
      description: "Target-ref compare-and-set promotion and its bounded fresh Git reconciliation.",
      evidence: () => currentEvidence.promotion,
      endpoints: {
        P0: "IntegratorRunCandidateGitObserved",
        P1: "TargetPromotionIntended",
        P2: "TargetPromotionAttemptIntended",
        P3: "TargetPromotionObservedSuccess, TargetPromotionStale, or TargetPromotionNonConvergence",
        P4: "GitReadIntentRecorded for promotion reconciliation",
        P5: "TargetLineageObserved for promotion reconciliation",
        P6: "TargetPromotionObservedSuccess, TargetPromotionStale, or TargetPromotionNonConvergence"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Target promotion", cut),
      qualification: metadataReasonFor("Target promotion")
    }),
    boundary({
      id: trackerCompletionRecoveryTrace.boundaryId,
      family: "Tracker completion finality",
      description: "Tracker completion admission, completion-claim replacement/deletion, and final settlement.",
      evidence: () => currentEvidence.completion,
      endpoints: trackerCompletionRecoveryTrace.endpoints,
      notApplicableReason: (cut) => noEndpointReasonFor("Tracker completion finality", cut),
      qualification: {
        _tag: "RepresentativeDualStoreTrace",
        cassetteKey: trackerCompletionRecoveryTrace.cassetteKey,
        executionCount: trackerCompletionRecoveryTrace.executionCount
      }
    }),
    boundary({
      id: "control-direction",
      family: "Control-direction application",
      description: "Operator Pause or Unpause application as a durable control direction.",
      evidence: () => currentEvidence.controlDirection,
      endpoints: { P0: "the record before ControlDirectionApplied", P6: "ControlDirectionApplied" },
      notApplicableReason: (cut) => noEndpointReasonFor("Control-direction application", cut),
      qualification: metadataReasonFor("Control-direction application")
    }),
    boundary({
      id: "attempt-choice",
      family: "Attempt-choice application",
      description: "Operator Continue, Restart, or Stop choice application for one exact attempt.",
      evidence: () => currentEvidence.attemptChoice,
      endpoints: { P0: "the record before AttemptChoiceApplied", P6: "AttemptChoiceApplied" },
      notApplicableReason: (cut) => noEndpointReasonFor("Attempt-choice application", cut),
      qualification: metadataReasonFor("Attempt-choice application")
    }),
    boundary({
      id: "planned-attempt-worktree-cleanup",
      family: "Planned-attempt worktree cleanup",
      description: "Exact superseded/terminal worktree cleanup with fresh Git reconciliation.",
      evidence: () => currentEvidence.worktreeCleanup,
      endpoints: {
        P0: "the record before WorktreeCleanupAuthorized",
        P1: "WorktreeCleanupAuthorized",
        P2: "WorktreeCleanupMutationIntended",
        P3: "WorktreeCleanupMutationResultRecorded (Unknown)",
        P4: "WorktreeCleanupObservationIntended (ordinal 2) for reconciliation",
        P5: "WorktreeCleanupObserved (ordinal 2, Absent) for reconciliation",
        P6: "WorktreeCleanupSettled or WorktreeCleanupContradicted"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Planned-attempt worktree cleanup", cut),
      qualification: metadataReasonFor("Planned-attempt worktree cleanup")
    }),
    boundary({
      id: "planned-attempt-branch-cleanup",
      family: "Planned-attempt branch cleanup",
      description: "Exact branch cleanup gated by settled worktree removal.",
      evidence: () => currentEvidence.branchCleanup,
      endpoints: {
        P0: "the record before BranchCleanupAuthorized",
        P1: "BranchCleanupAuthorized",
        P2: "BranchCleanupMutationIntended",
        P3: "BranchCleanupMutationResultRecorded (Unknown)",
        P4: "BranchCleanupObservationIntended (ordinal 2) for reconciliation",
        P5: "BranchCleanupObserved (ordinal 2, Absent) for reconciliation",
        P6: "BranchCleanupSettled or BranchCleanupContradicted"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Planned-attempt branch cleanup", cut),
      qualification: metadataReasonFor("Planned-attempt branch cleanup")
    }),
    boundary({
      id: "integrator-candidate-cleanup",
      family: "Integrator predecessor-candidate cleanup",
      description: "Exact FullRerun predecessor-candidate cleanup with session ownership reconciliation.",
      evidence: () => currentEvidence.integratorCandidateCleanup,
      endpoints: {
        P0: "the record before IntegratorCandidateCleanupAuthorized",
        P1: "IntegratorCandidateCleanupAuthorized",
        P2: "IntegratorCandidateCleanupMutationIntended",
        P3: "IntegratorCandidateCleanupMutationResultRecorded (Unknown)",
        P4: "IntegratorCandidateCleanupObservationIntended (ordinal 2) for reconciliation",
        P5: "IntegratorCandidateCleanupObserved (ordinal 2, Absent) for reconciliation",
        P6: "IntegratorCandidateCleanupSettled or IntegratorCandidateCleanupContradicted"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Integrator predecessor-candidate cleanup", cut),
      qualification: metadataReasonFor("Integrator predecessor-candidate cleanup")
    }),
    boundary({
      id: "run-establishment",
      family: "Run establishment",
      description: "Run establishment and re-entry from the current durable journal history.",
      evidence: () => currentEvidence.runEstablishment,
      endpoints: { P0: "the empty journal before WorkflowRunBegan", P6: "WorkflowRunBegan or WorkflowRunTerminated" },
      notApplicableReason: (cut) => noEndpointReasonFor("Run establishment", cut),
      qualification: metadataReasonFor("Run establishment")
    }),
    boundary({
      id: "run-cancellation-finality",
      family: "Run cancellation finality",
      description: "Fresh G2 graph recovery, terminal append acknowledgement loss, and exactly-once re-entry.",
      evidence: () => runCancellationEvidence,
      endpoints: {
        P0: "the record before RunCancellationApplied",
        P1: "RunCancellationApplied",
        P2: "fresh G2 graph read intent before the first recovery crash",
        P3: "fresh G2 graph observation before the first recovery crash",
        P4: "fresh G2 graph read intent after coordinator re-entry",
        P5: "fresh G2 graph observation proving cancellation finality",
        P6: "WorkflowRunTerminated"
      },
      notApplicableReason: (cut) => noEndpointReasonFor("Run cancellation finality", cut),
      qualification: metadataOnly(
        "Run cancellation finality is covered by focused production runner/bootstrap recovery tests; #142 remains the manifest's representative dual-store qualification."
      )
    }),
    boundary({
      id: "application-exit",
      family: "Application Exit",
      description: "Process-local graceful application Exit admission and drain, which writes no Run event.",
      evidence: () => currentEvidence.applicationExit,
      endpoints: {},
      notApplicableReason: (cut) =>
        `Application Exit is process-local, so ${recoveryPrefixCutMeaning[cut]} has no Run-journal representation; the application-exit conformance seam is the evidence.`,
      qualification: metadataReasonFor("Application Exit")
    })
  ]
}

/** The single checked-in manifest consumed by the focused conformance test. */
export const recoveryPrefixManifest = decodeRecoveryPrefixManifest(sourceManifest)

/** Extracting tags from the current closed event schema avoids a second event fixture catalog in test support. */
export const currentWorkflowEventTags = ((): ReadonlySet<string> => {
  const visit = (node: SchemaAST.AST): ReadonlyArray<string> => {
    const ownTags: ReadonlyArray<string> = SchemaAST.isObjects(node)
      ? (() => {
          const tagProperty = node.propertySignatures.find(({ name }) => name === "_tag")
          return tagProperty !== undefined &&
            SchemaAST.isLiteral(tagProperty.type) &&
            typeof tagProperty.type.literal === "string"
            ? [tagProperty.type.literal]
            : []
        })()
      : []
    const nestedTags = SchemaAST.isUnion(node) ? node.types.flatMap(visit) : []
    return [...ownTags, ...nestedTags]
  }
  return new Set(visit(WorkflowJournalEvent.ast))
})()
