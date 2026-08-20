# Durable-computation comparative evidence

**Evaluation date:** 2026-08-19

**Exact Dalph Base SHA:** `d4128e475ddfdda6970ac7951ce7696d7736685a`

**Prototype branch:** `prototype/issue-232-durable-computation`

**Candidate:** `effect@4.0.0-beta.106` (`fb75264`), SQL message storage
through `@effect/sql-sqlite-node@4.0.0-beta.106`, `SingleRunner` with
process-local runner storage

**Observed host:** Node `24.18.0`, pnpm `10.29.3`, Linux arm64

## Outcome

The Workflow-only arm passes the five accepted operational scenarios in this
evaluation. It uses no Dalph Journal and no reduced semantic log. A canonical
trace equivalent to the Journal baseline is projected from Workflow messages,
the controlled-provider ledger, and the recovered decision.

This result keeps Effect Workflow viable for the project owner's step-4
decision. It does not establish that all 59 current Journal event variants can
be deleted, does not authorize adoption, and does not integrate any prototype
code into `master`.

## Scenario-to-test mapping

| Accepted operational scenario | Concrete visible result | Journal baseline | Workflow-only candidate | Passing test |
| --- | --- | --- | --- | --- |
| GitHub applies the claim but Dalph loses the reply and stops. | The successor checks the exact claim, sends no second create, reads current task facts, and continues the same Run. | Pass: `ReadClaim, CreateClaim, ReadClaim, ReadCurrentTaskFacts`; one create. | Pass with the same calls and canonical trace. `ReconcileExactTaskClaimV1` rereads before it creates. | `checks GitHub after losing the mutation response and does not repeat the request`; `checks GitHub after the Workflow Activity loses its response and does not repeat the request` |
| GitHub's reply is durably known before Dalph stops. | The successor reuses the completed claim result, does not repeat the create, and still reads current task facts. | Pass: `ReadClaim, CreateClaim, ReadCurrentTaskFacts`. | Pass with the same calls; the stored Activity result is reused. | `reuses durable evidence when the provider outcome was already recorded`; `reuses the durable Workflow Activity result when GitHub's reply was recorded` |
| GitHub changes a relevant fact during ordinary downtime. | The first process sees revision 2/member; the successor sees revision 3/outside-target and waits. | Pass. | Pass. The current-facts call is deliberately outside a memoized Activity, so replay executes a new read. | `reads current GitHub facts after downtime instead of replaying an old observation`; `reads fresh GitHub facts when Workflow replays after ordinary downtime` |
| Application Exit cuts off successor progress. | Process 1 makes no call after `ApplicationExit.CutoffObserved`; a later explicit process start resumes ordinary recovery. | Pass. | Pass. Exit remains a process-wide fixture outside Workflow and is reopened only by the explicit second start. | `admits no successor progress after application Exit cutoff`; `lets Workflow resume only after a later explicit start following the application Exit cutoff` |
| Unfinished execution meets incompatible workflow code. | Version B fails closed before a provider call and reports the incompatible stored version/renamed step. | Not applicable: this scenario isolates candidate code evolution rather than current Journal schema handling. | Pass. The durable `v1` routing marker rejects `v2`, whose deliberately changed step is `ReconcileExactTaskClaimV2`. | `fails closed when unfinished execution code changes incompatibly` |
| Every restart retains one exact Run. | Both arms report only `run-232-ambiguity-0001`; neither creates a rival execution. | Pass. | Pass; Workflow derives one execution ID from the exact Run ID. | `replays one exact Run without establishing a duplicate execution` |
| Both arms preserve the accepted meaning. | The lost-reply traces are structurally equal. | Pass. | Pass. | `projects equivalent canonical semantics across baseline and candidate` |

Nothing in steps 1–3 deliberately defers part of these scenarios. The larger
production migration and every Journal event family outside this tracer-bullet
chronology remain untested adoption work and require a separately accepted
owner decision.

## Provider-call ledgers

Each row is the exact chronological request family. `P1` and `P2` are distinct
real child processes. `CreateClaim!` means the controlled GitHub world applied
the claim but the reply was withheld; `CreateClaim✓` means the reply reached
the adapter.

| Fault point / arm | P1 ledger | Downtime change | P2 ledger | Result |
| --- | --- | --- | --- | --- |
| Execution stored / Journal | no provider call | none | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2)` | Same stored Run begins once; continue |
| Execution stored / Workflow | no provider call | none | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2)` | Same derived Workflow execution resumes; continue |
| Claim intent before request / Journal | `ReadClaim(absent)` | none | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2)` | Durable intent survives; one first create |
| Claim intent before request / Workflow | `ReadClaim(absent)` | none | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2)` | Durable Activity request survives; one first create |
| Lost claim reply / Journal | `ReadClaim(absent), CreateClaim!` | none | `ReadClaim(exact), ReadCurrentTaskFacts(r2)` | Continue same Run |
| Lost claim reply / Workflow | `ReadClaim(absent), CreateClaim!` | none | `ReadClaim(exact), ReadCurrentTaskFacts(r2)` | Continue same Run |
| Recorded claim reply / Journal | `ReadClaim(absent), CreateClaim✓` | none | `ReadCurrentTaskFacts(r2)` | Reuse result; continue |
| Recorded claim reply / Workflow | `ReadClaim(absent), CreateClaim✓` | none | `ReadCurrentTaskFacts(r2)` | Reuse Activity result; continue |
| Clean checkpoint / Journal | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2/member)` | target membership removed; revision becomes 3 | `ReadCurrentTaskFacts(r3/outside-target)` | Wait from current facts |
| Clean checkpoint / Workflow | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2/member)` | target membership removed; revision becomes 3 | `ReadCurrentTaskFacts(r3/outside-target)` | Wait from current facts |
| Exit cutoff / Journal | `ReadClaim(absent), ApplicationExit.CutoffObserved` | explicit new application start | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2)` | No P1 successor; P2 continues |
| Exit cutoff / Workflow | `ReadClaim(absent), ApplicationExit.CutoffObserved` | explicit new application start | `ReadClaim(absent), CreateClaim✓, ReadCurrentTaskFacts(r2)` | No P1 successor; P2 continues |
| Incompatible code / Workflow | no provider call | `v1` store opened as `v2` | no provider call | Typed fail-closed result |

