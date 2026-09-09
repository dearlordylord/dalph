import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Ref, Scope } from "effect"
import { expect } from "vitest"
import {
  ApplicationExitResult,
  type ApplicationExitRequestBoundaryService,
  CoordinatorOwnership
} from "@dalph/orchestrator"
import {
  type ApplicationExitSignal,
  type ApplicationHostProcessBoundary,
  type ApplicationExitSignalBoundary,
  installApplicationExitSignalAdapter,
  installLinuxSupervisorExitSignalAdapter,
  makeApplicationHostLifecyclePorts,
  makeLinuxSupervisorApplicationExitHost,
  makeNodeApplicationHostProcessBoundary,
  nodeApplicationHostProcessBoundary
} from "./supervisor-exit.js"

const controlledSignalBoundary = Effect.fn("SupervisorExit.Test.controlledSignalBoundary")(function* () {
  const listeners = new Map<ApplicationExitSignal, () => void>()
  const removals = yield* Ref.make(0)
  const boundary: ApplicationExitSignalBoundary = {
    addSignalListener: (signal, candidate) =>
      Effect.sync(() => {
        listeners.set(signal, candidate)
      }),
    removeSignalListener: (signal, candidate) =>
      Effect.sync(() => {
        if (listeners.get(signal) === candidate) listeners.delete(signal)
      }).pipe(Effect.andThen(Ref.update(removals, (count) => count + 1)))
  }
  return { boundary, listener: (signal: ApplicationExitSignal) => listeners.get(signal), removals }
})

it.effect("SIGINT and SIGTERM enter the same scoped application Exit request boundary", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const signals = yield* controlledSignalBoundary()
    const requestCount = yield* Ref.make(0)
    const mayFinish = yield* Deferred.make<void>()
    const result = ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })
    const requestBoundary: ApplicationExitRequestBoundaryService = {
      requestExit: Ref.update(requestCount, (count) => count + 1).pipe(
        Effect.andThen(Deferred.await(mayFinish)),
        Effect.as(result)
      )
    }

    const joinedResult = yield* installApplicationExitSignalAdapter(requestBoundary, signals.boundary, [
      "SIGINT",
      "SIGTERM"
    ]).pipe(Scope.provide(scope))
    expect(signals.listener("SIGINT")).toBeTypeOf("function")
    expect(signals.listener("SIGTERM")).toBeTypeOf("function")

    signals.listener("SIGINT")?.()
    signals.listener("SIGTERM")?.()
    yield* Effect.yieldNow
    expect(yield* Ref.get(requestCount)).toBe(2)

    yield* Deferred.succeed(mayFinish, undefined)
    expect(yield* joinedResult.awaitResult).toEqual(result)
    yield* Scope.close(scope, Exit.void)

    expect(signals.listener("SIGINT")).toBeUndefined()
    expect(signals.listener("SIGTERM")).toBeUndefined()
    expect(yield* Ref.get(signals.removals)).toBe(2)
  })
)

it.effect("routes every Linux supervisor signal into the shared typed Exit boundary", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const signals = yield* controlledSignalBoundary()
    const requestCount = yield* Ref.make(0)
    const mayFinish = yield* Deferred.make<void>()
    const requestBoundary: ApplicationExitRequestBoundaryService = {
      requestExit: Ref.update(requestCount, (count) => count + 1).pipe(
        Effect.andThen(Deferred.await(mayFinish)),
        Effect.as(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
      )
    }

    yield* installLinuxSupervisorExitSignalAdapter(requestBoundary, signals.boundary).pipe(Scope.provide(scope))
    signals.listener("SIGTERM")?.()
    signals.listener("SIGTERM")?.()
    yield* Effect.yieldNow

    expect(yield* Ref.get(requestCount)).toBe(2)
    yield* Deferred.succeed(mayFinish, undefined)
    yield* Scope.close(scope, Exit.void)
  })
)

