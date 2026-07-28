import { Buffer } from "node:buffer"
import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:net"
import { availableParallelism, totalmem } from "node:os"
import { performance } from "node:perf_hooks"

import {
  frontierModelBudgetMilliseconds,
  frontierModelWarningMilliseconds,
  quintGateSafetyTimeoutMilliseconds,
  taskSessionModelBudgetMilliseconds
} from "./quint-gate-policy.mjs"

const pnpmEntryPoint = process.env.npm_execpath

if (pnpmEntryPoint === undefined) {
  throw new Error("Run this model gate through pnpm")
}

const model = "specs/frontierRecovery.qnt"
const tests = "specs/frontierRecovery_test.qnt"
const counterexamples =
  "specs/frontierRecovery_counterexamples.qnt"
const gibibyte = 1024 ** 3
const maxConcurrentOutputBytes = 16 * 1024 * 1024
const maxExhaustiveCheckConcurrency = 3
const outerQuintSafetyTimeoutSeconds =
  quintGateSafetyTimeoutMilliseconds / 1000
const taskSessionPrefixBudgetSeconds =
  taskSessionModelBudgetMilliseconds / 1000
const frontierGateWarningSeconds =
  frontierModelWarningMilliseconds / 1000
const frontierGateRegressionBudgetSeconds =
  frontierModelBudgetMilliseconds / 1000
const detectedExhaustiveCheckConcurrency =
  availableParallelism() >= 6 && totalmem() >= 32 * gibibyte
    ? 3
    : availableParallelism() >= 4 && totalmem() >= 16 * gibibyte
      ? 2
      : 1
const requestedConcurrencyInput =
  process.env.DALPH_QUINT_VERIFY_CONCURRENCY ??
  String(detectedExhaustiveCheckConcurrency)

if (!/^[1-9]\d*$/u.test(requestedConcurrencyInput)) {
  throw new Error(
    `DALPH_QUINT_VERIFY_CONCURRENCY must be an integer from 1 to ${maxExhaustiveCheckConcurrency}`
  )
}

const requestedExhaustiveCheckConcurrency = Number(requestedConcurrencyInput)
if (requestedExhaustiveCheckConcurrency > maxExhaustiveCheckConcurrency) {
  throw new Error(
    `DALPH_QUINT_VERIFY_CONCURRENCY must be an integer from 1 to ${maxExhaustiveCheckConcurrency}`
  )
}
const exhaustiveCheckConcurrency = Math.min(
  requestedExhaustiveCheckConcurrency,
  detectedExhaustiveCheckConcurrency
)
const gateStartedAt = performance.now()
const phaseDurations = new Map()
const invariants = [
  "boundedCapacity",
  "taskWorkCapacityRequirementIsProjected",
  "capacityUsageCountsTasksNotOperationCorrelations",
  "correlationConflictRetainsOneTaskPosition",
  "rejectedCapacityHistoryDerivesNoFrontier",
  "everyEffectHasIntent",
  "noDuplicateAuthorityEffect",
  "everyRequestUsesItsIntentIdentity",
  "noStaleAuthorityUse",
  "everyTaskIsActionableOrExplained",
  "branchLocalConstraintDoesNotStopC",
  "finalityIsSubjectSpecific",
  "oneOwnerPerExactTransition",
  "oneExactTransitionPerActivationOwner",
  "everyOwnerNamesAnAdmittedTransition",
  "ownedTransitionIsNotReadmitted",
  "duplicateOwnershipLeaksNoReservedPosition",
  "duplicateOwnershipDoesNotStopIndependentResponsibility",
  "postIntentOwnerUsesStableOperationIdentity",
  "postIntentSelectionAliasIsCorrelationOnly",
  "postIntentExitRetainsPositionUntilFreshEvidence",
  "everyAmbiguityCrossingEffectHasIntent",
  "newReservedPositionsRespectConfiguredCapacity",
  "lowerRestartCapacityDoesNotPreemptObservedUsage",
  "releaseAffectsOnlyItsExactOperation",
  "exactActivationIssueDoesNotStopIndependentResponsibility",
  "everyResponsibilityIsActionableOrExactlyExplained",
  "preIntentInterruptionLeaksNoReservedPosition"
]

