# Quint hosted-equivalent profile evidence

This record supports issue #153's hosted formal-model timeout decision. It is
tooling evidence only: it changes no Dalph runtime behavior, provider call,
workflow occurrence, journal fact, or operator-visible Run result, so no
runtime operational scenario applies.

## What was measured

The profile repeated the formal job's repository-local sequence on the same
Linux arm64 machine:

```text
mise exec node@<supported-version> -- pnpm install --frozen-lockfile
mise exec node@<supported-version> -- pnpm check:quint
```

The install command was timed separately. `check:quint` records every selected
Quint command and aggregates the typecheck, deterministic-test, sampled-run,
and exhaustive-verify phases. Every profile completed all 92 selected commands
(13 typechecks, 40 tests, 20 sampled runs, and 19 verifies). Ninety-one
ordinary selected commands exited 0; the one expected temporal-mutant verify
exited 1 and was accepted and checked by the gate, whose outer command exited
0.

The emitted command rows and reported phase totals are retained in
[`quint-hosted-equivalent-profile.raw.json`](./quint-hosted-equivalent-profile.raw.json).
That artifact was generated from the five retained run logs with this command
(the profile arguments are `id|node|repeat|install-seconds|log-path`):

```text
node scripts/generate-quint-profile-evidence.mjs --output research/quint-hosted-equivalent-profile.raw.json \
  --profile 'node22-repeat1|22.22.2|1|1.182|/tmp/dalph-issue-153-node22-profile1.log' \
  --profile 'node22-repeat2|22.22.2|2|1.196|/tmp/dalph-issue-153-node22-profile2.log' \
  --profile 'node24-repeat1|24.15.0|1|1.535|/tmp/dalph-issue-153-node24-profile1.log' \
  --profile 'node24-repeat2|24.15.0|2|0.990|/tmp/dalph-issue-153-node24-profile2.log' \
  --profile 'node24-final-post-change|24.15.0|final-post-change|-|/tmp/dalph-issue-153-final-check-quint.log'
```

The JSON records each source log's SHA-256, command rows, command counts, and
the phase totals emitted by the gate. The source logs are not claimed to be
portable files; the checked-in JSON is the retained measurement artifact.

The machine is Linux arm64 rather than GitHub's hosted Ubuntu runner. Cold
hosted action setup, cache-hit/miss behavior, and checkout/network timing were
not measured and cannot be observed until the workflow is pushed, so this
record does not present local timings as hosted timings. The workflow reserves
300 seconds for checkout, action setup, cache and network variance, and other
hosted startup work; that allowance is reserved, not measured, and is added to
the measured install and the gate's 600-second internal deadline.

## Repeated profiles

All durations are wall-clock seconds. Phase values come from the gate's own
per-command timing report; the total includes pnpm and process startup around
the gate.

| Node | Repeat | Frozen install | Typecheck (13) | Tests (40) | Sampled runs (20) | Verify (19) | Formal total | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 22.22.2 | 1 | 1.182 | 23.42 | 111.70 | 72.34 | 141.18 | 348.65 | pass |
| 22.22.2 | 2 | 1.196 | 25.55 | 133.73 | 78.42 | 147.51 | 385.21 | pass |
| 24.15.0 | 1 | 1.535 | 20.29 | 105.48 | 68.12 | 131.50 | 325.40 | pass |
| 24.15.0 | 2 | 0.990 | 21.47 | 103.09 | 66.36 | 126.83 | 317.75 | pass |
| 24.15.0 | final post-change | — | 35.60 | 176.29 | 102.24 | 258.13 | 572.29 | pass |

The final post-change run was made without repeating installation (the prior
Node 24.15.0 install measurement is 0.990s). It ran while other workspace
lanes were active and is retained as the most conservative observed profile.
The slowest observed formal total is 572.29 seconds. The slowest phase totals
are 35.60 seconds for typecheck, 176.29 seconds for tests, 102.24 seconds for
sampled runs, and 258.13 seconds for verification.

## Per-family command breakdown

