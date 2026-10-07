# Remote publication acceptance at the integrated candidate

Dalph publishes exact candidate M to its pinned remote endpoint/ref before local
promotion and tracker completion. This audit reconciles [#383](https://github.com/dearlordylord/dalph/issues/383)
against integrated Base `da34ab698aa01cf488aab254d06c569e5c896613` on
2026-10-07. **Parent disposition: leave open.** The implemented boundaries and
historical passing evidence below do not establish every required criterion at
this candidate. Closed children #384–#389 and green CI are not row evidence.

This change edits acceptance documentation only. It changes no executable,
test, schema, model, command, journal record, retry, or runtime result. No
publication fixture, provider mutation, full gate, or application test is run.
Dalph owns publication, tracker completion, integration and cleanup; this report
does not perform a tracker mutation. The accepted [chronology and test mapping](scenarios/direct-remote-publication.md#scenario-to-test-mapping)
remain normative, including the [grant chronology](scenarios/direct-remote-publication.md#386-acceptance-test-plan).

## Evidence boundaries and retained candidates

Passed means inspected primary evidence proves the named boundary at its named
candidate. Partial means some proof exists but a required cut or candidate
binding remains unproven. Failed means an observed execution violated the named
criterion. Untested means no execution evidence was identified. Source inspection
establishes coverage ownership, not a test verdict. Native means real processes
or Git; it does not imply a live hosted provider. Controlled process loss and
SQLite reopen are distinct from killing the production host at that cut.

| ID | Primary evidence inspected and exact scope | Limit |
| --- | --- | --- |
| Q389 | `/tmp/dalph-389-passed-gate-status.json`, run `9905bc9a-d4d4-4751-b80a-5dd903e84844`: qualification passed, custody stopped, root command exit 0. Candidate `b4851ff5b8f2f14a6a1b8222800edb84d9bd20c3`, Base `8df1894de41a85bb94305f018248a582929ed888`; input digest `f973f4dc49c3340838c9d81666ded91bdbb820fb1b2cb1b970215c81c1f0def7`. The retained root log is named in the receipt. | Passed historical qualification, not a blanket S1–S8 verdict. [Named public-entry mapping](scenarios/direct-remote-publication.md#389-public-qualification-test-ownership) supplies the boundary assertions. Public cases reconstruct hosts in process. |
| F389 | `/tmp/dalph-389-formal-live-status.json`, run `ba97d4ea-3f53-4d8f-8a1b-1b6efa04424b`: root formal command exit 0, qualification passed, custody stopped; input digest `4b72b375ac9768a9322e8d5fb78be1ff6b98b056fd345ce12ed5da1d2d88aaae`. Same source digest as Q389: `abfb24e442137dae6f070d6c5a431b5bdccb7e77e53edb16a965d2b9420d9430`. | Receipt Base is `9101bcd7a6b44c5be1768b7a7c2bbcb1a4195759`, distinct from the full-gate Base; preserve both. Expected negative-control exits and server termination are not failed proof obligations. Formal evidence does not prove native transports or current candidate bytes. |
| L388 | `/tmp/dalph-388-s1-20261001-0328z-r1/acceptance-report.json` and `journal-export.json`; source `6b9900ee007f3e0bbb30fee60fdfe82c7d2aabf9`, Source Base `d8e2fecf4b441ce983452b9f1f01956f6edc8d4d`, target Base `c18b6c9f23eaefbdff9f020e0dd29b6a4f49fd17`, C `f8162146494cb4c6f9b72e6ff10ccbfd38d0a4c7`, M `b604db3aa0acda029075e18b91a7cdea81a7f35c`. | Passed historical hosted S1, one disposable GitHub task and Codex execution. [Full identities and chronology](ISSUE-386-ACCEPTANCE-AUDIT.md#hosted-s1-workflow-acceptance--2026-10-01). CLI exit 1 at app-server close; no crash/race/grant journey or dependant in this one-task execution. |
| L414 | [#466 retained native graph observations](https://github.com/dearlordylord/dalph/issues/466): CLI source `77c81ba4de4339d1b7d537e458fb62a3bfa62881`; target remote `1b4b855680675bb170c3baea50f3b70b3fe7b789`; five tasks delivered and independently CLOSED/COMPLETED. Retained root `/workspace/dalph-dogfood/414-graph-run-20261007/`. | Ordinary live publication/tracker delivery corroboration only. Task totals do not prove per-row crashes, grants, races, exact later graph release or Run termination. That host later failed handshake and graceful Exit; forced stop is not graceful success. |
| H466 | `host-hang-evidence/acceptance-ledger.json`, `submit-result.json`, `scoped-review.md` under L414 root: candidate `893505ffb2bfc9a04dc4f4342feb12070dddf649`, review Base `1b4b855680675bb170c3baea50f3b70b3fe7b789`, check:submit exit 0. Review records public retained-prefix replay with/without watch, one termination and unchanged protected delivery counts. | Tracker #466 is CLOSED as observed 2026-10-07. Repair evidence is separate from the original failed host. With-watch replay reports typed timeout exit 3, resource finalization 6.223s; no-watch exit 0. This does not turn original L414 Exit into a pass or qualify all publication cuts. |
| G386 | [Candidate-specific grant audit](ISSUE-386-ACCEPTANCE-AUDIT.md#scoped-review-closure), original candidate `8cd92c9247607f6633cf8544a64867e6c820c01a`; follow-ups `53158090c`, `49bce46ab78c7d3a8dd81743e4d735423f5b6896` and named B3/B4 results. | Historical focused controlled/model/conformance evidence. B1–B5 closure is boundary-specific; none supplies a full qualification of current Base. The historical report retains earlier failures and their repairs. |

Git can resolve Q389's candidate in this clone. Its full tree is not the current
tree: `git diff --name-only b4851ff5b8f2f14a6a1b8222800edb84d9bd20c3 da34ab698aa01cf488aab254d06c569e5c896613 -- packages specs`
contains 228 paths. In the direct-publication protocol directory and direct CLI
integration test the bytes are unchanged, but production scenario tests and Git
command/composition dependencies changed. File equality alone cannot establish
unchanged application composition. No retained row-specific qualification bound
to this exact integrated Base was identified in this audit. Q389's same-tree
integration `b6b2d34f74aee05200937c7abd67d671d804e5c8` remains valid historical
provenance; it does not extend qualification across subsequent runtime changes.

## Current source and test owners

The admission owner [admission.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/admission.ts)
checks the durable destination pin and records read intent before Git. The real
Git owner [direct-publication.ts](../packages/orchestrator/src/authorities/git/direct-publication.ts)
uses the exact request refspec with `--porcelain`, `--no-follow-tags`,
`--recurse-submodules=no`, the pinned endpoint and a bounded operation. It parses
per-ref results rather than treating an exit code as publication proof.
[protocol-engine.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.ts),
[state.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/state.ts),
[batch-grant-control.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant-control.ts)
and [resume-runtime.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/resume-runtime.ts)
own retained attempts, exact proof, exhaustion/grant and resume. The finality
owner [completion-task-protocol.ts](../packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.ts)
rejects a new completion without exact publication proof; current tracker
authorization and completion reconciliation remain independent boundaries.

## Normative row ledger

All 15 rows in the scenario's main mapping are accounted for below. Status is
for acceptance at the integrated Base, not for implementation existence. A gap
action means a bounded follow-up owned by the relevant acceptance/test owner;
it is not authorization to rerun tests or providers during this docs-only task.
For each action, first retrieve the retained named child log and candidate
manifest, then determine whether a focused run is necessary. Use a maximum
10-minute item with an absolute UTC stop recorded before execution; stop on the
first absent receipt or contradictory boundary. Do not substitute another full
gate or a live bulk graph. A future live action additionally requires the #466
liveness and stopped-custody premises, independent of its closed tracker state.

| Normative row | Status and inspected coverage/primary evidence | Exact remaining gap and next discriminator |
| --- | --- | --- |
| S1 fresh delivery | **Partial.** Admission tests cover pin/restart; [CLI integration](../packages/dalph/test/integration/direct-remote-publication.integration.test.ts) asserts proof before promotion before completion, exact endpoint/M, one Begin, no redundant read, cleanup, later complete graph before dependant Begin. L388 passed the hosted order at positions 120/123/139/152/161/170/178/184. | Bind retained controlled CLI result to current Base and its changed composition. Retrieve that exact test's child result and source manifest; absent it, request one focused controlled CLI check after owner preparation. L388 remains historical live proof. |
| S2 competing remote head | **Partial.** [hermetic-mvp.test.ts](../packages/dalph/test/scenarios/hermetic-mvp.test.ts) has three full-suffix real-bare-Git cases: before discovery, between discovery/update, after lost response. The last actually rejects M against H2 and masks the response as ResponseDeadline; it does not prove that M applied. Successor authorization, baseline, fixation/provider recovery and predecessor cleanup owners are mapped in S2. Q389/F389 are historical qualification. | Retrieve individual results for all three placements, exact `[H2,C]`, one task Begin, bounded read, custody and cleanup at current composition. No native hosted competing-push evidence is claimed or required in place of controlled bulk coverage. |
| S3 repeated push / descendant containment | **Partial.** [real Git adapter tests](../packages/orchestrator/src/authorities/git/direct-publication.test.ts) assert exact update/up-to-date, both fast-forward directions, incompatible/missing history, ancestry unavailability, refspec rejection and no extra refs. Q389 is historical. | Bind each adapter/control result to candidate; distinguish equal content from exact ancestry and dry-run/exit-zero from proof. Inspect the named adapter child log and negative controls before requesting a focused adapter check. |
| S4 finite exhaustion | **Partial.** [protocol-engine.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts) owns no ungranted fourth intent; hermetic MVP owns real H2/H3/H4 three-session exhaustion. G386 and the grant ledger below cover continuation separately. | Obtain current results for session and intent exhaustion, unsent committed ordinal consumption, O2, unrelated-target progress and no fourth operation. A grant receipt never proves publication or completion. |
| S5 initial publication/finality death cuts | **Partial.** [recovery.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/recovery.test.ts) inspects controlled intent-before-send, unsent intent, applied/unapplied lost send, success append lost acknowledgement and custody refusal in memory/reopened SQLite. It ends at publication success, so its title alone does not prove promotion/close cuts. [promotion safety recovery](../packages/orchestrator/src/workflow/protocols/target-promotion/safety-recovery.test.ts) loses observation after applied CAS and asserts one CAS/push/proof; [completion tests](../packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts) own applied/NotApplied/ambiguous close recovery. | Retrieve separate current results for proof-before-promotion, promotion-before-observation, applied and unapplied completion, and receipt-before-activation. [Native sender SIGKILL test](../packages/dalph/src/application/git-sender-custody.real-host.test.ts) kills a fixture host with an escaped helper, proves exact sender absence before real ls-remote; it is not an actual hosted push crash at every cut. Identify its retained passing result separately. |
| S5/#387 accepted-journal read failures | **Partial.** [delivery adapter tests](../packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts) inject typed JournalError at selection and InRunJournalRunMismatch at pre-observation read, preserving history and avoiding that cut's Git/provider work. | Retrieve both exact results and current adapter dependency manifest. Neither assertion proves no earlier Git activity or sender-phase read coverage. |
| S5 successor H3 refresh recovery | **Partial.** [automatic successor baseline recovery](../packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts) owns exact round-two H2-to-H3 pending intent, ResponseDeadline with no CAS, later one CAS without another remote read, both stores, plus result/intent lost acknowledgements. | Retrieve current results for stop-before-CAS, applied-before-result and committed-result-before-ack; keep rejected CAS distinct from ambiguous pending. Request a single focused file only if those results cannot be bound. |
| S6 configuration / authority | **Partial.** Admission, real adapter, resume and public controls own pin mismatch/missing pin, URL rewrite, branch/ref/ancestry, typed denial/throttle, exact request mismatch and repaired facts. Q389 public cases preserve authority/custody constraints. | Retrieve current rejection results and sanitization assertions. Duplicate mappings are unconstructible in the supported single-repository public host; unknown-field rejection is not duplicate-mapping proof. Any multi-host assembly needs its own admission evidence. No throttled mutation retry. |
| Initial catch-up safety S5/S6 | **Partial.** [Git characterization](../packages/orchestrator/src/authorities/git/direct-publication-git-characterization.test.ts) owns unoccupied direct-ref fast-forward, clean/dirty checked-out refusal, ambiguous inventory, symbolic ownership and backward refusal. Baseline recovery retains CAS race as CatchUpChanged rather than fabricated divergence. | Retrieve each real-Git safety result, index/file preservation and exact applied-intent reconciliation at current Base. Do not infer ancestry from a ref race. |
| Initial baseline cutoff S7 | **Partial.** [cutoff tests](../packages/orchestrator/src/coordination/delivery/direct-publication-cutoff.test.ts) own Pause/Exit during observe/catch-up and produced-result persistence; the next activation performs a distinct boundary. | Retrieve all observe/catch-up cutoff and produced-result cases; verify no later Git boundary after cutoff, exact unresolved intent retained. |
| S7 publication/recovery Pause and Exit | **Partial.** Adapter Pause prevents custody/head/preparation/push; resume Exit and [production composition](../packages/dalph/test/scenarios/publication-composition.test.ts) own PauseAfterReceipt/ExitAfterReceipt in both stores. G386 owns grant ordering. Original L414 graceful Exit **failed**; H466 repair has separate controlled public process evidence. | Retrieve current lifecycle cases and H466 public replay primary results before unattended work. Preserve typed timeout as timeout; process disappearance and delivered task counts are not graceful Exit evidence. Do not use the failed original host as a passing S7 transcript. |
| S8 current completion premises after resume | **Partial.** [production.test.ts](../packages/dalph/test/scenarios/production.test.ts) names dependency, changed revision and foreign claim cases; they stop before claim replacement/close/finality/cleanup while preserving proof and M. Lost-response sibling reconciles NotApplied, retries once and tests settled/terminated resume status without wake/work. The CLI integration separately orders later complete graph before dependant Begin. | Production test bytes changed since Q389. Retrieve the four named current results plus exact cleanup/later-graph transcript. Publication acknowledgement does not release dependants or bypass fresh graph/revision/claim permission. |
| Public recovery | **Partial.** Q389 passed at its named candidate; nine mapped public-entry cases cover loss/reconnect, identical replay, changed-body refusal, Pause, policy denial, throttle and custody preparation refusal. [public tests](../packages/dalph/src/application/production-publication-control.acceptance.test.ts) retain independent core owners. | Bind current public entry/composition results to Base. In-process host reconstruction is not subprocess transport coverage; retrieve CLI subprocess evidence independently. Pending sender reconciliation remains a core-control obligation. |
| S1–S8 chronology and forbidden paths | **Partial.** The mapped CLI, lifecycle, positive/negative finality, model mutants and conformance owners are distinct. Q389/F389 are exact historical qualification, not aggregate acceptance. | Reconcile individual negative-control results for wrong M/target, missing proof, unsafe mutation, duplicate successor/grant, reset ordinals, early termination and early dependant release. One green total cannot fill these rows. |
| S1 real disposable hosted task | **Partial at current candidate; passed historical live boundary.** L388 has exact Source/Base/C/M/ref, PushApplied ordinal 1, independent remote parents/head and CLOSED issue, exact cleanup and termination with one task attempt. L414 corroborates ordinary live graph delivery. | No fresh live run at current Base is evidenced. First determine with the parent owner whether historical L388 plus current controlled composition qualifies the unchanged live boundary; otherwise plan one minimal supervised disposable task after liveness/custody verification. No bulk fixture, Kimi dependency or silent waiver. |

## Original tracker criteria retained alongside the current mapping

The original #383 S8 row is broader than the current changed-premise row. Its
requirements remain visible here; the no-extra-read amendment does not turn a
synthetic journal contradiction into observation of a real rewritten remote.

| Original criterion | Disposition and owner | Gap / bounded next discriminator |
| --- | --- | --- |
| S8 genuine later contrary remote observation | **Untested production trigger.** The accepted scenario explicitly says the supported workflow has no later remote observation before close; adding a rewrite-detection trigger is follow-up work. `state.test.ts` rejects malformed proof correlation, which is a different boundary. | Parent owner must reconcile this original requirement with the accepted 2026-09-20 no-extra-read amendment. Inspect the recorded amendment and identify a supported source of a genuine contrary observation; if none exists, retain the explicit acceptance limitation. Do not add monitoring or weaken the proof predicate in this audit. |
| S8 conclusive versus uncertain proof after restart | **Partial.** Publication recovery retains committed success with zero remote work; an ambiguous send proves stopped custody, observes remote, then proves M or spends the next ordinal. Grant-only proof is rejected independently. | Retrieve both-store exact results for each branch and complete promotion/finality continuation at current Base; conclusive proof alone never supplies tracker permission. |
| S8 applied versus unapplied lost close | **Partial.** Completion tests `checks A after losing the completion response and records fresh success without a second request`, `restart confirms success after a durable rejection or lost response cut`, `restart advances only after a durable NotApplied lookup`, and `does not retry ambiguous completion merely because A currently appears open` own distinct outcomes. The production S8 sibling composes the NotApplied path. | Retrieve applied and NotApplied results separately, preserving exact request/claim correlation and zero duplicate close/reopen/push/session on applied success. An open lifecycle is not NotApplied evidence. |
| S8 human early closure | **Partial protocol coverage; composed journey unproven.** Completion tests `does not turn completed lifecycle into success without the exact current completion claim` and `restart authorization rejects completed lifecycle without the exact current completion claim` reject lifecycle-only success. The exact publication-proof precondition remains independent. | Retrieve a composed current result showing externally closed task cannot manufacture publication or silently settle an outstanding responsibility. If only these protocol results exist, retain the composition gap and request a scoped controlled scenario check. |
| S6 concurrent branch deletion | **Partial native-Git coverage.** Real adapter test `recreates only the named branch when it is deleted after admission and before an ordinary push` characterizes plain non-force Git semantics with no extra ref/tag updates. An observed missing branch still retains a wait. | Retrieve that current adapter result independently; the contract promises no atomic no-recreation guarantee. Do not change push semantics to fill a documentation gap. |

## Grant subrow ledger

These eight normative #386 test-plan rows refine S4/S5/S7/S8; none is omitted
because its child is closed. All are **partial at current Base** with historical
controlled/model/conformance proof in G386 and Q389/F389. Native/live grant
execution at current Base is **untested**; the contract uses controlled coverage
for these bulk branches and does not require a live fixture per branch.

| Normative grant row | Current test owner and decisive boundary | Gap / bounded next discriminator |
| --- | --- | --- |
| Initial/later batch bounds | protocol-engine, automatic-successor-session and `directPublicationBatchGrant_test.qnt`: three sessions/intents, committed unsent intent consumes allowance, exact O2 requires a fresh grant, monotonic ordinals. | Retrieve distinct session and intent/O2 results; no initial-only test proves later exhaustion. |
| Identity and replay | [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts): wrong Run/Q/position/commit/candidate, superseded O and foreign quarantine rejected; same and different request IDs cannot mint a second batch. | Retrieve these admission/replay negatives and exact one-grant/authorization counts. Strict extra-field rejection is separate from stale journal-owned candidate occurrence rejection. |
| Post-Unpause outcomes | batch-grant and production: already-published M reaches promotion with zero push/session; reusable M pushes; same-C successor; authentication/throttle/custody/lineage/permission/claim retain exact waits. | Retrieve each branch result, including zero forward work on blocked cases; do not use the model as runtime proof. |
| Independent progress | hermetic MVP: one granted batch while unrelated target progresses; fourth same-C successor only after exact third-session grant. | Retrieve both composed results, one task Begin and retained Q until finality. |
| Grant/intent recovery | batch-grant, automatic-successor-session and [MBT](../packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts): precommit grant failure, SQLite commit-lost-ack, fixed fourth session, applied push lost response; memory/SQLite exact replay with one grant/proof/Begin and ordinal four. | Retrieve each cut and both-store conformance result; distinguish controlled reconstruction from native host death. |
| Pause and Exit | production granted-batch case: receipt/replay during Pause, no forward effect until Unpause; fresh control/destination/graph/claim/Git/custody before new intent; Exit before append and after commit. | Retrieve current production ordered-read and failed-graph/terminal/foreign-claim branches plus model guard-removal results. |
| Proof/finality | grant-only prefix calls ordinary Run finality selector: RunMustRemainActive, zero IntegrationFinalitySettled, missing exact proof blocks completion. | Retrieve the selector absence assertions and subsequent ordinary proof/promotion/tracker/cleanup sequence separately. |
| Formal chronology | `directPublicationBatchGrant_test.qnt` and negative tests: exact paused grant, replay, fixation/intent crash, four post-Unpause branches; duplicate/mismatched grant, budget reset, task restart, receipt-as-proof and Pause/Exit mutants. | Bind named obligations and negative-control expected exits in F389 to the current formal source closure; do not count server shutdown or expected mutant failure as missing obligations. |

## Closure and next owner action

#383 remains open for current-candidate evidence binding and the distinct
promotion/completion/native-custody, lifecycle, negative-control and public
transport results identified above. Missing current qualification is a proof
gap, not a finding that publication implementation is absent or defective.
The separate manual seven-task capstone is not a substitute for these rows and
is outside the accepted blocking publication mapping. This audit does not
reopen or close that story.

The next owner should first assemble a row-indexed retained-result manifest
at this Base, comparing each test's complete application/source closure with
its exact qualified candidate. Bound the first read-only retrieval to ten
minutes and stop at the first unbound cut; then select that cut's focused
controlled check in a separately authorized implementation/qualification task.
Leave native/live gaps explicitly untested until observed. Before any unattended
journey, verify H466's current liveness and stopped-writer premises; closure of
#466 alone cannot establish them. No source issue closure is justified by this
documentation audit.
