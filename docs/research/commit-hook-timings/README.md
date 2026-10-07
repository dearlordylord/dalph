# Current one-file hook timing

The maintainer runs the current pre-commit hook in a disposable Git repository
with exactly `scripts/hook-timing-fixture.ts` staged (`export {}` plus newline).
The hook still selects paths through lint-staged, runs Oxlint and dprint with
`--staged --fix`, then runs staged gitleaks with redaction. No rule, secret check,
path-selection predicate, or process cleanup is removed. This is tooling only:
no Dalph command, workflow, provider, Journal, retry or cleanup behavior changes.
The tracker reports host-liveness prerequisite #466 closed on 2026-10-07; its
repair is integrated in the acceptance Base below. Parent #334 remains Dalph-owned
tracker work; this evidence does not itself close it.

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
stop before spawning. The harness owns parent-signal cancellation through report publication and
fixture disposition, then propagates the original signal. The shared bounded
runner owns detached process groups and permits up to five seconds for termination and two
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
  order, lint failure refusal of gitleaks, and secret failure propagation. Its controlled interruption fixture proves
  that the actual harness stops its Git child, publishes evidence, removes its
  exact temporary directory and only then propagates SIGTERM.
- `scripts/quality-lint-census.test.mjs` proves discovery/tool timing fields,
  nonzero statuses, unchanged census versus ordinary first-failure behavior,
  and unchanged dprint incremental routing.
- `scripts/quality-lint.test.ts` exercises actual selection, lint rules,
  disposable cleanup, and signal custody; `scripts/run-bounded-command.test.ts`
  exercises the shared fixture supervisor's timeout/descendant controls.

These affected checks, full type-aware lint census, and documentation link check
are the tooling acceptance lanes. No Dalph runtime acceptance lane is changed.

## Acceptance of the integrated measurements

On 2026-10-07, the maintainer consumed the integrated measurements at Base
`98bc8a3265c06454a3cf566b6acb921ad7a28ca4`. Both retained complete invocations
(1.195 and 1.257 seconds) meet the documented reference target of <=30 seconds.
The current hook and lint-runner SHA-256 values exactly match
[the measured inputs](linux-arm64.json). No implementation repair is justified.
This slice changes only this evidence note and its JSON evidence: no executable,
rule, selection, dependency, formatter or cleanup policy changes, and no Dalph
runtime behavior can change. Timing remains limited to the reference fixture,
prepared dependencies and ambient caches described above; it is not a hardware,
cold-install, large-edit or full-commit guarantee.

[Real negative controls](negative-controls.json) bind observations to that Base,
the same tool versions and measured hook hashes. The disposable repository setup
and bounded command ownership came from `scripts/measure-commit-hook.mjs`.
Instead of running its success-sample loop, the diagnostic reset the disposable
repository to its baseline before each control, wrote and staged exactly the
named file, verified `git diff --cached --name-only`, and invoked the real
`sh .husky/pre-commit` with `DALPH_HOOK_TIMINGS=1` and a 60-second bound.
The overall stop was 2026-10-07T05:05:00Z; both completed before it.

- Lint: `packages/dalph/src/hook-refusal.ts` contained
  `throw new Error("hook refusal")` plus newline. Oxlint reported
  `dalph(no-throw-statement)` and exited 1. The hook exited 1 without reaching
  dprint or gitleaks, preserving first-failure behavior.
- Secret: `hook-refusal.txt` contained `token=`, the synthetic GitHub PAT prefix
  `ghp_`, and 36 mixed-case alphanumeric characters plus newline. No lint task
  matched the text file; lint-staged exited 0 and staged gitleaks reported
  `leaks found: 1`, exited 1, and made the hook exit 1. The token and tool output
  are not retained. A first diagnostic incorrectly expected a rule ID in normal
  redacted output; the observed leak count corrected that assertion before the
  passing diagnostic. No hook change was made.

Both controls proved stopped writers before removing the exact temporary
repository. These are refusal controls, not additional positive timing samples.
The existing command/order and cancellation controls passed with:

```sh
mise exec -- node --test scripts/commit-hook-timing.test.mjs scripts/quality-lint-census.test.mjs
```

All four tests passed. Since this slice preserves every executable input, there
are no changed-tool consumers to requalify; documentation formatting and
`mise exec -- pnpm check:docs` qualify the changed documentation boundary.
The unchanged positive fixture, actual lint/secret refusal and controlled
command/cancellation checks together support this bounded acceptance slice.
Original #334 still requires Dalph's own integration and tracker closure.
