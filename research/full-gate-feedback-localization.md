# Localizing full-gate delay and silent execution

The maintainer needs the local qualification command to identify failures promptly, explain ongoing work, and spend time only on justified checks. This investigation recommends exposing existing evidence first, then profiling the slow simulations and application suites, and making explicit decisions about which obligations remain blocking.

Research date: 2026-09-19 America/Montreal (2026-09-20 UTC). Source inspection: `master` at `97d6138e0075ccee4c9f08377977cf57ca4da039`, with pre-existing uncommitted changes. Those changes were preserved. This report changes documentation only: no Dalph runtime, gate policy, model, test selection, dependency, or tracker state changed. No full gate, checker, benchmark, or live-provider fixture was launched.

## Research order and evidence limits

1. Investigated primary sources independently of repository research/history. A background researcher also worked without reading Dalph files. The initial hypotheses were reporting delay, serial scheduling, repeated setup, solver/model cost, resource contention, and redundant obligations.
2. Only after that phase completed, inspected current scripts, previous research in Git, completed local run receipts, and current GitHub issue states. The repository evidence materially changed the priority: expensive random simulation is a stronger first target than SMT tuning.
3. Proposed the bounded experiments below. Historical observations are not benchmarks of today's dirty worktree. No current p50/p95, causal speedup, failure-frequency distribution, or measured maximum silent interval is claimed.

## Independent findings

Measure three outcomes separately: **time to an actionable failure**, **time to final qualification**, and **longest interval without useful status**. Also measure elapsed repair time from first failure to a focused diagnosis. These are proposed objectives, not existing measurements.

