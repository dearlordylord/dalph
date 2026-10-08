/* eslint-disable import/no-nodejs-modules -- Controlled read probes allocate an explicit loopback port. */
import { createServer } from "node:net"
import { RunId } from "@dalph/contracts"
import {
  AllocatedWorkflowRunId,
  currentSignalOf,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  JournalPosition,
  makeApplicationExitLifecycle,
  ProductionRunSelection,
  TraceCursor,
  type DeliveryRuntimeObservationState
} from "@dalph/orchestrator"
import { Effect, Option, Ref, Schema } from "effect"
import { type ProductionRunningHostObservation } from "../src/application/production-host.js"
import { LocalHostAddress } from "../src/application/running-host-contract.js"
const probeRunId = RunId.make("http-test-run")
const cursor = TraceCursor.make({ runId: probeRunId, position: JournalPosition.make(1) })
class ReadProbePortUnavailable extends Schema.TaggedError<ReadProbePortUnavailable>()("ReadProbePortUnavailable", {}) {}

export const availableHostAddress = (hostname: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise<LocalHostAddress>((resolve, reject) => {
        const reservation = createServer()
        reservation.once("error", reject)
        reservation.listen(0, hostname, () => {
          const address = reservation.address()
          if (address === null || typeof address === "string") {
            reservation.close()
            reject(new Error("PortUnavailable"))
            return
          }
          reservation.close(() => resolve(LocalHostAddress.make(`http://${hostname}:${address.port}`)))
        })
      }),
    catch: () => new ReadProbePortUnavailable({})
  })

export const availableLocalHostAddress = availableHostAddress("127.0.0.1")

export const makeRunningHostReadProbe = Effect.fn("RunningHostTest.readProbe")(function* () {
  const lifecycle = yield* makeApplicationExitLifecycle()
  const reads = yield* Ref.make(0)
  const closing = yield* Ref.make(false)
  const current = yield* Ref.make<DeliveryRuntimeObservationState>({ _tag: "NotReady" })
  const failure = yield* Ref.make<Option.Option<unknown>>(Option.none())
  const observation: ProductionRunningHostObservation<unknown> = {
    target: GithubIssueTarget.make({
      issueNumber: GithubIssueNumber.make(1),
      owner: GithubRepositoryOwner.make("fixture"),
      repository: GithubRepositoryName.make("fixture")
    }),
    selection: ProductionRunSelection.cases.Allocated.make({ runId: AllocatedWorkflowRunId.make(probeRunId) }),
    acceptedHistory: currentSignalOf(cursor),
    current: { ...currentSignalOf({ _tag: "NotReady" as const }), get: Ref.get(current) },
    readRunControl: Ref.update(reads, (count) => count + 1).pipe(
      Effect.as({ direction: "RunUnpaused", observedAt: cursor, termination: null })
    ),
    activationFailure: Ref.get(failure),
    closing: Ref.get(closing),
    commandAdmission: lifecycle.admission,
    awaitExitResult: lifecycle.awaitExitResult.pipe(Effect.asVoid),
    registerObservationDrain: () => Effect.void,
    executeAttachedCommand: () => Effect.die("passive probe cannot execute commands"),
    runTermination: { await: Effect.never, poll: Effect.succeed(Option.none()) },
    applicationExitRequestBoundary: { requestExit: Effect.die("read cannot request Exit") },
    traceReader: {
      snapshotAdmission: () => Effect.succeed({ _tag: "MayFit" as const }),
      readAt: () => Effect.die("read cannot request historical trace")
    }
  }

  return { runId: probeRunId, reads, closing, current, failure, observation }
})
