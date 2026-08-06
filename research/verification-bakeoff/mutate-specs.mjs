/**
 * Mutation analysis of the gated Quint models under specs/.
 *
 *   node mutate-specs.mjs [--spec <name>] [--samples 20000] [--steps 20] [--seed 31337]
 *
 * For each spec it perturbs the *model* -- actions, init, and the derivations
 * they use -- one token at a time, discards mutants that no longer typecheck,
 * and records which gated invariant kills each survivor.
 *
 * Invariant and witness declarations are never mutated. Mutating the invariant
 * would measure whether the invariant detects changes to itself, which is not
 * the question. The question is whether each gated invariant constrains the
 * model at all.
 *
 * An invariant that kills nothing is not necessarily wrong. It may be
 * definitional, subsumed by another invariant, or guarding a case this
 * operator set cannot express. It is, however, contributing nothing to the
 * gate, and that is worth knowing per invariant rather than in aggregate.
 */
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

// Run quint through pnpm when invoked from a pnpm context, so the mutation
// runs use the gate's pinned quint. Fall back to PATH with a warning, since
// this script also documents Homebrew-based usage.
const pnpmEntryPoint = process.env.npm_execpath
const quintExecutable = pnpmEntryPoint === undefined ? "quint" : process.execPath
const quintPrefix = pnpmEntryPoint === undefined ? [] : [pnpmEntryPoint, "quint"]
if (pnpmEntryPoint === undefined) {
  console.warn("warning: npm_execpath unset, using `quint` from PATH, which may not be the gate's pinned version")
}

const SPECS = [
  {
    name: "plannedAttemptExecutor",
    file: "specs/plannedAttemptExecutor.qnt",
    invariants: [
      "everyStatusUsesExactPlannedAttempt",
      "positionHeldUntilSuspensionResult",
      "safeSuspensionReleasesPosition",
      "suspensionRequestRetainsPosition",
      "terminalReleasesPosition"
    ],
    witnesses: [
      "responsibilityBeganReached",
      "runningReached",
      "suspensionRequestedReached",
      "safelySuspendedReached",
      "terminalReached"
    ]
  },
  {
    name: "controlDirectionApplication",
    file: "specs/controlDirectionApplication.qnt",
    invariants: [
      "appliedDirectionIsOperatorInitiated",
      "applicationClaimsNoLaterEffects",
      "typeOk"
    ],
    witnesses: []
  },
  {
    name: "taskFactReconciliation",
    file: "specs/taskFactReconciliation.qnt",
    invariants: [
      "positionHeldUntilSafeSuspension",
      "changedFactsPreserveWip",
      "specificationOffersEveryExactChoice",
      "externalSuccessPreventsDuplicateDelivery",
      "externalSuccessReleasesOnlyAfterSafeSuspension",
      "externalSuccessSettlesAfterExactClaimRelease",
      "replacementClaimRequiresDirectionAndIntent",
      "replacementClaimIdentityIsFresh",
      "foreignClaimIsNeverChanged",
      "unreadableClaimCannotAuthorizeReplacement",
      "claimConstraintPreservesIndependentEligibility"
    ],
    witnesses: []
  },
  {
    name: "gitReconciliation",
    file: "specs/gitReconciliation.qnt",
    invariants: [
      "compatibleTargetAdvanceDoesNotConstrainAttempt",
      "incompatibleRewriteConstrainsOnlyAffectedAttempt",
      "gitConstraintPreservesIndependentEligibility",
      "lostWorktreeNeverAuthorizesRepair",
      "registrationConflictNeverAuthorizesRepair",
      "positionHeldUntilSafeSuspension",
      "rejectedResultPreservesWorktree",
      "staleTargetNeverOverwrites",
      "ambiguousTargetNeverPromotes",
      "promotionRequiresExactExpectedHead",
      "unverifiedCandidateNeverPromotes"
    ],
    witnesses: []
  },
  {
    name: "acceptedResultIntegration",
    file: "specs/acceptedResultIntegration.qnt",
    invariants: [
      "cancellationExactlyQueued",
      "queuePositionsAreUnique",
      "targetHeldExactlyActiveIntegration",
      "atMostOneTargetHolder",
      "startedPrecedesRemainingQueue",
      "dependencyWaitPreservesQueueOrder",
      "candidateReadyHasExactOrderedParents",
      "sessionIdentityFixedAfterStart"
    ],
    witnesses: [
      "acceptedReached",
      "queuedReached",
      "startedReached",
      "dependencyWaitReached",
      "restartReached",
      "dependencyWaitReleasedTarget",
      "candidateReadyReached",
      "correctionRequiredReached",
      "correctionLimitReached",
      "continuationLimitReached"
    ]
  }
]

