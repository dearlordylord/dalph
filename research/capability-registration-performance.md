# Capability-registration source-audit performance

Issue #262 is a tooling-only change. The scanner reads authored TypeScript
text and builds an in-process TypeScript semantic index; it does not import,
evaluate, or call an audited module. The benchmark therefore measures source
text parsing and semantic indexing only.

## Method

At the original qualification commit `5b0941165`, the focused benchmark was
`scripts/capability-registration-performance.test.ts`. These are the exact
historical commands:

```sh
mise exec node@22.22.2 -- pnpm exec vitest run scripts/capability-registration-performance.test.ts --pool=forks --maxWorkers=1 --reporter=verbose
mise exec node@24.15.0 -- pnpm exec vitest run scripts/capability-registration-performance.test.ts --pool=forks --maxWorkers=1 --reporter=verbose
```

For the closure worktree, the benchmark is renamed to
`scripts/capability-registration.performance.test.ts` so the repository-wide
`.performance.test.ts` coverage exclusion recognizes it. The current explicit
command is:

```sh
mise exec node@24.20.0 -- pnpm exec vitest run scripts/capability-registration.performance.test.ts --pool=forks --maxWorkers=1 --reporter=verbose
```

Each current benchmark row reports elapsed wall time, compiler-diagnostic count, and
the virtual source-tree and dependency indexes that were rebuilt or reused. It runs
`runCapabilityRegistrationGate` and then reads the cached diagnostics for that
exact source-array object. The source array passed to each row is new, so the
row measures Program construction while the latest compatible Program is
supplied as TypeScript's old Program.

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

Those rows are the original Node 22.22.2 and Node 24.15.0 qualification at
`5b0941165`, when the repository source set contained 624 authored TypeScript
files. At closure, Node 24.20.0 is the repository's only supported version and
the source set contains 718 files. The renamed explicit benchmark on the
closure worktree reported:

| Node | Row | Wall time | Compiler diagnostics | Rebuilt trees | Reused trees | Rebuilt dependency indexes | Reused dependency indexes | Issues |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 24.20.0 | baseline | 5.359s | 0 | 718 | 0 | 718 | 0 | 0 |
| 24.20.0 | same-path semantic mutation | 2.360s | 1 | 1 | 718 | 1 | 718 | 1 |
| 24.20.0 | added/re-export roots | 2.379s | 0 | 3 | 718 | 721 | 0 | 1 |
| 24.20.0 | provider-text roots | 2.307s | 0 | 2 | 718 | 720 | 0 | 1 |

The added and provider rows intentionally report one unregistered production
Layer issue. Their source text is parsed and bound; no provider expression is
executed. The same-path row changes a valid virtual source to
`const semanticValue: string = 1`; its one `TS2322` diagnostic is returned and
the changed tree is rebuilt. The historical rows reused all 624 unchanged
repository trees; the current Node 24.20.0 row reused all 718.

The scanner asks TypeScript for compiler-option diagnostics on every new
Program. When root paths are identical, it reuses an unchanged source's
dependency index only after exact full-text equality; a changed source is
reindexed. When any root is added or removed, every dependency index is rebuilt
so newly resolvable and missing modules remain observable. It then compares the
current and previous module dependency graphs and
checks syntax and semantic diagnostics for each changed, added, or removed
source and the reverse dependency closure. An unchanged repository source is
also checked when its source text differs from the physical repository file;
unchanged physical repository roots are not rechecked for a virtual fixture, so
unrelated baseline diagnostics cannot be surfaced by a fixture. The focused
contracts cover a first-audit added root, changed dependency export, removed
dependency, syntax error, and semantic error.

Source diagnostics are retained by path. When a current source has identical
complete text and is outside the recomputed dependency-affected closure, its
prior diagnostics remain in the verdict even if roots reorder, an unrelated
root is added, or another unrelated source changes. Affected paths are checked
again, removed paths are omitted, and compiler-option diagnostics without a
source path are recomputed for every Program. If the TypeScript AST shows that
an added, changed, or removed source contributes script globals, a global or
module augmentation, or a UMD namespace export, every current root is affected.
This removes stale global-conflict diagnostics and detects new ambient errors
in otherwise unchanged consumers without guessing from source text.

