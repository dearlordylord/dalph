import { type RunId } from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Layer, Option, Ref, Semaphore } from "effect"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { Journal, journalLayer } from "../delivery/journal.js"
import {
  RunFinalityDecision,
  type RunFinalityDecision as RunFinalityDecisionType,
  type RunFinalityProof
} from "../frontier/frontier.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { InvalidWorkflowJournalHistory, ValidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import {
  JournaledRunBootstrap,
  JournaledRunIdentityMismatch,
  JournaledRunNotActive,
  type JournaledRunBootstrapService,
  type JournaledRunServices
} from "./run.js"
import { inspectStartupRecovery, StartupRecoveryBlocked } from "./startup-recovery.js"
import {
  type InRunJournal,
  type JournalReadError,
  JournalStore,
  RunLifecycleJournal
} from "../../workflow-journal/store.js"

export interface JournaledRuntimeLayerInput {
  readonly runId: RunId
  readonly startup: "Fresh" | "Recovered"
}

export type JournaledRuntimeLayer = Layer.Layer<
  Exclude<JournaledRunServices, Journal>,
  InvalidWorkflowJournalHistory | JournalReadError | StartupRecoveryBlocked,
  CoordinatorOwnership | InRunJournal
>

interface RuntimeControls {
  readonly controlDirection: ControlDirectionApplication["Service"]
  readonly taskClaimReacquisition: TaskClaimReacquisitionControl["Service"]
  readonly taskWorkCapacity: TaskWorkCapacityControl["Service"]
}

type RuntimeControlState =
  | { readonly _tag: "RuntimeInactive" }
  | {
      readonly _tag: "RuntimeAcceptingControl"
      readonly activeLeases: number
      readonly controls: RuntimeControls
      readonly drained: Deferred.Deferred<void>
    }
  | {
      readonly _tag: "RuntimeClosing"
      readonly activeLeases: number
      readonly controls: RuntimeControls
      readonly drained: Deferred.Deferred<void>
    }

const validateRun = Effect.fn("JournaledRunBootstrap.validateRun")(function* (
  runId: RunId,
  records: Parameters<typeof reduceWorkflowJournalHistory>[1]
) {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return yield* new StartupRecoveryBlocked({ issues: reduction.issues })
  }
  return reduction
})

/**
 * Owns the complete bootstrap/runtime/termination chronology. Raw storage never
 * enters the runtime context; external Operator calls borrow only narrow
 * controls and teardown waits for every accepted borrow to finish.
 */