The controlled Git and executor ledgers remain empty. Those boundaries do not
apply to this chronology because every tested decision stops immediately after
the current tracker decision; no worktree mutation or executor start is
authorized. The fixtures still carry the planned Base SHA and absent executor
observation so an adapter cannot invent them. The fixed controlled-clock fact
is `1786665600000`; no runtime clock call applies because the chronology has no
deadline, schedule, sleep, or time-derived decision. Parent-side monotonic time
is used only to measure the experiment and is not an adapter input.

The reserved fixture Attempt is not established in either arm: both adapters
report an empty established-attempt set at each durable registration, and the
shared identity test asserts that it stays empty across restart. This is the
concrete expected result because planning and executor admission occur after
the tracker decision where this tracer bullet stops.

## Canonical trace

For the organizing lost-reply scenario, both arms project:

```text
RunExecutionEstablished(run-232-ambiguity-0001, Base d4128e4...)
TaskClaimObserved(Absent, revision 1)
TaskClaimAcquisitionIntended(github:dearlordylord/dalph#232-fixture-task,
  dalph-evaluation-owner, claim-token-232-0001)
TaskClaimRequestApplied(revision 2)
TaskClaimObserved(Exact, revision 2)
CurrentTaskFactsObserved(Open:Member, revision 2)
RunDecisionRecovered(ContinueSameRun)
```

The baseline proves the intent from `TaskClaimAcquisitionIntended` in
`journal_records`. The candidate proves it from the persisted
`ReconcileExactTaskClaimV1` Activity request in `cluster_messages`. Provider
application and observations come from the provider-owned ledger. This
projection does not manufacture Journal-compatible rows for the candidate.

## Negative controls

`rejects all ambiguity negative controls` starts from a passing real
child-process result, applies one deliberate mutation at a time, and proves the
scenario verifier rejects:

- removal of the post-loss exact-claim read;
- insertion of a second unsafe claim request;
- insertion of a rival Run identity; and
- insertion of a task attempt before planning; and
- removal of durable claim intent before the applied request.

The incompatible-code test is the sixth negative control. Version B declares
the same Run handler with its claim Activity renamed to
`ReconcileExactTaskClaimV2`; explicit version routing rejects the unfinished
`v1` execution before the v2 handler or any provider call can reinterpret its
stored `ReconcileExactTaskClaimV1` request.

