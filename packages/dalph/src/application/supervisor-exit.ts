/* eslint-disable import/no-nodejs-modules -- This adapter intentionally owns Node signals, diagnostics, and process termination. */
import { writeSync } from "node:fs"
import nodeProcess from "node:process"
import {
  type ApplicationExitResult,
  type ApplicationExitRequestBoundaryService,
  type ApplicationExitShellService,
  type ApplicationExitTraceEvent,
  type ApplicationExitTraceService,
  type ApplicationProcessLifecycleService,
  makeApplicationExitShell
} from "@dalph/orchestrator"
import { Deferred, Effect, FiberSet, type Scope } from "effect"

const linuxSupervisorExitSignal = "SIGTERM" as const

/** One public operating-system transport that requests graceful application Exit. */
export type ApplicationExitSignal = "SIGINT" | "SIGTERM"

/** The process boundary that owns delivery and removal of exact application Exit signal listeners. */
export interface ApplicationExitSignalBoundary {
  readonly addSignalListener: (signal: ApplicationExitSignal, listener: () => void) => Effect.Effect<void>
  readonly removeSignalListener: (signal: ApplicationExitSignal, listener: () => void) => Effect.Effect<void>
}

/** One scoped listener installation and the first joined lifecycle result it observes. */
export interface InstalledApplicationExitSignalAdapter {
  readonly awaitRequest: Effect.Effect<void>
  readonly awaitResult: Effect.Effect<ApplicationExitResult>
}

/** The outer host boundary that reports lifecycle facts and ends this exact process incarnation. */
export interface ApplicationHostProcessBoundary extends ApplicationExitSignalBoundary {
  readonly reportLifecycleEvent: (event: ApplicationExitTraceEvent) => Effect.Effect<void>
  readonly requestProcessEnd: (status: 0 | 1) => Effect.Effect<void>
}

type ApplicationExitOwnership = Parameters<typeof makeApplicationExitShell>[0]

/**
 * Installs exact signal transports in the current outer application scope.
 * Every delivery submits the same transport-neutral boundary request; the
 * boundary owns first-request cutoff and repeated-request coalescing. The
 * returned Effect observes one joined result without turning signal receipt
 * or listener scope loss into lifecycle evidence.
 */
export const installApplicationExitSignalAdapter = Effect.fn("ApplicationExitSignalAdapter.install")(function* (
  requestBoundary: ApplicationExitRequestBoundaryService,
  signals: ApplicationExitSignalBoundary,
  acceptedSignals: readonly [ApplicationExitSignal, ...Array<ApplicationExitSignal>]
) {
  const runRequest = yield* FiberSet.makeRuntime<never, void, never>()
  const firstRequest = yield* Deferred.make<void>()
  const firstResult = yield* Deferred.make<ApplicationExitResult>()
  const registrations = acceptedSignals.map((signal) => {
    const listener = () => {
      runRequest(
        Deferred.succeed(firstRequest, undefined).pipe(
          Effect.andThen(requestBoundary.requestExit),
          Effect.flatMap((result) => Deferred.succeed(firstResult, result)),
          Effect.asVoid
        )
      )
    }
    return { listener, signal }
  })
  yield* Effect.forEach(
    registrations,
    ({ listener, signal }) =>
      Effect.acquireRelease(signals.addSignalListener(signal, listener), () =>
        signals.removeSignalListener(signal, listener)
      ),
    { discard: true }
  )
  return {
    awaitRequest: Deferred.await(firstRequest),
    awaitResult: Deferred.await(firstResult)
  } satisfies InstalledApplicationExitSignalAdapter
})

/** Preserves #210's Linux supervisor contract: only SIGTERM is installed. */
export const installLinuxSupervisorExitSignalAdapter = Effect.fn("LinuxSupervisorExitSignalAdapter.install")(
  (requestBoundary: ApplicationExitRequestBoundaryService, signals: ApplicationExitSignalBoundary) =>
    installApplicationExitSignalAdapter(requestBoundary, signals, [linuxSupervisorExitSignal]).pipe(Effect.asVoid)
)

/** Adapts the typed lifecycle trace and process-end decision to one application host. */
export const makeApplicationHostLifecyclePorts = (
  host: ApplicationHostProcessBoundary
): { readonly processLifecycle: ApplicationProcessLifecycleService; readonly trace: ApplicationExitTraceService } => ({
  processLifecycle: { requestEnd: ({ status }) => host.requestProcessEnd(status) },
  trace: { emit: (event) => host.reportLifecycleEvent(event) }
})

/** Composes one application-scoped Exit shell with the Linux supervisor transport and real host ports. */
export const makeLinuxSupervisorApplicationExitHost: (
  ownership: ApplicationExitOwnership,
  host?: ApplicationHostProcessBoundary
) => Effect.Effect<ApplicationExitShellService, never, Scope.Scope> = Effect.fn(
  "LinuxSupervisorApplicationExitHost.make"
)(function* (ownership, host = nodeApplicationHostProcessBoundary) {
  const ports = makeApplicationHostLifecyclePorts(host)
  const shell = yield* makeApplicationExitShell(ownership, ports.processLifecycle, ports.trace)
  yield* installLinuxSupervisorExitSignalAdapter(shell.requestBoundary, host)
  return shell
})

export interface NodeApplicationProcess {
  readonly addSignalListener: (signal: ApplicationExitSignal, listener: () => void) => void
  readonly end: (status: 0 | 1) => never
  readonly removeSignalListener: (signal: ApplicationExitSignal, listener: () => void) => void
  readonly report: (event: ApplicationExitTraceEvent) => void
}

const nodeApplicationProcess: NodeApplicationProcess = {
  addSignalListener: (signal, listener) => nodeProcess.on(signal, listener),
  end: (status) => nodeProcess.exit(status),
  removeSignalListener: (signal, listener) => nodeProcess.off(signal, listener),
  report: (event) => writeSync(nodeProcess.stderr.fd, `${JSON.stringify({ applicationExit: event })}\n`)
}

/** Real Node signal listener boundary; it intentionally has no process-end or lifecycle-report capability. */
export const nodeApplicationExitSignalBoundary: ApplicationExitSignalBoundary = {
  addSignalListener: (signal, listener) =>
    Effect.sync(() => {
      nodeApplicationProcess.addSignalListener(signal, listener)
    }),
  removeSignalListener: (signal, listener) =>
    Effect.sync(() => {
      nodeApplicationProcess.removeSignalListener(signal, listener)
    })
}

/** Constructs the real host adapter from the smallest exact Node process capability. */
export const makeNodeApplicationHostProcessBoundary = (
  applicationProcess: NodeApplicationProcess
): ApplicationHostProcessBoundary => ({
  addSignalListener: (signal, listener) =>
    Effect.sync(() => {
      applicationProcess.addSignalListener(signal, listener)
    }),
  removeSignalListener: (signal, listener) =>
    Effect.sync(() => {
      applicationProcess.removeSignalListener(signal, listener)
    }),
  reportLifecycleEvent: (event) => Effect.sync(() => applicationProcess.report(event)),
  requestProcessEnd: (status) =>
    Effect.sync(() => {
      applicationProcess.end(status)
    })
})

/** Real Node/Linux host boundary. Process exit is requested by Dalph, not delegated to the supervisor. */
export const nodeApplicationHostProcessBoundary = makeNodeApplicationHostProcessBoundary(nodeApplicationProcess)
