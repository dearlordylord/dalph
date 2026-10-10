/* eslint-disable import/no-nodejs-modules -- This native control owns only its exact test child and coordinator lock. */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import {
  CoordinatorLock,
  GitCommonDirectoryTarget,
  makeProductionHostApplicationExitShell,
  nodeCoordinatorLockLayer,
  publicApplicationExitResult
} from "@dalph/orchestrator"
import { Deferred, Effect, Layer, Schema } from "effect"
import {
  installApplicationExitSignalAdapter,
  nodeApplicationExitSignalBoundary
} from "../src/application/supervisor-exit.js"
import { ProductionHostExitUnsuccessful } from "../src/application/production-cli-startup.js"
import { runDalphNodeMain } from "../src/application/node-main.js"

const write = (value: unknown) => Effect.sync(() => nodeProcess.stdout.write(`${JSON.stringify(value)}\n`))
const application = Effect.scoped(
  Effect.gen(function* () {
    const directory = yield* Schema.decodeUnknownEffect(GitCommonDirectoryTarget)(nodeProcess.argv[2])
    const lock = yield* CoordinatorLock
    yield* lock.acquire(directory)
    const shell = yield* makeProductionHostApplicationExitShell({
      emit: (event) =>
        event._tag === "ExitRequested" ? write({ stage: "requested" }).pipe(Effect.asVoid) : Effect.void
    })
    const release = yield* Deferred.make<void>()
    yield* Effect.callback<void>((resume) => {
      const listener = (message: unknown) => {
        if (message === "release") resume(Effect.void)
      }
      nodeProcess.on("message", listener)
      // The process-local receipt is a test control, never a workflow or custody fact.
      return Effect.sync(() => nodeProcess.off("message", listener))
    }).pipe(Effect.andThen(Deferred.succeed(release, undefined)), Effect.forkScoped)
    const child = yield* Effect.sync(() =>
      spawn(nodeProcess.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true })
    )
    const pid = child.pid
    if (pid === undefined) return yield* Effect.die("native owner child failed to start")
    const startIdentity = yield* Effect.sync(
      () => readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[19]
    )
    const stopChild = yield* Effect.cached(
      Effect.callback<void>((resume) => {
        child.once("exit", () => resume(Effect.void))
        child.kill("SIGTERM")
      }).pipe(Effect.andThen(write({ stage: "descendant-stopped", pid })), Effect.asVoid)
    )
    const close = Deferred.await(release).pipe(Effect.andThen(stopChild))
    yield* Effect.addFinalizer(() => close)
    yield* shell.registerProcessLocalDrain({
      owner: { name: "CodexProvider", subject: { _tag: "NoRun" } },
      closeProcessLocalResources: close
    })
    const adapter = yield* installApplicationExitSignalAdapter(
      shell.requestBoundary,
      nodeApplicationExitSignalBoundary,
      ["SIGTERM"]
    )
    yield* write({
      stage: "ready",
      pid: nodeProcess.pid,
      descendantPid: pid,
      startIdentity,
      owners: yield* shell.readOwners
    })
    const result = yield* adapter.awaitResult
    yield* write({ stage: "result", result: publicApplicationExitResult(result), owners: yield* shell.readOwners })
    if (result._tag !== "Succeeded") return yield* new ProductionHostExitUnsuccessful({ disposition: result._tag })
    // The host scope retains the exact lock and child until close has accepted its stop proof.
  })
).pipe(Effect.provide(nodeCoordinatorLockLayer.pipe(Layer.provide(NodeServices.layer))))

runDalphNodeMain(
  application.pipe(
    Effect.ensuring(
      write({ stage: "scope-finalized" }).pipe(Effect.andThen(Effect.sync(() => nodeProcess.disconnect?.())))
    )
  )
)