The following rows preserve the gate's per-command report after grouping
commands by their selected model family. `Tests` includes deterministic and
negative-mutation commands; `Commands` is the total number of commands in the
row. This lets a later reviewer verify compile/typecheck, deterministic-plus-
mutation, sampled, and exhaustive costs for every repeated profile rather than
relying only on the four phase totals above. Values are seconds and are
rounded to two decimals from the checked-in profile logs.
The family-row sums use the emitted command values; they can differ from the
reported phase totals by a few hundredths because each command line is rounded
before it is emitted.

| Profile | Model family | Commands | Typecheck | Tests | Sampled | Exhaustive verify |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Node 22.22.2 repeat 1 | planned-attempt executor | 20 | 2.43 | 12.75 | 10.04 | 37.28 |
| Node 22.22.2 repeat 1 | application Exit | 21 | 2.08 | 17.56 | 16.69 | 19.65 |
| Node 22.22.2 repeat 1 | control-direction application | 5 | 0.88 | 4.28 | 0.89 | 5.01 |
| Node 22.22.2 repeat 1 | Run activation | 5 | 1.58 | 6.54 | 2.24 | 25.84 |
| Node 22.22.2 repeat 1 | Run cancellation | 5 | 1.16 | 3.43 | 5.01 | 6.34 |
| Node 22.22.2 repeat 1 | task-fact models | 17 | 6.55 | 34.72 | 18.44 | 20.71 |
| Node 22.22.2 repeat 1 | Git reconciliation | 5 | 0.92 | 2.55 | 3.31 | 5.30 |
| Node 22.22.2 repeat 1 | accepted-result integration | 9 | 5.18 | 19.90 | 12.30 | 6.68 |
| Node 22.22.2 repeat 1 | integration finality | 5 | 2.64 | 9.97 | 3.40 | 14.38 |
| Node 22.22.2 repeat 2 | planned-attempt executor | 20 | 2.54 | 11.86 | 10.05 | 36.61 |
| Node 22.22.2 repeat 2 | application Exit | 21 | 2.51 | 18.72 | 17.39 | 20.22 |
| Node 22.22.2 repeat 2 | control-direction application | 5 | 0.82 | 4.25 | 0.92 | 4.75 |
| Node 22.22.2 repeat 2 | Run activation | 5 | 1.47 | 6.30 | 2.91 | 33.07 |
| Node 22.22.2 repeat 2 | Run cancellation | 5 | 1.27 | 3.55 | 6.00 | 8.65 |
| Node 22.22.2 repeat 2 | task-fact models | 17 | 8.85 | 54.99 | 21.77 | 18.71 |
| Node 22.22.2 repeat 2 | Git reconciliation | 5 | 0.91 | 2.55 | 3.47 | 5.32 |
| Node 22.22.2 repeat 2 | accepted-result integration | 9 | 4.99 | 20.77 | 12.05 | 5.20 |
| Node 22.22.2 repeat 2 | integration finality | 5 | 2.18 | 10.70 | 3.86 | 14.96 |
| Node 24.15.0 repeat 1 | planned-attempt executor | 20 | 2.33 | 14.02 | 9.71 | 37.07 |
| Node 24.15.0 repeat 1 | application Exit | 21 | 2.02 | 16.31 | 16.37 | 19.12 |
| Node 24.15.0 repeat 1 | control-direction application | 5 | 0.67 | 3.86 | 0.73 | 4.72 |
| Node 24.15.0 repeat 1 | Run activation | 5 | 1.35 | 5.98 | 1.86 | 23.20 |
| Node 24.15.0 repeat 1 | Run cancellation | 5 | 1.02 | 2.96 | 5.37 | 7.68 |
| Node 24.15.0 repeat 1 | task-fact models | 17 | 5.87 | 32.84 | 16.60 | 15.92 |
| Node 24.15.0 repeat 1 | Git reconciliation | 5 | 0.77 | 2.36 | 3.32 | 4.94 |
| Node 24.15.0 repeat 1 | accepted-result integration | 9 | 4.25 | 18.67 | 10.91 | 5.09 |
| Node 24.15.0 repeat 1 | integration finality | 5 | 2.01 | 8.51 | 3.24 | 13.76 |
| Node 24.15.0 repeat 2 | planned-attempt executor | 20 | 1.96 | 9.96 | 8.58 | 32.51 |
| Node 24.15.0 repeat 2 | application Exit | 21 | 1.83 | 15.49 | 15.94 | 18.68 |
| Node 24.15.0 repeat 2 | control-direction application | 5 | 0.84 | 4.33 | 0.83 | 5.50 |
| Node 24.15.0 repeat 2 | Run activation | 5 | 1.54 | 6.16 | 1.92 | 23.72 |
| Node 24.15.0 repeat 2 | Run cancellation | 5 | 1.21 | 2.82 | 4.73 | 5.69 |
| Node 24.15.0 repeat 2 | task-fact models | 17 | 5.77 | 31.63 | 15.61 | 15.77 |
| Node 24.15.0 repeat 2 | Git reconciliation | 5 | 0.97 | 2.23 | 3.13 | 4.91 |
| Node 24.15.0 repeat 2 | accepted-result integration | 9 | 5.16 | 19.83 | 12.41 | 5.96 |
| Node 24.15.0 repeat 2 | integration finality | 5 | 2.19 | 10.64 | 3.20 | 14.09 |
| Node 24.15.0 final post-change | planned-attempt executor | 20 | 11.18 | 48.92 | 23.72 | 150.79 |
| Node 24.15.0 final post-change | application Exit | 21 | 3.75 | 33.14 | 24.29 | 21.27 |
| Node 24.15.0 final post-change | control-direction application | 5 | 0.91 | 4.52 | 0.88 | 5.15 |
| Node 24.15.0 final post-change | Run activation | 5 | 1.68 | 7.10 | 3.34 | 25.55 |
| Node 24.15.0 final post-change | Run cancellation | 5 | 1.21 | 4.18 | 5.98 | 8.51 |
| Node 24.15.0 final post-change | task-fact models | 17 | 7.56 | 42.40 | 23.68 | 19.96 |
| Node 24.15.0 final post-change | Git reconciliation | 5 | 0.90 | 2.54 | 3.74 | 6.61 |
| Node 24.15.0 final post-change | accepted-result integration | 9 | 6.20 | 23.08 | 12.92 | 5.62 |
| Node 24.15.0 final post-change | integration finality | 5 | 2.19 | 10.41 | 3.66 | 14.65 |

