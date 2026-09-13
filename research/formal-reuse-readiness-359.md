# Formal verification reuse readiness: #359

A developer preparing #360 first reads published and local Git refs, checks that
the guarded verification work is integrated, compares its source with the
accepted reference, and checks the selected checkout's installation. Source and
installation readiness are proven below. B1 is complete for the exact selected
baseline; this report does not prove the complete #359 → #360 → #361 → #362
feature sequence or release readiness.

This is a documentation-only readiness record. It changes no Dalph runtime or
verification command behavior. No formal checker, executor session, GitHub
claim, or Dalph journal event was started by this source inspection. Crash and
checker retry behavior do not apply: rerunning these read-only checks refreshes
the evidence and publishes no reusable verification success.

## Governing accepted decisions

- [Readiness ticket #359](https://github.com/dearlordylord/dalph/issues/359).
- [Approved amended specification #358](https://github.com/dearlordylord/dalph/issues/358#issuecomment-5649238628).
- [Accepted command and evidence contract #357](https://github.com/dearlordylord/dalph/issues/357#issuecomment-5649197858).
- [Accepted scope #356](https://github.com/dearlordylord/dalph/issues/356#issuecomment-5649088977).
- [Baseline preparation evidence #355](https://github.com/dearlordylord/dalph/issues/355#issuecomment-5649010347).
- [Completed decision map #354](https://github.com/dearlordylord/dalph/issues/354).

The chronological scenarios and full feature obligations remain in those
accepted issues. This report does not amend their rules or replace later
execution, overlap, failure, handoff, and measurement evidence.

## Exact source provenance

Inspection on 2026-09-12 found the following refs in the shared Git repository:

| Git fact | Observed value |
| --- | --- |
| Local `master` | `990148ff20b0636f2428210973b5b80920e5a2df` |
| Recorded published `origin/master` | `990148ff20b0636f2428210973b5b80920e5a2df` |
| Integration checkout `HEAD` | `990148ff20b0636f2428210973b5b80920e5a2df` |
| Accepted exact reference | `990148ff20b0636f2428210973b5b80920e5a2df` |
| Required guarded commit | `754d628136f92c7743222894d5fde0422b153b47` |
| Selected integration checkout | `/workspace/typescript/dalph-worktrees/integration-formal-reuse-359-362` |

The parent orchestration owns the upstream refresh; this inspection reads the
resulting refs and does not independently claim that reading `origin/master`
performed a network refresh.

Executed source checks:

```text
git rev-parse HEAD master origin/master
# All three lines: 990148ff20b0636f2428210973b5b80920e5a2df

git merge-base --is-ancestor 754d628136f92c7743222894d5fde0422b153b47 HEAD
# exit 0

git diff --quiet 990148ff20b0636f2428210973b5b80920e5a2df master
# exit 0
```

The approved reference and selected source are exactly equal, rather than a
mechanically equivalent successor. There is no relevant source-contract diff
and no specification amendment is needed for this baseline. Within `scripts/`,
`package.json`, and `.github/workflows/ci.yml`, the guarded commit to accepted
reference changed only `scripts/gate-input-observer.py` and
`scripts/gate-resume-inputs.test.mjs`; these are already included in the accepted
reference, not newly proposed changes.

The repository root remains bare. This inspection did not reset it, change
`core.bare`, repair conflicts, change another agent's files, or integrate other
session work.

## Scenario-to-evidence mapping

| Scenario | Concrete required result | Current evidence and remaining work |
| --- | --- | --- |
| B1: guarded work has integrated | Developer reads upstream/local refs, compares guarded source, then resolves installation links. #360 begins only with one exact coherent baseline. | `confirms integrated guarded baseline and coherent installation before implementation`: ref equality, ancestry exit 0, empty source diff, supported Node/pnpm versions, frozen-install exit 0, and complete link census prove the source and installation portions. Upstream refresh evidence belongs to orchestration. B1 is complete for this selected checkout. |
| B2: guarded work or coherent installation is absent | Developer reports the exact missing prerequisite; no feature code or unrelated repair starts. | `keeps implementation blocked when baseline readiness is unproven`: no B2 failure was observed. The installation record retains the documented absent `dist` launchers as an explicit fact; those are expected on a clean source checkout. The earlier PATH and `/workspace`-only Apalache search was incomplete: the server report proves the prepared `0.56.1` launcher/JAR under `/home/node/.quint/apalache-dist-0.56.1/apalache`. Neither fact is silently repaired or treated as feature completion. |

These are read-only readiness acceptance checks, not passing feature tests.
Release remains blocked on #362, and #360/#361/#362 retain their declared
acceptance scenarios and blocking edges.

## Reusable source seams and preservation requirements

Paths and lines refer to the accepted exact source above.

| Existing source | Contract to preserve or reuse |
| --- | --- |
| `scripts/with-gate-slot.mjs:18` | Nested commands validate inherited run/worktree and open registration. A fresh command acquires the exact worktree `flock` before clone-wide admission. |
| `scripts/run-admitted-gate.mjs:37` | Existing worktree fence refuses launch; clone slots skip fenced slots and fail when every slot requires reconciliation. Run, registration and fences are written before spawning. Queue time is recorded separately. |
| `scripts/gate-custody-records.mjs:111` | Linux/Git worktree prerequisite; resolved Git common-directory store `dalph-gates`; exact resolved worktree determines lock/fence identity. Run validation checks host, worktree and slot association. |
| `scripts/gate-custody-records.mjs:35` | Durable atomic record publication, digest, host identity and record readers are reusable primitives. |
| `scripts/gate-registration.mjs:21` | Spawn intent precedes observation. Registration and parent/run identities are checked; stopped descendants and closed registration prove process custody. |
| `scripts/run-bounded-command.mjs:44` | Existing process-group bounded execution, accepted actual exits, signals, receipts, logs and termination evidence. An invocation-owned server must participate in this custody. |
| `scripts/gate-run-evidence.mjs:56` | Complete obligation inventory, command/receipt identity, actual accepted exit, group absence, log/artifact identity and stopped terminal custody. An unrelated successful exit cannot qualify complete formal success. |
| `scripts/gate-resume-inputs.mjs:76` | Fresh linked filesystem walk records membership, absence, kind, modes, bytes, authored link and resolved target. The helper is private and records cycles rather than rejecting them; share narrowly and enforce formal-specific cycle/external-target rules separately. |
| `scripts/gate-input-observer.mjs:7`, `scripts/gate-input-observer.py:2` | Cooperative Linux observation begins before hashing, covers ancestors/links/membership, drains events and fails on dirty events, overflow, watch loss or error. Ordinary edit-and-revert invalidates; mmap containment is explicitly excluded. |
| `scripts/gate-resume-inputs.mjs:335` | Observer startup, root re-resolution, complete initial snapshot and drain; final root/snapshot comparison and drain. Existing identity includes HEAD/index/full candidate/Git/configuration/environment and cannot directly replace the formal semantic identity. |
| `scripts/gate-resume-policy.mjs:17` | Quality prefix resume requires prior stopped/closed custody, complete unchanged observation, exact candidate/tool/environment identity, exact stage manifest, earliest passing ordered prefix and unchanged generated artifacts. Preserve this distinct identity. |
| `scripts/run-quality-gate.mjs:21` | Frozen candidate acknowledgement, canonical base resolution and admitted `check:all` resume restrictions. Candidate history/base rules remain independent from formal applicability. |
| `scripts/quality-gate-stage-policy.mjs:53` | Fixed preflight/qualification inventory including required MBT. Replace the formal-selection control slot with formal-reuse controls rather than dropping its control budget. |
| `scripts/quality-output-budget.mjs:1` | Shared successful-output arithmetic exists, but the `550` limit is repeated in runner, execution and evidence modules. Centralize the numerical policy while preserving aggregate accounting and full failure diagnostics. |
| `scripts/quint-gate-command-contract.mjs:4` | Complete 105-obligation profile: 15 typechecks, 46 tests, 23 sampled runs, 21 verifies. Independent legacy/fresh-task literal order oracles detect coordinated manifest/execution omissions. |
| `scripts/check-quint-models.mjs:51` | Manifest position/name/kind reservation. Tests add `--max-samples 1 --seed 153000+position`; sampled runs add exactly four threads. Materialize full effective arguments and explicit fallback sampled seeds for reuse identity. |
| `scripts/check-quint-models.mjs:77` | Child receipts, witness-output validation, fixed family scheduling and execution timing remain required. |
| `scripts/quint-gate-policy.mjs:9` | 750-second regression threshold, 720-second monotonic execution safety allowance, 5-second termination and 2-second group absence; hosted 16-minute cutoff and 210-second reserve. New outer/final validation allowances require measured justification. |
| `scripts/quint-temporal-gate.mjs:8` | Apalache `0.56.1`, prepared TLC artifact and positive/negative temporal verdict obligations. Preserve preparation and verdict checks. |
| `scripts/quint-evaluator-provenance.mjs:14` | Existing Rust evaluator provenance reporting; complete installed-byte identification remains additional formal-policy work. |
| `package.json:44`, `package.json:58`, `.github/workflows/ci.yml:165` | Local formal command currently invokes admitted complete checking; hosted alias forwards to it and workflow directly invokes it. Route both hosted alias and workflow explicitly to admitted complete execution when local reuse is added. |

The current quality observer tool inventory declares Git, bash, flock,
gitleaks, and optional oxlint. It does not yet explicitly observe the future
formal Java/Apalache/backend roots through final handoff. The approved S12
external-tool edit-and-revert control therefore requires a narrow coverage
extension, rather than assuming current candidate observation covers every
formal tool.

Formal applicability, candidate eligibility, and stopped process custody have
different facts and validation. Reuse the existing JavaScript/Python tooling
seams without replacing quality candidate identity with formal identity or
adding Dalph runtime/journal state.

## Installation status

The installation agent inspected the selected integration checkout on
2026-09-12 and recorded the complete evidence in
`.scratch/formal-reuse-readiness-install.txt`:

- Checkout `integrate/formal-reuse-359-362` is at exact `HEAD`
  `990148ff20b0636f2428210973b5b80920e5a2df`, with no tracked changes from the
  installation.
- Node `v24.20.0` and pnpm `10.29.3` match `package.json`; the local workspace
  uses lockfile version `9.0` and Quint `0.32.0`.
- The bounded command
  `timeout --foreground --signal=TERM --kill-after=20s 300s pnpm install --frozen-lockfile`
  exited 0 in 21.1 seconds. It covered all five workspace projects, added 469
  packages from the configured pnpm store, and completed the `prepare` patch
  verification.
- The recursive checkout symlink census found 1,385 symlinks, with zero
  unresolved targets and zero targets outside this checkout. All seven
  `@dalph/*` workspace links resolve to the selected checkout's packages, and
  the local executable wrappers resolve under its `node_modules/.bin`.
- Java `17.0.18` is available at the configured local JRE path. The direct
  `apalache-mc`/`apalache` PATH lookup was empty, but the earlier `/workspace`-
  only search was incomplete: the prepared Apalache `0.56.1` launcher and JAR
  are available under
  `/home/node/.quint/apalache-dist-0.56.1/apalache` as proven by the server
  report. The formal probe must preserve that exact tool provenance.

The three missing `@dalph/dalph` `dist` bin launchers were the documented
clean-checkout warning during install; building package artifacts belongs to
the implementation and artifact checks. Versions and lockfile equality alone
do not prove the installed-byte identity that #360 owns. B1 is therefore a
complete readiness prerequisite for this exact baseline, while #360 still owns
the complete formal identity and observation machinery. No checker/server
behavior, performance, complete feature gate, or installation-byte identity is
claimed by this document.