const DECL = /^\s*(?:pure\s+)?(?:val|def|action|var|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/

/**
 * A declaration is protected if it is a gated invariant, a gated witness, or
 * any other observation-only value. Observation values are recognised by the
 * repository's own naming convention: they end in `Reached` or `Observed`.
 * Mutating them measures nothing, since nothing in the model reads them.
 */
const isObservation = (name) => /(?:Reached|Observed)$/.test(name)

/** Line ranges belonging to invariant or witness declarations, which stay untouched. */
const protectedLines = (lines, protectedNames) => {
  const starts = []
  lines.forEach((line, index) => {
    const match = DECL.exec(line)
    if (match) starts.push({ index, name: match[1] })
  })
  // Fail loudly if a protected name matched nothing: a renamed invariant must
  // not silently lose its protection.
  const found = new Set(starts.map(({ name }) => name))
  const missing = [...protectedNames].filter((name) => !found.has(name))
  if (missing.length > 0) {
    throw new Error(`protected declarations not found in the spec: ${missing.join(", ")}`)
  }
  const blocked = new Set()
  starts.forEach(({ index, name }, position) => {
    if (!protectedNames.has(name) && !isObservation(name)) return
    const end = position + 1 < starts.length ? starts[position + 1].index : lines.length
    for (let line = index; line < end; line += 1) blocked.add(line)
  })
  return blocked
}

/** One-token perturbations of the model. Each returns the mutated line or null. */
const OPERATORS = [
  { name: "== to !=", apply: (l) => (l.includes("==") ? l.replace("==", "!=") : null) },
  { name: "!= to ==", apply: (l) => (/!=/.test(l) ? l.replace("!=", "==") : null) },
  { name: "< to <=", apply: (l) => (/(?<![<>=!])<(?!=)/.test(l) ? l.replace(/(?<![<>=!])<(?!=)/, "<=") : null) },
  { name: "<= to <", apply: (l) => (l.includes("<=") ? l.replace("<=", "<") : null) },
  { name: ">= to >", apply: (l) => (l.includes(">=") ? l.replace(">=", ">") : null) },
  { name: "and to or", apply: (l) => (/\band\b/.test(l) ? l.replace(/\band\b/, "or") : null) },
  { name: "or to and", apply: (l) => (/\bor\b/.test(l) ? l.replace(/\bor\b/, "and") : null) },
  { name: "true to false", apply: (l) => (/\btrue\b/.test(l) ? l.replace(/\btrue\b/, "false") : null) },
  { name: "false to true", apply: (l) => (/\bfalse\b/.test(l) ? l.replace(/\bfalse\b/, "true") : null) },
  { name: "drop not", apply: (l) => (/\bnot\(/.test(l) ? l.replace(/\bnot\(/, "(") : null) },
  {
    name: "integer + 1",
    apply: (l) => {
      const match = /(?<![A-Za-z0-9_.])(\d+)(?![A-Za-z0-9_])/.exec(l)
      return match ? l.slice(0, match.index) + (Number(match[1]) + 1) + l.slice(match.index + match[1].length) : null
    }
  }
]

const generate = (lines, blocked) => {
  const mutants = []
  lines.forEach((line, index) => {
    if (blocked.has(index)) return
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return
    for (const operator of OPERATORS) {
      const mutated = operator.apply(line)
      if (mutated === null || mutated === line) continue
      mutants.push({ index, operator: operator.name, original: line.trim(), mutated: mutated.trim(), lines: lines.with(index, mutated) })
    }
  })
  return mutants
}

const quint = async (args, timeoutMilliseconds) => {
  try {
    const { stdout, stderr } = await run(quintExecutable, [...quintPrefix, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      ...(timeoutMilliseconds === undefined ? {} : { timeout: timeoutMilliseconds, killSignal: "SIGKILL" })
    })
    return { ok: true, output: stdout + stderr }
  } catch (error) {
    // A timeout is not a verdict. Apalache refutes cheaply and clears slowly,
    // so an exhausted budget must never be recorded as a kill.
    if (error.killed === true || error.signal === "SIGKILL") return { ok: false, timedOut: true, output: "" }
    return { ok: false, output: String(error.stdout ?? "") + String(error.stderr ?? "") }
  }
}

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const samples = arg("samples", "20000")
const steps = arg("steps", "20")
const only = arg("spec", null)
// Pinned per-invocation seed, so a kill or a survival reproduces exactly.
const seed = arg("seed", "31337")

/**
 * `--verify` swaps random sampling for Apalache. Sampling is flaky at depth,
 * so a sampled survivor may be a missed kill; verify is exact within its step
 * bound. It is also far slower and can fail to terminate, hence the mandatory
 * per-invocation budget.
 *
 * Run verify mode one process at a time. Quint drives a shared Apalache gRPC
 * server, and a second concurrent client makes it drop the connection, which
 * surfaces as an unhandled `code: 14, Connection dropped` rather than as a
 * verdict.
 */
const useVerify = process.argv.includes("--verify")
const verifySteps = arg("verify-steps", "10")
const budgetMilliseconds = Number(arg("timeout", "90")) * 1000

const workDir = await mkdtemp(join(tmpdir(), "quint-mutation-"))

try {
for (const spec of SPECS) {
  if (only && spec.name !== only) continue

  const source = await readFile(spec.file, "utf8")
  const lines = source.split("\n")
  const blocked = protectedLines(lines, new Set([...spec.invariants, ...spec.witnesses]))
  const mutants = generate(lines, blocked)

  const kills = Object.fromEntries(spec.invariants.map((name) => [name, 0]))
  const witnessKills = {}
  const survivors = []
  let compiled = 0
  let killedByWitness = 0
  let timedOut = 0
  let errored = 0

  for (const [ordinal, mutant] of mutants.entries()) {
    const file = join(workDir, `${spec.name}-${ordinal}.qnt`)
    await writeFile(file, mutant.lines.join("\n"))

    if (!(await quint(["typecheck", file])).ok) continue
    compiled += 1

    const all = useVerify
      ? await quint(
          ["verify", file, "--invariants", ...spec.invariants, "--max-steps", verifySteps, "--verbosity", "0"],
          budgetMilliseconds
        )
      : await quint([
          "run", file, "--invariants", ...spec.invariants,
          "--max-samples", samples, "--max-steps", steps, "--seed", seed, "--verbosity", "0"
        ])
    if (all.timedOut === true) {
      timedOut += 1
      continue
    }
    if (all.ok) {
      // The gate also asserts reachability. A mutant that leaves every
      // invariant true but makes a witnessed state unreachable is still caught
      // by the gate, and attributing that to "survived" would flatter the
      // invariants at the witnesses' expense.
      if (spec.witnesses.length > 0) {
        const witnessed = await quint([
          "run", file, "--witnesses", ...spec.witnesses,
          "--max-samples", samples, "--max-steps", steps, "--seed", seed, "--verbosity", "1"
        ])
        // Fail closed: a witness run that errors, times out, or whose output
        // does not parse is an error, never an "unreached" and never a
        // "survived".
        if (witnessed.timedOut === true) {
          timedOut += 1
          continue
        }
        const counts = spec.witnesses.map((witness) =>
          new RegExp(`${witness} was witnessed in (\\d+) trace`).exec(witnessed.output))
        if (!witnessed.ok || counts.some((found) => found === null)) {
          errored += 1
          continue
        }
        const unreached = spec.witnesses.filter((_, position) => Number(counts[position][1]) === 0)
        if (unreached.length > 0) {
          for (const witness of unreached) witnessKills[witness] = (witnessKills[witness] ?? 0) + 1
          killedByWitness += 1
          continue
        }
      }
      survivors.push(mutant)
      continue
    }

    // Attribute the kill to the specific invariants that fire.
    for (const invariant of spec.invariants) {
      const single = useVerify
        ? await quint(
            ["verify", file, "--invariant", invariant, "--max-steps", verifySteps, "--verbosity", "0"],
            budgetMilliseconds
          )
        : await quint([
            "run", file, "--invariant", invariant,
            "--max-samples", samples, "--max-steps", steps, "--seed", seed, "--verbosity", "0"
          ])
      if (!single.ok && single.timedOut !== true) kills[invariant] += 1
    }
  }

  const dead = spec.invariants.filter((name) => kills[name] === 0)

  const killed = compiled - survivors.length - timedOut - errored
  console.log(`\n## ${basename(spec.file)}${useVerify ? " (Apalache)" : ""} (seed ${seed})`)
  console.log(`\n${mutants.length} mutants generated, ${compiled} typecheck, ` +
              `${killed} killed (${killed - killedByWitness} by an invariant, ` +
              `${killedByWitness} by a witness only), ${survivors.length} survive` +
              `${timedOut > 0 ? `, ${timedOut} exceeded the ${budgetMilliseconds / 1000}s budget` : ""}` +
              `${errored > 0 ? `, ${errored} errored (fail-closed, no verdict recorded)` : ""}.\n`)
  console.log("| Invariant | mutants killed |")
  console.log("|---|---|")
  for (const invariant of spec.invariants) {
    const count = kills[invariant]
    console.log(`| ${invariant} | ${count === 0 ? "**0**" : count} |`)
  }
  const witnessRows = Object.entries(witnessKills).sort((left, right) => right[1] - left[1])
  if (witnessRows.length > 0) {
    console.log("\n| Witness | mutants it alone caught |")
    console.log("|---|---|")
    for (const [witness, count] of witnessRows) console.log(`| ${witness} | ${count} |`)
  }
  if (dead.length > 0) {
    console.log(`\nKilling nothing: ${dead.map((name) => `\`${name}\``).join(", ")}`)
  }
  if (survivors.length > 0) {
    console.log(`\nSurviving mutants (first 12):\n`)
    for (const survivor of survivors.slice(0, 12)) {
      console.log(`- line ${survivor.index + 1}, ${survivor.operator}: \`${survivor.original}\``)
    }
  }
}
} finally {
  await rm(workDir, { recursive: true, force: true })
}
