# Changing graph during one production Run: research and validation record

Status: source research and one disposable controlled-provider validation completed
on 2026-09-13 at source commit `f99a2343f5b5d90c08e84b536ffab4a8d562b1fb`.
This research changes no production code, creates no supported protocol, and
creates no task.

## Question

While one unchanged production host is delivering root task A at capacity one,
can the tracker change its complete target closure and can an attached observer
receive the resulting normalized graph, frontier, and status? Can the observer
disconnect without stopping the Run, and can a fresh observer attach to the
same Run's current graph? The experiment must keep parent grouping separate
from blocker prerequisites and distinguish a desired ticket placement from an
executor lease.

## Chronology and pass criteria

1. Alice's disposable repository begins with one open GitHub root issue A, no
   subissues or blockers, no claim, and an empty SQLite journal. The task-work
   capacity is one. Git, SQLite, coordinator ownership, workflow, executor and
   integrator are production components. GitHub and Codex responses are
   controlled in-process provider boundaries.
2. Start the production host and hold A's real executor turn in an executing
   observation. Start a separate OS observer. Its attached current publication
   must identify the selected Run and the one-task graph rooted at A.
3. Change only the controlled GitHub authority. Its complete closure now has
   four tasks: B and D are children of A; B is open and blocked by C; C is
   terminal without success and has no parent; D is independently open. Let the
   configured timer trigger the production active-work authority refresh.
4. The same connection must receive an accepted four-task publication. The
   graph must show A-to-B and A-to-D grouping edges and the separate C-to-B
   prerequisite edge. The frontier must exclude B for incomplete prerequisite C
   and exclude C for terminal-without-success. It must expose A and D as
   eligible. At capacity one, D is the selected desired placement and A is the
   eligible-outside-bound placement while A's already accepted executor
   responsibility remains the only task executor. No B, C, or D executor may
   begin.
5. Change the controlled GitHub authority again so D is terminal without
   success. Require a later accepted publication on the existing connection.
   Stop that OS observer. The host and held A executor remain live. A new OS
   observer attaches current-first to the same Run and receives the current
   four-task graph without a reconnect cursor.
6. Release A. Let the actual task result, integration promotion, and tracker
   completion confirmation occur. Observe the real finality outcome rather than
   assuming success. Close the observation server after the host observation
   closes, await both OS clients and subscription fibers, then delete the exact
   fixture.

There is no crash or mutation retry. Timer hints may coalesce. The acceptance
condition is an accepted changed complete graph and its actual downstream
outcome, not a prescribed number of hints or reads.

Forbidden results include treating B's parent A as its prerequisite, treating C
as a child, starting B while C is unsuccessful, starting a second task executor
while A holds the capacity-one responsibility, using observer attachment as
refresh authority, treating an accepted journal position as a stream sequence,
or claiming that this experiment creates tasks recursively.

## Source findings

- `packages/dalph/src/application/production-host.ts:527-545` constructs the
  production reactivation owner with its configured timer and no tracker
  notification source.
- `packages/dalph/src/application/production.ts:303-356` maps timer and tracker
  notification hints to active-work authority refresh.
- `packages/orchestrator/src/coordination/run/run-reactivation-owner.ts:188-204`
  constructs the timer. Lines 356-370 select active-work refresh for the timer
  or tracker-notification causes.
- `packages/orchestrator/src/coordination/run/recovery-activation.ts:2894-2950`
  selects one complete graph read for the captured executing attempts. The read
  covers their task IDs and names their accepted plan operations as causal
  predecessors. It does not name the preceding graph read.
- `packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts:149-166`
  projects GitHub parent and `blockedBy` relationships into distinct
  `parentTaskId` and `prerequisiteIds` fields. Lines 203-221 read the bounded
  complete target closure before projecting one normalized snapshot.
- `packages/orchestrator/src/authorities/task-tracker/github/read-primitives.ts`
  traverses root descendants and prerequisite endpoints. It does not treat a
  prerequisite as a child or recursively include that prerequisite's children.
- `packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts:131-145`
  ranks eligible frontier tasks against configured capacity. Lines 347-371
  combine those desired placements with retained exact delivery evidence. A
  `Selected` placement therefore does not itself prove a new executor lease,
  and an executing task may remain retained while currently outside the desired
  bound.
- `packages/orchestrator/src/coordination/delivery/reactive-delivery-relations.ts:198-223`
  deliberately projects a graph accepted before the activation baseline as
  `GraphNotEstablished` until that activation establishes a fresh graph. The
  process-lifetime journal retains the older accepted observation, but
  `TrackerGraphState` has no separate last-known field. An observer may retain
  its prior graph only as explicitly stale presentation memory; graph
  unavailable during refresh is not evidence that tasks were deleted.
- `packages/orchestrator/src/workflow-journal/termination-preconditions.ts:116-179`
  requires different overlapping graph observations to be causally comparable
  before terminating a Run. A later journal position alone does not supersede
  earlier tracker facts.
- `packages/orchestrator/src/coordination/run/run-stabilization.ts:182-194,258-275`
  makes post-quiescence reconfirmation depend on all graph reads journaled when
  it constructs that operation. In the observed history, this formed `g10`
  with `g1` through `g9` as predecessors.
- `packages/orchestrator/src/coordination/delivery/delivery-action-adapter-common.ts:46-57`
  constructs a fresh `WorkflowEstablishment` graph read without predecessors.
  That is the source shape of the later observed `g11`; the controlled fixture
  did not create its causal metadata.

