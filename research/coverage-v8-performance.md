# V8 coverage performance and dependency scope

**Observation date:** 2026-09-14 (America/Montreal)  
**Repository convention:** this is a research artifact under [`research/README.md`](./README.md). It records evidence and recommendations; it does not define Dalph runtime behavior.  
**Change boundary:** documentation only. No application code, test, Vitest configuration, dependency manifest, or quality-gate behavior was changed for this investigation.

## Bottom line

1. The passed candidate gate took **288.17 s** for `pnpm --silent test:coverage`. Vitest printed **285.02 s** for the test run: 384 files passed, 4 were skipped; 4,145 tests passed, 42 were skipped. Its largest reported component was `import 276.89 s`, followed by `tests 755.70 s` (the latter is summed worker/test time, not additional wall time). The coverage summary was printed after Vitest's duration line, leaving only about **3.15 s** between the Vitest line and the outer receipt; that tail includes coverage reporting, the repository verifiers, and process overhead, so it is an upper bound rather than a V8-only measurement. The local timing report explains why per-worker totals must not be added to wall time ([timing report](./coverage-suite-timing-report.md#critical-path-versus-overlapping-worker-time)).

   Evidence is the passed receipt at `.git/dalph-gates/runs/3b3ee65c-7eff-4bc1-8e8c-5a6231e799f3/receipts/3dd42d48-95b8-488a-9ec3-c4d86ca49bd8.json` and its log at `/workspace/typescript/dalph-worktrees/dogfood-2026-09/.scratch/quality-gates/3b3ee65c-7eff-4bc1-8e8c-5a6231e799f3/logs/3dd42d48-95b8-488a-9ec3-c4d86ca49bd8.log`. These are local gate evidence paths, not committed source files.

2. **Dependencies are not in the reported coverage map.** In the candidate's `coverage-summary.json`, all 483 file keys were under `packages/*/src` (contracts 9, dalph 105, orchestrator 369) and none contained `node_modules`. This agrees with Vitest 4.1.10's V8 provider, which filters `node_modules` URLs before remapping, and with Vitest's hard-coded `**/node_modules/**` coverage exclusion ([provider filter](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/index.ts#L24-L75), [resolved exclusions](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/vitest/src/node/config/resolveConfig.ts#L480-L505)).

