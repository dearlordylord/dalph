# Frozen shared child-process harness contract

## Maintainer-visible chronology

A maintainer starts one adapter process for the exact fixture Run. The child
reads the controlled GitHub world, records the exact claim intent through its
own durability mechanism, and asks the controlled GitHub boundary to create
the claim. At a named fault point the parent kills the child, may change the
GitHub world, and starts a fresh child with the same adapter store.

The successor child must recover the same Run, check GitHub after an unknown
claim result, avoid a second unsafe claim request, read current graph facts
before the next decision, and emit comparable evidence. The parent—not either
adapter—owns fault placement and assertions.

No real provider is reachable from this seam. `ControlledGitHub`,
`ControlledGit`, `ControlledExecutor`, `ControlledClock`, and
`ControlledApplicationExit` are file-backed fixtures under a per-test temporary
directory.

## Exact fixture identities

The first chronology uses these literals in every arm:

| Fact | Frozen value |
| --- | --- |
| Run | `run-232-ambiguity-0001` |
| task | `github:dearlordylord/dalph#232-fixture-task` |
| attempt | `attempt-232-ambiguity-0001` |
| planned Base SHA | `d4128e475ddfdda6970ac7951ce7696d7736685a` |
| claim owner | `dalph-evaluation-owner` |
| claim token | `claim-token-232-0001` |
| tracker target | repository `dearlordylord/dalph-evaluation-fixture` |
| workflow candidate | `dalph-run-v1` with execution key derived one way from the exact Run ID |

The controlled Git and executor boundaries still appear in the evidence
inventory even when a scenario makes no call to them. The claim tracer bullet
does not need a Git mutation or executor start: the process is killed before
those boundaries could be reached, and later decisions stop after the fresh
tracker observation.

## Adapter process protocol

The parent invokes one child executable with:

```text
child --adapter <journal-baseline|effect-workflow-v1|effect-workflow-v2>
      --fault-point <fault-point>
      --workspace <absolute-temporary-directory>
      --run-id run-232-ambiguity-0001
```

The child writes newline-delimited protocol messages to stdout. Each line is a
schema-decoded object with one of these tags:

- `ChildReady`: the adapter store is open and the execution is registered;
- `FaultReached`: names the exact fault point and waits for the parent to kill
  or release the child;
- `ExecutionCompleted`: names the recovered decision and evidence paths;
- `ExecutionFailedClosed`: reports a typed incompatible-code or durable-data
  result without continuing;
- `ChildProtocolFailure`: reports malformed fixture input or an internal
  harness defect.

The parent never infers safety from child exit alone. It checks the durable
ledger and trace after the child has exited.

## Controlled outside-world store

`outside-world.json` is schema-versioned and atomically replaced by the
parent/controlled boundaries. It contains:

- exact task identity, open/closed lifecycle, target membership, and one
  optional exact claim;
- a monotonically increasing tracker revision;
- exact planned Base SHA and an unchanged controlled worktree observation;
- exact executor correlation and `Absent | Running | SafelySuspended |
  Terminal` observation;
- whether application Exit admission is open or closed.

The outside-world file is provider authority for the experiment. Adapter
stores and historical results are not.

## Provider-call ledger

Every controlled boundary appends and fsyncs one JSON line to
`provider-calls.ndjson` before returning or triggering a fault. Each entry has
an ordinal, process instance, adapter, boundary family, concrete request,
observed/applied result, tracker revision when relevant, and whether the reply
was delivered.

The ledger distinguishes at least:

- `GitHub.ReadClaim`;
- `GitHub.CreateClaim`;
- `GitHub.ReadCurrentTaskFacts`;
- `Git.ReadPlannedBase`;
- `Executor.ObservePlannedAttempt`;
- `ApplicationExit.CutoffObserved`.

It is evaluation evidence and controlled-provider history. It is not an input
from which an adapter may reconstruct its continuation.

## Canonical semantic trace

Each arm projects its actual evidence into these comparison events:

