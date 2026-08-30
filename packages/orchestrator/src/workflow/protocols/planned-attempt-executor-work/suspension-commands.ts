import {
  plannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { defaultPlannedAttemptExecutorSuspensionLimit, type PlannedAttemptExecutorSuspensionLimit } from "./events.js"
import { latestUnsettledPlannedAttemptExecutorCommand } from "./evidence.js"
import { runPlannedAttemptExecutorCommand } from "./command.js"
import { PlannedAttemptExecutorCommandReconciliationRequired } from "./protocol.js"
import { type PlannedAttemptProtocolPermit, withPlannedAttemptProtocolPermit } from "./protocol-controller.js"

/** Begins all executor work for the exact planned attempt once. */
export const beginPlannedAttemptExecutorWorkWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt,
  selectedSpecification?: TaskWorkSpecification
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    runPlannedAttemptExecutorCommand(
      permit,
      plannedAttempt,
      "Begin",
      defaultPlannedAttemptExecutorSuspensionLimit,
      selectedSpecification
    )
  )

/** Resumes the same exact work after one accepted safe-suspension transition. */
export const resumePlannedAttemptExecutorWorkWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt,
  selectedSpecification?: TaskWorkSpecification
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    runPlannedAttemptExecutorCommand(
      permit,
      plannedAttempt,
      "Resume",
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
      return yield* runPlannedAttemptExecutorCommand(permit, plannedAttempt, "Suspend", suspensionLimit)
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
    runPlannedAttemptExecutorCommand(permit, plannedAttempt, "Suspend", suspensionLimit)
  )