const run = (name, args) => {
  process.stdout.write(`\n== ${name} ==\n`)
  const startedAt = performance.now()
  const result = spawnSync(process.execPath, [pnpmEntryPoint, ...args], {
    stdio: "inherit"
  })
  const elapsedSeconds = (performance.now() - startedAt) / 1000
  process.stdout.write(`completed in ${elapsedSeconds.toFixed(2)}s\n`)
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit ${result.status}`)
  }
  return elapsedSeconds
}

const findAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("Could not allocate a local Quint compiler port"))
        return
      }
      server.close((error) => {
        if (error === undefined) resolve(address.port)
        else reject(error)
      })
    })
  })

const makeBoundedOutput = () => {
  const chunks = []
  let bufferedBytes = 0
  let omittedBytes = 0

  return {
    append: (chunk) => {
      chunks.push(chunk)
      bufferedBytes += chunk.length
      while (bufferedBytes > maxConcurrentOutputBytes) {
        const first = chunks[0]
        const excess = bufferedBytes - maxConcurrentOutputBytes
        if (first.length <= excess) {
          chunks.shift()
          bufferedBytes -= first.length
          omittedBytes += first.length
        } else {
          chunks[0] = first.subarray(excess)
          bufferedBytes -= excess
          omittedBytes += excess
        }
      }
    },
    text: () => Buffer.concat(chunks).toString("utf8"),
    write: () => {
      if (omittedBytes > 0) {
        process.stdout.write(
          `[${omittedBytes} earlier output bytes omitted; diagnostic tail follows]\n`
        )
      }
      for (const chunk of chunks) process.stdout.write(chunk)
    }
  }
}

class ConcurrentCommandError extends Error {
  constructor(message, endpointFailure) {
    super(message)
    this.endpointFailure = endpointFailure
  }
}

const isCompilerEndpointFailure = (output) =>
  /address already in use|bindexception|eaddrinuse|econnrefused|failed to connect|could not connect|connection refused|status:\s*14 unavailable/iu.test(
    output
  )

const runConcurrent = (name, args) =>
  new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const child = spawn(process.execPath, [pnpmEntryPoint, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    })
    const output = makeBoundedOutput()
    child.stdout.on("data", output.append)
    child.stderr.on("data", output.append)
    child.once("error", reject)
    child.once("close", (status, signal) => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000
      process.stdout.write(`\n== ${name} ==\n`)
      output.write()
      process.stdout.write(`completed in ${elapsedSeconds.toFixed(2)}s\n`)
      if (status === 0) resolve()
      else {
        reject(
          new ConcurrentCommandError(
            `${name} failed with ${signal === null ? `exit ${status}` : `signal ${signal}`}`,
            signal === null && isCompilerEndpointFailure(output.text())
          )
        )
      }
    })
  })

const runExhaustiveProfile = async ([name, main, init, step]) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const port = await findAvailablePort()
    try {
      await runConcurrent(`exhaustive ${name}`, [
        "quint",
        "verify",
        model,
        "--main",
        main,
        "--backend",
        "tlc",
        "--server-endpoint",
        `127.0.0.1:${port}`,
        "--init",
        init,
        "--step",
        step,
        "--invariant",
        invariantExpression,
        "--verbosity",
        "3"
      ])
      return
    } catch (error) {
      if (
        attempt === 2 ||
        !(error instanceof ConcurrentCommandError) ||
        !error.endpointFailure
      ) {
        throw error
      }
      process.stdout.write(
        `\n${name} could not bind or connect to its compiler endpoint; retrying once with a newly allocated port.\n`
      )
    }
  }
}

const runConcurrentBatch = async (profiles) => {
  const results = await Promise.allSettled(profiles.map(runExhaustiveProfile))
  const failure = results.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
}

const recordPhase = (name, startedAt) => {
  const elapsedSeconds = (performance.now() - startedAt) / 1000
  phaseDurations.set(name, elapsedSeconds)
  return elapsedSeconds
}

const expectInvariantFailure = (
  name,
  step,
  invariant,
  main = "frontierRecoveryCounterexamples",
  init
) => {
  process.stdout.write(`\n== ${name} (expected invariant failure) ==\n`)
  const startedAt = performance.now()
  const result = spawnSync(
    process.execPath,
    [
      pnpmEntryPoint,
      "quint",
      "run",
      counterexamples,
      "--main",
      main,
      ...(init === undefined ? [] : ["--init", init]),
      "--step",
      step,
      "--invariants",
      invariant,
      "--max-steps",
      "2",
      "--max-samples",
      "1000",
      "--verbosity",
      "1"
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  )
  const elapsedSeconds = (performance.now() - startedAt) / 1000
  if (result.error !== undefined) throw result.error
  const output = `${result.stdout}${result.stderr}`
  if (result.status === 0 || !output.includes("[violation] Found an issue")) {
    process.stdout.write(output)
    throw new Error(`${name} did not produce the expected counterexample`)
  }
  process.stdout.write(
    `confirmed in ${elapsedSeconds.toFixed(2)}s: ${invariant} rejects ${step}\n`
  )
}

let phaseStartedAt = performance.now()
for (const input of [model, tests, counterexamples]) {
  run(`typecheck ${input}`, ["quint", "typecheck", input])
}

run("deterministic acceptance scenarios", [
  "quint",
  "test",
  tests,
  "--main",
  "frontierRecoveryTest"
])
run("deterministic capacity-one acceptance scenario", [
  "quint",
  "test",
  tests,
  "--main",
  "frontierRecoveryCapacityOneTest"
])
recordPhase("typechecks and deterministic tests", phaseStartedAt)

const sampledProfiles = [
  {
    init: "init",
    name: "forward workflow witnesses",
    step: "progressStep",
    steps: "80",
    witnesses: [
      "firstIntentReached",
      "requestReached",
      "worktreeBoundaryReached",
      "invocationRunningReached",
      "invocationAcceptedReached",
      "promotionReached",
      "trackerCompletionReached",
      "taskSettlementReached"
    ]
  },
  {
    init: "initAnyBoundaryProfile",
    name: "crash and retry witnesses",
    step: "crashProfileStep",
    steps: "10",
    witnesses: ["crashRestartReached", "retryReached"]
  },
  {
    init: "initRunningInvocationProfile",
    name: "pause and independent progress witnesses",
    step: "pauseProfileStep",
    steps: "10",
    witnesses: ["pauseReached", "unaffectedBranchProgressReached"]
  },
  {
    init: "initReconciliationProfile",
    name: "isolation and branch progress witnesses",
    step: "reconciliationProfileStep",
    steps: "10",
    witnesses: ["isolationReached", "branchProgressDuringIsolationReached"]
  },
  {
    init: "init",
    name: "tracker proven-absence read witness",
    step: "taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage",
    steps: "1",
    witnesses: ["taskTrackerProvenAbsenceReadReached"]
  },
  {
    init: "init",
    name: "tracker incomparable-membership read witness",
    step: "taskTrackerReturnsTargetClosureReadWithPredecessor",
    steps: "1",
    witnesses: ["taskTrackerIncomparableMembershipReadReached"]
  },
  {
    init: "init",
    name: "tracker compatible-replacement read witness",
    step: "taskTrackerReturnsTargetClosureReadAtNextRevision",
    steps: "1",
    witnesses: ["taskTrackerCompatibleReplacementReadReached"]
  },
  {
    init: "init",
    name: "activation ownership and interruption witnesses",
    step: "activationProfileStep",
    steps: "12",
    witnesses: [
      "activationOwnershipBeforeIntentReached",
      "activationOwnershipAfterIntentReached",
      "activationPostIntentInterruptionReached",
      "activationResultReleaseReached",
      "activationFreshNonConsumptionReached"
    ]
  },
  {
    init: "initChangedCapacityActivationProfile",
    name: "changed restart capacity witness",
    step: "reconstructActivation",
    steps: "1",
    witnesses: ["activationChangedCapacityReconstructionReached"]
  }
]

phaseStartedAt = performance.now()
for (const profile of sampledProfiles) {
  run(profile.name, [
    "quint",
    "run",
    model,
    "--main",
    "frontierRecoveryCapacityTwo",
    "--init",
    profile.init,
    "--step",
    profile.step,
    "--invariants",
    ...invariants,
    "--witnesses",
    ...profile.witnesses,
    "--max-steps",
    profile.steps,
    "--max-samples",
    "10000",
    "--verbosity",
    "1"
  ])
}
recordPhase("sampled profiles", phaseStartedAt)

const exhaustiveProfiles = [
  [
    "capacity one with two independently eligible tasks",
    "frontierRecoveryCapacityOne",
    "init",
    "orchestratorCommitsNextFreshTaskClaimIntent"
  ],
  [
    "capacity one prioritizes existing responsibility over a smaller fresh task",
    "frontierRecoveryCapacityOne",
    "initCapacityOneResponsibilityFirstProfile",
    "orchestratorCommitsNextFreshTaskClaimIntent"
  ],
  [
    "all boundaries",
    "frontierRecoveryCapacityTwo",
    "initAnyBoundaryProfile",
    "boundaryProfileStep"
  ],
  [
    "crash and restart at all boundaries",
    "frontierRecoveryCapacityTwo",
    "initAnyBoundaryProfile",
    "crashProfileStep"
  ],
  [
    "pause and resume",
    "frontierRecoveryCapacityTwo",
    "initRunningInvocationProfile",
    "pauseProfileStep"
  ],
  [
    "external reconciliation",
    "frontierRecoveryCapacityTwo",
    "initReconciliationProfile",
    "reconciliationProfileStep"
  ],
  [
    "activation ownership and result release",
    "frontierRecoveryCapacityTwo",
    "init",
    "activationOwnershipProfileStep"
  ],
  [
    "activation interruption and fresh capacity evidence",
    "frontierRecoveryCapacityTwo",
    "init",
    "activationInterruptionProfileStep"
  ],
  [
    "independent coordinator-worker lifetimes and reconstruction",
    "frontierRecoveryCapacityTwo",
    "init",
    "activationCrashReconstructionProfileStep"
  ],
  [
    "task-local provider correlation conflict and reconstruction",
    "frontierRecoveryCapacityTwo",
    "initCorrelationConflictActivationProfile",
    "capacityCorrelationProfileStep"
  ]
]
const invariantExpression = invariants.join(" and ")

// These sliced proofs are independent, so bounded concurrency reduces their
// aggregate wall time while retaining each profile's separate diagnostics.
process.stdout.write(
  `\nRunning exhaustive profiles with concurrency ${exhaustiveCheckConcurrency} ` +
    `(detected cap ${detectedExhaustiveCheckConcurrency}).\n`
)
phaseStartedAt = performance.now()
for (
  let offset = 0;
  offset < exhaustiveProfiles.length;
  offset += exhaustiveCheckConcurrency
) {
  await runConcurrentBatch(
    exhaustiveProfiles.slice(offset, offset + exhaustiveCheckConcurrency)
  )
}
recordPhase("exhaustive profiles", phaseStartedAt)

phaseStartedAt = performance.now()
expectInvariantFailure(
  "missing intent counterexample",
  "missingIntentStep",
  "everyEffectHasIntent"
)
expectInvariantFailure(
  "duplicate effect counterexample",
  "duplicateEffectStep",
  "noDuplicateAuthorityEffect"
)
expectInvariantFailure(
  "stale knowledge counterexample",
  "staleKnowledgeStep",
  "noStaleAuthorityUse",
  "frontierRecoveryCounterexamples",
  "initStaleKnowledgeCounterexample"
)
expectInvariantFailure(
  "configured capacity counterexample",
  "weakenedCapacityStep",
  "boundedCapacity",
  "frontierRecoveryCapacityCounterexample"
)
expectInvariantFailure(
  "operation-name capacity counterexample",
  "projectCapacityFromOperationName",
  "taskWorkCapacityRequirementIsProjected"
)
expectInvariantFailure(
  "duplicate exact activation owner counterexample",
  "duplicateOwnershipStep",
  "oneOwnerPerExactTransition"
)
expectInvariantFailure(
  "owned-transition readmission counterexample",
  "ownedReadmissionStep",
  "ownedTransitionIsNotReadmitted"
)
expectInvariantFailure(
  "duplicate registration reservation leak counterexample",
  "duplicateReservationLeakStep",
  "duplicateOwnershipLeaksNoReservedPosition"
)
expectInvariantFailure(
  "duplicate registration stops independent C counterexample",
  "duplicateStopsIndependentCStep",
  "duplicateOwnershipDoesNotStopIndependentResponsibility"
)
expectInvariantFailure(
  "pre-intent interruption reservation leak counterexample",
  "preIntentInterruptionLeakStep",
  "preIntentInterruptionLeaksNoReservedPosition"
)
expectInvariantFailure(
  "post-intent exit early release counterexample",
  "earlyPostIntentReleaseStep",
  "postIntentExitRetainsPositionUntilFreshEvidence"
)
expectInvariantFailure(
  "delayed A-17 release removes A-18 counterexample",
  "delayedReleaseA17RemovesA18",
  "releaseAffectsOnlyItsExactOperation"
)
expectInvariantFailure(
  "lowered-capacity new reservation counterexample",
  "reserveWhileObservedUsageIsAtLowerLimit",
  "newReservedPositionsRespectConfiguredCapacity"
)
expectInvariantFailure(
  "controller-carried stale ordering counterexample",
  "admitPausedTransitionFromStaleOrder",
  "currentFactsExcludePausedTransitions"
)
recordPhase("expected counterexamples", phaseStartedAt)

const gateElapsedSeconds = (performance.now() - gateStartedAt) / 1000
process.stdout.write("\n== Frontier recovery phase summary ==\n")
for (const [name, elapsedSeconds] of phaseDurations) {
  process.stdout.write(`${name}: ${elapsedSeconds.toFixed(2)}s\n`)
}
process.stdout.write(
  `frontier recovery total: ${gateElapsedSeconds.toFixed(2)}s ` +
    `(warning ${frontierGateWarningSeconds}s, regression budget ${frontierGateRegressionBudgetSeconds}s; ` +
    `${taskSessionPrefixBudgetSeconds}s prefix budget before the ${outerQuintSafetyTimeoutSeconds}s outer timeout)\n`
)

if (gateElapsedSeconds > frontierGateRegressionBudgetSeconds) {
  throw new Error(
    `Frontier recovery model gate exceeded its ${frontierGateRegressionBudgetSeconds}-second regression budget`
  )
}
if (gateElapsedSeconds > frontierGateWarningSeconds) {
  process.stderr.write(
    `Warning: frontier recovery model gate exceeded ${frontierGateWarningSeconds} seconds; investigate before the ${outerQuintSafetyTimeoutSeconds}-second outer safety timeout becomes the first signal.\n`
  )
}

process.stdout.write("\nCanonical frontier recovery model checks passed.\n")
