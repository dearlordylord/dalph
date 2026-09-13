# Release-candidate formal-reuse qualification report

A developer can now run the normal handoff after a complete formal success,
reuse its original stopped evidence, and still obtain independent application
checks and final formal applicability validation. The complete #359 → #360 →
#361 → #362 implementation is locally qualified at the frozen source below.
This report records the final acceptance; the [delivery chronology](formal-reuse-delivery-359-362.md)
retains earlier failed and incomplete checkpoints.

The frozen candidate is `49dc0dad73a41e30581be866018fda1bad55111e`, based on
`9a76772a7bcf2548767968906cde7693aba6757a`. This report concerns repository
verification tooling only. It changes no Dalph tracker, executor, Git
integration, workflow journal, or runtime behavior.

## Chronological position

The first local attempt used the former 720-second execution ceiling, passed
55 of 105 commands, and timed out. The user/maintainer then authorized the
longer local policy and diagnosis or repair of any remaining Quint problem.
That amendment permits a longer local measurement; it does not turn the failed
attempt into success, shorten the complete profile, or waive terminal evidence.

Master commit `8fdcad06ca9c55eb3d3fcdd805579e3864d7bfb8` temporarily pauses
automatic MBT in ordinary quality tests. The current Vitest configuration
excludes `packages/**/*.mbt.test.ts` from ordinary and coverage selection,
retains the capability-registration audit ownership and coverage exclusion,
and leaves hosted formal verification as a separate complete `check:ci:formal`
profile. This is the #363 routing change; it is not removal of the 105-command
formal profile.

The earlier ambient and stable-path F/R measurements were respectively
`548.696879 / 5.013628 / 6.169981` seconds and
`731.605537 / 4.821954 / 6.247266` seconds for F/median-R/maximum-R. The
`index.lock` and temporary `arg0` fail-closed attempts, the five test and evaluation-harness
`check:all` failures, and the preceding candidate measurements are linked in
the chronological report and earlier draft rather than repeated here.

The three repairs in the final source are:

1. The procfs process-view fixture accepts an injected native service and
   represents a process that disappears between `/proc` enumeration and its
   environment read as unavailable. It is the app-server protocol fixture
   repair and does not cover double-diamond chronology.
2. The authored-runner chronology bug retains the exit ordinal and rejects
   omission of the required actual activation return before its owed next
   graph. It repairs both double-diamond chronology cases.
3. The two stale tooling assertions now bind the current profile-driven
   deadline call, `createQuintGateDeadline({ startedAt, allowanceMilliseconds:
   profile.policy.safetyTimeoutMilliseconds })`, and the current
   ordinary/coverage MBT exclusions. The capability test keeps audit ownership
   and its coverage exclusion; hosted 720/750-second and 16-minute contracts
   remain asserted.

The graph-position/cause representation review correction is also in the
candidate; it was rechecked with zero remaining findings. Twenty-one focused tests plus
typecheck, lint and complexity checks passed after that correction. These are
source and review facts, not a change to Dalph runtime behavior.

## Candidate identity and complete profile

The admitted fresh run is `bd21a89e-5a78-4926-b86c-f40253631b8e`, attempt
`680fcf88-3662-4328-9b3b-9f9c46af4db0`. Its exact original evidence record is
`/workspace/typescript/dalph/.git/dalph-gates/runs/bd21a89e-5a78-4926-b86c-f40253631b8e/formal-attempts/680fcf88-3662-4328-9b3b-9f9c46af4db0.json`.
All ten warm records point to that same path.

The production audit of [audit.json](../.scratch/formal-reuse-qualification/release-candidate/audit.json) and [audit.md](../.scratch/formal-reuse-qualification/release-candidate/audit.md)
passed the saved referenced-success and all eleven run-reader checks. The
recorded identity values are:

| Identity fact | Recorded value |
| --- | --- |
| Source digest | `61478ba93cbfb9d4238cad30f2d494b91b3bdb806262f9077640e2ed29c1b289` |
| Tool digest | `8e5360399d71365cbf25a62ef50966cec23725ee6549c44ea4e6ac6d52140f37` |
| Formal input digest | `8081adf642b02caf2632cfcf128af6bbbe95517c91ca61b633009db7981c8969` |
| Environment digest | `78e814e42b19e2c264a7bd0e04a2846f812ee0a440009edd5b597dcb68497416` |
| Profile identity/digest | `5206378a45956eeed23036552fba728ae8724777ab28d9437521025fb4859f98` |
| Recorded custody input digest | `d66c0eaef45f5ee6ad40b29c63ac8da0c1cbb86803d6837e6413dd491b1ca74a` |

The canonical profile contains 105 commands: 15 typechecks, 46 tests, 23
sampled runs and 21 verifies, plus 42 scheduling/provenance steps. It recorded
466 witnesses, clean expected TLC and the expected mutant exit code 1. The
source/tool membership, modes, links and bytes matched at audit time across
25,551 entries and 20,705 files. Every owned process group was stopped.

The record identifies Linux aarch64 with glibc 2.36, Debian-12 runtime policy,
Node v24.20.0, pnpm 10.29.3, Quint 0.32.0, Apalache 0.56.1, Rust evaluator
v0.6.0, Temurin Java 17.0.18+8 and Python 3.11. Stable preparation removed
`/home/node/.codex/tmp/arg0/codex-arg04iGqHY`; node, pnpm, git, gitleaks, Java,
Python, bash and flock resolved to the same executable paths before and after
preparation. The complete resolution is retained in
[frozen-candidate.json](../.scratch/formal-reuse-qualification/release-candidate/frozen-candidate.json).

## Fresh and warm measurements

The [release summary](../.scratch/formal-reuse-qualification/release-candidate/summary.json) records one complete fresh
`pnpm check:quint` and ten ordinary unchanged-input reuses. The fresh command
used 105 checkers and one owned server. Every warm command used zero checkers
and zero servers and retained the original evidence identity.

| Sample | Run ID | Seconds | Disposition |
| --- | --- | ---: | --- |
| fresh | `bd21a89e-5a78-4926-b86c-f40253631b8e` | 560.085394645 | executed, 105 checkers/1 server |
| warm-01 | `a0eb8354-67bf-4978-9fb3-93e30f4c5a32` | 4.801592298 | reused, 0/0 |
| warm-02 | `e2c4cbd1-7c0b-4a80-96b5-104b787bcbcb` | 4.854039254 | reused, 0/0 |
| warm-03 | `d9035e2f-d66b-419e-9f89-affcc8e64923` | 4.330996086 | reused, 0/0 |
| warm-04 | `271c7f0a-7620-4138-977c-1392c0e7c4d5` | 4.343192321 | reused, 0/0 |
| warm-05 | `d7f30c66-eb8d-47b3-9ca0-49fdcbb6dd71` | 4.324343564 | reused, 0/0 |
| warm-06 | `f5edb7c7-362a-4dea-bf8d-08258e345a4a` | 4.290766823 | reused, 0/0 |
| warm-07 | `19ac770d-64bd-4abe-8f13-804fe9a66304` | 4.296042115 | reused, 0/0 |
| warm-08 | `116a5e67-a9d2-4115-b000-8f3cb9e468d1` | 4.325951131 | reused, 0/0 |
| warm-09 | `23406820-2004-4eed-aac9-7e7905c627f4` | 4.327893828 | reused, 0/0 |
| warm-10 | `cf5c84d7-bbe3-4892-a1cd-9cd6776f70cb` | 4.395565859 | reused, 0/0 |

`F = 560.0853946451098s`; median `R = 4.3294449569657445s`; maximum
`R = 4.854039253666997s`; `F - median(R) = 555.755949688144s`; and
`1 - R/F = 0.992270027038093` (99.227% applicable-repeat savings). The
summary records `warmCheckerCount: 0`, `warmServerCount: 0` and
`sameOriginalEvidence: true`. The host was local, with recorded initial load
values 5.384765625, 6.08056640625 and 5.9296875; cache state was uncontrolled,
so these measurements make no hosted performance claim.

## Phase costs, bounds and headroom

Fresh metrics report 77.206ms tool resolution, 1.225ms evidence read,
550.889015257s shared helper execution, 79.856ms publication, and
558.526502846s acquisition. The fresh guard phases were 1.058927s observer
setup, 2.929815s initial snapshot, 3.421240s qualification and 42.315ms
observer shutdown. Owned-server readiness took 1.036963s and planned stop to
proven absence took 0.522518s. Fresh wall time was 560.085395s and the recorded
profile elapsed time was 548.904350s.

