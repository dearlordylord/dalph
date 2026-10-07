# Current one-file hook timing

The maintainer runs the current pre-commit hook in a disposable Git repository
with exactly `scripts/hook-timing-fixture.ts` staged (`export {}` plus newline).
The hook still selects paths through lint-staged, runs Oxlint and dprint with
`--staged --fix`, then runs staged gitleaks with redaction. No rule, secret check,
path-selection predicate, or process cleanup is removed. This is tooling only:
no Dalph command, workflow, provider, Journal, retry or cleanup behavior changes.
The host-liveness prerequisite #466 and parent #334 remain separate work.

## Reproduce

From the prepared task checkout, run:

```sh
mise exec -- node scripts/measure-commit-hook.mjs .scratch/commit-hook-timings.json
```

The fixture copies tracked working-tree files (including instrumentation), links
only prepared dependencies, initializes its own Git repository, explicitly
disables hooks there, and makes an intentional fixture baseline commit. It never
commits in the invoking task worktree. It stages one new TypeScript file and
invokes `sh .husky/pre-commit` twice, without committing that staged file.
There are no provider calls or downloads in the harness. Ambient dprint plugin
cache must already contain the configured plugin; otherwise the normal tool may
fetch it, within the sample deadline.

Each sample has a hard 60-second execution limit and prints its absolute UTC
stop before spawning. The shared bounded runner owns detached process groups,
relays parent signals, and permits up to five seconds for termination and two
seconds to prove absence. It removes only its exact temporary directory after
stopped-writer proof; ambiguous outcomes retain that directory. Setup Git and
version calls each stop after ten seconds. Record a three-minute overall stop
before a reproduction (expected duration: under ten seconds on this host).
Do not run more than three complete samples for this task. Only two samples run
per harness invocation; the retained first incomplete observation means this
turn has already used its three-sample allowance.

`DALPH_HOOK_TIMINGS=1` emits one JSON stderr line per completed discovery,
Oxlint, dprint, lint-staged and gitleaks stage. It enables lint-staged `--verbose`
so successful child timing lines survive its output suppression. Without that
flag the original commands and output remain in use. Timing records contain no
paths, arguments, environment values or tool diagnostics. The harness captures
redacted tool output in memory and retains only timings and version strings.
A nonzero child still stops the ordinary hook; census lint still collects both
failures. Stages interrupted before completion can lack a timing line.

## Retained observation

Observed on 2026-10-07, Linux arm64, prepared Node v24.20.0, pnpm 10.29.3,
lint-staged 17.3.0, Oxlint 1.76.0, dprint 0.55.2 (oxc plugin 0.32.0), and
gitleaks 8.30.0. The source checkout was Base
`893505ffb2bfc9a04dc4f4342feb12070dddf649` with this task's instrumentation edits;
it is newer than the issue's historical audit commit. The retained JSON's
`candidate` identifies that starting HEAD, not qualification of the final commit.
Instrumentation input hashes are retained with the samples.

[Component evidence](linux-arm64.json) retains raw timings, exit codes, exact
staged path, deadlines, versions and stopped-writer results.
[Incomplete observation](incomplete-observation.json) retains the initial
1.39-second successful hook whose child timings lint-staged suppressed. This
was a measurement failure, not a failed lint or secret check; verbose timing
mode corrected that boundary before the two complete measurements.

| Component (milliseconds) | Fresh fixture | Same fixture, warm inputs |
| --- | ---: | ---: |
| Discovery | 20.38 | 24.38 |
| Oxlint | 473.34 | 526.38 |
| dprint | 35.53 | 39.23 |
| lint-staged total | 844 | 913 |
| lint-staged orchestration remainder | 314.75 | 323.00 |
| gitleaks | 316 | 311 |
| Complete hook with cleanup proof | 1195.35 | 1256.67 |

The orchestration remainder subtracts discovery, Oxlint and dprint from the
lint-staged span. It includes pnpm/Node startup, Git/index handling, runner
startup and timing overhead; it is not an isolated lint-staged CPU measurement.
Lint subprocess spans use monotonic performance time. Shell spans use wall time
from two small Node timestamp processes; millisecond granularity and timestamp
startup/exit overhead apply. Total uses monotonic time and includes process-group
absence proof. These are complete hook invocations, not full `git commit` timings.

The first complete sample has a fresh repository/index and no per-fixture dprint
incremental state; tool binaries, shared dprint plugin cache, dependency links
and OS caches are ambient. The earlier incomplete observation already exercised
those caches. The second retains the same index, staged bytes, and all caches.
No system cache eviction or isolated tool installation was attempted. The copied
source tree preserves the discovery census and lint configuration, but prepared
workspace dependency links can resolve back to the source checkout. This is a
one-file tooling reference, not a cold install or a large application edit.

Both measured complete invocations meet the <=30-second target. Oxlint is the
largest measured component. No latency optimization is proposed or implemented;
the next task can use these bounded observations without reviving the obsolete
ESLint diagnosis.

## Acceptance checks

- `scripts/commit-hook-timing.test.mjs` controls hook commands, timing opt-in,
  order, lint failure refusal of gitleaks, and secret failure propagation.
- `scripts/quality-lint-census.test.mjs` proves discovery/tool timing fields,
  nonzero statuses, unchanged census versus ordinary first-failure behavior,
  and unchanged dprint incremental routing.
- `scripts/quality-lint.test.ts` exercises actual selection, lint rules,
  disposable cleanup, and signal custody; `scripts/run-bounded-command.test.ts`
  exercises the shared fixture supervisor's timeout/descendant controls.

These affected checks, full type-aware lint census, and documentation link check
are the tooling acceptance lanes. No Dalph runtime acceptance lane is changed.