it.effect("removes the Linux supervisor signal adapter when the host scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const signals = yield* controlledSignalBoundary()
    const requestBoundary: ApplicationExitRequestBoundaryService = {
      requestExit: Effect.succeed(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
    }

    yield* installLinuxSupervisorExitSignalAdapter(requestBoundary, signals.boundary).pipe(Scope.provide(scope))
    expect(signals.listener("SIGTERM")).toBeTypeOf("function")
    expect(signals.listener("SIGINT")).toBeUndefined()

    yield* Scope.close(scope, Exit.void)

    expect(signals.listener("SIGTERM")).toBeUndefined()
    expect(yield* Ref.get(signals.removals)).toBe(1)
  })
)

it.effect("reports the lifecycle result before requesting the exact process status", () =>
  Effect.gen(function* () {
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const processBoundary: ApplicationHostProcessBoundary = {
      addSignalListener: () => Effect.void,
      removeSignalListener: () => Effect.void,
      reportLifecycleEvent: (event) => Ref.update(chronology, (current) => [...current, `reported:${event._tag}`]),
      requestProcessEnd: (status) => Ref.update(chronology, (current) => [...current, `ended:${status}`])
    }
    const ports = makeApplicationHostLifecyclePorts(processBoundary)
    const result = ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })

    yield* ports.trace.emit({ _tag: "ExitResultReported", result })
    yield* ports.processLifecycle.requestEnd({ _tag: "RequestForcedTermination", status: 1 })

    expect(yield* Ref.get(chronology)).toEqual(["reported:ExitResultReported", "ended:1"])
  })
)

it.effect("composes the application Exit shell with the scoped Linux host boundary", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const signals = yield* controlledSignalBoundary()
    const host: ApplicationHostProcessBoundary = {
      ...signals.boundary,
      reportLifecycleEvent: () => Effect.void,
      requestProcessEnd: () => Effect.void
    }

    const shell = yield* makeLinuxSupervisorApplicationExitHost(
      CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
      host
    ).pipe(Scope.provide(scope))

    expect(shell.requestBoundary.requestExit).toBeDefined()
    expect(signals.listener("SIGTERM")).toBeTypeOf("function")
    expect(signals.listener("SIGINT")).toBeUndefined()

    yield* Scope.close(scope, Exit.void)

    expect(signals.listener("SIGTERM")).toBeUndefined()
    expect(yield* Ref.get(signals.removals)).toBe(1)
  })
)

it.effect("adapts the exact Node process signal, diagnostic, and status capabilities", () =>
  Effect.gen(function* () {
    const chronology: Array<string> = []
    let installed: (() => void) | undefined
    const host = makeNodeApplicationHostProcessBoundary({
      addSignalListener: (signal, listener) => {
        chronology.push(`installed:${signal}`)
        installed = listener
      },
      end: (status) => {
        chronology.push(`ended:${status}`)
        throw new Error("controlled process end")
      },
      removeSignalListener: (signal, listener) => {
        chronology.push(`removed:${signal}:${listener === installed}`)
      },
      report: (event) => chronology.push(`reported:${event._tag}`)
    })
    const listener = () => undefined

    yield* host.addSignalListener("SIGINT", listener)
    yield* host.reportLifecycleEvent({ _tag: "ExitRequested" })
    yield* host.removeSignalListener("SIGINT", listener)
    const processEnd = yield* Effect.exit(host.requestProcessEnd(1))

    expect(processEnd).toMatchObject({ _tag: "Failure" })
    expect(chronology).toEqual(["installed:SIGINT", "reported:ExitRequested", "removed:SIGINT:true", "ended:1"])
  })
)

it.effect("installs, removes, and reports through the real Node host without ending the process", () =>
  Effect.gen(function* () {
    const listener = () => undefined
    yield* nodeApplicationHostProcessBoundary.addSignalListener("SIGTERM", listener)
    yield* nodeApplicationHostProcessBoundary.removeSignalListener("SIGTERM", listener)
    yield* nodeApplicationHostProcessBoundary.reportLifecycleEvent({ _tag: "AdmissionCutoffClosed" })
  })
)