Across warm samples, metrics ranged as follows: tool resolution
37.657–55.480ms; observer setup 342.612–688.711ms; initial snapshot
1.634249–2.021357s; evidence read 71.028–77.772ms; qualification
1.565073–1.614354s; acquisition 3.699355–4.267591s; and total measured
3.722642–4.291844s. These are phase ranges; concurrent phase sums are not wall
time.

The authorized local bounds are 2,100s outer acquisition, 1,800s execution,
1,850s regression, 1,857s helper envelope, 30s final validation, and 5s
termination plus 2s process-group absence. The fresh metrics leave 1,249.111s
against execution, 1,541.473s against outer acquisition and 1,306.111s against
the helper envelope. The profile leaves 1,301.096s against the 1,850s
regression ceiling. Preparation, observer setup and input qualification each
have a 60s phase cap; the measured 3.421s fresh qualification is below its 60s
cap, and server shutdown is below 5+2s. Final no-checker validation has a
separate 30s cap, measured in the final handoff below. The experimental
measurement watchdog was fixed at 2,133s with a further 7s stop allowance
before invocation. The selected policy inventory is 116.5 minutes
before existing setup/termination overhead, within the 24-hour custody limit.
Hosted policy remains unchanged at 720s execution, 750s regression and a
16-minute formal-model job.

## Actual wrapper and gate evidence

The standalone wrapper integration in
[formal-integration-final-controls.log](../.scratch/formal-reuse-qualification/stable-path/formal-integration-final-controls.log)
passed 12/12 tests in 149.089333 seconds. The four actual-wrapper controls
reported the following results:

- omitted actual checker obligation: 104 checker events and no canonical
  success;
- same-version installed tool-byte change: 210 fresh checker events, then a
  warm reuse with zero checker/server launches;
- native observer overflow: warm reuse zero launches, forced run 105, exact
  `IN_Q_OVERFLOW` refusal; and
- external tool edit/revert after formal completion: both stage and final-drain
  phases made the quality wrapper refuse success.

The lower seam tests passed earlier and remain useful supporting evidence; they
do not replace these wrapper controls. The saved production audit passed its
record readers, profile census, custody and identity comparison. The independent
formal-profile audit and the final `pnpm check:all` passed. The final handoff
record below completes local acceptance alongside these controlled tests.

## Maintenance decision

Frozen-candidate maintenance accounting at `49dc0dad7`, excluding this
report and subsequent documentation updates, records tooling of 2,225 lines, tests of 3,154
lines, documentation of 837 lines, a 94-line pinned patch, and a net three lines
across package/lock/CI configuration. Maintained evaluation changes are 227 lines and are counted
separately. The maintenance decision is to retain the complete feature because
the measured applicable repeat saves 555.756s (99.227%) despite the tooling
cost. This is one fresh comparison, not a fresh-runtime distribution. Cache state
was uncontrolled, with no cold-host or contention experiment. The host had 12
available CPUs; admission was 42.339ms fresh and 32.764–39.609ms warm. Repeat
frequency remains unknown. Conservative whole-scripts and installed-tool
invalidation forced fresh runs during this work; preserving those boundaries
is an ongoing cost alongside observer, evidence, custody and pinned-client
maintenance. No overall productivity or hosted qualification is claimed. The
passing final handoff supports retaining this complete feature without adding
another optimization project.

## Scenario-to-test mapping S1–S14

Each row starts with the developer's concrete trigger and boundary, then names
the original acceptance test and file. Older focused results are detailed in
the [chronological report](formal-reuse-delivery-359-362.md).

