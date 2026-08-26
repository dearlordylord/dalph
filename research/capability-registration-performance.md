# Capability-registration source-audit performance

Issue #262 is a tooling-only change. The scanner reads authored TypeScript
text and builds an in-process TypeScript semantic index; it does not import,
evaluate, or call an audited module. The benchmark therefore measures source
text parsing and semantic indexing only.

## Method

The focused benchmark is `scripts/capability-registration-performance.test.ts`.
It reports elapsed wall time, compiler-diagnostic count, and the virtual
source-tree paths that were rebuilt or reused. Each row runs
`runCapabilityRegistrationGate` and then reads the cached diagnostics for that
exact source-array object. The dedicated command is:

```sh
mise exec node@22.22.2 -- pnpm exec vitest run scripts/capability-registration-performance.test.ts --pool=forks --maxWorkers=1 --reporter=verbose
mise exec node@24.15.0 -- pnpm exec vitest run scripts/capability-registration-performance.test.ts --pool=forks --maxWorkers=1 --reporter=verbose
```

The repository source set contains 624 authored TypeScript files. The source
array passed to each row is new, so the row measures Program construction while
the latest compatible Program is supplied as TypeScript's old Program.

## Named rows

| Node | Row | Wall time | Compiler diagnostics | Rebuilt virtual trees | Reused virtual trees | Issues |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 22.22.2 | baseline | 2.139s | 0 | 624 | 0 | 0 |
| 22.22.2 | same-path semantic mutation | 0.614s | 1 | 1 | 624 | 1 |
| 22.22.2 | added/re-export roots | 0.807s | 0 | 3 | 624 | 1 |
| 22.22.2 | provider-text roots | 0.720s | 0 | 2 | 624 | 1 |
| 24.15.0 | baseline | 2.928s | 0 | 624 | 0 | 0 |
| 24.15.0 | same-path semantic mutation | 1.161s | 1 | 1 | 624 | 1 |
| 24.15.0 | added/re-export roots | 1.208s | 0 | 3 | 624 | 1 |
| 24.15.0 | provider-text roots | 1.005s | 0 | 2 | 624 | 1 |

The added and provider rows intentionally report one unregistered production
Layer issue. Their source text is parsed and bound; no provider expression is
executed. The same-path row changes a valid virtual source to
`const semanticValue: string = 1`; its one `TS2322` diagnostic is returned and
the changed tree is rebuilt while all 624 unchanged repository trees are reused.

The scanner asks TypeScript for compiler-option diagnostics on every new
Program. It asks for syntax and semantic diagnostics for every changed source
and every newly added virtual source; unchanged repository roots are not
rechecked on every negative fixture, so unrelated baseline diagnostics cannot
be surfaced by a fixture. The focused syntax and semantic negative contracts
prove that an invalid added or changed virtual source fails closed and that the
diagnostic path identifies only that source.

## Complete focused suite

The main focused command retains all 33 accepted capability positives and
negative controls and adds three cache contracts plus two compiler-diagnostic
contracts. All 38 tests passed in each final dedicated or stressed run below:

```sh
mise exec node@22.22.2 -- pnpm test:capability-registration -- --reporter=dot
mise exec node@24.15.0 -- pnpm test:capability-registration -- --reporter=dot
```

| Node | Run | Workload | Wall time | Result |
| --- | --- | --- | ---: | --- |
| 22.22.2 | dedicated | none | 27.987s | 38/38 passed |
| 22.22.2 | stressed | one fixed CPU worker, CPU 11, 70s | 27.678s | 38/38 passed |
| 24.15.0 | dedicated | none | 23.221s | 38/38 passed |
| 24.15.0 | stressed | one fixed CPU worker, CPU 11, 70s | 24.667s | 38/38 passed |

The existing capability-registration quality stage remains bounded at 60s.
The virtual compiler host precomputes its virtual directory set once per
Program. This avoids scanning all 624 virtual file names for every TypeScript
`directoryExists` lookup while retaining the same source-only resolution
boundary. The maximum final observation is 27.987s, leaving 32.013s of
measured margin; the bound was not raised. The stressed command ran this exact fixed competing
workload concurrently with the unrestricted test command:

```sh
taskset -c 11 mise exec node@22.22.2 -- node -e 'const end = Date.now() + 70000; let value = 0; while (Date.now() < end) value = (value + 1) % 1000003' &
mise exec node@22.22.2 -- pnpm test:capability-registration -- --reporter=dot

taskset -c 11 mise exec node@24.15.0 -- node -e 'const end = Date.now() + 70000; let value = 0; while (Date.now() < end) value = (value + 1) % 1000003' &
mise exec node@24.15.0 -- pnpm test:capability-registration -- --reporter=dot
```

The background child was terminated and reaped after each completed run. An
earlier diagnostic implementation that asked TypeScript for syntax diagnostics
on every unchanged repository root reached 65.660s on Node22 and was rejected;
the final implementation checks only changed or newly added relevant sources.

## Scenario-to-test mapping

| Operational scenario | Evidence |
| --- | --- |
| A maintainer runs the complete quality gate and the 33 accepted controls remain source-only | `capability-registration.test.ts` existing 33 tests; `is part of check:all`; complete-suite rows above |
| A negative fixture changes one existing source | `rebuilds a source whose complete text changes instead of reusing its old tree`; semantic diagnostic contract; same-path mutation row |
| A fixture adds virtual/re-export roots | `reuses unchanged source trees when a later audit adds a virtual root`; added/re-export row |
| An added or changed source has a TypeScript syntax or semantic error | `fails closed on syntax diagnostics from an added virtual source without exposing repository diagnostics`; `fails closed on semantic diagnostics from a changed virtual source` |
| A source contains a provider expression | `audits source text without loading or invoking a live provider`; provider-text row |
| Measurements set the finite stage bound | this report, the benchmark test, and the bounded runner contract in `capability-registration.test.ts` |
