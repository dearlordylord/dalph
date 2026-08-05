# The shared benchmark model

One pinned abstraction, encoded identically in every tool. Differences between
tools must come from the tool, not from a different model.

## Scope

Two tasks (`TASKS = {0, 1}`), one run, capacity ceiling 0..2, integration head
0..4. Small enough for exhaustive symbolic checking and for a hand-written
proof; large enough that capacity, ordering, resource exclusivity, and
recovery are all observable.

## L1 signature

```
frontier      : Publication -> Standing[]
boundedTickets: Standing[] * Capacity -> Placement[]
deliveries    : Placement[] * Evidence[] -> Delivery[]

Standing  = Eligible(taskId) | Excluded(taskId, reasons+)
Placement = Selected(rank) | EligibleOutsideBound(rank)
          | GraphExcluded(reasons+) | AbsentFromCurrentGraph | GraphNotEstablished
```

`rank` is the position of a task inside the eligible set under the graph's
total order. `Selected` iff `rank < capacity`.

`deliveries` contains a task iff it is `Selected` now, or exact evidence still
gives Dalph work to settle.

## L2 state

```
tickets  : TaskId -> { phase, attempts, present, open, expectedHead }
capacity : 0..2
positions: Set[TaskId]        -- process-local
paused   : bool
targetResource: Set[TaskId]   -- process-local, size <= 1
targetHead    : 0..4
crashed  : bool
```

Two history flags carry the transition properties that no state predicate can
express: `admissionRespectedCeiling` (I8) and `promotedFromExactHead` (I13).
Their presence in the model is a lesson, not an implementation detail.

## Phases

```
NoObligation -> Claimed -> Planned -> Executing -> Accepted
                                   -> SuspensionRequested -> Suspended -> Executing
Accepted -> Integrating -> Promoted -> Settled
```

Position held exactly in `Executing` and `SuspensionRequested`.

## Actions

| Action | Meaning |
|---|---|
| `observeGraph(id, present, open)` | a later complete tracker observation, including disappearance and external completion |
| `acquireClaim(id)` | requires current selection |
| `planAttempt(id)` | records one immutable attempt; increments `attempts` |
| `beginWork(id)` | admission; requires a free position and no pause |
| `requestSuspension(id)` | retains the position |
| `safelySuspend(id)` | executor's proof; releases the position |
| `resumeWork(id)` | re-admission of the same attempt |
| `reportAccepted(id)` | terminal accepted; releases the position |
| `startIntegration(id)` | acquires the exclusive target resource, captures `expectedHead` |
| `promote(id)` | compare-and-set against `targetHead`; advances it; releases the resource |
| `settle(id)` | terminal delivery fact |
| `applyPause` / `applyUnpause` | operator direction |
| `changeCapacity(c)` | policy revision; existing holders continue |
| `externalTargetAdvance` | the integration target moves outside Dalph, staling a captured head |
| `crash` | clears every process-local resource; `Integrating` falls back to `Accepted` |
| `recover` | reconstructs positions for existing responsibilities; plans nothing new |

## Deliberate omissions

Review, retry, provider sessions, handback, and convergence policy are not
Dalph domain concepts and are absent. Claim tokens (I11), candidate parent
order (I12), exact correlation (I9), and journal folding (I15) are modelled
only where a tool can express them cheaply; where a tool cannot, the scoreboard
records `—` rather than a weakened encoding.
