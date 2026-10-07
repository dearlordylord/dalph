# Remote publication acceptance at the integrated candidate

Dalph publishes exact candidate M to its pinned remote endpoint/ref before local
promotion and tracker completion. This report reconciles
[#383](https://github.com/dearlordylord/dalph/issues/383) against planned Base
`01fbaf48f2e300280ee6b57d41d7e39454f1d678` in worktree
`/workspace/typescript/dalph-383-acceptance` on 2026-10-07. The accepted
[chronological scenarios and test mapping](scenarios/direct-remote-publication.md#scenario-to-test-mapping),
including the eight grant rows, remain normative. Closed children and aggregate
passing totals do not establish acceptance.

This attempt changes verification fixtures and adds a composed test. It preserves
verified Base-read identities in the hermetic qualification validator, repairs a
page observation fixture's renamed `graphView` field, and tests human early
closure through ordinary production Run reconstruction. It also refreshes the
existing MBT manifest/corpora after a prior scheduler input change. These changes do not
alter the regular Dalph workflow, remote push policy, tracker authority, journal
schema, models or operation ordering. Production fixtures are checked through the
rebuilt CLI; they are not substitutes for live provider observations.

## Evidence and candidate binding

The checked-in [named-result manifest](evidence/issue-383-retained-results.json)
indexes 345 passing ordinary cases across 27 owners by primary-log line, test
name and source hash. It also records historical formal commands, named positive
and negative results, receipt log hashes, unchanged model-family source hashes,
and this attempt's focused logs. Local primary paths retain execution details;
this manifest is a boundary-specific record, not a new full qualification.

| ID | Result and source binding | Limit |
| --- | --- | --- |
| R7 | Ordinary run `7ad45ef1-aed5-46bb-beb9-8bbe770f955c`, candidate `7f2799b6ab95649494bfddca532130954d60e07a`: 5,368 passed, one failed, 72 skipped. Primary log digest `c5eef23e3fa2f40d3ac2322cb178996368cf0e0c4eff349649bc7d6660742ae7` matches its receipt. Reconstructed 1,966 tracked inputs match recorded source digest `ea8c674b78bcac750807fcfe41670b2fdecf5437aac73b93adc50c2920d28ec9`; custody stopped and source unchanged. | The overall gate **failed**. Its unrelated gzip property oracle was repaired at `571797dca` and checked separately. Only the individually passing cases below are retained. |
| C383 | Rebuilt `pnpm test:integration:publication`: **five passed**, including actual CLI S1, publication/promotion/close/finality/cleanup chronology and later dependant Begin. Hermetic qualification source: **36 passed**, including accepted Base-read identity and refusal of a foreign identity. New S8 human early closure: **one passed**. Fresh typecheck passed. | Current controlled processes and real bare Git; no new hosted provider journey. Initial S1 failed because the qualification validator dropped an already verified operation identity; the focused regression and rebuilt S1 pass after repair. |
| P383 | Affected production and page HTTP files: **34 passed, one timeout**. Existing `reconciles a lost Begin to executing work without sending another command` exceeded its 10-second deadline while typecheck was also running. The isolated case passed in 448 ms; R7 had also passed that unchanged case in 208 ms. | The file invocation remains failed. The isolated pass establishes the boundary under that invocation; it does not establish the cause of the timeout or erase it. No timeout increase or full-suite repeat. |

Between R7 and this planned Base, regular production core sources and the
dependency lock are identical. The complete changed package list is recorded in
the manifest: dashboard browser code, page observation/test, and the gzip test
oracle. Browser rendering changes do not interpret publication or tracker
commands. This attempt changes the qualification validator and tests/fixtures
listed above; C383 checks its composed CLI consumer and P383 checks the page
consumer. Retained ordinary owners therefore keep their individually passing
verdicts, without claiming the new tree passed the old complete gate.

F389's 24 accepted-result, integration-finality and batch-grant model-family
files, including their imported family modules, are unchanged. The manifest
verifies 36 relevant child logs against their receipt hashes and preserves each
command's actual mode and exit. This is historical model evidence, not reuse of
cross-worktree formal certification inside an ordinary gate. Runtime conformance
is a separate obligation because its drivers changed after Q389. The exhaustive
batch/finality projection remains [#408](https://github.com/dearlordylord/dalph/issues/408);
deterministic and sampled results do not establish that exhaustive follow-up.

### Historical executions retained at their original scope

| ID | Primary evidence inspected and exact scope | Limit |
| --- | --- | --- |
| Q389 | `/tmp/dalph-389-passed-gate-status.json`, run `9905bc9a-d4d4-4751-b80a-5dd903e84844`: qualification passed, custody stopped, root command exit 0. Candidate `b4851ff5b8f2f14a6a1b8222800edb84d9bd20c3`, Base `8df1894de41a85bb94305f018248a582929ed888`; input digest `f973f4dc49c3340838c9d81666ded91bdbb820fb1b2cb1b970215c81c1f0def7`. The retained root log is named in the receipt. | Passed historical qualification, not a blanket S1–S8 verdict. [Named public-entry mapping](scenarios/direct-remote-publication.md#389-public-qualification-test-ownership) supplies the boundary assertions. Public cases reconstruct hosts in process. |
| F389 | `/tmp/dalph-389-formal-live-status.json`, run `ba97d4ea-3f53-4d8f-8a1b-1b6efa04424b`: root formal command exit 0, qualification passed, custody stopped; input digest `4b72b375ac9768a9322e8d5fb78be1ff6b98b056fd345ce12ed5da1d2d88aaae`. Same source digest as Q389: `abfb24e442137dae6f070d6c5a431b5bdccb7e77e53edb16a965d2b9420d9430`. | Receipt Base is `9101bcd7a6b44c5be1768b7a7c2bbcb1a4195759`, distinct from the full-gate Base; preserve both. Expected negative-control exits and server termination are not failed proof obligations. Formal evidence does not prove native transports or current candidate bytes. |
| L388 | `/tmp/dalph-388-s1-20261001-0328z-r1/acceptance-report.json` and `journal-export.json`; source `6b9900ee007f3e0bbb30fee60fdfe82c7d2aabf9`, Source Base `d8e2fecf4b441ce983452b9f1f01956f6edc8d4d`, target Base `c18b6c9f23eaefbdff9f020e0dd29b6a4f49fd17`, C `f8162146494cb4c6f9b72e6ff10ccbfd38d0a4c7`, M `b604db3aa0acda029075e18b91a7cdea81a7f35c`. | Passed historical hosted S1, one disposable GitHub task and Codex execution. [Full identities and chronology](ISSUE-386-ACCEPTANCE-AUDIT.md#hosted-s1-workflow-acceptance--2026-10-01). CLI exit 1 at app-server close; no crash/race/grant journey or dependant in this one-task execution. |
| L414 | [#466 retained native graph observations](https://github.com/dearlordylord/dalph/issues/466): CLI source `77c81ba4de4339d1b7d537e458fb62a3bfa62881`; target remote `1b4b855680675bb170c3baea50f3b70b3fe7b789`; five tasks delivered and independently CLOSED/COMPLETED. Retained root `/workspace/dalph-dogfood/414-graph-run-20261007/`. | Ordinary live publication/tracker delivery corroboration only. Task totals do not prove per-row crashes, grants, races, exact later graph release or Run termination. That host later failed handshake and graceful Exit; forced stop is not graceful success. |
| H466 | `host-hang-evidence/acceptance-ledger.json`, `submit-result.json`, `scoped-review.md` under L414 root: candidate `893505ffb2bfc9a04dc4f4342feb12070dddf649`, review Base `1b4b855680675bb170c3baea50f3b70b3fe7b789`, check:submit exit 0. Review records public retained-prefix replay with/without watch, one termination and unchanged protected delivery counts. | Tracker #466 is CLOSED as observed 2026-10-07. Repair evidence is separate from the original failed host. With-watch replay reports typed timeout exit 3, resource finalization 6.223s; no-watch exit 0. This does not turn original L414 Exit into a pass or qualify all publication cuts. |
| G386 | [Candidate-specific grant audit](ISSUE-386-ACCEPTANCE-AUDIT.md#scoped-review-closure), original candidate `8cd92c9247607f6633cf8544a64867e6c820c01a`; follow-ups `53158090c`, `49bce46ab78c7d3a8dd81743e4d735423f5b6896` and named B3/B4 results. | Historical focused controlled/model/conformance evidence. B1–B5 closure is boundary-specific; none supplies a full qualification of current Base. The historical report retains earlier failures and their repairs. |

## Scenario row ledger

**Passed** means the named owner proved that boundary at the recorded candidate,
with the source binding above or a current focused consumer check. Native means
real Git or processes; it does not mean a hosted provider. Memory/SQLite reopen
and controlled host reconstruction are distinct from native process death.
Every owner below resolves to individual passing names and log lines in R7's
manifest; the normative scenario mapping specifies the assertions and cuts.

| Normative row | Evidence and decisive result | Scope |
| --- | --- | --- |
| S1 fresh delivery | C383's CLI S1 and R7 `admission.test.ts` pass. Exact M reaches the pinned branch before promotion, tracker confirmation, per-attempt finality, physical cleanup and later dependant Begin. | Current built CLI, controlled tracker/executor and real Git. L388 supplies the one disposable hosted journey separately. |
| S2 competing head at three placements | R7 `hermetic-mvp`, `automatic-successor-real-git-safety`, `automatic-successor-session`, `automatic-successor-authorization-recovery` and `delivery-proposal-routes` cases pass. Same C, one task Begin, exact parents, retained responsibility, bounded sessions and no duplicate successor. | Controlled composition plus native bare-Git safety; races retain the observed ref and do not imply divergence without ancestry. |
| S3 repeat and descendant proof | R7 `direct-publication`, `direct-publication-command` and parser cases pass. Same endpoint/ref and exact M proof; non-force bounded push, same candidate reuse, no extra refs/tags or credential diagnostics. | Native Git/parser boundary; no inference from local remote-tracking refs. |
| S4 initial and later exhaustion | R7 `protocol-engine`, `hermetic-mvp` and `batch-grant` cases pass. Third session/intent exhausts the original allowance, committed unsent intent consumes it, and one exact grant authorizes another bounded batch without resetting ordinals. | Controlled bulk branches; grant subrows below remain distinct. |
| S5 publication, promotion and completion crash cuts | R7 initial `recovery`, promotion `safety-recovery`, `completion-task-protocol` and native/controlled sender-custody cases pass. Intents precede uncertain effects; recovered sends reconcile stopped custody; promotion and close keep independent acknowledgements. | Initial publication matrix covers memory and reopened SQLite. Native sender-host death is separate from controlled promotion/close reconstruction. |
| S5/#387 journal-read failure | R7 `integration-delivery-action-adapter` cases pass: journal read failure retains the owning responsibility and starts no unproved later effect. | Ordinary Run adapter; raw provider diagnostics stay outside history/status. |
| S5 successor H3 refresh | R7 `automatic-successor-baseline-recovery` cases pass. Exact H2-to-H3 intent survives stop-before-CAS; ResponseDeadline retains it; later reconciliation performs one CAS without another read or session. | Both stores and native Git safety have separate mapped owners. |
| S6 configuration and authority | R7 admission, adapter, resume and nine public control cases pass. Changed destination/configuration rejects before work; denied/throttled or incompatible authority retains exact C/session/claim and allowance. | Throttled mutations are never retried. A compatible retained head remains the normal successor frontier's responsibility. |
| Initial catch-up S5/S6 | R7 Git characterization, baseline recovery/state and real-Git successor safety pass. Unoccupied proven-behind target alone may advance; checked-out, dirty, symbolic, backward and raced targets preserve files/index and exact evidence. | A ref race is `CatchUpChanged`; a failed CAS is not ancestry proof. |
| Initial baseline cutoff S7 | R7 `direct-publication-cutoff` cases pass. Pause/Exit preserves the exact unresolved observe/catch-up intent and forbids the next Git boundary; produced results persist before release. | Controlled lifecycle cuts through the production one-boundary engine. |
| S7 publication/recovery Pause and Exit | R7 production, publication composition and adapter cases pass. Receipt/replay during Pause starts no forward work; both-store PauseAfterReceipt/ExitAfterReceipt retain exact work and forbid later push/session/finality. | Original L414 graceful Exit failed; H466 is separate repair evidence. Its with-watch typed timeout remains a timeout. |
| S8 fresh completion premises | R7 production, completion and state cases pass; P383 retains current affected production results. Dependency, revision or foreign claim prevents close/finality/cleanup; lost response uses exact completion lookup before retry. | Publication proof never supplies current tracker permission. C383 adds the distinct human-closure composition below. |
| Public recovery | R7 nine public-entry acceptance cases, publication composition and resume pass. Exact request replay is idempotent; changed body, Pause, policy denial, throttle and custody refusal preserve authority and allowance. C383 separately exercises actual CLI subprocess transport. | In-process host reconstruction does not become native transport or live-provider evidence. |
| S1–S8 forbidden paths and model chronology | R7 completion/state/successor/custody negatives and unchanged F389 named obligations pass: wrong M/target, missing proof, unsafe mutation, duplicate grant/successor, ordinal reset, early termination or dependant release are forbidden. | Current model-to-runtime replay is recorded separately below; formal mutants are not runtime transport tests. |
| One real disposable hosted S1 task | L388 passed the workflow boundary: exact PushApplied ordinal 1, independent remote head/parents, CLOSED/COMPLETED task, finality, cleanup and termination. | Historical hosted source retained below; CLI close exited 1. No fresh live journey or clean CLI exit is claimed. |

The hosted criterion asks for one disposable journey, not a new journey for each
Base. L388's direct-publication Git adapter, command and parser bytes are unchanged
at this Base. The ordinary CLI composition is checked currently by C383; the
intervening `node-main.ts` change routes diagnostics rather than push/proof policy.
Together these retain the historical live boundary without inventing a current
provider execution or weakening the accepted transport criterion.

## Original tracker criteria and accepted amendment

| Original criterion | Disposition and exact evidence |
| --- | --- |
| S8 genuine later contrary remote observation | **Deferred trigger by the accepted 2026-09-20 amendment.** The scenario explicitly preserves the no-extra-read rule and says the supported workflow has no later observation before close. A new rewrite-detection trigger is follow-up work. F389 tests the conditional model action, while malformed proof tests exercise correlation; neither is claimed as observing a rewritten production remote. This original requirement remains visible and is reconciled with the accepted amendment rather than silently waived. |
| S8 conclusive versus uncertain proof after restart | **Passed controlled boundary:** R7 recovery/resume cases retain conclusive proof with zero remote work; ambiguous sends prove stopped custody and observe/reconcile before a later ordinal. Promotion and finality continuation have their own tests. Grant-only evidence never supplies proof or tracker permission. |
| S8 applied versus unapplied lost close | **Passed controlled boundary:** R7 completion tests independently confirm applied success without another request, advance after exact durable NotApplied lookup, and refuse retry solely because a task looks open. Production composes the NotApplied continuation and later finality/status. |
| S8 human early closure | **Passed current composed boundary:** C383's `S8 human early closure retains unpublished responsibility without proof or Run termination` reconstructs a SQLite Run with two denied publication intents and an externally completed task. Ordinary Run may read admission, but makes zero pushes, executor/integrator commands, promotion/close calls or cleanup; no publication proof, completion acknowledgement, finality or termination appears, and exact claim/candidate responsibility remains. External lifecycle cannot manufacture publication. |
| S6 concurrent branch deletion | **Passed native Git boundary:** R7 adapter `recreates only the named branch when it is deleted after admission and before an ordinary push` preserves plain non-force push semantics without extra ref/tag updates. An observed missing branch still retains a wait. The contract promises no atomic no-recreation guarantee. |

## Grant subrow ledger

All eight accepted grant rows retain distinct owners. R7's manifest records
individual runtime results; F389 records actual formal commands and mutants.
Controlled bulk coverage is accepted here; a live grant fixture per branch is
not required.

| Grant row | Passing evidence and boundary |
| --- | --- |
| Initial/later batch bounds | R7 protocol-engine, automatic-successor-session and F389 batch tests: three sessions/intents, committed unsent intent, fresh exact O2 grant, monotonic ordinals. |
| Identity and replay | R7 batch-grant rejects wrong Run/Q/position/commit/candidate, superseded O and foreign quarantine; same or different request IDs cannot mint a second batch. |
| Post-Unpause outcomes | R7 batch-grant/production separately prove already-published M with zero push/session, reusable M, same-C successor, and retained authentication/throttle/custody/lineage/permission/claim waits. |
| Independent progress | R7 hermetic MVP proves unrelated target progress while one bounded grant runs; fourth same-C successor requires the exact third-session grant and keeps one task Begin. |
| Grant/intent recovery | R7 batch-grant/successor-session and current conformance own precommit failure, SQLite commit-lost-ack, fixed fourth session and applied push lost response. Exact replay preserves one grant/proof/Begin and ordinal four; current conformance verdict is recorded below. |
| Pause and Exit | R7 production proves paused receipt/replay makes no forward effect before Unpause, then refreshes control/destination/graph/claim/Git/custody. Failed graph, terminal/foreign claim and F389 Exit-before-append/after-commit branches retain work. |
| Proof and finality | R7 grant-only prefix returns ordinary `RunMustRemainActive`, with zero `IntegrationFinalitySettled`; separate exact proof/promotion/tracker/cleanup owners establish later settlement. |
| Formal chronology | F389 named paused-grant/replay/fixation/intent-crash/post-Unpause positives and guard-removal negatives pass on unchanged model closure. Duplicate grant, budget reset, task restart, receipt-as-proof and Pause/Exit mutants remain explicitly checked. Exhaustive batch/finality projection is separate #408. |

## Current conformance, submission and review closure

**Parent disposition: acceptance complete under the accepted amended scope.**
Current accepted-result integration and integration-finality corpus replay passed
all **16 tests**, with no skips, in 101.82 seconds. The manifest records each
name/log line, both driver source hashes, corpus identities and primary log hash.
These results close the model-to-runtime proof gap independently of F389.

The first replay invocation had 14 directed passes and two input-guard failures:
the manifest retained the old `vitest.config.ts` hash after R7 changed ordinary
project ordering. Derivation identified this single difference; models, driver
expressions, tools, options, seeds, sample/trace/depth budgets and dependencies
were unchanged. The manifest was refreshed explicitly and all 39 pairs genuinely
regenerated; no old receipt was relabeled. Generation passed in 512.485 seconds
with 171,921,812 bytes and stopped-writer proofs for every generator group.
All 39 artifact pairs passed provenance/ITF validation, alongside loader/contract
controls: **27 passed, zero skips**. Only the two acceptance owner files replayed
the new data; the other 13 MBT files were not replayed. This does not claim a
complete corpus replay or frozen Integrator merge qualification.

The coherent application candidate passed required `pnpm check:submit` once:
production artifacts, **150 formal controls**, fresh typecheck, changed lint,
full lint census and **49 memory-cassette files / 506 passed / 21 configured
skips**. Subsequent changes are generated verification artifacts and evidence
documentation; their focused contract/consumer checks replace a repeat of those
unchanged application stages. Documentation links and whitespace are checked
separately.

### Standards review

No blockers or actionable smells. The verified identity set remains strict,
including the foreign-ID refusal. Early closure retains the exact prefix,
claim/candidate and ordinals without external forward commands. The provenance
repair's manifest, 39 actual receipts/corpus hashes and stopped-writer proofs
match the ledger. Historical failed executions remain failed.

### Specification review

No blockers in the implementation or row reconciliation. All 15 main and eight
grant rows retain their distinct owners. Current CLI, human-closure composition,
conformance replay and submission results close the identified proof gaps.
The contrary-observation trigger retains its accepted follow-up disposition;
L388 retains its historical hosted workflow scope and failed CLI close.

Both axes report zero remaining scoped findings. The unrelated production
file-run timeout remains visible; its isolated pass does not diagnose the cause.
No new full candidate qualification, exhaustive #408 proof, complete MBT replay
or fresh live provider journey is claimed. This report establishes acceptance;
the tracker separately owns issue disposition.
