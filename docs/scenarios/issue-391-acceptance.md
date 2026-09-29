# Production admission, app-server routing, and retained-wait acceptance

Issue: [Fix production admission, app-server routing, unchanged-wait reactivation](https://github.com/dearlordylord/dalph/issues/391)

Status: accepted issue scenarios mapped to executable acceptance evidence.

The issue remains the scenario authority; this file maps its four accepted
chronologies and a focused failed-read refinement of the fourth chronology to
executable evidence.

## Scenario-to-test mapping

| Accepted scenario | Executable acceptance evidence |
| --- | --- |
| The production operator supplies an invalid GitHub claim owner; configuration admission rejects it before constructing a Run or calling a mutation boundary. After the operator supplies a valid owner, a new invocation can allocate normally. | `production-configuration.test.ts`: `rejects claimOwner with %s during configuration admission`; `claim-representation.test.ts`: `rejects the same owner representations the GitHub adapter must reject`; `production-host.test.ts`: `cold production host records one beginning before the first GitHub delivery read` proves the independent valid-owner invocation allocates the Run and records its beginning. The configuration decoder is the production host's pre-construction boundary. |
| The production host starts a Codex task; it proves the all-yes unattended policy before allocating work, applies it to every thread and turn, and treats any approval request as a typed sticky protocol failure. | `codex-app-server-protocol.test.ts`: `pins and proves all-yes unattended policy for every task thread and turn`, `fails policy admission before creating a task thread when effective policy is unsupported`, and `turns an unexpected approval request into a sticky provider-protocol failure`; `production-host.test.ts`: `Codex policy admission follows safe history discovery and fails before Run allocation or provider work`; `codex-app-server-real-qualification.test.ts`: `create and materialize: one real thread stores one task turn in the registered worktree` asserts `{ approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } }`, completes repository tool work, and observes no approval request. |
| Codex sends an ID-bearing server request whose ID collides with an outbound Dalph request; routing keeps the outbound request pending, while malformed envelopes fail through the typed protocol boundary. Existing ID-less completion notifications remain wake hints. | `codex-app-server-protocol.test.ts`: `does not let an ID-bearing server request settle a colliding outbound request`, `fails malformed JSON-RPC envelopes through the typed protocol boundary`, and `keeps existing ID-less completion notifications as wake hints only`. |
| A retained wait republishes unchanged accepted facts; the owner retracts only the publication-owned trailing activation and does not reactivate itself. A later provider, tracker, operator, or timer wake starts at most one bounded activation. | `run-reactivation-owner.test.ts`: `an unchanged retained wait retracts only its publication-owned trailing activation` and the four-case `$0 starts at most one bounded activation after a retained wait`; `production-reactivation.test.ts`: `a reopened SQLite Run keeps positions 232 and 233 stable until an outside wake` and `a rejected fresh foreign claim remains visible without re-reading the graph`. |

## Crash, retry, and forbidden results

The four accepted scenarios do not authorize a new retry, journal event, or
cleanup action. Configuration and policy failures stop before Run allocation;
protocol failures stay typed and sticky; malformed or colliding messages cannot
complete an unrelated request; and an unchanged retained wait cannot create a
self-sustaining activation loop. Existing process-loss recovery, mutation
reconciliation, rate-limit handling, and cleanup scenarios remain unchanged.

## Focused failed-current-graph-read refinement

This refinement preserves the accepted retained-wait behavior while narrowing
how an unreadable current graph read is published. It proves the classifier
and process-local owner together; it does not qualify the composed S1 delivery
journey.

### Starting facts and trigger

No person directly starts this transition. An active, unpaused Run is inside
one bounded activation, and that activation has not established a complete
current `WorkflowEstablishment` graph. An earlier accepted `WorkflowProgress`
publication arrives while the activation is still running, so the
`RunReactivationOwner` records one trailing activation owned by accepted-fact
publication.

The same activation asks the tracker authority to read the current graph. The
tracker boundary fails with an unreadable result such as `CircuitOpen`; there
is no complete graph result.

### Dalph boundary calls and visible result

Dalph records `TaskTrackerReadIntentRecorded` for the
`WorkflowEstablishment` read, calls the tracker once, and records
`TaskTrackerFactsReadFailed`. The accepted-fact classifier derives
`RetainedWait` from the accepted prefix, then the accepted-fact observer
delivers it to the running owner. The owner retracts the pending activation
owned solely by the earlier `WorkflowProgress` publication. Once the current
activation hands off to idle, advancing the fake clock by 30 minutes without
an outside wake leaves the Run waiting and the activation count at one. A
subsequent operator wake produces exactly one second bounded activation.

The maintainer sees no automatic second activation or tracker read after the
failed observation. The later operator wake makes one bounded activation
eligible; the failed result itself is never treated as established graph
facts.

### Crash, retry, and forbidden result

The focused proof begins with a semantically accepted intent and failed result
in the Run journal. It does not inject process loss or qualify restart,
provider traffic, completion, or finality; those remain part of the S1 and
existing retained-wait acceptance evidence. The failed result authorizes no
immediate retry. Only an outside wake, such as the tested operator wake, can
start the next bounded activation.

Dalph must not leave the publication-owned trailing marker queued after the
failed read, start a second activation before an outside wake, drop or duplicate
the operator wake, or infer a current graph from `TaskTrackerFactsReadFailed`.
It must also keep a successful `UnchangedTaskTrackerFactsReconfirmed` as
`WorkflowProgress`: when the accepted graph shows a completed root and an open
dependant, that reconfirmation may enable the dependant's ordinary progression.

### Exact acceptance-test mapping

- `run-reactivation-owner.test.ts`: `a failed accepted graph read retracts
  progress-owned trailing activation until an operator wake` constructs a
  Run-began / `WorkflowEstablishment` read-intent / `CircuitOpen`
  `TaskTrackerFactsReadFailed` prefix, validates it with
  `reduceWorkflowJournalHistory`, derives publication with
  `acceptedRunFactPublicationFromPrefix`, and sends it through the real
  `RunReactivationOwner` accepted-fact observer. It first publishes
  `WorkflowProgress`, then the failed-read publication, waits for the owner to
  hand off to idle, advances `TestClock` without another wake, and checks one
  activation; `OperatorWake` then checks exactly two total activations.
- `run-reactivation-owner.test.ts`: `classifies an accepted unchanged
  root/dependant graph reconfirmation as workflow progress` validates a
  complete accepted prefix whose graph has a completed root and an open
  dependant, confirms the later read is an actual
  `UnchangedTaskTrackerFactsReconfirmed`, and checks its publication remains
  `WorkflowProgress`.

These two focused tests prove the failed-read classifier repair composed with
the owner and its successful-reconfirmation control. They do not substitute
for S1 acceptance.
