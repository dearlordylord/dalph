# Coverage and output

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

### Coverage and output budgets

Coverage scheduling is repository tooling only: it does not change a Dalph
command, workflow decision, provider boundary, journal fact, retry, cleanup
action, or runtime-visible result. Resource-sensitive simulations that spawn a
built CLI do not add child-process V8 coverage to the parent report; their
inclusion must rest on required acceptance proof. When focused boundary tests
plus the actual protected qualification already own their acceptance facts,
remove a redundant built-child simulation instead of moving it into another
automatic lane. The focused tests remain boundary evidence, not a substitute
for composed runtime proof; the actual protected #307 run owns the final
shipped-entry composition.

The direct-publication S1 test is a production integration scenario under
`packages/dalph/test/integration/`: it starts the built CLI with real local
Git and SQLite and controlled external providers. The maintained recorded
catalog remains under `packages/dalph/test/cassettes/` and has its own command.
Run `pnpm test:integration:publication` before handoff when direct publication
or its composed completion/dependant behavior changes; record its result in the
scenario-to-test mapping. Ordinary `test`, `coverage:body`, and `check:all`
exclude this process-backed scenario. It contributes no child-process V8
coverage, and its real Git/SQLite startup can fail for reasons unrelated to
the coverage measurements. The named integration command retains the full
scenario assertions and bounded completion timeout. Its old 130-call ceiling
was a heuristic rather than an accepted scenario outcome; provider operation
counts remain in the failure diagnostic for investigating loops. Neither this
change nor a passing coverage run claims S1 acceptance until that named
integration command passes. These changes affect test policy, not a Dalph
command or runtime behavior.

Before submitting another hosted candidate after a failure, reproduce the
failure with the smallest named check that owns that boundary. Run cheap
structural diagnostics before resource-sensitive acceptance checks; the gate
manifest enforces its complete preflight prefix before qualification and
coverage. `scripts/recorded-catalog-gate.test.ts` proves that ordering and the
two-worker V8 policy. Coverage runs ordinary files with two workers, then the
cleanup recovery file, then the distinct-finality and formal-command contract
files one at a time. All three
projects use the same 30-second per-test budget and current-source aliases.
`scripts/coverage-scheduling.test.ts` checks that the split keeps the ordinary
file selection and exclusions and runs each of the three resource-sensitive
files once. This scheduling policy changes no Dalph runtime behavior.

- Report 95% production and 75% maintained-evaluation goals independently
  for statements, branches, functions, lines, and changed executable lines.
  These goals are advisory and never determine the command exit status.
  Require explicit tests for changed accepted behavior and review uncovered
  changed branches, including negative, crash, and replay outcomes. Test failures
  and unreadable coverage artifacts still fail. This deliberately removes the
  blanket percentage assurance; no tests are deleted. Maintained cassettes and
  deterministic test-only completion boundaries use evaluation; runtime and
  adapters use production. Mixed production/fixture files remain production
  until split behind a dedicated evaluation seam.
- Lab assertions run through its maintained check and enter line coverage only
  when instrumented. Tooling scripts have focused tests and gate execution,
  not executable-source coverage. Model checks remain separately required.
- Changed-line coverage uses `DALPH_COVERAGE_BASE_SHA` (CI: PR target or previous
  push SHA), falling back on missing/all-zero input to the merge base with
  `origin/master`, then `HEAD^`. It includes staged/unstaged tracked changes and
  untracked production source; non-executable/test/docs/tooling paths are
  excluded. Istanbul statement spans determine changed executable lines.
- Successful stages retain exact per-stage stdout/stderr counts in evidence; they
  do not share a qualification success ceiling. Each admitted child forwards at
  most 550 lines or 64 KiB to the console when its complete log is retained;
  failed stages retain complete diagnostics and their exit status. Reduce
  reporter noise before changing the per-child presentation bound.

For a branch review, set the coverage base explicitly:

```sh
DALPH_COVERAGE_BASE_SHA="$(git merge-base origin/master HEAD)" pnpm test
```

### Coverage explanation

A maintainer can inspect existing coverage without starting Vitest again:
`pnpm coverage:explain --candidate=<exact base sha> --run=<gate run id>`.
The command reads the run's captured `coverage-final.json` and prints JSON with
independent production/evaluation counts, uncovered statement/function ranges,
branch-arm locations, changed executable lines, missing source entries and the
existing threshold failures. An implicit branch arm without an Istanbul source
range is explicitly unavailable; the containing branch range is separate.

Freshness requires the exact worktree, coverage base and source-input digest,
matching captured artifact bytes/hash, a completed coverage-stage receipt and a
closed, stopped run whose source was unchanged. A failed coverage stage may
supply fresh diagnostic evidence while gate qualification remains `UNPROVEN`.
Missing, malformed, partial or incompatible receipts cannot establish freshness;
source/base/path/hash mismatches are stale. Incomplete reports remain unproven.

`--coverage=<final JSON>` can inspect a raw report; without matching run evidence
its freshness is unproven. `--baseline-coverage=<final JSON>` compares actual
report denominators only; baseline source/base provenance remains unproven.
Without that explicit artifact the prior denominator is unavailable. No prior
counts, unreachable branches or threshold exemption are inferred.

Status 0 means complete analysis of an artifact with matching freshness evidence.
Status 1 means analysis is unproven, stale, incomplete or unavailable. Neither
status certifies coverage compliance or replaces `test`/`check:all`;
the production 95% and maintained-evaluation 75% goals are advisory.