## Durable evidence inventory

| Durable item | Arm | Owner and purpose | Authority classification |
| --- | --- | --- | --- |
| SQLite `journal_records` and `effect_sql_migrations` | Journal baseline | Current Dalph Journal stores Run beginning, claim intent, and exact observed outcome. | Dalph workflow-journal history. |
| SQLite `cluster_messages`, `cluster_replies`, and `cluster_migrations` | Workflow-only | Effect stores the Run request, registration-checkpoint and claim Activity request/results, replies, delivery markers, and schema migrations. Runner assignment is deliberately process-local. | Runtime replay infrastructure, not task/Git/executor authority. |
| `effect-workflow-code-version` (`v1`) | Workflow-only | Routes unfinished execution to compatible code and fails closed on `v2`. | Runtime evolution metadata; not domain or provider state. |
| `outside-world.json` | Shared harness | Controlled GitHub/Git/executor/clock/Exit facts. | Controlled outside-system authority for the experiment. |
| `provider-calls.ndjson` | Shared harness | Fsynced chronological requests/results. | Evaluation/provider history; adapters never reconstruct continuation from it. |
| canonical trace returned to the parent | Both | Comparable projection built after execution from actual arm/provider evidence. | Evaluation output, not a durable-computation driver. |

No frontier, queue, resource owner, UI state, or candidate decision is stored.
No reduced Dalph semantic log was necessary for these accepted scenarios.

## Required candidate code and remaining protocols

The Workflow-only adapter is 175 authored lines after formatting, compared with
152 for the experiment-specific Journal adapter. Those are spike sizes, not a
production migration estimate.

Effect owns:

- deterministic execution identity;
- SQL persistence of the Run request and named Activity result;
- handler replay after the parent kills a real process; and
- reuse of a completed Activity result.

Dalph-shaped code still owns:

- mapping the exact Run ID one way into Workflow identity;
- a harness-only `RegisterExactDalphRunV1` Activity checkpoint so the parent can
  kill immediately after durable registration through the public Workflow
  seam; this is runtime test control, not retained domain evidence;
- the `read exact claim; create only if absent` reconciliation protocol inside
  the claim Activity;
- disabling Activity interruption retries (`Schedule.recurs(0)`) for the unsafe
  request;
- a deliberately non-memoized GitHub read before a current-state decision;
- process-wide Exit admission outside Workflow;
- version routing for unfinished execution; and
- live Git/worktree/executor ownership and cleanup, which this chronology does
  not exercise.

The pinned production tree contains 1,853 non-test lines under
`workflow-journal/` and 4,374 non-test lines under
`coordination/reconstruction/`. These are the maximum investigation surface,
not proven deletion: most encode event families absent from this tracer bullet,
and semantic/reconciliation responsibilities survive even if continuation
moves to Workflow. The experiment proves that the narrow Run/claim continuation
does not require a second Dalph semantic log.

## Operations and timing

The candidate is embedded: one Node process, one SQLite database, no listening
port, no Kafka, and no external service. Installation adds no version not
already pinned by the repository's Effect beta.106 stack. An offline user still
needs the packages present in the pnpm store. SQLite backup must include a WAL
checkpoint or use the driver's backup operation; copying only the main file
while the process is live is not a valid backup procedure.

The SQL message tables have no Dalph-specific inspection or retention command
in this prototype. Operators would need an accepted diagnostics, backup,
retention, migration, and malformed-row protocol before adoption. The
process-local runner option is appropriate only to the accepted single-process
experiment and proves nothing about multi-runner fencing.

The candidate polls entity messages and replies every 20 ms in this experiment.
The table separates first-process time to the named cut from restart-to-visible
progress; cleanup is removal of the closed temporary store. RSS is sampled
from `/proc` while process 1 is blocked at the cut. These are single
Linux-host observations after correctness, not performance claims; RSS
assertions are omitted on hosts without `/proc`.