| Primary-source finding | Implication for the investigation |
| --- | --- |
| Build traces can show concurrent actions, CPU use, garbage collection, and the critical path. [Bazel trace documentation](https://bazel.build/advanced/performance/json-trace-profile) | Reconstruct a timeline before adding workers. A trace format is useful; adopting Bazel is not required. |
| Linux PSI exposes time stalled on CPU, memory, and I/O, including cgroup scope. [Kernel documentation](https://docs.kernel.org/accounting/psi.html) | Record pressure alongside CPU and peak memory when comparing concurrency. CPU utilization alone does not establish productive work. |
| Apalache's incremental SMT profiler attributes generated cells/constants/expressions to source locations; it is not an exact solver-time profiler. [Apalache profiling](https://apalache-mc.org/docs/apalache/profiling.html) | Use translation profiles only where Apalache is actually expensive. Its tuning settings trade query count against memory. [Tuning](https://apalache-mc.org/docs/apalache/tuning.html) |
| Simulation, bounded model checking, induction, and finite explicit-state exploration establish different guarantees. [Apalache execution](https://apalache-mc.org/docs/apalache/running.html), [Quint model checkers](https://quint.sh/docs/model-checkers) | Fewer samples, smaller domains, shallower bounds, or a backend change require a stated change in evidence. A fast simulation is not replacement proof. |
| Vitest exposes transform/setup/import/test/environment timings and CPU/heap profiles; coverage debugging exposes conversion/report work. [Vitest profiling](https://main.vitest.dev/guide/profiling-test-performance) | Separate test/import execution from coverage processing. Overlapping worker totals must not be added to wall time. Check diagnostics against pinned Vitest 4.1.10. |
| Published Google studies distinguish selection from prioritization, and show that simple historical-transition strategies do not universally perform as expected. [2014 study](https://research.google/pubs/techniques-for-improving-regression-testing-in-continuous-integration-development-environments/), [2019 study](https://research.google/pubs/assessing-transition-based-test-selection-algorithms-at-google/) | Evaluate ordering against this repository's failures before deleting tests or promising earlier failures from a heuristic. |

The independent research also considered TypeScript diagnostics and SMT data representation. Those remain conditional tools, not the leading suspects after inspecting Dalph. Upstream documentation can describe features newer than the pinned toolchain; no dependency upgrade is implied.

## What Dalph already does

The local order is preflight census → complete formal acquisition or not-applicable disposition → delivery repeatability → Reducer Lab → recorded catalog → tests/coverage → final evidence validation. Preflight collects ordinary failures before stopping expensive qualification. The application stages remain serial, and formal acquisition precedes all of them. [Runner](../scripts/gate-quality-run.mjs), [stage manifest](../scripts/quality-gate-stage-policy.mjs), [preflight](../scripts/preflight-census.mjs)

The current formal profile contains **105 commands: 15 typechecks, 46 tests, 23 sampled runs, and 21 verifies**, across 42 scheduling/provenance steps. Of the verify commands, **20 use TLC; one uses Apalache for artifact preparation**. Families admit at most two children, with serialized preparation where required. Sampled runs use four threads, and changing that count changes seeded trace partitioning. Hosted execution additionally partitions the complete profile into two shards per selected runtime and prioritizes expensive commands within families. Local execution does not apply that hosted priority. [Profile](../scripts/quint-effective-profile.mjs), [command contract](../scripts/quint-gate-command-contract.mjs), [concurrency](../scripts/quint-gate-concurrency.mjs), [shards](../scripts/quint-hosted-shards.mjs)

These optimizations already exist:

- Guarded full-gate prefix resume (`754d62813`) and complete formal success reuse in normal handoff (`3fead985f`), subsequently narrowed and extended across equivalent worktrees.
- Fail-closed local/hosted formal relevance classification (`78c315133`, `61c2527a7`) and hosted sharding (`a09948741`).
- Removal of duplicate formal replay from coverage (`94f587fc7`), the separate covered catalog pass (`f6c9f7a1f`), and a redundant composed test (`7ea130fc7`).
- Effect diagnostics folded into ordinary typecheck (`df8c11637`); recent cassette history/diagnostic optimizations (`c92a99f14`, `986d5b832`).
- Automatic MBT is temporarily excluded (`8fdcad06c`) pending [#363](https://github.com/dearlordylord/dalph/issues/363). This is an existing conformance gap to account for when discussing further removal.

The [#307 postmortem](../docs/postmortems/issue-307-qualification-churn.md) already identified serial discovery, unnecessary fresh verification, excessive fixture repair, and failure to distinguish infrastructure problems from product defects. It explicitly declines to attribute all subsequent speedup to suite deletion.

## Why formal execution can be silent

The silence has concrete causes in the current wrapper stack:

1. Individual formal children use `captureOutput: true` and `forwardOutput: false`. Noncompact output is rendered after a family completes, not as each child progresses. [check-quint-models.mjs](../scripts/check-quint-models.mjs)
2. The local profile uses `compact: true`, suppressing successful family output and the end-of-run timing rendering. Timings remain in the report. [run-formal-profile.mjs](../scripts/run-formal-profile.mjs)
3. The enclosing workflow captures that helper's output without forwarding it. It prints a running message and a completion message; failures replay captured output. Adding inner logging alone therefore does not fix the terminal boundary. [run-formal-workflow.mjs](../scripts/run-formal-workflow.mjs)
4. Timing records contain command duration and result; their public copies omit start/end timestamps. Aggregates sum overlapping child durations. Durable receipts retain timestamps and logs, but the standard output does not present a live critical path. [Timing](../scripts/quint-gate-timing.mjs), [bounded runner](../scripts/run-bounded-command.mjs)
5. Successful output exceeding **550 lines fails qualification**. Progress reporting must address that contract rather than accidentally consume its remaining allowance. [Output policy](../scripts/quality-output-budget.mjs)

This proves deliberate output withholding, not that every silent interval is caused only by buffering. A backend can also be quiet while working. Expose wrapper state immediately; then distinguish backend computation, blocked work, and delayed delivery with measurements.

## Existing measurements recovered

The historical [formal reuse qualification report](https://github.com/dearlordylord/dalph/blob/997e7aa398ba43eaa22d3e62b233b753cf2315ba/research/formal-reuse-qualification-362.md) already records a complete fresh run of **560.09s**, followed by ten unchanged-input reuses with **4.33s median / 4.85s maximum**, zero checker/server launches, and original evidence identity. It includes phase costs and S1–S14 acceptance mappings. Repeating that study from scratch is unnecessary unless a present regression or changed boundary warrants it. It is one historical candidate, not today's latency distribution.

I independently read completed run records in `.git/dalph-gates/runs/`. Stage durations below follow the top-level `quality-stages/<ordinal>.json` obligation IDs into receipts. Selecting receipts by command name alone is incorrect: coverage tests create synthetic nested gate receipts with the same names.

| Historical successful run | Fresh formal run `c4241daa…` | Formal reuse run `d0ba2713…` |
| --- | ---: | ---: |
| Candidate HEAD | `61c2527a7d40ab545b0032a813d6942378db3a10` | `6d4d95d2f9851ad895e295b31e56709ac5c3b460` |
| Completed UTC | 2026-09-14 15:40:39 | 2026-09-15 00:31:24 |
| Whole command, run start to terminal | 1,803.21s | 854.13s |
| Preflight child durations summed | 339.25s | 262.44s |
| Formal acquisition | 621.53s, including 611.45s helper execution | 6.96s reuse |
| Delivery repeatability | 130.17s | 98.34s |
| Reducer Lab | 136.40s | 107.64s |
| Recorded catalog | 84.24s | 57.40s |
| Tests and coverage | 455.71s | 300.14s |

These runs have different inputs and host conditions; their difference is **not a measured reuse speedup**. Both predate the separate Effect-pass removal. The relevant observation is that coverage and repeated application evaluation remain substantial even when formal reuse succeeds. Current timeout ceilings are safety policy, not measured durations.

Evidence roots:

- `.git/dalph-gates/runs/c4241daa-d26c-4815-b063-8589e847e4c7/{run.json,terminal.json,quality-stages,receipts,formal-metrics}`
- `.git/dalph-gates/runs/d0ba2713-8ec3-4b64-82aa-a46696b65bc5/{run.json,terminal.json,quality-stages,receipts,formal-metrics}`

The fresh profile report at `.git/dalph-gates/runs/c4241daa-d26c-4815-b063-8589e847e4c7/formal-executions/a4075c6b-cfdf-4f65-95d3-1a7b5c330758.json` records:

| Expensive command | Duration |
| --- | ---: |
| Executor sampled model | 172.59s |
| Fresh-task admission sampled model | 77.88s |
| Accepted-result integration sampled model | 47.39s |
| Fresh-task admission capacity exhaustive proof | 40.62s |
| Task-fact reconciliation sampled model | 40.46s |
| Run activation exhaustive model | 21.46s |
| Apalache artifact preparation | 17.03s |

The profile elapsed time is 609.52s. Summed child times are 413.26s sampled runs, 153.43s verifies, 158.79s tests, and 24.37s typechecks; they overlap and exceed elapsed time. Two other successful retained profiles (`fb3d2001…/40518745…` and `b0d4efb0…/afc3b628…`) also put the executor simulation first, at 139.69s and 185.46s. This is a repeatable historical ranking, not a controlled performance distribution.

The existing [V8 investigation](coverage-v8-performance.md) measured 288.17s coverage wall time on another candidate and proposed a same-selection coverage/no-coverage comparison. It did not establish that V8 causes most of the delay. Its historical description of the then-current worker count is not current configuration: today's `vitest.config.ts` selects four coverage workers. The current experiment must pin its own settings.

## Recommended next steps

The first deliverable should be a small diagnostic improvement and a ranked cost report, followed by one bounded performance experiment. Avoid another all-gate rewrite before locating costs.

| Order | Work and boundary | Evidence or acceptance required | Stop/decision rule |
| --- | --- | --- | --- |
| 1 | Extract a timeline from completed receipts and formal reports. Include queue, setup, checks, final validation, failed/unrun suffix, reuse reason, exact input/tool identity. | Join by obligation ID and parentage; exclude synthetic fixture gates; distinguish fresh/reused/not applicable. Show wall time separately from summed worker time. | Initial analysis: two hours, no new full gate. If retained logs lack timing, mark unknown and instrument only that boundary. |
| 2 | Stream structured command start/completion/failure events through both formal wrappers; show active command, elapsed time, last observed activity, deadline, and log path during quiet work. | Controlled runner tests: quiet long child, concurrent children completing out of order, failure/cancellation, parent loss, compact mode, and existing verdict preservation. Suggested presentation target: status within 15s while quiet, terminal failure surfaced within 2s of wrapper observation. A heartbeat must say when backend progress is unknown. | First implementation slice: half a day before reassessment. Keep full raw logs in existing artifacts. Reconsider the fatal 550-line policy as part of this slice. |
| 3 | Profile the executor simulation, then fresh-task admission simulation. Hold model/tool bytes, samples, depth, seed and four-thread policy fixed. Measure evaluator CPU, import/translation/setup and resource pressure. | Reproduce the ranking; capture actions/invariants or evaluator stacks responsible for cost. Run a paired comparison only for the identified hotspot. | Initial session: 45 minutes; each command gets its own explicit expected duration and UTC stop time before launch. Two non-advancing attempts require a different experiment. |
| 4 | Measure coverage enabled/disabled on identical test selection and workers; profile catalog/Lab/repeatability reuse of the same fixtures and assertions. Separate Oxlint, compatibility ESLint and formatter timing within lint. | Coverage delta, import/setup/test/report times, slowest files, CPU/RSS/pressure. Map each expensive repeated scenario to its distinct assertion. Compare equivalent selections; ordinary test mode has different exclusions. | One paired coverage session capped at 60 minutes, with per-command deadlines; no provider switch until overhead is measured. Reuse existing profiling evidence where applicable. |
| 5 | Replay scheduling alternatives from recorded durations, then validate one promising arrangement under bounded resources. Candidates: earlier application failure checks; local family priority; independent preflight checks after build. | Measure first actionable failure and makespan independently. Prove actual artifact dependencies, owned-server constraints, observer/receipt correctness, cancellation, and clone-wide resource limits. Use representative controlled failures, not only successful runs. | Compare concurrency 1 versus 2 at one boundary. Stop increasing workers if contention or memory rises without useful improvement. Simulated savings are an upper bound until measured. |
| 6 | Decide retain/optimize/reduce/move/remove for each expensive obligation. | Scenario/property → check → distinct bug class/negative control → measured cost → replacement or explicit accepted loss. | Make a decision for the top three costs after the first experiments. No indefinite optimization backlog and no deletion justified solely by green history. |

These are proposed session limits, not currently running operations. Before any future command exceeding one minute, record its expected duration and absolute wall-clock stop time, use the supported admission boundary, preserve stopped-process evidence, and follow [Development](../docs/DEVELOPMENT.md). Do not wrap `check:all` in an outer GNU timeout. This research did not change accepted gate order or authorize a manual skipped-stage qualification.

Formal backend diagnostics depend on what is slow. For TLC, retain states generated/distinct, queue size and action statistics; focused expression/action profiling adds overhead and does not profile liveness properties. [TLC results](https://tla.msr-inria.inria.fr/tlatoolbox/doc/model/results-page.html), [TLC profiling](https://tla.msr-inria.inria.fr/tlatoolbox/doc/model/profiling.html). For the single Apalache preparation command, separate JVM/readiness/translation costs before considering SMT tuning. For sampled runs, profile the Rust evaluator; TLC state-space statistics do not explain evaluator sampling cost.

## Which gates should be reconsidered?

| Candidate | Present recommendation | What would justify changing it |
| --- | --- | --- |
| Fatal success-output line budget | Replace with a presentation budget that retains logs and permits progress; assess as the first retirement candidate. | A correct run should not become incorrect because useful status was printed. Test bounded rendering and complete failure artifacts; preserve protection against unbounded output. |
| 10,000-sample canonical simulations | Highest-value candidate to optimize or reduce frequency/budget after profiling. | Measure marginal new failures/witnesses across sample budgets and seeds, including negative controls. Canonical models are richer than several proof projections, so exhaustive projection checks do not automatically subsume their samples. |
| Twenty fresh-process delivery repetitions | Audit the marginal value and frequency; consider a smaller blocking sample plus dedicated full repeatability qualification. | Identify bugs caught only after earlier repetitions and preserve process-isolation evidence. This changes the accepted twenty-run requirement and requires an explicit scenario/policy amendment; warm repetitions are not equivalent. |
| Lab/catalog/capstone overlap | Consolidate demonstrably repeated fixture work; retire duplicate assertions where the remaining boundary proves the requirement. | Distinguish browser/build, whole-catalog semantics, process isolation, and coverage obligations. A shared cassette alone is not proof of duplicate coverage. |
| Standalone formal typechecks | Low-priority removal experiment: later test/run/verify calls also perform front-end checking. | Prove every root remains checked, diagnostic behavior and failure ordering are acceptable, and no unique obligation disappears. Historical total was only ~24s, so this is smaller than simulation work. |
| Complexity/duplication checks | Policy review is reasonable, but they are weak runtime-saving targets. | In one successful historical run they cost ~1.37s combined. Removing them cannot explain minutes of improvement; assess maintenance and false-positive costs separately. |
| Coverage floors/provider | Keep causal questions separate from policy preferences. | First establish collection overhead and unique protection. Lowering a threshold without removing work normally saves no passing-run execution. A provider change needs equivalent report/threshold validation. |
| Model-based conformance | Account for the existing automatic exclusion before any further reduction. | #363 specifies pre-generated trace replay with model/tool/options provenance and zero routine trace generation; missing/stale corpus must fail. Simulation and implementation conformance are different obligations. |

A scheduling change may improve feedback without shortening a successful run. Parallel formal and coverage execution may shorten elapsed time but contend across evaluator threads, JVMs, Vitest workers, and multiple admitted gates. It also changes the current formal-observer lifecycle and contiguous-prefix resume assumptions. Treat it as an orchestration change with acceptance tests, not replacing an `await` with `Promise.all`.

## Historical research and tracker reconciliation

The [#355 measurement resolution](/workspace/typescript/dalph/.scratch/verification-costs-355/resolution.md), retained in the original research worktree, recommended complete-profile reuse before finer selection; its 366.65s failed run is not a success baseline. Its older successful profiles and MBT measurements are explicitly versioned. The [older hosted-equivalent profile](https://github.com/dearlordylord/dalph/blob/c61535b87cc6e03355a6953b57f33185ad235fab/research/quint-hosted-equivalent-profile.md) already investigated command/family timing, evaluator identity, seeded sampling and contention.

Live tracker reads during this investigation found [#336](https://github.com/dearlordylord/dalph/issues/336) open; #355–#358 closed; [#359](https://github.com/dearlordylord/dalph/issues/359), [#360](https://github.com/dearlordylord/dalph/issues/360), [#361](https://github.com/dearlordylord/dalph/issues/361), [#362](https://github.com/dearlordylord/dalph/issues/362), and [#363](https://github.com/dearlordylord/dalph/issues/363) open. Git and the qualification report establish substantial implemented work despite those open statuses. Reconcile the existing report against tracker acceptance before creating replacement work; do not treat open status as absent implementation or silently close issues based on this research. No tracker writes were made.

The immediate recommendation is to expose existing execution evidence, profile the slow simulations and repeated application evaluation, and then choose explicit reductions where protection does not justify cost. The retained evidence supports those priorities; it does not support deleting formal verification wholesale or promising a particular speedup for current master.
