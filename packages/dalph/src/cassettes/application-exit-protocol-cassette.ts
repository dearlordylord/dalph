import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  type ApplicationExitResult,
  type ApplicationExitTraceEvent,
  CoordinatorOwnership,
  makeApplicationExitShell,
  type ApplicationProcessEndDecision
} from "@dalph/orchestrator"
import { Effect, Ref, Schema } from "effect"
import {
  ApplicationExitProtocolCassette,
  type ApplicationExitProtocolCassette as ApplicationExitProtocolCassetteType
} from "./application-exit-protocol-cassette-domain.js"

export interface ApplicationExitProtocolCassetteRun {
  readonly cassette: ApplicationExitProtocolCassetteType
  readonly processEndDecisions: ReadonlyArray<ApplicationProcessEndDecision>
  readonly quickDrains: ReadonlyArray<string>
  readonly result: ApplicationExitResult
  readonly trace: ReadonlyArray<ApplicationExitTraceEvent>
}

const drainFailureDiagnostic = ApplicationExitDiagnostic.make(
  "controlled executor suspension contradicted the exact attempt"
)

/** Runs one application-lifecycle story through the production Exit request boundary. */
export const runApplicationExitProtocolCassette = Effect.fn("ApplicationExitProtocolCassette.run")(function* (
  input: unknown
) {
  const cassette = yield* Schema.decodeUnknownEffect(ApplicationExitProtocolCassette)(input)
  const quickDrains = yield* Ref.make<ReadonlyArray<string>>([])
  const processEndDecisions = yield* Ref.make<ReadonlyArray<ApplicationProcessEndDecision>>([])
  const trace = yield* Ref.make<ReadonlyArray<ApplicationExitTraceEvent>>([])
  const recordDrain = (name: string) => Ref.update(quickDrains, (current) => [...current, name])
  const ownership = CoordinatorOwnership.of({
    release: recordDrain("CoordinatorLock"),
    runMutation: (mutation) => mutation
  })
  const shell = yield* makeApplicationExitShell(
    ownership,
    { requestEnd: (decision) => Ref.update(processEndDecisions, (current) => [...current, decision]) },
    { emit: (event) => Ref.update(trace, (current) => [...current, event]) }
  )
  yield* shell.registerProcessLocalDrain({ closeProcessLocalResources: recordDrain("ProcessLocalResources") })
  if (cassette.scenario === "DrainFailure") {
    yield* shell.registerExecutorDrain({
      suspendRunningExecutorWork: Effect.fail(
        new ApplicationExitDrainFailure({ diagnostics: [drainFailureDiagnostic] })
      )
    })
  }

  const result = yield* shell.requestBoundary.requestExit
  return {
    cassette,
    processEndDecisions: yield* Ref.get(processEndDecisions),
    quickDrains: yield* Ref.get(quickDrains),
    result,
    trace: yield* Ref.get(trace)
  } satisfies ApplicationExitProtocolCassetteRun
})
