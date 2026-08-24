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
(13 typechecks, 40 tests, 20 sampled runs, and 19 verifies) with exit 0.

The machine is Linux arm64 rather than GitHub's hosted Ubuntu runner. Direct
hosted setup timing cannot be observed until the workflow is pushed, so this
record does not present local timings as hosted timings. The workflow reserves
300 seconds for checkout, action setup, network variance, and other hosted
startup work in addition to the measured install and the gate's 600-second
internal deadline.

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