| Case | P1 to cut | Restart to progress | P1 RSS | Cleanup |
| --- | ---: | ---: | ---: | ---: |
| Journal execution-stored cold start | 628 ms | 523 ms | 174 MiB | 1.2 ms |
| Workflow execution-stored cold start | 654 ms | 671 ms | 188 MiB | 0.6 ms |
| Journal lost reply | 634 ms | 675 ms | 175 MiB | 1.2 ms |
| Workflow lost reply | 759 ms | 764 ms | 188 MiB | 0.8 ms |
| Workflow recorded reply | 729 ms | 799 ms | 192 MiB | 0.4 ms |
| Workflow ordinary downtime/current reread | 823 ms | 843 ms | 192 MiB | 0.5 ms |
| Workflow Exit cutoff and later start | 675 ms | 712 ms | 192 MiB | 0.5 ms |
| Workflow incompatible-code failure | 709 ms | 688 ms | 187 MiB | 0.7 ms |

Every successful recovery opened the original SQLite files without copying or
rebuilding them. Backup-and-restore of a copied database was not exercised;
the adoption gap remains a WAL-aware backup/restore drill. The harness enforces
a 2.5-second recovery bound so a marked-read execution cannot silently hang a
passing test.

## Authority refresh as reconstructed input

A useful industry analogy is to treat the tracker refresh after restart as
pulling the input queue before durable computation continues. That is exactly
what the non-memoized current-facts read demonstrates: the runtime replays its
history, then Dalph reconstructs decision input from the authoritative tracker
snapshot. This is sufficient when the decision depends on current state. It is
not equivalent to an event queue when the identity or order of intervening
transitions is independently meaningful; those transitions still need durable
domain evidence or a provider event stream.

## Pinned Effect issue dispositions

| Signal | Disposition at beta.106 |
| --- | --- |
| Effect #6294, delayed second child-workflow resume | Not applicable: the accepted chronology starts no child Workflow. Claim work is one Activity in the Run Workflow. |
| Effect #6318, `DurableDeferred` completion race | Not applicable to the implemented path: it uses no `DurableDeferred`. The adjacent completed-Activity-before-next-read cut passes with a real killed process. |
| Effect #6179, SQLite contention between long/short clients | Not exercised by design: one child process and one embedded client exist at a time. Adoption or a multi-client control surface must reproduce it separately. |
| Effect #6508, concurrent entity execution after SQL runner refresh | Not applicable to the authorized single-process arm, which uses process-local runner storage. It supplies no multi-runner ownership evidence. |

## Interim result for owner evaluation

**Workflow-only remains viable; no reduced semantic log was necessary for the
tested chronology.** This is evidence for continued evaluation, not an adoption
recommendation. No further real-provider, worktree, or executor evaluation is
implied: the owner has chosen to evaluate the form of the computation and its
fit with Dalph's domain-coloured code before making the decision.

### Domain-coloured code-shape extension

The owner extended step 4 before making the decision: evaluate whether Workflow
can sit below Dalph's protected, domain-coloured compositions, while retaining
the explicit option that Workflow could replace `delivery` with its own
readable model if preservation creates worse duplication.

The executable extension extracted the recovered decision into
`domain-colored-computation.ts`. Its seven statements say: reconcile the exact
task claim, stop if it cannot be reconciled, read current task facts, and
continue or wait. The module imports no Workflow, Activity, SQL, Journal,
cluster, storage, or harness fault vocabulary. The same SQL-backed
child-process suite remains green with the Workflow adapter supplying the two
domain ports.

The extension also found one concrete integration constraint. Within one
Workflow execution, two separately constructed Activities with the same name
collide: the second yield reuses the first stored result without executing its
own implementation. A focused executable probe uses independent counters to
prove that behavior. A production adapter therefore cannot name every proposal
`ExecuteAction`; each materialized domain action needs one stable durable name.
The claim Activity now includes its exact `OperationId`.

The current code-shape verdict is **preserve `delivery` with named architectural
adjustments**. The tested claim fits below domain ports. The remaining
adjustments are stable per-action identity, schema-decoded result publication
back into current domain inputs, fresh owning-boundary reads, process-local
resource ownership, and explicit version routing. No tested behavior requires
Workflow to replace `delivery`.

The replacement verdict remains open rather than forbidden. Its concrete cost
is that a Workflow-native composition must re-express the current signal,
description, planning, bounded concurrency, live ownership, Exit, quiescence,
and stabilization meanings. A short handler that hides those obligations is
not equivalent evidence. See `code-shape-evaluation.md` for both shapes, the
four verdicts, and the scenario-to-test mapping.

Do not integrate this prototype or delete Journal code from this issue. Step 4
remains the project owner's continue/revise/adopt/retain decision.

