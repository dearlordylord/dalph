# Choosing checks

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

## Choosing checks

Choose checks by affected behavior, not by commit or handoff alone:

- **Documentation/history cleanup:** check formatting, links, and remaining
  references. Explain why runtime behavior is unchanged; no local full gate.
- **Tooling-only changes:** run affected tool tests, consumer/path checks, and
  relevant lint/typechecks. Moving a script alone does not require the full gate.
- **Runtime/model behavior changes:** use focused tests mapped to every changed
  accepted scenario and `pnpm check:fast` before integration. A full local
  `check:all` is an explicit maintainer/release diagnostic, not a prerequisite
  for each implementation attempt. Hosted CI retains its selected quality and
  formal cells. Model or conformance changes also require adequacy review and
  a negative control. Before submitting model obligations or conformance import
  changes, run `pnpm test:formal:controls`: it checks the independent command
  profile and checked-in hosted source closure. Regenerate a stale closure with
  `node scripts/generate-hosted-formal-input-manifest.mjs --write`; update a
  command fingerprint only after inspecting its exact added/removed obligations.
  A required fresh live-provider scenario remains separate
  from both local and hosted broad gates.
- **Before hosted submission:** run `pnpm check:submit` once on the coherent
  candidate when application source or application test code changed. It prepares
  production artifacts, checks formal profile/source controls, runs typecheck and
  the hosted full lint census, then runs the in-memory cassette suite. A subsequent
  tooling-only repair uses its affected tool and consumer checks; it does not
  restart unchanged application tests. Keep submission routing assertions in
  the early controlled tooling tests: assert required boundary order rather than
  copying an entire shell string into an expensive process fixture. A repair that changes gate custody or
  evidence validity still follows the shared-qualification rule below.
  The lint and cassette checks address
  failures first discovered in hosted #309 runs. Estimate its wall-clock budget
  from recent complete runs of this command, including artifact preparation,
  fresh typecheck, the full lint census, cassette imports and all selected tests.
  A focused test's duration or an old smaller catalog cannot size this budget.
  It does not run the full local qualification or repeat after
  documentation-only edits. The artifact preparation matches hosted preflight:
  workspace package exports resolve through `dist`, so a fresh worktree's
  type-aware lint must not depend on build output left by earlier work.
- **Baseline:** no separate baseline is mandatory. The final preflight owns
  its lint pass; run the maintained Lab only when its boundary is affected.
  `check:baseline` remains an explicit diagnostic convenience, not a prerequisite.
- **Shared qualification changes:** run affected tool tests and inspect the
  generated local and hosted plans before integration. Run the full local gate
  only when its end-to-end custody or evidence validity is the changed boundary;
  selection-only changes receive hosted CI validation after integration.
  Uncertain impact requires investigation, not exemption.

