import { Effect, Exit, Option, Queue, Ref } from "effect"
import { ActivationCause, makeActivationCoordinator } from "./activation-coordinator.js"
import { makeFreshImplementationConvergenceStage } from "./fresh-implementation-convergence-stages.js"
import {
  type AuthoritativeImplementationConvergenceResult,
  type FreshImplementationConvergenceOptions,
  type FreshImplementationConvergenceStage,
  type FreshImplementationConvergenceStageError
} from "./implementation-convergence-stage.js"
import type { TaskAdmissionController } from "./task-admission-controller.js"
import type { TaskExecutionOutcome } from "./task-execution.js"

interface LiveImplementationConvergenceOptions extends FreshImplementationConvergenceOptions {
  readonly admissionController: TaskAdmissionController
  readonly initialExecutionOutcome: TaskExecutionOutcome
}

/** Drives exact convergence operations through activation ownership. */
export const runLiveImplementationConvergence = Effect.fn(
  "Workflow.runLiveImplementationConvergence"
)(function*(options: LiveImplementationConvergenceOptions) {
  type Completion = AuthoritativeImplementationConvergenceResult
  const completion = yield* Ref.make<Completion | undefined>(undefined)
  const stage: FreshImplementationConvergenceStage = yield* makeFreshImplementationConvergenceStage(
    {
      ...options,
      onCompleted: (result) => Ref.set(completion, result)
    },
    options.initialExecutionOutcome
  )
  const initialStage = stage
  yield* Effect.scoped(Effect.gen(function*() {
    const stages = yield* Ref.make<
      ReadonlyArray<FreshImplementationConvergenceStage>
    >([initialStage])
    const outcomes = yield* Queue.unbounded<
      Exit.Exit<
        AuthoritativeImplementationConvergenceResult,
        FreshImplementationConvergenceStageError
      >
    >()
    const coordinator = yield* makeActivationCoordinator({
      admissionController: options.admissionController,
      readFrontier: Ref.get(stages).pipe(
        Effect.map((current) => ({
          explanations: [],
          transitions: current.map(({ transition }) => transition)
        }))
      ),
      runId: options.subject.plannedAttempt.runId,
      runTransition: (transition, execution) =>
        Effect.gen(function*() {
          const owned = Option.getOrThrow(
            Option.fromUndefinedOr(
              (yield* Ref.get(stages)).find(
                (candidate) => candidate.transition === transition
              )
            )
          )
          const exit = yield* owned.run(execution.recordIntent).pipe(
            Effect.exit
          )
          if (Exit.isFailure(exit)) {
            yield* Ref.set(stages, [])
            yield* Queue.offer(outcomes, Exit.failCause(exit.cause))
            return yield* Effect.failCause(exit.cause)
          }
          yield* Ref.set(
            stages,
            exit.value === undefined ? [] : [exit.value]
          )
          if (exit.value === undefined) {
            const completed = Option.getOrThrow(
              Option.fromUndefinedOr(yield* Ref.get(completion))
            )
            yield* Queue.offer(outcomes, Exit.succeed(completed))
          }
        })
    })
    yield* coordinator.signal(ActivationCause.Restart())
    const outcome = yield* Queue.take(outcomes)
    if (Exit.isFailure(outcome)) {
      return yield* Effect.failCause(outcome.cause)
    }
  }))
  const result = yield* Ref.get(completion)
  return Option.getOrThrow(Option.fromUndefinedOr(result))
})
