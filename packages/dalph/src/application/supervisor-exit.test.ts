import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Ref, Scope } from "effect"
import { expect } from "vitest"
import {
  ApplicationExitResult,
  type ApplicationExitRequestBoundaryService,
  CoordinatorOwnership
} from "@dalph/orchestrator"
import {
  type ApplicationHostProcessBoundary,
  type LinuxSupervisorSignalBoundary,
  installLinuxSupervisorExitSignalAdapter,
  makeApplicationHostLifecyclePorts,
  makeLinuxSupervisorApplicationExitHost,
  makeNodeApplicationHostProcessBoundary
} from "./supervisor-exit.js"

const controlledSignalBoundary = Effect.fn("SupervisorExit.Test.controlledSignalBoundary")(function* () {
  let listener: (() => void) | undefined
  const removals = yield* Ref.make(0)
  const boundary: LinuxSupervisorSignalBoundary = {
    addSigtermListener: (candidate) =>
      Effect.sync(() => {
        listener = candidate
      }),
    removeSigtermListener: (candidate) =>
      Effect.sync(() => {
        if (listener === candidate) listener = undefined
      }).pipe(Effect.andThen(Ref.update(removals, (count) => count + 1)))
  }
  return { boundary, listener: () => listener, removals }
})

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
    signals.listener()?.()
    signals.listener()?.()
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
    expect(signals.listener()).toBeTypeOf("function")

    yield* Scope.close(scope, Exit.void)

    expect(signals.listener()).toBeUndefined()
    expect(yield* Ref.get(signals.removals)).toBe(1)
  })
)

it.effect("reports the lifecycle result before requesting the exact process status", () =>
  Effect.gen(function* () {
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const processBoundary: ApplicationHostProcessBoundary = {
      addSigtermListener: () => Effect.void,
      removeSigtermListener: () => Effect.void,
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
    expect(signals.listener()).toBeTypeOf("function")

    yield* Scope.close(scope, Exit.void)

    expect(signals.listener()).toBeUndefined()
    expect(yield* Ref.get(signals.removals)).toBe(1)
  })
)

it.effect("adapts the exact Node process signal, diagnostic, and status capabilities", () =>
  Effect.gen(function* () {
    const chronology: Array<string> = []
    let installed: (() => void) | undefined
    const host = makeNodeApplicationHostProcessBoundary({
      addSigtermListener: (listener) => {
        chronology.push("installed")
        installed = listener
      },
      end: (status) => {
        chronology.push(`ended:${status}`)
        throw new Error("controlled process end")
      },
      removeSigtermListener: (listener) => {
        chronology.push(`removed:${listener === installed}`)
      },
      report: (event) => chronology.push(`reported:${event._tag}`)
    })
    const listener = () => undefined

    yield* host.addSigtermListener(listener)
    yield* host.reportLifecycleEvent({ _tag: "ExitRequested" })
    yield* host.removeSigtermListener(listener)
    const processEnd = yield* Effect.exit(host.requestProcessEnd(1))

    expect(processEnd).toMatchObject({ _tag: "Failure" })
    expect(chronology).toEqual(["installed", "reported:ExitRequested", "removed:true", "ended:1"])
  })
)
