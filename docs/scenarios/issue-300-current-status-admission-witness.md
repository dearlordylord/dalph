# Issue #300: Alice sees an admitted action beside the latest accepted facts

Alice is watching one production Run while Dalph has already admitted an exact
action. A newer accepted graph or delivery evaluation can remove that action's
proposal, or its task, before the process-local action owner disappears. Alice
must still see the actual owner beside the latest accepted facts. Restart must
never reconstruct that owner from history.

Status: accepted narrow refinement for [#300](https://github.com/dearlordylord/dalph/issues/300)
and [#217](https://github.com/dearlordylord/dalph/issues/217). This documentation
change records the acceptance rule for the existing #300 candidate; it changes
no runtime code and does not claim #300 is integrated or complete.

## Governing behavior

When Alice reads current status after an accepted evaluation changes, this
scenario refines point 3 of the [accepted #217 amendment](https://github.com/dearlordylord/dalph/issues/217#issuecomment-5401809878).
It replaces only the unconditional requirement that every live owner's exact
proposal still occur in the current frontier. One genuine opaque admission
witness issued by this process for that complete exact proposal is sufficient
when the proposal is absent. If the same proposal identity remains in the
current frontier, its complete value must still equal the owner's proposal,
except for the narrowly defined evaluation-prefix refinements below.
Duplicate owners, mismatched proposals, and untrusted witnesses remain typed
`DeliveryStatusProjectionConflict` results.

This preserves [#269's action-owner handoff](issue-269-independent-work-retained-priority.md#an-action-owner-remains-live-until-its-accepted-successor-frontier-reaches-the-runtime)
and [#315's bounded fresh admission](issue-315-preserve-bounded-fresh-admission.md#three-tasks-enter-two-tasks-remain-outside):
runtime owns the admitted action, including a fresh proposal materialized only
after admission; description owns the latest accepted evaluation. Neither
owner authorizes presentation to start work. The governing executable scenarios
are the runtime, projection, and process-restart tests mapped below. This
refinement adds no Quint transition; the existing admission and recovery models
do not model opaque JavaScript object identity or passive status projection.

[D29 and D30](../DELIVERY-INVARIANTS.md#process-and-durability) forbid persisted
derived ownership and trust in pre-crash memory. [D21 and D22](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
retain intent before ambiguity-crossing effects and reconciliation before
retrying an ambiguous effect. Passive or read-only tracker and executor
observations require no mutation intent. The
[fixed-history/current-status distinction](../CONTEXT.md#language) remains
unchanged: the witness is never workflow history or a durable fact.

## Alice remains attached while an admitted proposal leaves the current graph

### Starting facts and trigger

Alice has attached to Run R's passive current-first status signal. GitHub's
accepted graph contains task A and independent task B. Dalph has admitted exact
proposal P for A, registered its single process-local owner, and issued an
opaque admission witness bound to P's complete value. P may be a tracker read,
a fresh claim action, or an already-authorized executor observation. An
ambiguity-crossing effect already made by P has its ordinary exact acknowledged
Journal intent. A passive or read-only tracker or executor observation requires
no mutation intent. The owner records its actual admitted, materialized, or
settled state.
No executor-private session or transcript enters this status source.

Git worktrees and executor responsibilities, when present, remain bound to
their existing exact attempts. This observation creates no worktree, attempt,
claim, or executor command. A tracker edit removes A from the target closure,
or ordinary accepted action results advance planning so P no longer appears.
The workflow independently reads and accepts those facts, producing a newer
coherent evaluation while P's actual owner still exists. That publication is
the trigger; Alice makes no workflow request.

### Ordered boundary calls and visible result

1. The runtime publishes the latest coherent accepted evaluation together with
   sanitized snapshots of its actual process-local owners. It retains the
   issued witness with P's owner; it does not put P back into the new graph or
   replace the latest evaluation with an older one.
2. Alice's status subscription receives that current value. The pure projector
   checks that exactly one owner names P and that the opaque witness was issued
   in this process for P's complete exact value.
3. If P is absent from the current frontier, that genuine witness permits its
   actual owner entry. If P's identity is present, a different complete
   proposal remains a contradiction even with a genuine witness, except for
   the evaluation-prefix refinements below.
4. Alice's Run view shows the actual live action, or its actual settled owner
   awaiting accepted publication, alongside B and every applicable latest
   accepted fact. Owner ordering uses the exact admitted proposal evidence
   when the latest graph no longer supplies that task's order. This does not
   change the separate task-subject absent-from-current-graph result.
5. Ordinary runtime completion and accepted publication remove the owner;
   subsequent status no longer includes it. Presentation does not settle or
   retain the owner itself.

The status boundary makes no tracker, Git, executor, Integrator, Journal append,
admission, retry, cleanup, control, or Exit call. It must not freeze the graph,
suppress independent current facts, manufacture an owner, call a proposed
action running, persist a witness or status cursor, or authorize a successor.

## Alice restarts after the process owning the witness disappears

### Starting facts, crash, and trigger

The first process dies after publishing P's owner but before the owning
protocol has necessarily recorded its outside result. SQLite retains R and its
accepted prefix, possibly including an acknowledged intent without its
observation. GitHub, Git, and the executor retain their own facts. The old
signal, owner, witness registry, and fibers are gone. Alice invokes the same
production command again without selecting a recovery mode.

### Ordered recovery, rejection, and visible result

1. The host performs ordinary discovery and selects the same unfinished R. The
   owning protocol reconstructs responsibilities and rereads the outside
   authority before any ambiguous request can repeat.
2. The new process publishes a new current-first source. An actual action it
   newly admits receives its own new process-local witness. Journal evidence,
   a prior status record, or a decoded snapshot cannot recreate the old witness.
3. Attempting to project an old absent-current owner fails with
   `DeliveryStatusProjectionConflict`. Forged, spread-copied, serialized and
   decoded admission witnesses also fail. A genuine witness rebound to another
   proposal fails, as do duplicate owner snapshots and a mismatched current
   proposal. Copying descriptive fields is never proof of admission.
4. Alice sees current status from the new process or the exact typed projection
   failure. Historical output remains separately labeled. Projection failure
   initiates no provider reread, duplicate call, cleanup, or graceful Exit.

A second crash repeats ordinary Run discovery and boundary reconciliation.
Status itself has no retry: it crosses no outside mutation boundary. Process
loss must not create a second beginning, restore a previous live owner, or
turn a lost response into proof of failure or graceful shutdown.

## Scenario-to-test mapping

The existing #300 tests provide the acceptance evidence; this document adds no
test-only implementation or cassette. These tests retain their independent
production-runtime, pure-projection, and real-process boundaries.

| Scenario or forbidden result | Existing executable acceptance test |
| --- | --- |
| Actual owner survives proposal/task disappearance with exact structural order | `delivery-status.test.ts`: `keeps Alice's historical action order when each admitted proposal kind leaves the current task graph`; `orders multiple historical owners by their admitted proposal evidence for every input permutation` |
| Duplicate/mismatched owner and forged/copied/decoded/rebound witness fail closed; genuine absent proposal remains visible | `delivery-status.test.ts`: `fails closed for duplicate or mismatched live-owner snapshots`; `compares live-owner proposals canonically through causal predecessor arrays` |
| Invalid ownership is rejected even when Alice selects another task | `delivery-status.test.ts`: `rejects invalid owners while Alice reads a task unaffected by another task's proposal conflict` |
| Latest current-first publication carries actual owners; runtime owns their completion | `run-delivery-runtime.test.ts`: `publishes current-first exact live-owner observations until standalone runtime quiescence`; `keeps an action owner until its accepted successor publication reaches the runtime` |
| Fresh admission remains exact when its first claim-intent append is ambiguous | `run-delivery-runtime.test.ts`: `retains fresh admission when the first claim-intent append outcome is unknown` |
| A new process recovers R, reconciles the exact claim, publishes current status without restoring the old owner, and appends no second beginning | `production-public-recovery.integration.test.ts`: `unfinished SQLite public restart reports the same recovered Run and no second beginning` |
| Projection failure cannot initiate graceful Exit or a workflow mutation | `production-cli.test.ts`: `typed status or TraceAtCursor projection failure fails fast without calling ApplicationExitRequestBoundary.requestExit or mutating a workflow boundary` |

This mapping refines #217's existing scenarios 3, 8, and 9 and supports #260
scenarios 3 through 5 through #300. All other #217 acceptance requirements and
native blocking edges remain applicable.

## Alice sees the original graph-read owner after its intent advances history

This accepted #339 qualification refinement supersedes only complete
owner-versus-current equality for the graph-read ordering position. Complete
admission-witness-versus-owner equality remains unchanged. It adds no workflow
transition, request, retry, durable ownership, or status authority. The
governing boundaries remain #217's passive observation and #269's owner
handoff; the existing admission and recovery models do not model this passive
ordering comparison.

### Starting facts and trigger

Alice watches built production child P1 for Run R. SQLite has acknowledged
R's beginning at position 1. Git remains at the fixture's initial head; no
task claim, worktree, executor session, or integration has started because the
first complete tracker graph read has not returned. The runtime has admitted
one graph-read proposal P, retained its complete original admission witness,
and registered its actual process-local owner. P's tracker graph-read ordering
position is 1.

The owning graph-read protocol acknowledges its existing G1 read intent at
position 2 and starts the controlled GitHub read. GitHub holds the response.
The current coherent evaluation now has accepted position 2 and derives the
same graph-read proposal identity, target, route, admission requirements,
action identity, and wait correlation. Only the frontier's tracker graph-read
ordering position has advanced to 2. That publication triggers Alice's passive
status update.

### Ordered calls, visible result, and forbidden result

1. The pure status projection checks the original complete witness against the
   original complete owner proposal. It does not replace or modify either.
2. For an otherwise identical tracker graph-read action, it accepts only a
   non-regressing tracker graph-read ordering position from the coherent
   current evaluation. It compares all other proposal fields exactly. Other
   The recovered-workflow refinement below extends this distinction only to
   that variant's evaluation position; its other ordering fields remain exact.
3. Alice sees the latest accepted position 2 beside the actual owner with its
   original ordering position 1 and actual operation correlation. Status makes
   no additional GitHub, Git, executor, admission, or journal call and starts
   no second graph read.
4. When GitHub returns and ordinary successor publication completes, runtime
   removes the owner. Status does not manufacture or settle it.

A changed target, route, admission requirement, action identity, wait
correlation, order tag, regressing prefix, duplicate owner, or forged/rebound
witness remains a typed projection conflict. Comparing by identity alone,
discarding every ordering field, freezing the latest evaluation, or rewriting
the admitted owner's ordering evidence is forbidden.

### Crash and test mapping

If P1 dies at the held response, its owner and witness disappear. Ordinary
SQLite discovery and the graph-read protocol determine P2's recovery; this
refinement reconstructs no old owner and authorizes no retry.

- Actual read intent advances history while the response is held → focused
  runtime/status regression proves accepted position 2, original owner order
  1, one graph boundary/operation, and no projection conflict.
- Response and accepted successor publication → ordinary runtime regression
  proves owner disappearance.
- Invalid ownership or changed action → focused status negative controls cover
  owner-order tampering against its witness, current payload/admission/target/
  wait changes, changed order tag, regression, duplicates, and forged/rebound
  witnesses.
- Same real trigger through built production entry → #339's real SQLite/Git
  controller test proceeds beyond the first graph read without the false
  projection conflict. The remaining #339 and downstream qualification
  scenarios and blocking edges are unchanged.

## Alice sees the original claim-read owner after its intent advances history

This accepted #339 refinement extends the preceding graph-read rule only to
the evaluation position in `RecoveredWorkflowOrder`. Its constructor takes
that position from the current evaluation for every recovered transition;
task, transition, frontier ordinal and responsibility beginning are separate
facts. This is not a new claim-read permission or a route-specific recovery
rule. The preceding governing behavior and opaque admission checks remain
applicable, and no Quint transition or outside request is added.

### Starting facts and trigger

Alice watches built production child P1 for Run R. SQLite's accepted prefix at
position 15 leads Dalph to check the responsible task's claim. A claim label
exists in controlled GitHub; its existence alone does not prove that Dalph has
accepted a claim observation. Git has not promoted the integration target,
and no executor command is started by this status check.

The runtime admits exact proposal P for `ObserveResponsibleTaskClaim` and
retains its original witness and owner. P has recovered-workflow order position
15, frontier ordinal 0 and null responsibility beginning. The production
journaled claim-read interpreter acknowledges `TaskTrackerReadIntentRecorded`
for its exact `ReadTaskClaim` operation at position 16, records the owner's
intent, then calls GitHub. The acceptance test holds that original read's
response. The latest coherent evaluation derives the same proposal at position
16. Only `order.acceptedAt` differs; all other ordering and proposal fields
remain identical. This publication triggers Alice's passive status update.

The positions 15 and 16 identify the built diagnostic chronology. A smaller
controlled runtime fixture may use consecutive positions p and p+1, but must
assert the actual acknowledged read-intent event and exact operation rather
than manufacture an unexplained evaluation change.

### Ordered calls, visible result, and forbidden result

1. Status checks the complete original owner against its complete original
   opaque witness, including every original order field.
2. If complete owner-versus-current equality fails, only matching
   `TrackerGraphOrder` or matching `RecoveredWorkflowOrder` may compare their
   evaluation positions separately. Current position must equal the coherent
   evaluation's position and must not regress. Null is an initial position,
   not a permitted return from an acknowledged non-null position.
3. Status compares the complete proposals after replacing only the current
   order's evaluation position with the original position. The graph owner
   and graph-read route checks remain. Every other recovered order field,
   owner, route, identity, payload, admission requirement and wait correlation
   remains exact. Other order variants still require complete equality.
4. Alice sees the latest accepted prefix beside the actual original owner.
   Status does not rewrite that owner or witness, freeze the evaluation,
   append history, create a claim, read GitHub again, or authorize a retry.
5. GitHub returns to the original call. Ordinary accepted successor
   publication removes the owner; status cannot settle or reconstruct it.

Changed semantic order fields, incoherent or regressing evaluation positions,
changed actions, duplicate owners and invalid witnesses remain typed
projection conflicts. Comparing by proposal identity alone or discarding the
entire order is forbidden. On P1 crash, the original owner and witness vanish;
ordinary journal discovery and boundary reconciliation govern P2. This rule
adds no recovery request or automatic qualification rerun.

### Scenario-to-test mapping

- Held original production claim read after its acknowledged intent → runtime
  regression asserts the actual read-intent row and operation, current prefix
  p+1, original order p, exact other recovered order fields and witness, one
  outside read, successful projection and ordinary successor owner removal.
- Evaluation position is descriptive for both typed variants → pure status
  tests cover forward/null-initial positions while preserving the graph case.
- Changed recovered task, transition, frontier ordinal or responsibility
  beginning → independent negative controls still report projection conflict.
- Invalid owner/current chronology or action → existing and extended controls
  reject witness/order tampering, duplicate/forged/copied/rebound witnesses,
  changed route/payload/admission/identity/wait, order tag, regression and
  mixed-time position. Other order variants remain strict.
- Actual built chronology → #339's real SQLite/Git controller proceeds past
  the responsible-task claim read with no extra provider operation. Remaining
  #339 acceptance scenarios and native blocking edges are unchanged.