## Complete focused suite

The main focused command retains all 33 accepted capability positives and
negative controls and adds cache, compiler-diagnostic, and quality-composition
contracts. The current focused command has 47 tests. The Node22/Node24 rows
below are the serialized original qualification observations:

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

The closure worktree's Node 24.20.0 focused suite produced these current
qualification observations:

| Node | Run | Workload | Wall time | Result |
| --- | --- | --- | ---: | --- |
| 24.20.0 | bounded stage | none | 30.411s | 47/47 passed |
| 24.20.0 | stressed | one fixed CPU worker, CPU 11, 70s | 58.888s | 47/47 passed |

The first row ran through `runBoundedCommand` with the accepted 60-second
deadline; Vitest reported 29.81 seconds. Its 29.589-second margin is 49.3% of
the stage bound. The stressed row used the current Node 24.20.0 one-CPU worker,
marker, kill/wait status, and fail-closed cleanup procedure reproduced below;
Vitest reported 56.36 seconds and the full command took 58.888 seconds. That
1.112-second full-command margin is inside the accepted bound but is not
described as comfortable headroom.

The exact current stress command was:

```sh
run_current_stressed() (
  stress_directory=""
  stress_pid=""
  worker_marker=""
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
      if wait "$stress_pid" 2>/dev/null; then worker_wait_status=0; else worker_wait_status=$?; fi
      worker_marker_status=$(cat "$worker_marker" 2>/dev/null || true)
      worker_status_ok=1
      if [ "$worker_marker_status" = "complete" ] && [ "$worker_wait_status" -eq 0 ]; then
        worker_status_ok=0
      elif [ "$worker_alive_status" -eq 0 ] && [ "$worker_kill_status" -eq 0 ] && [ "$worker_wait_status" -eq 143 ]; then
        worker_status_ok=0
      fi
      if [ "$worker_status_ok" -ne 0 ] && [ "$test_status" -eq 0 ]; then test_status=1; fi
    fi
    if [ -n "$worker_marker" ] && ! rm -f -- "$worker_marker"; then test_status=1; fi
    if [ -n "$stress_directory" ] && ! rmdir -- "$stress_directory"; then test_status=1; fi
    exit "$test_status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! stress_directory=$(mktemp -d); then exit 1; fi
  worker_marker="$stress_directory/complete"
  taskset -c 11 mise exec node@24.20.0 -- node -e 'const fs = require("node:fs"); const marker = process.argv[1]; const end = Date.now() + 70000; let value = 0; while (Date.now() < end) value = (value + 1) % 1000003; fs.writeFileSync(marker, "complete")' "$worker_marker" &
  stress_pid=$!
  if ! kill -0 "$stress_pid" 2>/dev/null; then exit 1; fi
  mise exec node@24.20.0 -- pnpm test:capability-registration -- --reporter=dot
)

run_current_stressed
```

The marker lived in the dedicated directory. Cleanup explicitly unlinked it,
removed that now-empty directory, and accepted the worker only after it was
terminated and reaped or completed with its marker. The shared-container
overseer file was stale at a September 2 timestamp and did not refresh during a
60-second wait, so workload clearance could not be independently certified from
that file. After a further two-minute quiet wait without polling processes, the
green row above was recorded as the test result itself. Three earlier CPU-11
samples were discarded rather than averaged into the passing claim:

- 77.136 seconds, 47/47 passed, while unrelated #335 and DND Vitest jobs were
  observed at completion;
- 84.488 seconds, 46/47 passed, while DND raw-swarm TypeScript work and #335
  lint were observed at completion; and
- 77.544 seconds, 46/47 passed, while DND generated-declaration processing was
  observed at completion.