## Issue #233 closed-loop extension — 2026-08-20

The extension started at exact prototype commit
`5cea6629ef9dc4f02cda04bc69cab85b845dd2a7` and remains on
`prototype/issue-232-durable-computation`. Pinned candidate and storage
revisions remain `effect@4.0.0-beta.106`,
`@effect/sql-sqlite-node@4.0.0-beta.106`, and
`@effect/platform-node@4.0.0-beta.106`.

### Scenario-to-test results

| Scenario | Maintainer-visible result | Passing acceptance evidence |
| --- | --- | --- |
| Stored action result is republished after a crash. | Process 1 crosses `GitHub.ReadTrackerGraph` once for `delivery-operation-233-0001`; the parent sends `SIGKILL` after Workflow stores the Activity result and before accepted-fact publication. Process 2 reports the same Workflow execution, makes no tracker-graph call, republishes the matching result, and the actual planned proposal becomes absent. No task attempt is established. | `reuses the stored action result after restart, republishes its accepted fact, and does not call the boundary twice` |
| Current facts are read after replayed publication. | The parent changes controlled target membership during downtime. The republished action result still carries tracker revision 1; the next current-state decision calls `GitHub.ReadCurrentTaskFacts` in process 2 and sees revision 2, `Open:OutsideTarget`. | `reads current facts after replayed publication before the next current-state decision` |
| Two exact actions remain distinct. | Operation 1 crosses the boundary in process 1; operation 2 crosses it in process 2; process 3 replays both without another tracker-graph call. Every publication correlates the materialized `OperationId` with the same decoded accepted `OperationId`. | `keeps two delivery actions distinct through Workflow and republishes each matching result` |
| Journal and Workflow project the same domain consequences. | Both arms use unchanged `delivery`, ordinary action planning, process-local runtime admission, and `DeliveryActionExecutor`. Both end with the same two action/result correlations, an absent proposal, and revision-2 current facts. Their storage and boundary histories are intentionally unequal. | `projects the same delivery consequences through the Journal baseline and Workflow adapter` |
| Domain description remains engine-free. | The production exact-source test still guards the seven statements. The focused planning guard finds no Activity, Workflow engine, SQL client, or Journal store vocabulary in `delivery-action-planning.ts`. | Production exact-source guard; `keeps Workflow and storage vocabulary out of delivery action planning` |

Focused result: `11` tests passed across
`delivery-loop.acceptance.test.ts` and `domain-colors.test.ts`. Aggregate counts
are supplementary; the rows above are the acceptance evidence.

### Chronological ledgers

For the one-action Workflow chronology:

```text
P1: proposal present → ReadTrackerGraph(op-0001, revision 1) → Activity result stored → SIGKILL
downtime: target membership changes; tracker revision becomes 2
P2: same execution → proposal present → stored op-0001 result republished
    → proposal absent → ReadCurrentTaskFacts(Open:OutsideTarget, revision 2)
```

For two Workflow actions, process 1 stores operation 1 and dies; process 2
replays/publishes operation 1, stores operation 2, and dies; process 3
replays/publishes both. The tracker-graph ledger contains exactly two entries,
one for each operation. This uses two restarts because actions are sequential;
it makes no concurrency claim.

The Journal baseline deliberately differs after a crash. Reconstruction
restores historical graph knowledge but leaves current graph state
`GraphNotEstablished`. The baseline therefore performs the safe tracker read
again before publishing current input. Workflow replay republishes its stored
read result. Both then perform the separate revision-2 current-facts read.
This difference is infrastructure history, not a difference in the compared
visible delivery consequences.

### Negative-control evidence

- `publicationMode: Suppress` replays the stored Activity result but never
  publishes it into the ordinary current input. The real proposal remains and
  the successor is killed at the bounded eight-second recovery deadline. The
  accepted one-action test would fail its required absent-proposal result.
- `activityIdentityMode: Generic` names both Activities `ReadTrackerGraph`.
  Effect reuses operation 1's result for operation 2, performs only one
  boundary call, and publishes `acceptedOperationId = op-0001` for materialized
  `operationId = op-0002`. The identity-separation assertions fail.

Both mutations are exercised by passing tests that assert the concrete broken
result before the correct implementation is restored for the acceptance rows.

### Durable-evidence inventory

