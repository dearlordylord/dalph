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
| 22.22.2 | baseline | 2.707s | 0 | 624 | 0 | 0 |
| 22.22.2 | same-path semantic mutation | 0.960s | 1 | 1 | 624 | 1 |
| 22.22.2 | added/re-export roots | 1.116s | 0 | 3 | 624 | 1 |
| 22.22.2 | provider-text roots | 1.123s | 0 | 2 | 624 | 1 |
| 24.15.0 | baseline | 2.608s | 0 | 624 | 0 | 0 |
| 24.15.0 | same-path semantic mutation | 0.906s | 1 | 1 | 624 | 1 |
| 24.15.0 | added/re-export roots | 1.020s | 0 | 3 | 624 | 1 |
| 24.15.0 | provider-text roots | 1.005s | 0 | 2 | 624 | 1 |

The added and provider rows intentionally report one unregistered production
Layer issue. Their source text is parsed and bound; no provider expression is
executed. The same-path row changes a valid virtual source to
`const semanticValue: string = 1`; its one `TS2322` diagnostic is returned and
the changed tree is rebuilt while all 624 unchanged repository trees are reused.

The scanner asks TypeScript for compiler-option diagnostics on every new
Program. It computes the current and previous module dependency graphs, then
checks syntax and semantic diagnostics for each changed, added, or removed
source and the reverse dependency closure. An unchanged repository source is
also checked when its source text differs from the physical repository file;
unchanged physical repository roots are not rechecked for a virtual fixture, so
unrelated baseline diagnostics cannot be surfaced by a fixture. The focused
contracts cover a first-audit added root, changed dependency export, removed
dependency, syntax error, and semantic error.

## Complete focused suite

The main focused command retains all 33 accepted capability positives and
negative controls and adds three cache contracts plus eleven compiler-diagnostic
contracts. The current focused command has 47 tests; the final Node22/Node24
rows below are serialized qualification observations:

```sh
mise exec node@22.22.2 -- pnpm test:capability-registration -- --reporter=dot
mise exec node@24.15.0 -- pnpm test:capability-registration -- --reporter=dot
```

| Node | Run | Workload | Wall time | Result |
| --- | --- | --- | ---: | --- |
| 22.22.2 | dedicated | none | 33.822s | 47/47 passed |
| 22.22.2 | stressed | one fixed CPU worker, CPU 11, 70s | 33.604s | 47/47 passed |
| 24.15.0 | dedicated | none | 40.903s | 47/47 passed |
| 24.15.0 | stressed | one fixed CPU worker, CPU 11, 70s | 36.653s | 47/47 passed |

The existing capability-registration quality stage remains bounded at 60s;
that bounded runner contract is the stage verdict. The benchmark test reports
elapsed observations and deterministic source-tree/diagnostic assertions but
does not fail on ambient wall-clock time. The explicit benchmark commands above
and the bounded quality-gate stage enforce and profile the 60-second contract.
The virtual compiler host precomputes its virtual directory set once per
Program. This avoids scanning all 624 virtual file names for every TypeScript
`directoryExists` lookup while retaining the same source-only resolution
boundary. The final 47-test observations above replace the earlier 41-test
observation. Each wall time includes the pinned `mise exec` and package-runner
startup; both documented Node pins (`22.22.2` and `24.15.0`) were available in
the qualification environment. Each of the four qualification profiles was
invoked as its own serialized shell command; dedicated commands captured the
`mise` status directly, and stressed commands captured the `run_stressed`
status from the Bash pipeline before exiting with it. All four returned `0`.
The stressed command uses exact cleanup and reaping for its fixed competing
workload:

```sh
run_stressed() (
  node_version="$1"
  stress_pid=""
  worker_marker=""
  previous_exit_trap=$(trap -p EXIT)
  previous_int_trap=$(trap -p INT)
  previous_term_trap=$(trap -p TERM)
  cleanup() {
    test_status=$?
    trap - EXIT INT TERM
    worker_alive_status=1
    worker_kill_status=0
    worker_wait_status=1
    if [ -n "$stress_pid" ]; then
      if kill -0 "$stress_pid" 2>/dev/null; then worker_alive_status=0; fi
      if [ "$worker_alive_status" -eq 0 ]; then
        if kill "$stress_pid" 2>/dev/null; then worker_kill_status=0; else worker_kill_status=$?; fi
      else
        worker_kill_status=1
      fi
      if wait "$stress_pid" 2>/dev/null; then
        worker_wait_status=0
      else
        worker_wait_status=$?
      fi
      worker_marker_status=$(cat "$worker_marker" 2>/dev/null || true)
      worker_status_ok=1
      if [ "$worker_marker_status" = "complete" ] && [ "$worker_wait_status" -eq 0 ]; then
        worker_status_ok=0
      elif [ "$worker_alive_status" -eq 0 ] && [ "$worker_kill_status" -eq 0 ] && [ "$worker_wait_status" -eq 143 ]; then
        worker_status_ok=0
      fi
      if [ "$worker_status_ok" -ne 0 ] && [ "$test_status" -eq 0 ]; then
        test_status=1
      fi
    fi
    if [ -n "$worker_marker" ]; then rm -f "$worker_marker"; fi
    if [ -n "$previous_exit_trap" ]; then eval "$previous_exit_trap"; else trap - EXIT; fi
    if [ -n "$previous_int_trap" ]; then eval "$previous_int_trap"; else trap - INT; fi
    if [ -n "$previous_term_trap" ]; then eval "$previous_term_trap"; else trap - TERM; fi
    return "$test_status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! worker_marker=$(mktemp); then exit 1; fi
  taskset -c 11 mise exec "$node_version" -- node -e 'const fs = require("node:fs"); const marker = process.argv[1]; const end = Date.now() + 70000; let value = 0; while (Date.now() < end) value = (value + 1) % 1000003; fs.writeFileSync(marker, "complete")' "$worker_marker" &
  stress_pid=$!
  if ! kill -0 "$stress_pid" 2>/dev/null; then exit 1; fi
  mise exec "$node_version" -- pnpm test:capability-registration -- --reporter=dot
)

run_stressed node@22.22.2 || exit $?
run_stressed node@24.15.0 || exit $?
```

Cleanup accepts an already-running worker only when the explicit `kill` succeeds
and Bash reports exactly `143` from `wait` (the SIGTERM status); every other
nonzero status fails closed. Natural completion is accepted only with the
`complete` marker and wait status `0`.

This harmless negative probe must fail closed because the worker exits before
writing its completion marker; the probe itself succeeds only when the early
worker failure is detected:

```sh
(
  marker=""
  worker_pid=""
  cleanup() {
    probe_status=$?
    trap - EXIT INT TERM
    if [ -n "$worker_pid" ]; then wait "$worker_pid" 2>/dev/null || true; fi
    if [ -n "$marker" ]; then rm -f "$marker" || true; fi
    return "$probe_status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! marker=$(mktemp); then exit 1; fi
  taskset -c 11 mise exec node@22.22.2 -- node -e 'process.exit(7)' "$marker" &
  worker_pid=$!
  worker_status=0
  wait "$worker_pid" || worker_status=$?
  if [ "$worker_status" -ne 7 ]; then exit 1; fi
  if [ "$worker_status" -eq 143 ]; then exit 1; fi
  if [ -s "$marker" ]; then exit 1; fi
)
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
| A dependency export changes or a dependency root is removed | `fails closed when a changed dependency removes an imported export`; `fails closed when a removed dependency remains imported`; `rechecks an unchanged consumer after a changed ordinary require call dependency`; `rechecks an unchanged consumer after an ordinary require call dependency is removed` |
| A type-only import dependency changes or a triple-slash dependency is removed | `fails closed when a changed import-type dependency removes an exported type`; `fails closed when a removed triple-slash dependency remains referenced` |
| A dynamic import or ordinary require dependency changes or is removed | `fails closed when a changed dynamic-import dependency removes an exported value`; `rechecks an unchanged consumer after a changed ordinary require call dependency`; `rechecks an unchanged consumer after an ordinary require call dependency is removed` |
| An added source uses a repository source prefix | `fails closed for a first-audit virtual source under a repository source root` |
| An added or changed source has a TypeScript syntax or semantic error | `fails closed on syntax diagnostics from an added virtual source without exposing repository diagnostics`; `fails closed on semantic diagnostics from a changed virtual source` |
| A source contains a provider expression | `audits source text without loading or invoking a live provider`; provider-text row |
| Measurements set the finite stage bound | this report, the benchmark test, and the bounded runner contract in `capability-registration.test.ts` |
