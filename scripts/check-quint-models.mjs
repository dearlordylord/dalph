import { createRequire } from "node:module"
import { performance } from "node:perf_hooks"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { createQuintEffectiveProfile, assertQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import {
  assertQuintHostedDeadlineContract,
  createQuintGateDeadline,
  quintGateProcessGroupAbsenceTimeoutMilliseconds,
  quintGateTerminationGraceMilliseconds
} from "./quint-gate-policy.mjs"
import { assertQuintGateCommandContract } from "./quint-gate-command-contract.mjs"
import { readQuintEvaluatorProvenance, renderQuintEvaluatorProvenance } from "./quint-evaluator-provenance.mjs"
import {
  assertCleanTemporalVerdict,
  assertTlcArtifactPrepared,
  assertViolatedTemporalVerdict
} from "./quint-temporal-gate.mjs"
import {
  quintGateBatchResults,
  quintGateCommandAdmissionPriority,
  runQuintGateFamily
} from "./quint-gate-concurrency.mjs"
import { assertCompleteQuintHostedPartition, createQuintHostedShard } from "./quint-hosted-shards.mjs"
import { createQuintGateTiming, runWithQuintGateTiming } from "./quint-gate-timing.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { validateQuintCommandOutput } from "./quint-witness-coverage.mjs"

const quintEntryPoint = createRequire(import.meta.url).resolve("@informalsystems/quint/dist/src/cli.js")

/**
 * Execute the complete pre-materialized plan. Local callers provide the sanitized
 * environment, invocation-owned endpoint and the deadline already spent on server
 * readiness; hosted callers retain the independently executing raw checker.
 * Captured output is required verdict evidence, separate from optional log files.
 */
export const runQuintEffectiveProfile = async ({
  purpose = "hosted",
  profile = createQuintEffectiveProfile({ purpose }),
  environment,
  serverEndpoint,
  evaluatorPath,
  remainingExecutionMilliseconds,
  signal,
  progress,
  write = (report) => process.stdout.write(report),
  compact = false,
  runCommand = runBoundedCommand,
  readProvenance = readQuintEvaluatorProvenance,
  assertArtifactPrepared = assertTlcArtifactPrepared,
  hostedShard
} = {}) => {
  assertQuintEffectiveProfile(profile, { purpose })
  // Execute a fresh frozen canonical copy, so caller mutation after validation
  // cannot change the admitted plan while a preceding command is awaited.
  profile = createQuintEffectiveProfile({ purpose })
  if (hostedShard !== undefined && purpose !== "hosted") {
    throw new Error("Hosted Quint shards cannot select the guarded local profile")
  }
  const shard =
    hostedShard === undefined
      ? undefined
      : (assertCompleteQuintHostedPartition(profile), createQuintHostedShard(profile, hostedShard))
  const executionSteps = shard?.steps ?? profile.steps
  if (serverEndpoint !== undefined && environment === undefined) {
    throw new Error("An owned Quint endpoint requires an explicit sanitized environment")
  }
  if (serverEndpoint !== undefined && evaluatorPath === undefined) {
    throw new Error("An owned Quint endpoint requires the identified prepared evaluator path")
  }
  const startedAt = performance.now()
  const localDeadline = createQuintGateDeadline({
    startedAt,
    allowanceMilliseconds: profile.policy.safetyTimeoutMilliseconds
  })
  const timeoutFor = (name) => {
    const localRemaining = localDeadline(name)
    const sharedRemaining =
      remainingExecutionMilliseconds === undefined ? localRemaining : remainingExecutionMilliseconds(name)
    if (!Number.isFinite(sharedRemaining) || sharedRemaining <= 0) {
      throw Object.assign(new Error(`${name} exceeded the Quint gate execution deadline before launch`), {
        quintCommandResult: "timed-out"
      })
    }
    return Math.min(localRemaining, sharedRemaining)
  }
  const timing = createQuintGateTiming()
  const commands = new Array(profile.commands.length)
  let provenance
  const buildReport = () => ({
    version: 1,
    entryPoint: quintEntryPoint,
    profile,
    ...(shard === undefined ? {} : { shard }),
    serverEndpoint: serverEndpoint ?? null,
    commands: commands.filter((command) => command !== undefined),
    timing: { records: timing.records(), aggregates: timing.aggregates() },
    provenance,
    elapsedMilliseconds: performance.now() - startedAt
  })
  const renderedPositions = new Set()
  const renderedOutputs = new Set()
  const renderFamily = (reserved, outcomes, { failure = false } = {}) => {
    if (compact && !failure) return
    for (const [index, command] of reserved.entries()) {
      const outcome = outcomes?.[index]
      if (outcome === undefined) continue
      renderedPositions.add(command.position)
      write(`\n== ${command.name} ==\n`)
      const output = outcome.status === "fulfilled" ? outcome.value?.output : outcome.reason?.output
      if (typeof output === "string" && output.length > 0) {
        renderedOutputs.add(output)
        write(output)
      }
    }
  }
  const executeCommand = (command, familySignal) =>
    timing.measure({
      kind: command.kind,
      name: command.name,
      order: command.position,
      run: async () => {
        const args =
          serverEndpoint !== undefined && command.kind === "verify"
            ? [...command.args, "--server-endpoint", serverEndpoint]
            : [...command.args]
        let lifecycle
        let result
        const runOptions = {
          ...command.options,
          args: [quintEntryPoint, ...args],
          environment,
          executable: process.execPath,
          name: command.name,
          captureOutput: true,
          forwardOutput: false,
          relayParentSignals: true,
          signal: signal === undefined ? familySignal : AbortSignal.any([signal, familySignal]),
          processGroupAbsenceTimeoutMilliseconds: quintGateProcessGroupAbsenceTimeoutMilliseconds,
          terminationGraceMilliseconds: quintGateTerminationGraceMilliseconds,
          timeoutMilliseconds: timeoutFor(command.name)
        }
        try {
          if (progress !== undefined) {
            runOptions.progress = {
              emit: typeof progress === "function" ? progress : progress.emit,
              identity: { position: command.position, kind: command.kind, name: command.name },
              terminal: false,
              onLifecycle: (value) => {
                lifecycle = value
              }
            }
          }
          result = await runCommand(runOptions)
          const evidence = {
            position: command.position,
            name: command.name,
            kind: command.kind,
            executable: process.execPath,
            args,
            obligationId: result.gateObligationId,
            exitCode: result.exitCode,
            output: result.output,
            verdict: command.verdict
          }
          commands[command.position] = evidence
          if (!command.verdict.acceptedExitCodes.includes(result.exitCode)) {
            throw new Error(`${command.name} returned unsupported exit ${result.exitCode}`)
          }
          validateQuintCommandOutput({ args: command.args, name: command.name, output: result.output })
          const property = command.args[command.args.indexOf("--temporal") + 1]
          if (command.verdict.temporal === "clean") assertCleanTemporalVerdict(result, property)
          if (command.verdict.temporal === "violation") assertViolatedTemporalVerdict(result, property)
          if (command.verdict.artifactPreparedAfter) await assertArtifactPrepared(environment?.QUINT_HOME)
        } catch (error) {
          if (error instanceof Error && typeof result?.output === "string")
            Object.assign(error, { output: result.output })
          lifecycle?.terminal({
            outcome: error?.quintCommandResult ?? (result === undefined ? "failed" : "invalid"),
            exitCode: result?.exitCode ?? error?.exitCode ?? null,
            signal: error?.signal ?? null
          })
          throw error
        }
        lifecycle?.terminal({ outcome: `exit:${result.exitCode}`, exitCode: result.exitCode })
        return result
      }
    })
  try {
    await runWithQuintGateTiming({
      timing,
      run: async () => {
        for (const step of executionSteps) {
          if (step.kind === "evaluator-provenance") {
            // Local preparation/identification happens before observation; supplying
            // the identified path avoids the binary manager's cold-download branch.
            provenance = await readProvenance(evaluatorPath)
            if (!compact) write(`${renderQuintEvaluatorProvenance(provenance)}\n`)
            continue
          }
          const reserved = step.positions.map((position) => profile.commands[position])
          try {
            const values = await runQuintGateFamily({
              commands: reserved,
              concurrency: step.concurrency,
              priority: purpose === "hosted" ? quintGateCommandAdmissionPriority : undefined,
              serializedPrefix: step.serializedPrefix,
              run: executeCommand
            })
            renderFamily(
              reserved,
              values.map((value) => ({ status: "fulfilled", value }))
            )
          } catch (error) {
            renderFamily(reserved, quintGateBatchResults(error), { failure: true })
            throw error
          }
        }
      },
      write: compact ? () => {} : write
    })
    const phases = timing.aggregates()
    const executed = {
      total: commands.filter((command) => command !== undefined).length,
      typecheck: phases.typecheck.count,
      test: phases.test.count,
      "sampled-run": phases["sampled-run"].count,
      verify: phases.verify.count
    }
    if (shard === undefined) {
      assertQuintGateCommandContract({ manifest: profile.commands, executed })
    } else {
      const selectedCommands = shard.positions.map((position) => profile.commands[position])
      const expected = Object.fromEntries(
        ["typecheck", "test", "sampled-run", "verify"].map((kind) => [
          kind,
          selectedCommands.filter((command) => command.kind === kind).length
        ])
      )
      if (
        executed.total !== selectedCommands.length ||
        Object.entries(expected).some(([kind, count]) => executed[kind] !== count)
      ) {
        throw new Error(`Hosted Quint shard ${shard.shard} command contract mismatch`)
      }
    }
    const report = buildReport()
    const resultName = shard === undefined ? "Complete Quint model gate" : `Hosted Quint shard ${shard.shard} evidence`
    write(
      `\n${resultName}: ${(report.elapsedMilliseconds / 1000).toFixed(2)}s (budget ${profile.policy.regressionBudgetMilliseconds / 1000}s)\n`
    )
    if (report.elapsedMilliseconds > profile.policy.regressionBudgetMilliseconds) {
      throw new Error("Quint models exceeded their regression budget")
    }
    return report
  } catch (error) {
    if (compact) {
      for (const record of commands) {
        if (record?.output && !renderedPositions.has(record.position)) {
          renderedOutputs.add(record.output)
          write(`\n== ${record.name} ==\n${record.output}`)
        }
      }
      if (typeof error?.output === "string" && !renderedOutputs.has(error.output)) write(error.output)
    }
    if (error instanceof Error) Object.assign(error, { formalProfileReport: buildReport() })
    throw error
  }
}

// Importing this module constructs no child process and executes no checker.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.env.npm_execpath === undefined) throw new Error("Run this model gate through pnpm")
  assertQuintHostedDeadlineContract(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"))
  await runQuintEffectiveProfile()
}
