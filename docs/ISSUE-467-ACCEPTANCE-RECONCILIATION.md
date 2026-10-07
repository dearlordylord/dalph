# Overnight graph evidence reconciliation

Dalph integrated the eight bounded outputs of [#467](https://github.com/dearlordylord/dalph/issues/467)
into published master `3d0c52151b0a2b3d1c639559366f5e0fb48b8b46`.
This parent audit consumes that exact planned Base on 2026-10-07 UTC. The bounded
output reconciliation is complete; the broader #345 and #383 defects remain
open. Source-issue dispositions below distinguish delivered work from missing
acceptance proof. Dalph owns publication, tracker updates and typed cleanup.
This report performs none of those effects.

This change adds documentation only: no executable, test, model, configuration,
workflow event, provider call, retry, cleanup or runtime result changes. Existing
chronologies remain normative. Unchanged application qualification is not rerun.

## Native tracker and Git observations

Fresh GitHub REST reads of #467's `sub_issues` and `dependencies/blocked_by`
returned exactly #468–#475, all closed. Each child's native blocked-by list
matched the accepted graph below, including #466. These are observed tracker
facts, not a persisted scheduling authority. Git resolves every accepted child
commit and its integrating merge as ancestors of the planned Base.

| Child | Exact native prerequisites | Accepted child commit | Integrated candidate |
| --- | --- | --- | --- |
| #468 | #466 | `237612ecde1f0f9ade42e156a65a5a87b867d2aa` | `98bc8a3265c06454a3cf566b6acb921ad7a28ca4` |
| #469 | #466, #468 | `f8450a62634f3ae43e28896013f5933946ca82bb` | `bb57c57cec1da60c8093e663f20ccbf242a6dfea` |
| #470 | #466 | `95758d11c8b4126809bb5b1c5d178c522044f1aa` | `72a197658092c2e65e902a15e898ec70264e3937` |
| #471 | #466, #470 | `3b98d9f8c0faa7c900cb902ecab91411bbab2da0` | `08fa36605900f9edb59fc4bdc79b07d51d64593f` |
| #472 | #466, #471 | `1747842bf486ea2dc985b97e4d4fadd02028c9b3` | `a66309d2a201afe23d22cf231a2cc3168e560d44` |
| #473 | #466, #472 | `b92baaf9d10829e0c33f1725c035a4201f31bf0a` | `b5b42d9d76c32f5b294d5d361186b6a61629bcad` |
| #474 | #466, #473 | `7a183a1a6c10152e8487d4b4ac6b51b22ddd152b` | `da34ab698aa01cf488aab254d06c569e5c896613` |
| #475 | #466, #469, #472, #473, #474 | `7d4f2b46437b9067b7d45ea45e23c9f510edf9a8` | `3d0c52151b0a2b3d1c639559366f5e0fb48b8b46` |

The eight retained accepted-result documents under
`/workspace/dalph-dogfood/night-467-20261007/evidence/` bind these child commits.
They establish reported results, not test verdicts. Native issue closure and
result envelopes alone never substitute for the boundary evidence below.
Additional host recovery #476 and secret-scanning #477 maintenance remain in
Git history; neither is silently counted as one of the eight outputs.

## Bounded outputs and primary evidence

| Output | Evidence inspected and disposition | Preserved limit |
| --- | --- | --- |
| #468 measurement | **Passed bounded measurement.** [Timing fixture and component evidence](research/commit-hook-timings/README.md) retain exact staged path, tool versions, hashes, stopped writers and fresh/warm spans. Complete invocations were 1.195/1.257 seconds; command/order, failure and cancellation controls are named there. | Prepared Linux arm64 reference, ambient caches; hook invocation, not full commit or cold install. The first incomplete timing capture remains negative evidence. |
| #469 measured target | **Passed bounded target.** Same measured executable hashes; real lint and staged-secret refusal [controls](research/commit-hook-timings/negative-controls.json) preserve both gates and exact cleanup. Both complete positive observations meet 30 seconds. | No optimization was justified or added. No daemon/cache or hardware-wide guarantee. |
| #470 inventory | **Passed inventory/provenance output.** [Corpus contract](development/mbt-corpus.md) enumerates 15 suites/39 lanes, exact models, semantic inputs, tools, options, witnesses and budgets, including non-ITF controls. | Inventory is not generation completion. Reverse-trace evaluator controls remain executable obligations. |
| #471 generation/loader | **Passed bounded generation and validated replay output.** [Generation evidence](development/mbt-corpus-generation.md#submission-qualification-2026-10-07-utc) pins source `87a897ebf2496ac32b07cb9b0bb3e1afe64a4476`, fresh all-39 generation, loader/inventory, fixture controls, check:fast and submission. Missing/stale/corrupt inputs refuse without self-healing. | Earlier 38/39, detached-generator custody and fixed-Base fixture failures remain historical failures, not credited artifacts. Integration requires regenerated exact semantic-input provenance. |
| #472 automatic wiring | **Passed replay-only migration.** [Migration evidence](development/mbt-corpus-generation.md#automatic-replay-migration-evidence-2026-10-07-utc) retains all lanes/options and zero generator calls, actual replay adapter comparison and missing/stale refusal. Hosted replay at final application candidate below confirms this boundary independently. | No required lane dropped; explicit generation is separate. Cancelled coverage supplies no qualification. |
| #473 names | **Passed bounded terminology output.** [Protected composition](ARCHITECTURE.md#protected-compositions) names `DeliveryGraphView`, `DeliveryPlanningCatchUp.awaitJournalPosition`, `DeliveryRelationInputObserver` and `DeliveryRuntimeObservationPublication.updateLatest`; [glossary](CONTEXT.md#language) distinguishes append, catch-up, view, evaluation and passive update. Fresh search finds no old three symbols in maintained packages/docs/scripts. Retained `delivered472-473-scoped-review.md` verifies exact delivered Git objects, all 39 fingerprints/receipts and no behavior change. | Source/integrity review is not application test qualification. Original #311's complete focused/check:fast/submission proof is not independently reconstructed in this parent audit. |
| #474 refusal/output | **Passed controlled acceptance output.** [Accepted fault/output mapping](scenarios/public-runner-failure-channels.md#controlled-unreadable-process-facts-during-public-recovery) ties actual ownership refusal, memory/private-filesystem custody, SQLite recovery and both built public cases to explicit assertions and dirty-stdout negative control. Retained `delivered474-scoped-review.md` found no scoped blockers. | Injected EACCES does not diagnose historical hosted procfs cause. Typed failed Exit remains failure; filesystem acquisition is not repeated lease-owner reconciliation proof. |
| #475 publication audit | **Passed bounded audit.** [Complete row ledger](ISSUE-383-ACCEPTANCE-RECONCILIATION.md) accounts for all 15 current normative rows, original tracker criteria and grant obligations with primary evidence and bounded gap actions. | Partial/untested current-candidate rows remain partial/untested. Historical hosted S1 and Q389/F389 do not qualify every current crash/race/grant/finality cut. |

Retained review files above are in
`/workspace/dalph-dogfood/night-467-20261007/`. This audit inspected them read-only;
it did not modify private stores, journal, process resources or evidence. The
checked-in subtask notes retain their exact local checks and candidates; their
historical totals are not fresh parent test executions.

## Published CI and candidate boundaries

Fresh GitHub commit read returned the planned Base as remote master.
[CI run 37601524105](https://github.com/dearlordylord/dalph/actions/runs/37601524105),
attempt 1, is completed/success at that exact SHA. Documentation references,
documentation-only quality and required aggregates passed. Application preflight,
suffix and formal shards were skipped by classification; the successful formal
aggregate is not a fresh proof run.

Earlier application runs at #471–#474 integrated candidates were cancelled with
coverage cancelled and quality aggregate failure. None is a passing full run.
Specifically, runs 37590156634, 37593405453, 37596494824 and 37600037678
retain those outcomes. Individual passing stages remain boundary evidence only.

The [#474 integrated replay job](https://github.com/dearlordylord/dalph/actions/runs/37600037678/job/112724096735)
completed successfully at `da34ab698aa01cf488aab254d06c569e5c896613`, Base
`b5b42d9d76c32f5b294d5d361186b6a61629bcad`, attempt 1, Node 24.20.0.
Its inspected log reports 14 ordinary suites/87 tests, then the serial suite/14
tests, and **zero generator executable invocations**. Between that candidate
and this audit's Base, only the three publication acceptance Markdown files
changed. This supports unchanged replay bytes; it does not fill #383 row gaps
or replace cancelled coverage. No new application qualification is needed for
this documentation reconciliation.

## Source-issue disposition for Dalph

Fresh reads found all five source issues open. This audit makes no tracker writes.

| Source | Disposition and exact next boundary |
| --- | --- |
| #334 | Current source criteria are proved within the documented reference scope: actual component timings, reproducible bounded fixture, <=30 seconds, current rules/secret checks and refusal/cleanup controls. Eligible for a Dalph-owned completion update linking #468/#469 and this scope; no repair was necessary. |
| #363 | Replay-only restoration criteria are supported by complete fresh generation/loader controls, preserved lanes/options/budgets, mandatory local/hosted routing and the exact integrated hosted zero-generator replay above. Eligible for a Dalph-owned completion update; do not describe cancelled full quality runs as passed or retire the separate evaluator controls. |
| #311 | Terminology and integrity are proved, but leave source disposition open pending retrieval of #473's exact focused runtime, check:fast and coherent check:submit results. The independent delivered review establishes symbols/receipts, not those required test results. Retrieve retained owner/Integrator child evidence first; no unchanged application rerun is authorized merely to fill a report. |
| #345 | Leave open. Controlled refusal and built public output are delivered; historical hosted cause/classification and its minimal hosted reproduction remain unproved. Follow the exact remaining #345 acceptance boundary; no blanket permission-error exclusion. |
| #383 | Leave open. Use the row-specific next discriminators in the acceptance ledger, including original S8 contrary-observation/human-closure requirements and current composition binding. A completed #475 audit is not completion of publication acceptance. |

## Liveness, stop and custody limits

The [#466 completion evidence](https://github.com/dearlordylord/dalph/issues/466#issuecomment-6031112733)
pins `893505ffb2bfc9a04dc4f4342feb12070dddf649`, actual retained-prefix
public replay with/without watch, one Run termination and unchanged delivery
facts. No-watch Exit succeeded; with-watch Exit reported the original five-second
timeout, then finalizers finished at 6.223 seconds. The original failed host's
forced stop remains a failed graceful Exit. Its exact launch reconciliation is
separate from host process-group absence.

Nightly `run-intent.json` records original launch 04:46:12.820258 UTC and stop
07:46:12.820258 UTC. `process-result.json` records an earlier host exit 3 at
06:03:49.949519 UTC, no forced stop and observed group absence, explicitly
excluding native executor custody proof. Later retained recovery/generation
notes extend beyond the original stop. This audit does not claim one uninterrupted
three-hour run or certify deadline compliance across resumed invocations. It
accepts retained bounded outputs, not an expired process as qualification.
Dalph retains all original/resumed process, provider, private and custody evidence;
this report grants no fence clearance or resource removal.

Parent checks are documentation formatting, local references, fixed-Base Git
ancestry/diff and read-only tracker/CI reconciliation. No bulk provider fixture,
full gate, model proof, corpus generation or application test is executed here.
The final documentation commit still requires Dalph's publication; CI observations
above belong to the already published Base, not that future commit.