Gate infrastructure controls run for tooling and shared configuration changes;
ordinary product edits omit them. Missing change evidence retains the controls.
Recorded-catalog checks run for cassette, schema, projection, Lab, and shared
configuration changes. The Reducer Lab check runs automatically only for
changes under `prototypes/reducer-lab` or when changed-path evidence is
unavailable; an authored cassette or shared configuration change does not
also require its UI/trace projection in the blocking preflight. Run
`pnpm check:lab` explicitly when changing that projection or investigating
it. During development, run the focused Lab scenario for the changed behavior;
run the selected `check:lab` once on the coherent candidate, since its smoke
replays the maintained catalog and can take several minutes. For causal
cassette authoring and matcher changes, run the focused
`pnpm check:lab:browser:causal` browser replay. For the seven-task capstone's
Lab presentation, run `pnpm check:lab:browser:capstone` explicitly. The
comprehensive `pnpm check:lab:browser` checks shared Lab navigation and all
maintained catalog entries; it is a manual diagnostic for shared Lab or browser
harness changes, not a prerequisite for each cassette edit. Selection retains
deleted and renamed source paths.
The seven-task `deliveryInvariantStoryCapstone` is excluded from the
recorded-catalog round trip. Its focused DS01–DS17 causal checkpoint test runs
in the ordinary cassette suite; the complete DS18–DS22 proof runs under
`pnpm test:integration:capstone`. A passing routine gate proves only the
focused prefix.
During focused capstone fixture repair, use each observed mismatch to name the
competing causes and inspect the exact boundary evidence before editing. A
fixture-only correction supported by that evidence may be followed by another
bounded capstone run without repeating typecheck and lint after every numeric
correlation edit. Re-run the affected negative controls when causal matching or
runtime behavior changes, then run `check:fast` on the coherent candidate before
integration. A failed full qualification still follows its separate recovery
rule; focused capstone attempts do not consume a full-gate admission.
When diagnosing a capstone that must be terminated at its wall-clock stop,
append progress captures to a temporary sidecar and restore the diagnostic
hook afterward. Vitest may hold intercepted console output until test exit, so
console logging alone does not retain the last observed boundary on timeout.
The S1–S8 publication mapping uses the focused checks named in the accepted
direct-publication scenario. This selection changes test policy only; Dalph
production runtime and its accepted behavior do not change.
Complexity, duplication, and unused-export checks are optional trend diagnostics,
not delivery blockers; `lint` owns formatter and code-lint correctness only.
This reduces heuristic and sampling assurance without changing application tests.
Ordinary local and hosted candidates use three fresh delivery samples; coordination, workflow,
execution, cassette, and tooling changes retain twenty. Hosted plans select the same
catalog boundary and retain all declared Node versions only for broad sampling changes. Fewer samples reduce the chance of detecting rare races; the
complete checkpoint order is still asserted in every sample.

The local `check:all` runner requires a clean frozen checkout and an exact Base
SHA. It writes its chosen command manifest before execution, reads each actual
child exit, and writes results alongside that same manifest in
`candidate-checks.json`. A failed stage stops its suffix. The surrounding bounded
supervisor retains worktree locking, clone capacity, logs, source-change checks,
and stopped-process fences. There is no second checkout's profile reader, repair
permit, stage resume, or cross-worktree formal reuse on this ordinary path.
Interruption costs a rerun after reconciliation; this is an explicit simplicity
tradeoff. Formal relevance is recorded, while proof runs by explicit local
request or in CI.

After structural preflight, the local gate runs its delivery,
recorded-catalog, and coverage suffix. Its recorded manifest contains no Quint
stage and its report says `formalDisposition: not-requested`. A maintainer can
run `pnpm check:quint` separately; hosted formal and quality cells remain
independent. This qualification-tooling selection changes no Dalph runtime
behavior or assertions inside the formal command.

### Local CI evidence before a hosted push

On a clean Linux worktree with Python 3, inotify, the pinned Node version, and
installed workspace dependencies, run
`pnpm check:all --candidate=<exact Base SHA>` for the exact
committed HEAD. This runs the preflight and delivery, recorded-catalog, and
coverage commands selected from the same stage algebra as hosted quality CI.
For a PR, set `DALPH_PR_NUMBER` to its number and read its recorded Base and HEAD
immediately before the local run:

```bash
gh api "repos/dearlordylord/dalph/pulls/${DALPH_PR_NUMBER}" \
  --jq '{baseRefOid: .base.sha, headRefOid: .head.sha}'
```

These API values match `baseRefOid` and `headRefOid` even when the installed
`gh pr view --json` does not expose those fields. The PR's recorded Base can
lag the current `master` head; it is not a fresh Git-target observation.
Verify that the local HEAD equals `headRefOid`, pass `baseRefOid`
to `--candidate`, and set `DALPH_DIAGNOSTICS_BASE` to that same Base for earlier
changed-file diagnostics. A local `origin/master` may lag the PR Base; do not
infer the exact Base from it. If hosted CI checks a synthetic merge commit,
compare that commit's tree with the reviewed head tree before counting the
local result as evidence for the same source bytes.
If model inputs changed, run `pnpm check:quint --force` on that unchanged HEAD
for the complete formal command profile. `check:submit` is a cheaper prepush
diagnostic and never claims full CI coverage.

