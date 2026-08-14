import {
  plannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import { InRunJournal } from "../../../workflow-journal/store.js"
import {
  defaultPlannedAttemptExecutorContinuationLimit,
  defaultPlannedAttemptExecutorSuspensionLimit,
  type PlannedAttemptExecutorContinuationLimit,
  type PlannedAttemptExecutorSuspensionLimit
} from "./events.js"
import { latestUnsettledPlannedAttemptExecutorCommand } from "./evidence.js"
import { PlannedAttemptExecutorCommandReconciliationRequired, runPlannedAttemptExecutorCommand } from "./protocol.js"
import { type PlannedAttemptProtocolPermit, withPlannedAttemptProtocolPermit } from "./protocol-controller.js"

/** Starts or resumes all executor work for the exact planned attempt. */
export const continuePlannedAttemptExecutorWorkWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt,
  continuationLimit: PlannedAttemptExecutorContinuationLimit = defaultPlannedAttemptExecutorContinuationLimit,
  selectedSpecification?: TaskWorkSpecification
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    runPlannedAttemptExecutorCommand(
      plannedAttempt,
      "StartOrContinue",
      continuationLimit,
      defaultPlannedAttemptExecutorSuspensionLimit,
      selectedSpecification
    )
  )

/**
 * Issues a suspension only when no earlier executor command needs a fresh
 * projection. The exact-attempt permit keeps that check and command together;
 * application Exit uses this seam because reconciliation is forbidden during
 * its bounded drain.
 */
export const requestPlannedAttemptExecutorSuspensionWithoutReconciliationWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt,
  suspensionLimit: PlannedAttemptExecutorSuspensionLimit = defaultPlannedAttemptExecutorSuspensionLimit
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const records = yield* journal.read(plannedAttempt.runId)
      const unsettledCommand = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt)
      if (unsettledCommand !== undefined) {
        return yield* new PlannedAttemptExecutorCommandReconciliationRequired({
          commandOrdinal: unsettledCommand.ordinal,
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        })
      }
      return yield* runPlannedAttemptExecutorCommand(
        plannedAttempt,
        "Suspend",
        defaultPlannedAttemptExecutorContinuationLimit,
        suspensionLimit
      )
    })
  )

/** Asks the executor to stop all work while preserving the exact attempt for resume. */
export const requestPlannedAttemptExecutorSuspensionWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt,
  suspensionLimit = defaultPlannedAttemptExecutorSuspensionLimit
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    runPlannedAttemptExecutorCommand(
      plannedAttempt,
      "Suspend",
      defaultPlannedAttemptExecutorContinuationLimit,
      suspensionLimit
    )
  )
