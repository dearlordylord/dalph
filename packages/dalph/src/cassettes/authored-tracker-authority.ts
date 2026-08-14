import { Effect, Layer, Match, Option, Ref } from "effect"
import type { TaskId } from "@dalph/contracts"
import {
  CompletionClaimBoundary,
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  CompletionTaskRequestFailure,
  CompletionTaskRequestLookup,
  type CompletionClaimObservation,
  completionTaskClaimEquals,
  isExactTaskClaim,
  OperationId,
  TrackerRevision,
  TaskClaimConflict,
  TaskClaimOwnershipConflict,
  TaskClaimReadFailure,
  type TaskClaimObservation,
  TrackerMutation,
  UnclaimedTask
} from "@dalph/orchestrator"
import { AuthoredCassetteInteractionMismatch, type StoryCursor } from "./authored-cursor.js"

type AuthoredInteractionMismatchReporter = (failure: AuthoredCassetteInteractionMismatch) => Effect.Effect<void>
type AuthoredAcquisitionOperationLookup = (operationId: OperationId) => Effect.Effect<Option.Option<TaskId>>

/** Owns one coherent authored tracker-claim authority across ordinary and completion-finality protocols. */
export const controlledTrackerAuthorityLayer = (
  cursor: StoryCursor,
  tracker: TrackerMutation["Service"],
  reportInteractionMismatch: AuthoredInteractionMismatchReporter = () => Effect.void,
  lookupAcquisitionOperationTask: AuthoredAcquisitionOperationLookup = () => Effect.succeed(Option.none())
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const authoredObservations = yield* Ref.make<ReadonlyMap<TaskId, CompletionClaimObservation>>(new Map())
      const currentObservation: TrackerMutation["Service"]["readTaskClaim"] = (taskId) =>
        Ref.get(authoredObservations).pipe(
          Effect.flatMap((observations) => {
            const observation = observations.get(taskId)
            if (observation === undefined) return tracker.readTaskClaim(taskId)
            /* v8 ignore start -- @preserve Production planning never routes an active-claim read through a task whose completion-finality protocol owns the current claim. */
            return observation._tag === "CompletionTaskClaim"
              ? Effect.fail(
                  new TaskClaimReadFailure({
                    detail: "the task currently has a promotion-correlated completion claim",
                    taskId
                  })
                )
              : Effect.succeed(observation)
            /* v8 ignore stop -- @preserve */
          })
        )
      const setObservation = (taskId: TaskId, observation: CompletionClaimObservation) =>
        Ref.update(authoredObservations, (observations) => new Map(observations).set(taskId, observation))
      const applyAuthoredObservation = (observation: TaskClaimObservation) =>
        Effect.gen(function* () {
          if (observation._tag === "UnclaimedTask") {
            const current = yield* tracker.readTaskClaim(observation.taskId)
            /* v8 ignore start -- @preserve Repeating an authored absence needs no second underlying release. */
            if (current._tag === "ActiveTaskClaim") {
              yield* tracker
                .releaseTaskClaim({
                  claim: current,
                  operationId: OperationId.make(`authored-external-claim-loss:${current.operationId}`)
                })
                .pipe(Effect.orDie)
            }
            /* v8 ignore stop -- @preserve */
          }
          yield* setObservation(observation.taskId, observation)
          return observation
        })
      const applyAcquisition = (acquisition: Parameters<TrackerMutation["Service"]["acquireTaskClaim"]>[0]) =>
        cursor.consumeTaskClaimAcquisitionConflictReturned.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                tracker
                  .acquireTaskClaim(acquisition)
                  .pipe(Effect.tap((claim) => setObservation(acquisition.taskId, claim))),
              onSome: ({ observed, operationId }) =>
                Effect.gen(function* () {
                  // A definite conflict is a provider observation, not a
                  // mutation. Retain K2 so a later activation's current read
                  // cannot regress to the earlier missing observation.
                  yield* setObservation(acquisition.taskId, observed)
                  const mappedTaskId = yield* lookupAcquisitionOperationTask(operationId)
                  if (
                    Option.isNone(mappedTaskId) ||
                    mappedTaskId.value !== acquisition.taskId ||
                    operationId !== acquisition.operationId ||
                    observed.taskId !== acquisition.taskId
                  ) {
                    yield* reportInteractionMismatch(
                      new AuthoredCassetteInteractionMismatch({
                        actual: JSON.stringify({
                          operationId: acquisition.operationId,
                          taskId: acquisition.taskId,
                          mappedTaskId: Option.isSome(mappedTaskId) ? mappedTaskId.value : undefined
                        }),
                        expected: JSON.stringify({ operationId, taskId: observed.taskId }),
                        storyPosition: (yield* cursor.storyPosition) - 1
                      })
                    )
                  }
                  return yield* Effect.fail(new TaskClaimConflict({ attempted: acquisition, observed }))
                })
            })
          )
        )
      const readTaskClaim: TrackerMutation["Service"]["readTaskClaim"] = (taskId) =>
        cursor.consumeTaskClaimRead.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => currentObservation(taskId),
              onSome: (item) => {
                if (item._tag === "TaskClaimCurrentReadReturned") {
                  return item.taskId === taskId
                    ? currentObservation(taskId)
                    : /* v8 ignore next -- @preserve Decoded authored claim reads must name the requested task. */
                      Effect.die(`authored cassette returned current claim ${item.taskId} for ${taskId}`)
                }
                if (item._tag === "TaskClaimReadFailed") {
                  return item.taskId === taskId
                    ? Effect.fail(new TaskClaimReadFailure({ detail: item.reason, taskId }))
                    : /* v8 ignore next -- @preserve Decoded authored failures must name the requested task. */
                      Effect.die(`authored cassette returned unreadable claim ${item.taskId} for ${taskId}`)
                }
                return item.observation.taskId === taskId
                  ? applyAuthoredObservation(item.observation)
                  : /* v8 ignore next -- @preserve Decoded authored observations must name the requested task. */
                    Effect.die(`authored cassette returned task claim ${item.observation.taskId} for ${taskId}`)
              }
            })
          )
        )
      const trackerMutation = TrackerMutation.of({
        acquireTaskClaim: (acquisition) =>
          Ref.get(authoredObservations).pipe(
            Effect.flatMap((observations) => {
              const observed = observations.get(acquisition.taskId)
              if (observed === undefined) {
                return applyAcquisition(acquisition)
              }
              const attempted = { _tag: "ActiveTaskClaim" as const, ...acquisition }
              if (observed._tag === "UnclaimedTask") {
                return applyAcquisition(acquisition)
              }
              /* v8 ignore start -- @preserve A completion claim retains integration-finality ownership and cannot return to fresh task acquisition. */
              if (observed._tag === "CompletionTaskClaim") {
                return Effect.die(`authored tracker cannot acquire ${acquisition.taskId} over a completion claim`)
              }
              /* v8 ignore stop -- @preserve */
              return isExactTaskClaim(observed, attempted)
                ? Effect.succeed(observed)
                : Effect.fail(new TaskClaimConflict({ attempted: acquisition, observed }))
            })
          ),
        readTaskClaim,
        /* v8 ignore start -- @preserve Release variants are covered by the tracker contract and composed cassette outcomes. */
        releaseTaskClaim: (release) => {
          const applyRelease = Ref.get(authoredObservations).pipe(
            Effect.flatMap((observations) => {
              const observed = observations.get(release.claim.taskId)
              if (observed === undefined) {
                return tracker
                  .releaseTaskClaim(release)
                  .pipe(
                    Effect.tap(() =>
                      setObservation(release.claim.taskId, UnclaimedTask.make({ taskId: release.claim.taskId }))
                    )
                  )
              }
              if (observed._tag === "CompletionTaskClaim") {
                return Effect.die(
                  `authored tracker cannot release active claim ${release.claim.taskId} over a completion claim`
                )
              }
              if (observed._tag === "UnclaimedTask") {
                return Effect.fail(new TaskClaimOwnershipConflict({ attempted: release.claim, observed }))
              }
              /* v8 ignore next -- @preserve Ownership-conflict variants are covered by the tracker contract. */
              return isExactTaskClaim(observed, release.claim)
                ? tracker
                    .releaseTaskClaim(release)
                    .pipe(
                      Effect.tap(() =>
                        setObservation(release.claim.taskId, UnclaimedTask.make({ taskId: release.claim.taskId }))
                      )
                    )
                : Effect.fail(new TaskClaimOwnershipConflict({ attempted: release.claim, observed }))
            })
          )
          return cursor.consumeTaskClaimReleaseResponseLost.pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => applyRelease,
                onSome: (lost) =>
                  lost.taskId !== release.claim.taskId
                    ? Effect.die(
                        `authored cassette lost claim-release response for ${lost.taskId} while releasing ${release.claim.taskId}`
                      )
                    : applyRelease.pipe(Effect.andThen(cursor.pauseAtCoordinatorProcessDeath))
              })
            )
          )
        }
        /* v8 ignore stop -- @preserve */
      })
      const currentCompletionObservation = (taskId: TaskId) =>
        Ref.get(authoredObservations).pipe(
          Effect.flatMap((observations) => {
            const observation = observations.get(taskId)
            /* v8 ignore next -- @preserve Completion-finality cassette reads follow the authored replacement that establishes the controlled observation. */
            return observation === undefined ? tracker.readTaskClaim(taskId) : Effect.succeed(observation)
          })
        )
      const completionClaimBoundary = CompletionClaimBoundary.of({
        readTaskClaim: (taskId) =>
          Effect.gen(function* () {
            const returned = yield* cursor.consumeCompletionClaimReadReturned.pipe(Effect.orDie)
            /* v8 ignore start -- @preserve The authored finality chronology binds every controlled response to the production-requested task. */
            if (returned.taskId !== taskId) {
              return yield* Effect.die(
                `authored completion-claim read returned ${returned.taskId} while reading ${taskId}`
              )
            }
            const current = yield* currentCompletionObservation(taskId).pipe(Effect.orDie)
            const kind = current._tag === "CompletionTaskClaim" ? "Completion" : "Active"
            if (current._tag === "UnclaimedTask" || kind !== returned.claim) {
              return yield* Effect.die(
                `authored completion-claim read expected ${returned.claim} for ${taskId}, received ${current._tag}`
              )
            }
            /* v8 ignore stop -- @preserve */
            return current
          }),
        replaceTaskClaim: (request) =>
          Effect.gen(function* () {
            const applied = yield* cursor.consumeCompletionClaimReplacementApplied.pipe(Effect.orDie)
            const taskId = request.claim.plannedAttempt.taskId
            /* v8 ignore start -- @preserve The authored finality chronology and production request share one exact task and active claim. */
            if (applied.taskId !== taskId) {
              return yield* Effect.die(
                `authored completion-claim replacement applied to ${applied.taskId} while replacing ${taskId}`
              )
            }
            const current = yield* currentCompletionObservation(taskId).pipe(Effect.orDie)
            if (current._tag !== "ActiveTaskClaim" || !isExactTaskClaim(current, request.claim.originalClaim)) {
              return yield* Effect.die(`authored completion-claim replacement lacked exact active claim ${taskId}`)
            }
            /* v8 ignore stop -- @preserve */
            yield* setObservation(taskId, request.claim)
            return request.claim
          }),
        deleteTaskClaim: (request) =>
          Effect.gen(function* () {
            const applied = yield* cursor.consumeCompletionClaimDeletionApplied.pipe(Effect.orDie)
            const taskId = request.claim.plannedAttempt.taskId
            /* v8 ignore start -- @preserve The authored finality chronology and production request share one exact task and completion claim. */
            if (applied.taskId !== taskId) {
              return yield* Effect.die(
                `authored completion-claim deletion applied to ${applied.taskId} while deleting ${taskId}`
              )
            }
            const current = yield* currentCompletionObservation(taskId).pipe(Effect.orDie)
            if (current._tag !== "CompletionTaskClaim" || !completionTaskClaimEquals(current, request.claim)) {
              return yield* Effect.die(`authored completion-claim deletion lacked exact completion claim ${taskId}`)
            }
            /* v8 ignore stop -- @preserve */
            yield* setObservation(taskId, UnclaimedTask.make({ taskId }))
          })
      })
      const completionTaskBoundary = CompletionTaskBoundary.of({
        readFocusedTaskCompletion: (taskId, target, operationId) =>
          Effect.gen(function* () {
            const returned = yield* cursor.consumeCompletionTaskFocusedReadReturned.pipe(Effect.orDie)
            if (returned.taskId !== taskId) {
              return yield* Effect.die(`authored focused completion read returned ${returned.taskId} for ${taskId}`)
            }
            const currentClaim = yield* currentCompletionObservation(taskId).pipe(Effect.orDie)
            if (currentClaim._tag !== "CompletionTaskClaim") {
              return yield* Effect.die(`authored focused completion read found ${currentClaim._tag} for ${taskId}`)
            }
            return {
              currentClaim,
              lifecycle: returned.lifecycle,
              operationId,
              target,
              targetMembership: "Member",
              taskId,
              taskRevision: currentClaim.plannedAttempt.taskRevision,
              trackerRevision: TrackerRevision.make(`authored-completion:${taskId}:${operationId}`),
              unfinishedPrerequisiteTaskIds: returned.unfinishedPrerequisiteTaskIds
            }
          }),
        completeTask: (request) =>
          Effect.gen(function* () {
            const returned = yield* cursor.consumeCompletionTaskRequestReturned.pipe(Effect.orDie)
            if (returned.taskId !== request.taskId) {
              return yield* Effect.die(`authored completion response returned ${returned.taskId} for ${request.taskId}`)
            }
            const current = yield* currentCompletionObservation(request.taskId).pipe(Effect.orDie)
            if (current._tag !== "CompletionTaskClaim" || !completionTaskClaimEquals(current, request.claim)) {
              return yield* Effect.die(`authored completion request lacked exact completion claim ${request.taskId}`)
            }
            return yield* Match.value(returned.outcome).pipe(
              Match.when("Acknowledged", () =>
                Effect.succeed(
                  CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
                )
              ),
              Match.when("DefinitelyRejected", () =>
                Effect.fail(
                  new CompletionTaskRequestFailure({
                    detail: returned.outcome,
                    outcome: "DefinitelyNotApplied",
                    request
                  })
                )
              ),
              Match.when("ResponseLost", () =>
                Effect.fail(new CompletionTaskRequestFailure({ detail: returned.outcome, outcome: "Unknown", request }))
              ),
              Match.exhaustive
            )
          }),
        readCompletionRequest: (request) =>
          Effect.gen(function* () {
            const returned = yield* cursor.consumeCompletionTaskRequestLookupReturned.pipe(Effect.orDie)
            if (returned.taskId !== request.taskId) {
              return yield* Effect.die(`authored completion lookup returned ${returned.taskId} for ${request.taskId}`)
            }
            return Match.value(returned.outcome).pipe(
              Match.when("Applied", () => CompletionTaskRequestLookup.cases.Applied.make({ request })),
              Match.when("NotApplied", () => CompletionTaskRequestLookup.cases.NotApplied.make({ request })),
              Match.when("Unreadable", () =>
                CompletionTaskRequestLookup.cases.Unreadable.make({ detail: "authored unreadable lookup", request })
              ),
              Match.exhaustive
            )
          })
      })
      return Layer.mergeAll(
        Layer.succeed(TrackerMutation, trackerMutation),
        Layer.succeed(CompletionClaimBoundary, completionClaimBoundary),
        Layer.succeed(CompletionTaskBoundary, completionTaskBoundary)
      )
    })
  )