3. **Dependencies can still contribute to runtime cost.** V8 precise collection is started in each test isolate through the Inspector protocol before results are filtered; Vitest documents that V8 cannot limit collection to selected modules ([Vitest V8 guide](https://vitest.dev/guide/coverage#v8-provider), [Vitest V8 provider startup](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/index.ts#L9-L49)). “Not reported” therefore does not mean “never observed by the profiler.” This is runtime profiling, not Istanbul-style source instrumentation of every dependency.

4. **V8 being slower here is plausible, but not proven by this receipt.** Vitest recommends V8 for generally faster execution and lower memory, while explicitly warning that it can be slower when many different modules are loaded because V8 cannot limit collection to specific modules ([Vitest V8 guide](https://vitest.dev/guide/coverage#v8-provider)). This repository runs hundreds of test files over three source packages and has a very large import-time signal, so the warning fits the shape of this workload. There is no same-revision, same-worker, no-coverage or Istanbul baseline in the passed receipt; the causal size of V8 overhead remains unknown.

5. The first executable experiment should be a **same-worktree pair**: V8 with `DEBUG=vitest:coverage`, then the same test selection with coverage disabled. Vitest's provider emits `Generate coverage total time`, per-file conversion messages, and uncovered-file processing under that namespace ([provider debug timings](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/provider.ts#L40-L94), [conversion debug timings](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/provider.ts#L367-L425)). Until that pair exists, changing the provider or excluding more files is speculation.

## Evidence and snapshot boundaries

The receipt was created for candidate `de2dc1b9cdee149fae1d1f4c2f17b3276ff17c67` in `/workspace/typescript/dalph-worktrees/dogfood-2026-09`, with Node `v24.20.0`, and passed with exit code 0. Its coverage artifacts were 10,579,703 bytes (`coverage-final.json`) and 178,300 bytes (`coverage-summary.json`). The log reported:

```text
Test Files  384 passed | 4 skipped (388)
Tests       4145 passed | 42 skipped (4187)
Duration    285.02s (transform 17.69s, setup 0ms, import 276.89s, tests 755.70s, environment 26ms)
Statements  96.55% (37940/39295)
Branches    94.88% (23740/25020)
Functions   95.79% (10735/11206)
Lines       97.21% (34799/35797)
```

There is an important snapshot distinction. The passed candidate had four coverage workers and a 95% production threshold in its own worktree. The current shared worktree inspected during this research has two coverage workers in [`vitest.config.ts`](../vitest.config.ts#L17-L24) and 99% production thresholds in [`scripts/coverage-policy.mjs`](../scripts/coverage-policy.mjs#L1-L5). The current root script is also a direct `vitest run` command ([`package.json`](../package.json#L37-L38)), whereas the candidate wrapped the same coverage body in its gate-slot helper. Consequently, the receipt is a precise observation of one passed candidate, not a baseline for the current staged worktree. The mechanism and path-scope conclusions are still applicable because both snapshots use the same V8 provider, source include globs, and Vitest 4.1.10; the worker and threshold differences must be held constant in any new benchmark.

## What this repository asks Vitest to cover

The current root config selects the V8 provider and includes `src/**/*.ts` plus `packages/*/src/**/*.ts`; it excludes declarations, test/spec files, and `test/**` ([`vitest.config.ts`](../vitest.config.ts#L34-L49)). The test runner separately excludes `node_modules` and `dist` from test discovery ([`vitest.config.ts`](../vitest.config.ts#L42-L48)). The root command enables coverage and requests `text-summary`, `json-summary`, and `json` outputs before running the two independent summary verifiers ([`package.json`](../package.json#L37-L38)).

The explicit `coverage.include` is broader than “files imported by the tests”: Vitest's documented default is imported files only, while an include glob adds source files that were not imported ([coverage include documentation](https://vitest.dev/guide/coverage#including-and-excluding-files-from-coverage-report), [coverage config reference](https://vitest.dev/config/coverage.html#coverage-include)). In the passed candidate, `packages/*/src/**/*.ts` matched 756 TypeScript paths; 273 were `.test.ts`/`.spec.ts` paths excluded by the repository config, leaving 483 non-test source files. The generated map contained exactly those 483 paths. No root-level `src` files existed in that candidate.

`pnpm-workspace.yaml` declares pnpm workspaces (`.`, `packages/*`, and the reducer-lab prototype) but does not declare Vitest projects ([`pnpm-workspace.yaml`](../pnpm-workspace.yaml#L1-L10)). The root Vitest `projects` block is conditional on `mode === "mbt"`; ordinary coverage runs use the root configuration, not one coverage project per package ([`vitest.config.ts`](../vitest.config.ts#L48-L76)). The aliases resolve the three package names to their source entry points ([`vitest.config.ts`](../vitest.config.ts#L26-L32)), so workspace package source is application source for this report, not an external dependency.

The independent policy deliberately keeps production and maintained-evaluation brackets separate ([`scripts/coverage-policy.mjs`](../scripts/coverage-policy.mjs#L7-L52), [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md#L124-L130)). Narrowing `coverage.include` to make the percentage or file count look better would risk removing production or maintained-evaluation obligations; it is not a safe performance fix without an equivalent policy proof.

## How V8 coverage is collected and filtered

Vitest's V8 guide says that collection runs at runtime through `node:inspector`/the Chrome DevTools Protocol, with source executed as-is rather than pre-instrumented. It also says that AST-based remapping since Vitest 3.2 provides Istanbul-equivalent report accuracy, while warning that V8 may be slower for many modules because collection cannot be limited to selected modules ([Vitest coverage guide](https://vitest.dev/guide/coverage#v8-provider)).

The pinned 4.1.10 provider confirms the sequence:

1. `startCoverage` connects an Inspector session, enables the profiler, and calls `Profiler.startPreciseCoverage` with `callCount: true` and `detailed: true` ([source](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/index.ts#L9-L22)).
2. `takeCoverage` asks V8 for precise coverage, then removes non-file URLs and `/node_modules/` URLs before serializing the worker result ([source](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/index.ts#L24-L75)). This is why dependencies can be observed by the profiler during execution without appearing in the stored map.
3. The provider merges per-suite process results, filters each result through `isIncluded`, and converts included scripts with a Vite transform, AST parse, and `ast-v8-to-istanbul` remap ([merge and untested-file handling](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/provider.ts#L40-L94), [filter and conversion](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/provider.ts#L351-L425)).
4. When `coverage.include` is set and all tests ran, Vitest globs untested files and transforms/remaps them into zero-hit entries so they remain visible in the report ([base provider](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/vitest/src/node/coverage.ts#L171-L202), [V8 uncovered-file conversion](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/provider.ts#L137-L183)). This is the post-run work that makes explicit source globs useful for enforcement, but it is also work that a “loaded files only” report would avoid.

Vitest's base provider rejects files outside the project root when `allowExternal` is false (the documented default), then applies include and exclude globs ([coverage config reference](https://vitest.dev/config/coverage.html#coverage-allowexternal), [base provider `isIncluded`](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/vitest/src/node/coverage.ts#L137-L169)). The resolver additionally appends an unoverrideable `**/node_modules/**` exclusion ([resolver](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/vitest/src/node/config/resolveConfig.ts#L480-L505)). This repository does not set `allowExternal`, `server.deps.inline`, or a coverage-specific project, and its positive include globs do not match `node_modules` in the first place.

The underlying engine behavior explains why V8 can affect execution even when its output is filtered. V8 describes precise coverage as complete but potentially slower and more memory-intensive; its block-level mode adds runtime counters, and precise mode retains feedback vectors to avoid garbage collection ([V8 coverage design](https://v8.dev/blog/javascript-code-coverage#for-embedders), [Node inspector API](https://nodejs.org/api/inspector.html#class-inspectorsession)). Vitest uses this precise Inspector path, not the lower-overhead best-effort mode.

## Diagnosis, confidence, and unknowns

| Hypothesis | Evidence | Confidence | What would confirm or reject it |
|---|---|---:|---|
| Broad import/module graph is the dominant wall-time pressure. | The coverage-enabled receipt reports 276.89 s of import work and 17.69 s of transform work; 384 test files load a three-package source graph. These per-worker figures overlap, so they are workload indicators rather than additive wall time. | High that it is a major workload component; low that V8 caused all of it. | Same candidate, same workers, `--coverage.enabled=false`; compare import and wall deltas. |
| V8 precise collection adds execution overhead across loaded modules. | The provider starts precise collection for each isolate, and Vitest documents no module-level collection limit; V8 documents precise-mode runtime/memory overhead. | Medium-high as a mechanism; unknown magnitude here. | Compare no-coverage and V8 runs, then compare V8's `Generate coverage total time` to the wall delta. |
| AST/source-map remapping and explicit uncovered-file processing are expensive. | The provider transforms and parses each included script and globs/remaps untested files when `include` is set; the candidate report had 483 source files. | Medium. The receipt's post-duration tail is only about 3.15 s, but it is not broken down. | `DEBUG=vitest:coverage` conversion and generation timings; vary only `coverage.processingConcurrency`. |
| Worker CPU/memory contention affects the critical path. | Candidate used four coverage workers; current shared config uses two and comments that V8 instrumentation competes for CPU/memory ([`vitest.config.ts`](../vitest.config.ts#L19-L23)). | Medium. | Run identical candidate tests at 1, 2, and 4 workers while recording wall, RSS, and test counts. |
| Npm dependencies inflate the final report. | The provider filters `/node_modules/`; the final map has zero dependency paths. | Low / rejected for report size. | Keep the final-map path census as a regression assertion; profile runtime modules separately if needed. |
| Reporters alone explain the 285 s. | The command writes JSON and summary artifacts, but coverage output begins after the 285.02 s line and the outer tail is only 3.15 s in this receipt. | Low for this run. | Run the same V8 command with only the verifier-required reporters in a disposable experiment, without removing `coverage-final.json`. |

The old Vitest issue supplied with this task is useful corroborating evidence, not a diagnosis of Dalph: issue #5322 reports roughly one minute for one NestJS test under Vitest 1.3.1 and is closed as “not planned” ([issue #5322](https://github.com/vitest-dev/vitest/issues/5322)). It demonstrates that V8 coverage can expose pathological module/reporting costs in a small test, but it does not establish that this repository has the same NestJS cause or that dependencies are emitted into the report. A secondary DEV Community post likewise describes coverage as slow on large projects, but supplies no controlled attribution; it is retained only as a symptom lead ([DEV article](https://dev.to/neophen/vitest-is-fast-jest-is-faster--ln1)). The official Vitest documentation/source, Node documentation, V8 design note, and this repository's receipt are the evidence used for the conclusions above.

## Prioritized, executable plan

The plan below is deliberately measurement-first. A run expected to exceed one minute should be time-boxed (the receipt suggests roughly five minutes for coverage): before launch, record the expected duration and a hard wall-clock stop time; use a 10-minute command timeout, preserve the log and partial report, and name the next discriminating experiment before rerunning. Do not modify application code or committed test configuration as part of the investigation.

### P0 — establish an apples-to-apples baseline

In the exact candidate worktree/config that is being compared, run the existing coverage test selection once with V8 and once with coverage disabled while retaining `--mode coverage`, worker count, Node, pnpm, and reporter selection. For example, use the existing `coverage:body` command with `DEBUG=vitest:coverage` for the first run, then invoke the equivalent `vitest run --mode coverage --coverage.enabled=false --reporter=dot` for the second. Record:

- shell wall time and RSS;
- Vitest `Duration`, `transform`, `import`, and `tests` values;
- `Generate coverage total time`, conversion, and uncovered-file debug timings;
- test-file/test counts and exit status; and
- coverage-map path count, `node_modules` path count, and artifact sizes.

Acceptance: the two runs execute the same test files and tests; only coverage collection is different. This separates V8's runtime cost from the suite's ordinary import/test cost before any optimization.

### P1 — identify the expensive phase

If the V8/no-coverage wall delta is large but `Generate coverage total time` is small, focus on precise collection and module execution: use a focused test-file group to find imports that dominate, and inspect heavy static imports or boundary setup. If generation/remapping is large, compare `--coverage.processingConcurrency=4`, `8`, and the documented default (`min(20, availableParallelism)`) without committing the flag ([processing-concurrency reference](https://vitest.dev/config/coverage.html#coverage-processingconcurrency)). Keep JSON output needed by the repository verifiers.

If a worker-count experiment is needed, compare the candidate's 4 workers with 2 and 1 using the CLI override in a disposable run. More workers may reduce wall time but can increase RSS, V8 profiler traffic, and CPU contention; accept a setting only when test counts, coverage paths, and all four metrics remain unchanged. The current two-worker config is a deliberate resource trade-off, not evidence that V8 itself is broken.

### P2 — test provider choice only after P0/P1

Run a disposable, version-matched Istanbul comparison only if V8 overhead is confirmed as the dominant delta. Vitest documents Istanbul's trade-off: instrumentation can be limited to selected files, which can win for large module graphs, but source transformation slows execution and uses more memory ([Istanbul comparison](https://vitest.dev/guide/coverage#istanbul-provider)). The Vitest maintainers' benchmark protocol measures no-coverage, V8, and Istanbul whole-process wall time and warns that reporter duration is not whole-process time ([official benchmark protocol](https://github.com/vitest-dev/benchmarks#coverage)).

Acceptance is not “the fastest provider wins.” Keep the provider that preserves the required source map, aggregate, changed-line, and maintained-evaluation checks, with no dependency paths in the final map. Since Vitest 3.2's V8 remapping is documented as Istanbul-accurate, a measured Istanbul win is a performance trade-off rather than an automatic correctness fix.

### P3 — consider low-risk permanent changes

Only after the measurements:

- Keep the positive source include globs unless a replacement ledger proves every production and maintained-evaluation file remains enforced. Adding an explicit dependency exclusion is harmless for report scope but is redundant here and should not be expected to reduce V8 runtime collection, because V8 collection cannot be limited to selected modules.
- Tune `coverage.processingConcurrency` only if remapping is the measured bottleneck; verify memory and identical maps at the chosen value.
- Keep `coverage-final.json` and `coverage-summary.json` because the repository's changed-line and bracket verifiers consume them. Reducing terminal/HTML output can reduce I/O, but it cannot replace required JSON artifacts; the current CLI already requests text-summary, JSON summary, and JSON.
- Use changed-only or focused package coverage for local iteration only if its output is clearly labelled as non-gating. It must not replace the full source ledger or permit an untested source file to disappear from the required gate.
- Consider splitting package runs or adding Vitest projects only with an explicit merge/threshold proof. Separate projects change roots, source-map transforms, worker scheduling, and merge semantics; they are not a free speedup.
- Reduce unnecessary heavy imports or mock external boundaries only when a test-specific scenario still exercises the same behavior. This can improve both ordinary and coverage runs, but it is a test-design change and needs its own scenario/test review.

## Accuracy and safety trade-offs

| Candidate action | Runtime risk | Coverage/accuracy risk | Recommendation |
|---|---|---|---|
| Debug logging and same-worktree baseline | None beyond observation overhead in the debug run | None | Do first; do not compare debug and non-debug times as production timings. |
| Worker or processing-concurrency experiment | CPU/RSS contention; possible timeout changes | Usually low if maps are merged correctly, but verify exact paths and metrics | Measure with CLI overrides before changing checked-in values. |
| Explicit `node_modules` exclusion | Little; already hard-coded by Vitest | None for current report; no expected profiler-speed win | Do not prioritize. |
| Narrow `coverage.include` / broad new excludes | May reduce post-run work | High: can omit production code and inflate percentages | Avoid unless an independently checked source ledger and policy update accompany it. |
| `coverage.changed` for local runs | Faster local feedback | High if used as the full gate; unaffected debt is invisible | Local-only optimization; preserve the full gate. |
| Istanbul provider | Instrumentation and memory overhead; possibly faster on this module shape | Vitest says V8 remapping is Istanbul-accurate since 3.2, but execution/source-transform behavior differs | A measured fallback, not an unverified switch. |
| Package/project splitting | More process/merge complexity | Source-map roots, thresholds, and dependency boundaries can change | Defer until P0/P1 identifies a map/report bottleneck. |

## Research acceptance map

This file is tooling research and does not add a person-visible workflow, boundary call, durable journal fact, retry, recovery rule, or runtime result. The repository permits omitting runtime scenarios for a documentation-only change when that reason is stated ([development guidance](../docs/DEVELOPMENT.md#L38-L47)). The research evidence maps to executable checks as follows:

| Research claim | Verification seam | Required result |
|---|---|---|
| The V8 phase and ordinary suite have separate costs | Same-worktree V8/no-coverage pair with `DEBUG=vitest:coverage` | Stable test counts; wall/import/test/generation deltas recorded; no causal claim without the pair. |
| Dependencies are not in the report | Node path census over `coverage-summary.json` and `coverage-final.json` | Zero `node_modules` paths; all reported paths match the intended source ledger. |
| Whole package source is intentionally eligible | Compare `coverage.include` globs, policy bracket, and final map | No source file removed without an explicit accepted policy decision; uncovered included files remain visible. |
| A performance change preserves the gate | `pnpm test:coverage` plus the independent changed-line verifier on the exact candidate | Existing production/maintained thresholds, changed-line floors, report artifacts, and test counts still pass. |

No quality gate was rerun for this documentation-only investigation; the plan above names the exact next runs needed to turn the remaining hypotheses into measured conclusions.

## Sources

- [Vitest coverage guide](https://vitest.dev/guide/coverage)
- [Vitest coverage configuration reference](https://vitest.dev/config/coverage.html)
- [Vitest v4.1.10 V8 provider entry point](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/index.ts)
- [Vitest v4.1.10 V8 provider/remapping implementation](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/coverage-v8/src/provider.ts)
- [Vitest v4.1.10 base coverage provider](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/vitest/src/node/coverage.ts)
- [Vitest v4.1.10 coverage config resolution](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/vitest/src/node/config/resolveConfig.ts)
- [Node.js Inspector API](https://nodejs.org/api/inspector.html)
- [Node.js V8 coverage lifecycle APIs](https://nodejs.org/api/v8.html#v8stopcoverage)
- [V8 JavaScript code coverage design note](https://v8.dev/blog/javascript-code-coverage)
- [Vitest issue #5322](https://github.com/vitest-dev/vitest/issues/5322)
- [Vitest maintainers' coverage benchmark protocol](https://github.com/vitest-dev/benchmarks#coverage)
- [Secondary DEV Community symptom lead](https://dev.to/neophen/vitest-is-fast-jest-is-faster--ln1)