The benchmark is explicit performance evidence and is excluded from coverage;
the correctness suite runs once as its own bounded `check:all` stage and is
also excluded from coverage.

The restored capability-registration quality stage remains bounded at 60s;
that bounded runner contract is the stage verdict. The benchmark test reports
elapsed observations and deterministic source-tree/diagnostic assertions but
does not fail on ambient wall-clock time. The explicit benchmark commands above
and the bounded quality-gate stage enforce and profile the 60-second contract.
The virtual compiler host precomputes its virtual directory set once per
Program. This avoids scanning every virtual file name for every TypeScript
`directoryExists` lookup while retaining the same source-only resolution
boundary. It retains only the latest and largest Programs, chooses the one with
the greatest exact source overlap, and declines both candidates when neither
has an exact path-and-source match. It resolves export status only for symbols
actually referenced by declared compositions, reuses dependency indexes under
the exact-root/exact-text rule above, and uses the Program's path index for
source lookups. The final 47-test observations above replace the earlier 41-test
observation. Each original wall time includes the pinned `mise exec` and
package-runner startup; both then-supported Node pins (`22.22.2` and `24.15.0`)
were available in the qualification environment. Each of the four original qualification profiles was
invoked as its own serialized shell command; dedicated commands captured the
`mise` status directly, and stressed commands captured the `run_stressed`
status from the Bash pipeline before exiting with it. All four returned `0`.
The historical Node 22.22.2 and Node 24.15.0 measurements used this earlier
exact-cleanup procedure, whose marker was a single `mktemp` file rather than the
current dedicated directory:

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
| Scenario 1: a maintainer runs the complete quality gate and the 33 accepted controls remain source-only | `capability-registration.test.ts` existing controls; `runs the capability audit exactly once and continues to the next quality stage`; `fails fast when the capability audit exits nonzero`; `passes the capability deadline and parent-signal policy to the bounded runner`; `attaches captured output when a command exits outside the accepted set`; `attaches captured output and line counts when a command times out`; complete-suite rows above |
| A negative fixture changes one existing source | `rebuilds a source whose complete text changes instead of reusing its old tree`; semantic diagnostic contract; same-path mutation row |
| A fixture adds virtual/re-export roots | `reuses unchanged source trees when a later audit adds a virtual root`; added/re-export row |
| A dependency export changes or a dependency root is removed | `fails closed when a changed dependency removes an imported export`; `fails closed when a removed dependency remains imported`; `rechecks an unchanged consumer after a changed ordinary require call dependency`; `rechecks an unchanged consumer after an ordinary require call dependency is removed` |
| A type-only import dependency changes or a triple-slash dependency is removed | `fails closed when a changed import-type dependency removes an exported type`; `fails closed when a removed triple-slash dependency remains referenced` |
| A dynamic import or ordinary require dependency changes or is removed | `fails closed when a changed dynamic-import dependency removes an exported value`; `rechecks an unchanged consumer after a changed ordinary require call dependency`; `rechecks an unchanged consumer after an ordinary require call dependency is removed` |
| An added source uses a repository source prefix | `fails closed for a first-audit virtual source under a repository source root` |
| An added, changed, reordered, repeated, or ambient source has a TypeScript syntax or semantic error | `fails closed on syntax diagnostics from an added virtual source without exposing repository diagnostics`; `fails closed on semantic diagnostics from a changed virtual source`; `preserves or recomputes diagnostics across unrelated and ambient source changes` |
| A source contains a provider expression | `audits source text without loading or invoking a live provider`; provider-text row |
| Scenario 5: measurements set the finite stage bound | this report; the explicitly invoked benchmark test; `passes the capability deadline and parent-signal policy to the bounded runner`; `excludes capability correctness and every performance test only from coverage`; `attaches captured output when a command exits outside the accepted set`; `attaches captured output and line counts when a command times out`; `kills a resistant descendant after the process-group leader exits` |
