/* eslint-disable import/no-nodejs-modules -- The opt-in check observes one real Linux Codex process. */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import nodeOs from "node:os"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { ProductionLiveLocalResourceLocator } from "../../src/qualification/live-fixture-cleanup.js"
import { ProductionLiveCodexHome } from "../../src/qualification/live-qualification-controller.js"
import {
  codexAppServerObservationWrapper,
  ProductionLiveLaunchPreflight,
  productionLiveLaunchPreflightLayer
} from "../../src/qualification/live-qualification-runtime.js"

describe("#417 protected live Codex launcher", () => {
  it.skipIf(nodeProcess.platform !== "linux")(
    "closes the exact generated wrapper and keeps its process out of the task count",
    async () => {
      const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), "dalph-live-launch-preflight-"))
      const privateDirectory = nodePath.join(root, "private")
      const codexHome = nodePath.join(root, "codex-home")
      const stateDirectory = nodePath.join(privateDirectory, "probe-state")
      const wrapper = nodePath.join(privateDirectory, "codex-app-server-observer")
      const taskObservationPath = nodePath.join(privateDirectory, "app-server-processes")
      const probeObservationPath = nodePath.join(privateDirectory, "preflight-app-server-processes")
      const launchObservationPath = nodePath.join(privateDirectory, "preflight-launch-observation.json")
      const codexEntry = nodePath.join(nodeProcess.cwd(), "node_modules/@openai/codex/bin/codex.js")
      let responsesRequests = 0
      const responsesServer = createServer((_request, response) => {
        responsesRequests += 1
        response.writeHead(500).end()
      })
      let qualified = false
      try {
        await new Promise<void>((resolve) => responsesServer.listen(0, "127.0.0.1", resolve))
        const address = responsesServer.address()
        if (address === null || typeof address === "string") throw new Error("missing controlled Responses port")
        await Promise.all([privateDirectory, codexHome].map((path) => mkdir(path, { mode: 0o700 })))
        await mkdir(stateDirectory, { mode: 0o700 })
        await Promise.all([taskObservationPath, probeObservationPath].map((path) => writeFile(path, "")))
        await writeFile(
          nodePath.join(codexHome, "config.toml"),
          [
            'model = "gpt-5.1-codex-mini"',
            'model_provider = "dalph-live-qualification"',
            'approval_policy = "never"',
            'sandbox_mode = "danger-full-access"',
            "[model_providers.dalph-live-qualification]",
            'name = "Dalph protected live qualification"',
            `base_url = "http://127.0.0.1:${address.port}/v1"`,
            'env_key = "DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL"',
            'wire_api = "responses"',
            "request_max_retries = 0",
            "stream_max_retries = 0"
          ].join("\n")
        )
        await writeFile(
          wrapper,
          codexAppServerObservationWrapper(codexEntry, nodeProcess.execPath, taskObservationPath, probeObservationPath)
        )
        await chmod(wrapper, 0o700)
        await Effect.runPromise(
          Effect.gen(function* () {
            const preflight = yield* ProductionLiveLaunchPreflight
            yield* preflight.run({
              configuration: { codexExecutable: wrapper },
              codexHome: ProductionLiveCodexHome.make(codexHome),
              launchPreflight: {
                processObservationPath: ProductionLiveLocalResourceLocator.make(probeObservationPath),
                launchObservationPath: ProductionLiveLocalResourceLocator.make(launchObservationPath),
                stateDirectory: ProductionLiveLocalResourceLocator.make(stateDirectory)
              }
            })
          }).pipe(Effect.provide(productionLiveLaunchPreflightLayer))
        )
        const probe = (await readFile(probeObservationPath, "utf8")).trim()
        const pid = Number(probe.split(":").at(-1))
        const observation = JSON.parse(await readFile(launchObservationPath, "utf8")) as Record<string, unknown>
        expect(await readFile(taskObservationPath, "utf8")).toBe("")
        expect(probe).toMatch(new RegExp(`^linux:[1-9][0-9]*:pid:${pid}$`, "u"))
        expect(observation).toMatchObject({
          configuredExecutable: wrapper,
          pid,
          matchesConfiguredExecutable: true,
          launchOwnership: "ExactLive"
        })
        expect(responsesRequests).toBe(0)
        expect(() => nodeProcess.kill(pid, 0)).toThrow()
        qualified = true
      } finally {
        await new Promise<void>((resolve, reject) =>
          responsesServer.close((error) => (error === undefined ? resolve() : reject(error)))
        )
        if (qualified) await rm(root, { recursive: true, force: true })
      }
    },
    30_000
  )

  it.skipIf(nodeProcess.platform !== "linux")(
    "interrupts a slow wrapper before admitting task work and retains its launch state",
    async () => {
      const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), "dalph-live-launch-interrupted-"))
      const privateDirectory = nodePath.join(root, "private")
      const codexHome = nodePath.join(root, "codex-home")
      const stateDirectory = nodePath.join(privateDirectory, "probe-state")
      const wrapper = nodePath.join(privateDirectory, "codex-app-server-observer")
      const taskObservationPath = nodePath.join(privateDirectory, "app-server-processes")
      const probeObservationPath = nodePath.join(privateDirectory, "preflight-app-server-processes")
      const launchObservationPath = nodePath.join(privateDirectory, "preflight-launch-observation.json")
      const codexEntry = nodePath.join(nodeProcess.cwd(), "node_modules/@openai/codex/bin/codex.js")
      let proved = false
      try {
        await Promise.all([privateDirectory, codexHome].map((path) => mkdir(path, { mode: 0o700 })))
        await mkdir(stateDirectory, { mode: 0o700 })
        await Promise.all([taskObservationPath, probeObservationPath].map((path) => writeFile(path, "")))
        const source = codexAppServerObservationWrapper(
          codexEntry,
          nodeProcess.execPath,
          taskObservationPath,
          probeObservationPath
        )
        await writeFile(wrapper, source.replace('exec -a "$0"', 'sleep 20\nexec -a "$0"'))
        await chmod(wrapper, 0o700)
        const completed = await Effect.runPromiseExit(
          Effect.gen(function* () {
            const preflight = yield* ProductionLiveLaunchPreflight
            yield* preflight.run({
              configuration: { codexExecutable: wrapper },
              codexHome: ProductionLiveCodexHome.make(codexHome),
              launchPreflight: {
                processObservationPath: ProductionLiveLocalResourceLocator.make(probeObservationPath),
                launchObservationPath: ProductionLiveLocalResourceLocator.make(launchObservationPath),
                stateDirectory: ProductionLiveLocalResourceLocator.make(stateDirectory)
              }
            })
          }).pipe(Effect.provide(productionLiveLaunchPreflightLayer))
        )
        expect(Exit.isFailure(completed)).toBe(true)
        expect(await readFile(taskObservationPath, "utf8")).toBe("")
        const probe = (await readFile(probeObservationPath, "utf8")).trim()
        expect(probe).toMatch(/^linux:[1-9][0-9]*:pid:[1-9][0-9]*$/u)
        const pid = Number(probe.split(":").at(-1))
        expect(() => nodeProcess.kill(pid, 0)).toThrow()
        const launchState = await readFile(nodePath.join(stateDirectory, "executor-private-state.json"), "utf8")
        expect(launchState).toContain('\\"phase\\":\\"Launching\\"')
        proved = true
      } finally {
        if (proved) await rm(root, { recursive: true, force: true })
      }
    },
    25_000
  )

  it.skipIf(nodeProcess.platform !== "linux")(
    "rejects a wrapper whose effective executable changes before task work",
    async () => {
      const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), "dalph-live-launch-mismatch-"))
      const privateDirectory = nodePath.join(root, "private")
      const codexHome = nodePath.join(root, "codex-home")
      const stateDirectory = nodePath.join(privateDirectory, "probe-state")
      const wrapper = nodePath.join(privateDirectory, "codex-app-server-observer")
      const taskObservationPath = nodePath.join(privateDirectory, "app-server-processes")
      const probeObservationPath = nodePath.join(privateDirectory, "preflight-app-server-processes")
      const launchObservationPath = nodePath.join(privateDirectory, "preflight-launch-observation.json")
      const codexEntry = nodePath.join(nodeProcess.cwd(), "node_modules/@openai/codex/bin/codex.js")
      await Promise.all([privateDirectory, codexHome].map((path) => mkdir(path, { mode: 0o700 })))
      await mkdir(stateDirectory, { mode: 0o700 })
      await Promise.all([taskObservationPath, probeObservationPath].map((path) => writeFile(path, "")))
      const source = codexAppServerObservationWrapper(
        codexEntry,
        nodeProcess.execPath,
        taskObservationPath,
        probeObservationPath
      )
      await writeFile(wrapper, source.replace('exec -a "$0"', 'exec -a "/wrong-codex-wrapper"'))
      await chmod(wrapper, 0o700)
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const preflight = yield* ProductionLiveLaunchPreflight
          yield* preflight.run({
            configuration: { codexExecutable: wrapper },
            codexHome: ProductionLiveCodexHome.make(codexHome),
            launchPreflight: {
              processObservationPath: ProductionLiveLocalResourceLocator.make(probeObservationPath),
              launchObservationPath: ProductionLiveLocalResourceLocator.make(launchObservationPath),
              stateDirectory: ProductionLiveLocalResourceLocator.make(stateDirectory)
            }
          })
        }).pipe(Effect.provide(productionLiveLaunchPreflightLayer))
      )
      expect(Exit.isFailure(result)).toBe(true)
      expect(await readFile(taskObservationPath, "utf8")).toBe("")
      expect((await readFile(probeObservationPath, "utf8")).trim()).toMatch(/^linux:[1-9][0-9]*:pid:[1-9][0-9]*$/u)
      const observation = JSON.parse(await readFile(launchObservationPath, "utf8")) as Record<string, unknown>
      expect(observation).toMatchObject({ matchesConfiguredExecutable: false, launchOwnership: "Contradictory" })
      const launchState = await readFile(nodePath.join(stateDirectory, "executor-private-state.json"), "utf8")
      expect(launchState).toContain('\\"phase\\":\\"Launching\\"')
      expect(launchState).toContain('\\"phase\\":\\"Live\\"')
      // An unproved identity keeps the private launch state and fixture for
      // reconciliation; the disposable Linux container owns final teardown.
    },
    30_000
  )
})