Each passing profile's outer `pnpm check:quint` command exited 0. Within that
successful gate, the expected temporal mutant command
`planned-attempt executor temporal mutant releasableEvidenceNeverReleasesPosition`
intentionally exits 1; the gate accepts that one exit and validates the
violation before continuing. A deliberately broken selected model in the
negative-control test instead makes the outer `check:ci:formal` command exit
nonzero.

## Bound selected from the evidence

`check:quint` retains a 600-second decreasing internal deadline. The hosted
formal job uses a 16-minute (`960` second) GitHub job timeout:

```text
600.000s internal gate budget
  + 1.535s slowest measured frozen install
  + 300.000s explicit hosted checkout/setup/network allowance
  + 58.465s final reporting margin
= 960.000s job timeout
```

This bound cannot expire before the complete inner budget plus the measured
install and the stated hosted-startup allowance. The 600-second bound remains
well above the repeated local maximum; a later hosted run that exceeds it
must fail with the gate's accumulated command and phase timings rather than
silently omit formal checking.

## Scenario-to-test mapping

This is a tooling-only change, so the issue's accepted runtime-scenario
exemption applies. The concrete tooling outcomes are covered by:

- `scripts/quint-ci-contract.test.ts`: the `check:ci:formal` script and hosted
  matrix contract, plus a controlled-copy inversion of the selected
  `commandProjectionBelongsToCalledCommand` `plannedAttemptExecutor` obligation
  that must make the formal gate fail;
- `scripts/quint-gate-timing.test.ts`: command/phase accumulation, including
  timing output from `finally` while preserving the original failure; and
- the five passing gate runs recorded above: the same `check:quint` command
  exercised on both supported Node versions with all four phase families (four
  with a separately measured frozen install and one final post-change run).