## Executed evidence

Command:

```sh
pnpm vitest --config research/prototypes/invokee-changing-graph/vitest.config.ts --run
```

The qualified reproduction passed in the parent run in 5.24 seconds (20.51
seconds including transform/import). An independent reviewer run passed in
10.75 seconds (37.38 seconds including transform/import). The independent run recorded:

- initial one-task current publication at accepted journal position 18;
- an accepted four-task publication at position 22 on the original connection;
- the exact grouping and prerequisite structure described above;
- B excluded for prerequisite C, C excluded as terminal without success, D
  `Selected` at rank zero, and A `EligibleOutsideBound` at rank one;
- seven controlled changed-graph reads across the chronology, one task executor turn while A was held,
  no child task work-specification read, and no additional task executor
  responsibility;
- D terminal without success at position 32, first-client `SIGTERM` without an
  application-exit request, and a fresh subscriber on the same Run with the
  current four-task graph at position 34;
- one task turn plus one integrator turn, accepted root executor result,
  successful target promotion, and accepted tracker completion confirmation;
- a typed `WorkflowRunTerminationEvidenceInvalid` failure with detail
  `termination requires tracker graph observations to be causally comparable`,
  and zero accepted `WorkflowRunTerminated` events.

The exact graph-read history explains the negative final result. The expansion was
`g5` at position 22: A, B and D open and C terminal without success. The second
authority change was `g6` at position 32: A and B open and C and D terminal
without success. Reads `g7` through `g10` reconfirmed `g6`; `g10` was a
post-quiescence reconfirmation with `g1` through `g9` as predecessors. After the
root task was delivered, `g11` at position 93 was a new complete
`WorkflowEstablishment` observation: A completed successfully, B remained open,
and C and D remained terminal without success. `g11` had no predecessor. Its
changed overlapping facts were not causally comparable with `g10`, so the
journal rejected termination. This is a real conservative
boundary in the exercised production workflow. It is not evidence that every
changing graph must fail termination: a reconfirmation can supersede all graph
reads already in its predecessor census, and unchanged reconfirmations have a
separate typed link to their prior full observation.

A development diagnostic also observed a `Ready` publication with
`graph: null` at position 20 between the initial graph and the accepted refresh
at position 22. That matches the source's activation-local
`GraphNotEstablished` state. Consumers must not interpret it as task deletion.
The successful fresh attachment happened when the current graph was established;
the experiment does not promise that every arbitrary attachment's first frame
contains a graph.

## What this proves and does not prove

This proves that the existing timer-driven active-work refresh can expose new
members of the tracker closure through the real production workflow while a
root executor is active. It proves the connected and reconnected observation
behavior only for the disposable current-first stream in this prototype; it
specifies no wire protocol and no durable replay.

The provider is controlled, so this is not a live GitHub or Codex qualification.
The tracker authority supplies B, C, and D; Dalph does not create them. The
experiment changes topology only while A is already executing. It does not show
that adding a blocker to an already executing task pauses or yields that task,
and it establishes no automatic-yield behavior. It also does not show recursive
discovery beyond the GitHub reader's documented bounded closure.

The capacity result is based on accepted executor responsibility and provider
turn counts, not placement labels alone. D was retired before A was released,
so the experiment does not test D's eventual admission after capacity becomes
free. The finality rejection is a technical gap requiring correction or an explicitly
bounded support claim before promising terminal closure for this chronology.
It does not require an operator to approve weakening causal evidence, and the
research does not propose weakening that validator.

## Scenario-to-test mapping

| Chronology | Focused experiment evidence |
| --- | --- |
| A is executing; the timer reads the changed authority; the attached OS client sees four tasks with separate grouping and prerequisite edges. | `streams changed graph, respects capacity, and exposes rejected terminal evidence`: accepted positions 18 then 22 and exact graph assertions. |
| Capacity one retains A's real executor while D is desired and B/C are excluded; no second task executor begins. | Placement, provider operation-count, child specification, and accepted executor-responsibility assertions in the same test. |
| D retires; first client exits; host continues; second client attaches to the same Run's current four-task graph. | Settled publication at 32, first-client `SIGTERM`, host/application-exit assertions, exact current-first attachment and position 34. |
| A completes, promotes, and confirms tracker completion, but incomparable graph evidence prevents final termination. | Journal assertions for accepted result, promotion, completion confirmation, typed termination failure, graph causal chain, and absence of `WorkflowRunTerminated`. |
| Host, observer server, subscription fibers, clients, journal and fixture close in order. | Scoped finalizers, awaited fiber/client exits, closed retained publication, reopened SQLite assertions, and fixture removal. |

## Probe construction corrections

Earlier runs held the start request before accepted execution, which did not
exercise active-work refresh. The final probe waits for a real accepted
`ExecutorWorkExecuting` report and makes all controlled provider views agree:
start response, thread read/resume, and complete thread-list summaries. Once the
held result is released, later integrator turns use their actual completed
status. A transient integrator error caused by unconditional in-progress masking
was a fixture error and was corrected before the qualified runs above.

Client frame waits now have a bounded native timeout and remove timed-out
waiters. Parent diagnostics localized the actual negative result to journal
termination after successful graph publication and delivery. No claim about
Effect promise interruption or a provider snapshot lock is inferred from the
earlier opaque timeouts.