| ID | Scenario event, boundary and required result | Original acceptance test and file; current evidence |
| --- | --- | --- |
| S1 | Developer starts with no success and invokes the complete formal command; admission, observed inputs, all obligations, stopped custody and atomic publication are required; partial exit cannot qualify. | `records complete formal success only after obligations and terminal evidence then reuses the original without launches` — `scripts/formal-gate.integration.test.mjs`; fresh record is complete and wrapper control passed. |
| S2 | Developer repeats unchanged inputs; the command rereads identity/evidence and returns the original timestamp with zero checker/server launches. | Same integration test's reuse half and `records complete formal success only after obligations and terminal evidence; reuses original evidence with enclosing custody open` — `scripts/formal-gate.integration.test.mjs`, `scripts/formal-success-evidence.test.mjs`; ten warm samples pass with the original path. |
| S3 | Developer changes formal membership, bytes, mode or link; fresh enumeration must reject the old identity and run the complete profile. | `reruns after input membership content mode or link changes` — `scripts/formal-input-policy.test.mjs`; input controls passed; `materializes the independent complete 105 obligations before any launch` and `profile omission substitution argument verdict scheduling and policy changes refuse checker launches` in `scripts/quint-effective-profile.test.mjs` prevent claiming unregistered obligations. |
| S4 | Developer changes unrelated application source or HEAD/index/base; formal reuse stays applicable while independent application admission remains required. | `retains formal reuse across unrelated edits without binding HEAD index or base` — `scripts/formal-input-policy.test.mjs`; quality handoff test in `scripts/formal-gate.integration.test.mjs` passed. |
| S5 | Developer changes same-version tool bytes or effective environment/policy; prior success must invalidate before checker launch or be rerun completely. | `same-version installed checker bytes invalidate actual reuse and run every obligation` — `scripts/formal-gate.integration.test.mjs`; 210 fresh commands then zero-launch warm reuse. |
| S6 | Developer presents missing, malformed or partial required evidence; the command reruns all obligations, while an optional diagnostic log alone preserves reuse. | `corrupted required evidence launches the whole profile while a missing optional console log preserves reuse` — `scripts/formal-gate.integration.test.mjs`; corresponding malformed/truncated/optional test is `scripts/formal-success-evidence.test.mjs`. |
| S7 | A writer edits and restores a declared input or the observer overflows; qualification must fail closed despite equal final bytes and force must not hide the error. | `native observer overflow refuses actual warm and fresh qualification` — `scripts/formal-gate.integration.test.mjs`; `rejects edit and revert at qualification: execution file edit revert`, `reuse membership create delete`, and `reuse link replacement` — `scripts/formal-input-policy.test.mjs`; exact `IN_Q_OVERFLOW` and phase refusal passed. |
| S8 | Two developers invoke in one worktree or linked worktrees; admission waits/rereads, inherited admission avoids deadlock, and clone capacity keeps records/servers separate. | `waits then rereads without duplicate formal launches and nested inherited admission does not deadlock`; `different worktrees obey clone capacity and execute separate complete profiles without sharing success or servers` — `scripts/formal-gate.integration.test.mjs`; wrapper integration passed. |
| S9 | An ambient server exists; the invocation launches and stops only its identified server, routes the child to it, and refuses readiness/ownership failure. | `uses and terminates only the identified owned server` — `scripts/quint-owned-server.test.mjs`; owned-server audit recorded one stopped server and no warm server launches. |
| S10 | A checker fails, times out, is interrupted or the parent crashes; no success qualifies, custody is reconciled before retry, and no partial suffix is accepted. | `failed interrupted and crashed attempts cannot qualify or bypass custody` — `scripts/formal-success-evidence.test.mjs`; controlled failure/custody evidence passed. |
| S11 | After success the developer forces a run or a publication crashes before/during/after rename; old success cannot return until complete stopped evidence is reconciled. | `failed force prevents fallback to older success and retry runs every obligation` — `scripts/formal-gate.integration.test.mjs`; `publication crashes before during and after durable rename accept only complete stopped evidence after reconciliation` — same file; both passed. |
| S12 | Normal handoff obtains formal evidence after preflight, retains the observer through application/final drain, and refuses post-formal external edit/revert. | `external tool edit and revert after formal completion rejects actual quality handoff` — `scripts/formal-gate.integration.test.mjs`; both actual phases refused, alongside the full-prefix handoff test. |
| S13 | Developer invokes with unresolved worktree custody or unsupported prerequisites; the command refuses before preparation, checker or server launch. | `unresolved worktree custody refuses the actual formal dispatch before any preparation or checker` — `scripts/formal-gate.integration.test.mjs`; `unsupported prerequisites never yield verified success` — `scripts/formal-input-policy.test.mjs`; both controls passed. |
| S14 | CI invokes hosted quality/formal entry points; formal keeps every obligation and hosted deadlines while quality keeps its current MBT routing/exclusion. | `exposes complete CI and independently runnable quality/formal subgates` and `uses the hosted regression budget with a distinct safety stop` — `scripts/quint-ci-contract.test.ts`; `keeps the exact combined exclusions out of ordinary tests and in coverage` — `scripts/capability-registration-quality-gate.test.ts`; focused repairs passed. |