| Record | Classification | Used to drive continuation? |
| --- | --- | --- |
| `delivery-loop-workflow.sqlite` cluster messages/replies/migrations | Effect Workflow replay infrastructure. Activity results are historical accepted read results, never current tracker authority. | Yes, only by Effect Workflow replay. |
| `delivery-loop-journal.sqlite` journal records/migrations | Independently required Dalph domain evidence in the comparison arm. | Yes, only by the Journal baseline. |
| `outside-world.json` | Controlled task-tracker authority for the experiment. | Yes, by explicit boundary reads. |
| `delivery-boundary-calls.ndjson` | Maintainer-visible controlled-provider ledger. | No. Adapters never read it. |
| `delivery-publications.ndjson` | Maintainer-visible evidence of decoded fact publication and action/result correlation. | No. |
| `delivery-proposal-observations.ndjson` | Maintainer-visible evidence sampled through the real planning/runtime signal. | No. |
| `provider-calls.ndjson` | Maintainer-visible fresh current-facts ledger. | No. |

No durable record contains a proposal, frontier, current signal, admission
position, fiber, live owner, claim ownership, worktree ownership, executor
ownership, resource ownership, or UI state. The Workflow arm uses a
process-local in-memory Journal only to mint the existing privately branded
accepted graph observation required by the ordinary input type; none of those
records survive process exit.

That in-memory translation is important evidence, not a clean-fit claim. The
Activity result is schema-decoded, but the current delivery input accepts a
Journal-branded graph observation. A production adoption would need a
provider-neutral accepted tracker-observation boundary (with the Journal and
Workflow adapters both able to construct it), or it would retain custom
Journal-shaped publication machinery beneath Workflow.

### Code-shape accounting

The extension adds a disposable child protocol, parent harness, controlled
ledgers, and one production-shaped evaluator. It retains all process-local
admission and owner logic in Dalph. Effect owns execution identity, Activity
result persistence, and replay. Dalph still owns:

- exact `OperationId` allocation before the durable boundary;
- the one-way `OperationId` → Activity name mapping;
- schema decoding of the Activity result;
- publication into ordinary current domain input;
- fresh tracker reads for later current-state decisions;
- process-local admission, live ownership, quiescence, and cleanup; and
- the adapter from accepted tracker results to the current privately branded
  graph-observation input.

Workflow could make the Journal baseline's continuation-specific intent/result
records deletable for this tracker-read family. It does not make the current
domain evidence, action planning, runtime ownership, authority refresh, or
semantic explanation responsibilities deletable. The current private
Journal-observation brand is duplicated conceptually by the candidate's
translation and is the principal adjustment exposed by this experiment.

Effect Workflow did not lack a necessary replay or Activity-identity pattern
for these scenarios, so no minimal engine counterexample was produced and the
conditional Restate/DBOS comparison was not triggered.

### Updated four-way verdict

1. **Preserve `delivery`; Workflow fits cleanly:** not supported. The closed
   loop works, but accepted-fact publication currently requires custom
   Journal-shaped translation.
2. **Preserve `delivery` with named architectural adjustments:** strongest
   supported verdict. Introduce a provider-neutral accepted-observation input,
   retain exact per-action identities, and keep fresh authority reads outside
   replayed results.
3. **Workflow cannot fit the coloured architecture:** rejected for the tested
   tracker-read family. The unchanged description, planning, runtime, and
   executor seam completed the crash/replay loop.
4. **Workflow can and should substitute `delivery` with its own readable
   model:** remains valid but least preferred. Nothing in this experiment
   requires re-expressing Dalph's description, admission, ownership,
   quiescence, or stabilization model inside Workflow.

No verdict authorizes adoption, production changes, integration into `master`,
or modification of parent issue #232.

### Final verification

- Focused prototype suite: 3 files, 28 tests passed.
- `pnpm typecheck`: passed.
- `pnpm typecheck:effect`: 517 files checked, zero errors or warnings.
- `pnpm lint:code`: passed.
- `pnpm check:all`: passed; 1,789 tests passed, 2 skipped, coverage
  verification passed, and no secrets were found.
- Final `pnpm check:quint`: passed in 358.74 seconds, including deterministic,
  negative-control, sampled, temporal, and exhaustive checks.

The Quint gate is aggregate formal evidence for unchanged governed behavior;
the named issue #233 acceptance tests above remain the scenario-specific proof.
