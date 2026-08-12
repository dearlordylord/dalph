/* eslint-disable import/no-nodejs-modules -- This adapter intentionally owns Node signals, diagnostics, and process termination. */
import { writeSync } from "node:fs"
import nodeProcess from "node:process"
import {
  type ApplicationExitRequestBoundaryService,
  type ApplicationExitShellService,
  type ApplicationExitTraceEvent,
  type ApplicationExitTraceService,
  type ApplicationProcessLifecycleService,
  makeApplicationExitShell
} from "@dalph/orchestrator"
import { Effect, FiberSet, type Scope } from "effect"

const linuxSupervisorExitSignal = "SIGTERM" as const

/** The process boundary that owns delivery and removal of Linux supervisor SIGTERM listeners. */
export interface LinuxSupervisorSignalBoundary {
  readonly addSigtermListener: (listener: () => void) => Effect.Effect<void>
  readonly removeSigtermListener: (listener: () => void) => Effect.Effect<void>
}

/** The outer host boundary that reports lifecycle facts and ends this exact process incarnation. */
export interface ApplicationHostProcessBoundary extends LinuxSupervisorSignalBoundary {
  readonly reportLifecycleEvent: (event: ApplicationExitTraceEvent) => Effect.Effect<void>
  readonly requestProcessEnd: (status: 0 | 1) => Effect.Effect<void>
}

type ApplicationExitOwnership = Parameters<typeof makeApplicationExitShell>[0]

/**
 * Installs the Linux supervisor adapter in the current outer application scope.
 * Every SIGTERM submits the same transport-neutral boundary request; the
 * boundary owns first-request cutoff and repeated-request coalescing.
 */
export const installLinuxSupervisorExitSignalAdapter = Effect.fn("LinuxSupervisorExitSignalAdapter.install")(function* (
  requestBoundary: ApplicationExitRequestBoundaryService,
  signals: LinuxSupervisorSignalBoundary
) {
  const runRequest = yield* FiberSet.makeRuntime<never, void, never>()
  const listener = () => {
    runRequest(requestBoundary.requestExit.pipe(Effect.asVoid))
  }
  yield* Effect.acquireRelease(signals.addSigtermListener(listener), () => signals.removeSigtermListener(listener))
})

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
  readonly addSigtermListener: (listener: () => void) => void
  readonly end: (status: 0 | 1) => never
  readonly removeSigtermListener: (listener: () => void) => void
  readonly report: (event: ApplicationExitTraceEvent) => void
}

const nodeApplicationProcess: NodeApplicationProcess = {
  addSigtermListener: (listener) => nodeProcess.on(linuxSupervisorExitSignal, listener),
  end: (status) => nodeProcess.exit(status),
  removeSigtermListener: (listener) => nodeProcess.off(linuxSupervisorExitSignal, listener),
  report: (event) => writeSync(nodeProcess.stderr.fd, `${JSON.stringify({ applicationExit: event })}\n`)
}

/** Constructs the real host adapter from the smallest exact Node process capability. */
export const makeNodeApplicationHostProcessBoundary = (
  applicationProcess: NodeApplicationProcess
): ApplicationHostProcessBoundary => ({
  addSigtermListener: (listener) =>
    Effect.sync(() => {
      applicationProcess.addSigtermListener(listener)
    }),
  removeSigtermListener: (listener) =>
    Effect.sync(() => {
      applicationProcess.removeSigtermListener(listener)
    }),
  reportLifecycleEvent: (event) => Effect.sync(() => applicationProcess.report(event)),
  requestProcessEnd: (status) =>
    Effect.sync(() => {
      applicationProcess.end(status)
    })
})

/** Real Node/Linux host boundary. Process exit is requested by Dalph, not delegated to the supervisor. */
export const nodeApplicationHostProcessBoundary = makeNodeApplicationHostProcessBoundary(nodeApplicationProcess)