A passing local stage supplies acceptance evidence for the same command and
source boundary. The local gate is sequential in one worktree; hosted CI also
tests clean runner setup, its generated Node matrix, coverage UID isolation,
portable artifact export/aggregation, and two formal shards under the hosted
CPU policy. Record these remaining platform and workflow differences instead
of reporting the remote jobs as passed. Remote CI can continue in the
background after a locally qualified push; investigate its result only when it
provides new failure evidence or the repository requires its status for merge.
This makes the local result the development decision and preserves the hosted
run as a separate deployment and platform check. The shared quality command
selection is checked by `quality-gate-stage-plan.test.mjs`; the local and hosted
formal profiles have identical commands, steps, and execution obligations as
checked by `quint-effective-profile.test.mjs`, with different time budgets and
hosted shard resource policy.

Accepted task requirements still apply. Handoffs name the affected scenarios,
checks run or unrun, and why broader checks add no relevant coverage. Unused-code
removal needs consumer evidence and affected type/build checks; changed behavior
follows the runtime rule.

For a hosted comprehensive qualification handoff, the Integrator first runs the
focused checks that own the repaired boundary before final qualification. A
separate lint/Lab baseline is not required. Hosted CI runs its
generated structural preflight before the generated recorded-catalog and
coverage suffix cells. The historical strict-order delivery repeatability is
manual while #413's permitted publication schedules are reconciled. Each clean suffix runner installs
the frozen dependency graph and then runs the bounded `pnpm check:artifacts`
preparation declared by the shared stage algebra, so package `dist` trees exist
before coverage or another suffix stage consumes them. This preparation does not
rerun the structural preflight. Those cells use bounded fail-slow concurrency,
so one ordinary failure does not cancel independent cells. The quality aggregate
reports every expected cell, including rows that are missing or unproven, and
the separate formal aggregate remains independent of the quality suffix.
On a failed suffix cell, CI also uploads its complete retained child logs as a
one-day diagnostic artifact. The portable stage envelope still owns the verdict;
the extra logs supply test assertions and stack traces that its short stage log
and failed-file inventory cannot show. This changes CI evidence retention only,
not Dalph runtime behavior or quality outcomes.

When the hosted quality aggregate reports more than one independent defect,
repair every reported defect before submitting the repaired candidate C2. The
earlier C evidence remains diagnostic evidence for C and cannot qualify C2.

The aggregate reports setup-inclusive time to first actionable failure and
total makespan. Historical [same-candidate serial observations](https://github.com/dearlordylord/dalph/issues/396#issuecomment-5750976052)
were 117.940 seconds for delivery repeatability and 72.991 seconds for the
recorded catalog; [coverage was 198.112 seconds](https://github.com/dearlordylord/dalph/issues/396#issuecomment-5750857362).
Their 389.043-second sum is a reference for independent work, not a current
hosted baseline or a promised parallel saving; compare complete hosted attempts
with their queue, install, and upload costs.

Hosted CI keeps its documentation-only quality classification. Its separate
formal classification compares the exact event base-to-head paths with the
generated hosted-formal input projection. That projection follows executable
model-conformance adapters through their TypeScript-resolved repository import
closure; the non-model workspace source-resolution control remains outside it. Unaffected changes retain the
required formal check as a lightweight successful not-applicable result.
The classifier reads exact committed root `package.json` contents at Base and
HEAD. A change solely to `scripts.test:formal:controls` adds or changes a
structural control without changing Quint inputs, so that package path alone
does not start model proof. Dependency, Quint command, other package, or
unreadable comparison changes still require formal proof. The classifier itself
remains a governed formal input.

When required, freeze the candidate and run
`pnpm check:all --candidate=<base-sha>`. No prior stages are credited. The runner
records formal relevance from the candidate's formal-input projection but does
not execute Quint. Missing Git or projection evidence still fails before
application qualification. Explicit standalone `pnpm check:quint` runs the
local formal profile when requested; CI keeps its own formal proof.

The optional unused-file/export graph and the project-wide Effect pass build the
entire program; use repository commands, not per-file substitutes.