## Final handoff and review closure

`pnpm check:all --candidate=9a76772a7bcf2548767968906cde7693aba6757a`
passed on the frozen implementation in **739.883 seconds**, run
`418b332e-3327-4e7f-a56a-f3901b8256f7`. Its [console log](../.scratch/formal-reuse-qualification/release-candidate/check-all.log)
and [outer result](../.scratch/formal-reuse-qualification/release-candidate/check-all-result.json)
are retained. Every preflight stage passed, including 93 formal controls and
55 capability-registration tests. The handoff reused the original
`bd21a89e`/`680fcf88` success with zero new checker/server launches in the formal reuse stage.
Preflight's existing broken-model negative controls intentionally launched two
installed Quint CLI checks in disposable fixtures; those are recorded
separately from the reused complete profile. All twenty
fresh-process capstone repetitions retained 1,010 occurrences and the accepted
order digest; Lab checks/build and the maintained catalog passed.

Coverage passed **3,917 tests in 359 files**, with 42 tests/four files skipped
under the retained configuration. Statements were 97.68%, branches 96.49%,
functions 96.93% and lines 98.16%; changed maintained-evaluation lines were
112/112, with no changed production lines in that coverage classification.
The evaluation chronology and omission tests retain their original assertions;
the [#337 scenario amendment](../docs/scenarios/issue-337-delivery-capstone.md)
maps the observed return and forbidden omission to those tests.

Final no-checker applicability validation took **2.629 seconds**, including
143.304ms of evidence reading and a 2.482s final snapshot/drain. That leaves
27.371s against the separate 30s allowance. The formal observer reported ready,
drained and unchanged with the original identity; the final validation did
not launch a new formal profile. Successful output was **451/550 lines**: 450 required-stage lines plus one
formal reuse line, each counted once, leaving 99 lines of headroom. Detailed
checker output remains in referenced evidence. The [handoff audit](../.scratch/formal-reuse-qualification/release-candidate/handoff-audit.md)
and [machine-readable audit](../.scratch/formal-reuse-qualification/release-candidate/handoff-audit.json)
validate all 19 required stages and 343 stopped obligations through the
production reader, including unchanged candidate observation.

Repeated domain/spec, architecture/connascence and standards reviews found no
remaining actionable issue. The graph-position/cause representation finding
was corrected by storing both in one optional record and rechecked. The four
missing wrapper controls were implemented and independently reviewed; lower
seam tests were not substituted for them. Earlier exploratory proposals and
rejected findings retain their reasons in the chronological report.

The [original approved specification](https://github.com/dearlordylord/dalph/issues/358#issuecomment-5649238628)
and [command/evidence contract](https://github.com/dearlordylord/dalph/issues/357#issuecomment-5649197858)
remain the governing requirements, with the explicit local timeout amendment
in the [qualification scenario](../docs/scenarios/formal-reuse-local-qualification-budget.md)
and master's #363 automatic-MBT pause described above. The [#359 readiness
record](formal-reuse-readiness-359.md), [input seam](formal-reuse-input-seam-360.md),
[owned-server seam](formal-reuse-server-seam-360.md), and every S1–S14 scenario
remain linked; no tracker issue or blocking
edge was modified. Hosted contracts are preserved by tests, not claimed as
live hosted qualification.

This documentation-only report follows the frozen measurements and handoff as
explicitly allowed by #362. It is outside the formal input boundary and changes
no implementation or tool bytes. The qualified implementation remains
`49dc0dad73a41e30581be866018fda1bad55111e`; the report commit does not manufacture
a new formal execution timestamp.