1. `RunExecutionEstablished` with exact Run and Base SHA;
2. `TaskClaimAcquisitionIntended` with exact task/owner/token;
3. `TaskClaimObserved` with `Absent | Exact | Foreign` and tracker revision;
4. `TaskClaimRequestApplied` only when the controlled provider applied it;
5. `CurrentTaskFactsObserved` with the post-restart revision and decision fact;
6. `RunDecisionRecovered` with `ContinueSameRun | Wait | FailClosed`;
7. `ApplicationExitCutoffApplied` when that scenario closes admission;
8. `ExecutionCodeRejected` for incompatible unfinished history.

The trace is ordered by actual occurrence. The baseline may project Journal
records plus provider evidence. The Workflow-only arm must project Workflow
execution/activity evidence plus provider evidence without manufacturing
Journal-shaped records.

## Fault points

The shared harness recognizes these exact cut points:

| Fault point | Parent action | Required successor evidence |
| --- | --- | --- |
| `AfterExecutionStored` | Kill after exact execution registration. | Same Run execution; no duplicate beginning. |
| `AfterClaimIntentBeforeRequest` | Kill after durable intent, before GitHub create. | Read exact claim, then issue at most one first request if absent. |
| `AfterClaimAppliedBeforeReplyRecorded` | Controlled GitHub applies claim, ledger fsyncs, child blocks, parent kills it. | Read exact claim before any create; zero duplicate create requests. |
| `AfterClaimReplyDurableBeforeNextRead` | Adapter durably knows the completed request, then parent kills it. | Reuse the completed result; still perform a fresh task-facts read for the next current decision. |
| `AfterCleanCheckpoint` | Stop with no boundary in flight, mutate tracker revision, restart. | New task-facts read uses the post-stop revision. |
| `AfterExitCutoff` | Close Exit while unfinished work exists. | No later provider call begins in that process. |
| `WithIncompatibleExecutionCode` | Create unfinished v1 history, open it with v2. | Typed fail-closed result or declared compatible migration; never silent reinterpretation. |

## Acceptance tests and negative controls

The public seam is the parent-driven child chronology. Candidate-native tests
may diagnose its internals but cannot replace it.

| Accepted scenario | Named test at the shared seam | Deliberate mutation that must fail it |
| --- | --- | --- |
| GitHub applied a claim and Dalph lost the reply. | `checks GitHub after losing the mutation response and does not repeat the request` | Skip the reconciliation read or repeat `CreateClaim`. |
| The exact Run survives every restart. | `replays one exact Run without establishing a duplicate execution` | Derive a new execution identity on restart. |
| GitHub's reply was durably known before stop. | `reuses durable evidence when the provider outcome was already recorded` | Repeat the completed create request. |
| GitHub changed a relevant fact during downtime. | `reads current GitHub facts after downtime instead of replaying an old observation` | Reuse the pre-stop observation as current. |
| Application Exit closes admission. | `admits no successor progress after application Exit cutoff` | Start the next GitHub read after cutoff. |
| Unfinished history meets incompatible code. | `fails closed when unfinished execution code changes incompatibly` | Rename/reinterpret the durable step without version routing. |
| Both adapters describe the same accepted chronology. | `projects equivalent canonical semantics across baseline and candidate` | Alter the candidate's Run identity or omit/reorder one required trace event. |

## Evidence inventory contract

For each arm, the final evidence records:

- exact package/runtime revision and store configuration;
- durable tables/files and owner classification;
- provider-call ledger and canonical trace for every fault point;
- recovered decision and exact identity;
- custom reconciliation, Exit, and code-version protocols;
- setup, processes, ports, persistence, backup/restore, retention, cold start,
  restart-to-progress, polling delay, idle resources, and offline constraints;
- code/concepts made deletable, retained semantic evidence, and duplication;
- dispositions for Effect issues #6294, #6318, #6179, and #6508; and
- scenario-to-test results plus negative-control failures.

The experiment stops after publishing this evidence. Selecting or rejecting a
runtime remains the project owner's decision.