export const journaledRunBootstrapLayer = (
  expectedRunId: RunId,
  runtimeLayer: (input: JournaledRuntimeLayerInput) => JournaledRuntimeLayer
) =>
  Layer.effect(
    JournaledRunBootstrap,
    Effect.gen(function* () {
      const ownership = yield* CoordinatorOwnership
      const storage = yield* JournalStore
      const lifecycle = yield* RunLifecycleJournal
      const runtimeState = yield* Ref.make<RuntimeControlState>({ _tag: "RuntimeInactive" })
      const activation = yield* Semaphore.make(1)

      const acquireControlLease = Effect.fn("JournaledRunBootstrap.acquireControlLease")(function* () {
        const controls = yield* Ref.modify(runtimeState, (current) =>
          current._tag === "RuntimeAcceptingControl"
            ? [
                Option.some(current.controls),
                { ...current, activeLeases: current.activeLeases + 1 } satisfies RuntimeControlState
              ]
            : [Option.none<RuntimeControls>(), current]
        )
        if (Option.isNone(controls)) return yield* new JournaledRunNotActive()
        return controls.value
      })

      const releaseControlLease = Effect.fn("JournaledRunBootstrap.releaseControlLease")(function* () {
        const signal = yield* Ref.modify(runtimeState, (current) => {
          /* v8 ignore start -- acquireUseRelease cannot release a lease that was never acquired. */
          if (current._tag === "RuntimeInactive") return [Option.none<Deferred.Deferred<void>>(), current]
          /* v8 ignore stop */
          const activeLeases = current.activeLeases - 1
          return [
            current._tag === "RuntimeClosing" && activeLeases === 0
              ? Option.some(current.drained)
              : Option.none<Deferred.Deferred<void>>(),
            { ...current, activeLeases } satisfies RuntimeControlState
          ]
        })
        if (Option.isSome(signal)) yield* Deferred.succeed(signal.value, undefined)
      })

      const withRuntimeControls = <A, E>(
        use: (controls: RuntimeControls) => Effect.Effect<A, E>
      ): Effect.Effect<A, E | JournaledRunNotActive> =>
        Effect.acquireUseRelease(acquireControlLease(), use, releaseControlLease)

      const closeControlAdmission = Effect.fn("JournaledRunBootstrap.closeControlAdmission")(function* () {
        const wait = yield* Ref.modify(runtimeState, (current) => {
          /* v8 ignore start -- runWithJournal opens admission exactly once before closing it exactly once. */
          if (current._tag !== "RuntimeAcceptingControl") return [Effect.void, current]
          /* v8 ignore stop */
          const closing = { ...current, _tag: "RuntimeClosing" as const }
          return [current.activeLeases === 0 ? Effect.void : Deferred.await(current.drained), closing]
        })
        yield* wait
        yield* Ref.set(runtimeState, { _tag: "RuntimeInactive" })
      })

      const runWithJournal = <E, R>(
        runId: RunId,
        target: Parameters<JournaledRunBootstrapService["fresh"]>[0],
        initial: ValidWorkflowJournalHistory,
        startup: "Fresh" | "Recovered",
        recheckJournalAfterProof: boolean,
        program: Effect.Effect<RunFinalityProof, E, R>
      ) =>
        Effect.scoped(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const downstream = runtimeLayer({ runId, startup }).pipe(
                Layer.provide(Layer.succeed(CoordinatorOwnership, ownership))
              )
              const runtime = downstream.pipe(Layer.provideMerge(journalLayer(runId, target, initial, storage)))
              const context = yield* Layer.build(runtime)
              const journal = Context.get(context, Journal)
              const controls: RuntimeControls = {
                controlDirection: Context.get(context, ControlDirectionApplication),
                taskClaimReacquisition: Context.get(context, TaskClaimReacquisitionControl),
                taskWorkCapacity: Context.get(context, TaskWorkCapacityControl)
              }
              const drained = yield* Deferred.make<void>()
              yield* Ref.set(runtimeState, { _tag: "RuntimeAcceptingControl", activeLeases: 0, controls, drained })
              const result = yield* restore(Effect.provide(program, context)).pipe(Effect.exit)
              yield* closeControlAdmission()
              return yield* Exit.match(result, {
                onFailure: Effect.failCause,
                onSuccess: (proof) =>
                  proof.decision._tag === "RunMustRemainActive" || !recheckJournalAfterProof
                    ? Effect.succeed(proof.decision)
                    : journal.state.get.pipe(
                        Effect.map(({ records }) =>
                          records.some(
                            ({ event, position }) =>
                              (proof.acceptedAt === null || position > proof.acceptedAt) &&
                              event._tag !== "TaskWorkCapacityChanged"
                          )
                            ? RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
                            : proof.decision
                        )
                      )
              })
            })
          )
        )

      const finish = Effect.fn("JournaledRunBootstrap.finish")(function* (
        runId: RunId,
        finality: RunFinalityDecisionType
      ) {
        if (finality._tag === "RunMayTerminate") yield* lifecycle.terminateRun(runId)
        return finality
      })

      const fresh: JournaledRunBootstrapService["fresh"] = (target, initialControlPolicy, runId, program) =>
        activation.withPermit(
          Effect.gen(function* () {
            if (runId !== expectedRunId) {
              return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: runId })
            }
            yield* inspectStartupRecovery(runId, lifecycle)
            yield* lifecycle.beginRun(runId, target, initialControlPolicy)
            const initial = yield* validateRun(runId, yield* lifecycle.read(runId))
            return yield* finish(runId, yield* runWithJournal(runId, target, initial, "Fresh", true, program))
          })
        )

      const recovered: JournaledRunBootstrapService["recovered"] = (target, program) =>
        activation.withPermit(
          Effect.gen(function* () {
            const current = yield* inspectStartupRecovery(expectedRunId, lifecycle)
            const runId = current?.runId ?? expectedRunId
            yield* lifecycle.readRunForRecovery(runId, target)
            const initial = yield* validateRun(runId, yield* lifecycle.read(runId))
            return yield* finish(runId, yield* runWithJournal(runId, target, initial, "Recovered", true, program))
          })
        )

      const operatorControl: JournaledRunBootstrapService["operatorControl"] = {
        applyControlDirection: (input) => withRuntimeControls(({ controlDirection }) => controlDirection.apply(input)),
        applyTaskClaimReacquisition: (input) =>
          withRuntimeControls(({ taskClaimReacquisition }) => taskClaimReacquisition.apply(input)),
        readTaskWorkCapacity: (runId) => withRuntimeControls(({ taskWorkCapacity }) => taskWorkCapacity.read(runId)),
        setTaskWorkCapacity: (input) => withRuntimeControls(({ taskWorkCapacity }) => taskWorkCapacity.apply(input))
      }

      return JournaledRunBootstrap.of({ fresh, operatorControl, recovered })
    })
  )
