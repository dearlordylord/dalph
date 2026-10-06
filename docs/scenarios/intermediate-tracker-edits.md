# Dalph reads an authored task before its later blocker edit

Owning issue: [#373](https://github.com/dearlordylord/dalph/issues/373), S7 of
[the running-host contract](running-host-clients.md).

## Governing behavior

The agent authors tracker tasks directly. Q17 permits Dalph to admit a task
from a complete intermediate authored state before a later call adds blockers.
[Complete graph refresh](refresh-complete-task-pipelines.md) and
[D23](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence) still forbid interpreting
missing provider evidence as blocker absence. The tracker retains task authority;
client hints and process-local presentation supply none.

This refines [active-work refresh](active-work-authority-refresh.md): later
unfinished prerequisites alone do not request suspension of an executing
attempt. Instruction, lifecycle, membership, claim and Git constraints preserve
their existing protocols. An already safely suspended attempt still cannot
resume through an unfinished prerequisite. Neither blocker authoring nor client
reads release an occupied position or authorize cleanup. Preserve
[D12–D16](../DELIVERY-INVARIANTS.md#admission-and-capacity) and
[retained attempt presentation](current-status-admission-witness.md).
The `everyDurableRetainedAttemptHasExactPosition` and
`latestPolicyControlsAdmission` laws in
[runActivation](../../specs/runActivation.qnt) continue to govern positions and
admission. These models do not encode provider pagination or client transport.
No model action, schema, or law changes here.

## A complete intermediate edit admits D

Alice's host has one established Run and coordinator. Root A is executing in
its immutable planned worktree; capacity is two. D and E are not yet authored.
The agent creates open D within A's grouping closure, without prerequisites.
D has no claim, plan, Git worktree or executor. Grouping supplies no blocker.

1. The configured timer starts an independent graph read. Dalph records its
   tracker-read intent, then reads actual GitHub issue, grouping and blocker
   fields. Both public clients observe `GraphNotEstablished` while the read is
   held. This differs from the preceding established graph containing only A.
   Snapshot reads append nothing and perform no provider or Git action.
2. The complete read establishes D with an empty prerequisite set. Dalph records
   the observation, claims D with intent before effects, reconfirms tracker
   authority, records D's exact plan, creates its actual Git worktree and begins
   its executor. Its Base is the configured immutable Base. The recorded
   provider order puts the D blocker read before D's Begin.
3. Only after D begins does the agent author E and add E as D's prerequisite.
   The next timer read exposes that edge through both clients. D remains held
   under its original attempt identity, Base, branch, claim and worktree.
   Dalph neither suspends/yields D nor launches a successor, frees its position,
   or cleans its resources merely because the blocker appeared.

No edit transaction, readiness label, mandatory Pause, public refresh operation,
external-worker protocol or recursive yield is added. No crash or command retry
occurs: this chronology tests authored-call ordering.

## Incomplete evidence never establishes blocker absence

A separate fixture starts with A executing, spare capacity and no D attempt.
The agent authors D and E with E already blocking D. On the timer read the
provider supplies one of four independent failures: a required grouping page
cannot be followed, D's required blocker field is absent, D's grouping facts
contradict membership, or D's blocker request is unreadable.

Dalph records failed/incomplete evidence instead of a complete no-blocker graph.
It acquires no D claim, records no D plan, creates no D worktree and begins no D
executor. A retains its exact attempt. Ordinary bounded failure handling remains
with the existing tracker-read owner; no client command retry occurs. After
provider repair, a later timer independently establishes the complete graph;
both clients see D blocked by E and D still has no attempt.

Clients distinguish unavailable current graph from an established task list.
The independent inspection owner may retain its last complete graph only as
`Stale`, with the failed observation marked explicitly. That value is
process-local and never feeds admission or a workflow Journal event. Initial
inspection failure remains `Unavailable`. A later scheduled complete read returns
inspection to `Ready`.

## Scenario-to-test mapping

| Accepted boundary | Maintained test |
| --- | --- |
| S7 complete intermediate edit, actual timer read/claim/plan/Git/Begin before E, exact retained attempt, forbidden mutations, both native clients, recorded cassette equivalence | `running-host-intermediate-edits.acceptance.test.ts`: `timer reads Complete authored D evidence before later edits and both clients preserve its exact meaning` |
| S7 missing page, missing blocker, contradictory grouping and unreadable result; no D admission; independent complete later timer read; both native clients distinguish unavailable from established graph | The same file's separately named `MissingPage`, `MissingBlocker`, `Contradictory` and `Unreadable` cases |
| Later blockers leave executing responsibility intact while still constraining safely suspended work | `recovery-activation.test.ts`: `later blocker authoring retains Running work and still prevents resuming safely suspended work` |
| Explicit process-local stale inspection, initial unavailability and later recovery through scheduled reads | `running-host-inspection.test.ts`: `scheduled inspection marks its process-local retained graph stale and reports initial failure as unavailable`; `restart reconstructs without durable inspection state` |

The cassette is generated from each production fixture's accepted Journal prefix
and checked at every replay checkpoint for history, operational state, pure
selection and occurrence-position equivalence. Fixture Exit follows the prefix;
it is not a consequence of authoring a blocker or disconnecting either client.
Exact qualification evidence belongs to the implementation handoff.
