# Reducer Lab: action palette states who selects and applies each action

This scenario changes only wording and grouping in the throwaway Reducer Lab.
It does not change Dalph runtime behavior or authorize a new production
transition.

## Open the Lab before observing the task graph

### Starting situation

A developer opens the Reducer Lab. The Lab's fake in-memory task tracker already
contains tasks A–D, but Dalph has not observed that tracker graph and the
workflow journal contains no graph-observation intent or outcome.

No GitHub, Git, or real task-runner boundary applies. The prototype reconstructs
production state over fake in-memory authorities. Its pause buttons do invoke
the production command-recording service, but that service records an operator
request; it does not prove the reconstructed run or task is paused.

### Trigger and ordered behavior

After the initial empty input history is reconstructed, the Lab presents every
possible next input or selected move in groups:

1. Production frontier selections contains only moves emitted by the real
   production runnable-frontier selector.
2. Fake task-tracker selection and read contains the target selector and the
   request for production to read the selected Lab fake tracker. It states that
   selecting a target edits neither target, and that task editing and saving
   happen separately.
3. Lab workflow-driver controls contains every move chosen by the prototype's
   fixed workflow script: individual production stage invocations, the
   pre-claim fresh read, and the convenience that advances executor replay to
   its outer outcome. It states that production executes those stages but did
   not select the UI moves, and does not call any of them coordinator
   activation.
4. Lab responsibility-selector inputs contains synthetic disposition and
   fact-cardinality cases supplied directly to production's selector. It does
   not call executor wait/settlement, relinquishment, settlement, or
   missing/duplicate cases authoritative task-tracker or executor evidence.
5. Production recovery activation contains the control that invokes the real
   production recovery coordinator over reconstructed responsibilities.
6. Lab run-finality inputs contains the direct target-settlement fact supplied
   to production's finality selector; it does not claim to mutate the fake
   tracker.
7. Lab coordinator simulation contains crash, restart, and capacity inputs that
   configure the in-memory exploration scenario.
8. Fake boundary outcomes contains Lab setup for what a later fake task-runner,
   reviewer, or handback boundary returns. These controls are not production
   workflow moves.
9. Recorded operator control requests contains whole-run and per-task
   pause/unpause requests. Before graph observation, task buttons may exist
   because their identities come from the fake tracker authority, not from
   durable graph knowledge. The group states that clicking records a request
   and does not prove pause state changed.

Each row distinguishes “production move executable,” “Lab input available,”
and “request can be recorded” instead of displaying all three as merely
“Available.”

### Visible and forbidden results

The developer can tell who selected each row, which component it changes, and
whether clicking establishes production state or only changes the Lab scenario
or records a request. The headings “Production capability gaps,”
“Reducer-selected moves,” and generic “Process controls” do not appear.

The Lab must not imply that the reducer authorized fake-boundary setup,
coordinator crash/capacity changes, or pause/unpause requests. It must not imply
that recording a pause request changed reconstructed pause state. An
unexecutable production-selected transition remains visible as a Lab driver gap
beside the production-selected moves; it is not presented as a clickable
production capability.

### Crash and retry

Crash and external retry do not apply to this wording/grouping change. The Lab
keeps its existing in-memory replay and request-identity behavior; closing the
browser still discards the exploration.

### Acceptance-test mapping

- `The action palette names the selector and effect of every group before observation`
  in `prototypes/reducer-lab/src/lab-engine.smoke.ts` checks all nine group
  titles and descriptions and rejects the three ambiguous historical titles.
- `Availability labels distinguish production moves, Lab inputs, and recorded requests`
  in the same smoke file checks every typed move origin across initial,
  observed, active-workflow, executor, and recovery snapshots. It confirms that
  each group contains only its exact origin and that representative row
  reasons name the selector or Lab control that supplied them.
