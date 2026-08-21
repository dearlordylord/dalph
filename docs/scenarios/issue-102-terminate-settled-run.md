# Terminate one globally settled Run

Issue: [Terminate one globally settled live run](https://github.com/dearlordylord/dalph/issues/102)

Status: Accepted in the 2026-08-20 scenario interview and implemented on the
issue #102 delivery branch. The scenario-to-test mapping below records the
production seams and negative controls used for handoff.

These scenarios extend the shipped `Completed`-only stabilization behavior from
issue #194. They specify three final results for V1: `Completed`, `Blocked`, and
`Cancelled`. The implementation supports `Blocked` and `Cancelled` without
adding `Failed` for enum symmetry.

A Run begins for one Run root task. After ordinary delivery has no executable
action and no live action owner, Dalph may make one complete task-tracker read
for that root. The accepted result is the current Run task graph. The graph can
change between reads. The journal remains the authority for workflow history;
the tracker, Git, and executor remain authorities for their own current facts.

## GitHub confirms that every current task succeeded

### Starting situation

Alice is the Operator who can observe Run R, but no person directly triggers
the finality check. R began for GitHub issue A. The journal contains the exact
Run beginning, all accepted tracker-read intents and observations, and every
workflow responsibility created while delivering A and its Run task graph.

Ordinary delivery has reached quiescence: it proposes no action and has no live
action owner. Every executor, integration, retry, reconciliation, claim-release,
and cleanup responsibility is settled or durably relinquished. Git owns the
accepted commits and refs; GitHub owns the current task lifecycle and graph;
the executor owns its terminal or safely suspended reports. No unresolved
boundary request remains.

### Trigger and chronological behavior

1. Quiescence causes Run stabilization to allocate one exact graph-read
   operation identity and record the complete-read intent for root A.
2. Dalph asks GitHub once for the complete current Run task graph and records
   the correlated result. The result includes A, every current grouping
   descendant, and every transitive supporting prerequisite. Each included
   task is `CompletedSuccessfully`.
3. Reduction constructs typed completion evidence for R from that exact intent
   and observation. The evidence names R, root A's tracker locator, the read
   operation identity, normalized content identity or revision, complete graph
   and required fact-family coverage, and the observation's journal position.
4. The termination boundary checks the evidence against reconstructed journal
   history. It also checks again that no executable action, live owner, or
   unsettled responsibility remains.
5. Dalph records one `WorkflowRunTerminated(Completed)` as the final record for
   R. Alice can see R as completed. A later task or graph edit under the same
   GitHub root requires a new Run identity; R never reopens.

A valid complete empty graph from a future accepted Run-input boundary also
reaches `Completed` when no workflow responsibility remains. That mathematical
case does not apply to V1's root-task boundary: a successful V1 graph read must
contain exact root A. An inaccessible or missing root, incomplete page set,
contradictory response, or failed read is a typed read failure, not an empty
graph and not a terminal result.

### Crash and retry

If Dalph dies before recording the graph observation, restart reconstructs the
unresolved read intent and reconciles that read according to its owning
protocol. An unrecorded response supplies no completion evidence. Even after
the old observation is recovered, the restarted activation performs its own
one post-quiescence complete read before termination; pre-crash freshness is
not current freshness.

If Dalph dies after recording the observation but before recording termination,
restart reconstructs the same Run and responsibilities, reaches quiescence,
and performs that new post-restart read. If the termination append succeeded
but its acknowledgement was lost, Run establishment reads the final journal
record and creates neither another activation nor another termination record.

### Forbidden results and acceptance tests

Dalph must not terminate from an empty frontier, a Boolean supplied without
its exact read evidence, a partial or stale graph, a pre-crash freshness claim,
or one successful task outcome. It must not terminate while any responsibility
or live owner remains, append twice, reopen R, or persist a derived frontier as
authority.

Acceptance-test seams:

- `completes one Run from exact fresh graph evidence after every responsibility settles`
- `rejects completion evidence with a mismatched Run root operation revision coverage or journal position`
- `performs a new complete graph read after restart before completing the Run`
- `reconstructs an unacknowledged termination append without appending twice`
- `treats a missing root and incomplete graph read as typed nonterminal failures`

Invariant mapping: D29 keeps derived state process-local; D32a makes
termination the last record; D34 requires quiescence before the read; D35
requires exact current evidence and settled work; D36 permits only one such
read per activation.

## GitHub proves that the accepted work cannot succeed

### Starting situation

No person directly triggers this result. R began for root task C. Its current
Run task graph contains task A, task B, and C. GitHub reports A as
`TerminalWithoutSuccess`, B as open and requiring A, and C as
`CompletedSuccessfully`. No cancellation direction has been applied to R.

Dalph has already brought any earlier executor and integration work to its safe
boundary. Claims and exact resources have been released, preserved, or
otherwise disposed through their accepted typed protocols. No workflow
responsibility, action, temporary capacity wait, retry, unreadable authority,
ambiguous result, pause, application Exit, or quarantine decision remains.

### Trigger and chronological behavior

1. Ordinary delivery reaches quiescence and Run stabilization records one
   exact complete graph-read intent.
2. GitHub returns the complete current graph. Dalph records the correlated
   observation.
3. The graph proves that R cannot make every current task successful under its
   accepted root and dependency rules: A has conclusively ended without
   success, while B still requires A. There is no transition by which Dalph can
   repair that tracker fact in R.
4. Reduction proves both the fresh tracker blockage and the absence of every
   outstanding workflow responsibility or live owner.
5. Because no cancellation was applied, Dalph records one
   `WorkflowRunTerminated(Blocked)`. The maintainer can see the exact tracker
   facts A and B that made R blocked. Changing A, B, or their relationship later
   requires a new Run identity; the terminal R does not reopen.

One unchanged graph read alone does not mean permanent blockage. Neither does
no runnable task. `Blocked` requires a conclusive tracker lifecycle or
dependency fact that makes success of the current graph impossible. Provider
unavailability, timeouts, process death, capacity contention, retry deferral,
pause, application Exit, unresolved membership cleanup, and Integrator
quarantine keep the Run active with their existing typed reason.

A non-root task that leaves a later complete graph is no longer part of the
current success predicate after Dalph settles or durably relinquishes every
responsibility for it. If all tasks remaining in that graph succeeded, the Run
is `Completed`, not `Blocked`. Root C cannot disappear from a successful V1
read; that is a typed read failure.

### Crash and retry

The same read and termination crash rules as the Completed scenario apply. A
restarted activation must obtain a new complete graph read; it cannot turn a
pre-crash blockage observation into current terminal evidence. A successful
but unacknowledged terminal append is discovered from journal history and is
not repeated.

### Forbidden results and acceptance tests

Dalph must not ask the Operator to authorize the `Blocked` classification,
silently discard retained work, confuse a temporary wait with impossibility,
use an executor failure as tracker blockage, or reopen the terminal Run after a
GitHub edit.

Acceptance-test seams:

- `blocks one Run when fresh GitHub facts show a failed prerequisite makes current success impossible`
- `keeps temporary waits pause unreadable authorities and quarantine nonterminal`
- `does not block while a removed task still has an unsettled responsibility`
- `completes when a removed non-root task is settled and every remaining task succeeded`
- `performs a new complete graph read after restart before blocking the Run`
- `reports the exact tracker facts that support Blocked`

Invariant mapping: D16 preserves retained work; D34 rejects quiescence as the
result itself; D35 requires settled responsibilities; D37 permits convergence
from conclusive tracker impossibility without inventing an Operator repair.

## Alice cancels a Run before work is active

### Starting situation

Alice is the Operator. R has begun for root A and is not terminal. No delivery
action is admitted, no outside request is unresolved, and no executor,
integration, claim, worktree-cleanup, retry, or reconciliation responsibility
is active. R may be paused or unpaused.

### Trigger and chronological behavior

1. Alice submits `CancelRun` for exact R through the Run control boundary.
2. The boundary orders the request against application Exit and Run
   termination. If accepted, Dalph records one durable cancellation-applied
   fact, `RunCancellationApplied`, before selecting another forward-progress
   action. V1 does not add a transport request identity: the one durable fact
   for R makes semantic redelivery idempotent.
3. Exact redelivery observes the already-applied direction. V1 has no
   withdrawal command and no second cancellation state to apply.
4. Dalph closes new forward-work admission for R. Cancellation may proceed
   while R was paused because stopping and settling existing work is not new
   forward progress.
5. With no applicable responsibility to settle, Dalph performs the one
   post-quiescence complete graph read required for terminal classification.
6. If the fresh graph says every current task succeeded, Dalph records
   `Completed`: Alice's request arrived too late to change the result.
   Otherwise, Dalph records `WorkflowRunTerminated(Cancelled)`.

If application Exit linearizes first, the control boundary returns typed
`ApplicationExiting` and records no cancellation. If Run termination
linearizes first, it returns the existing terminal result. Application Exit
never becomes cancellation. If Dalph dies before the cancellation fact is
durable, no cancellation was applied and Alice may retry. If the append succeeds
but its acknowledgement is lost, redelivery reads that fact and does not append
another. If Dalph dies after recording cancellation but before termination,
restart reconstructs the applied direction and continues settlement; it
neither resumes ordinary work nor requires Alice to cancel again.

Alice sees cancellation pending until settlement and the fresh classification
read finish, followed by either `Cancelled` or the already-earned `Completed`.

Acceptance-test seams:

- `cancels an idle Run after recording the Operator direction and a fresh graph read`
- `returns Completed when all tasks succeeded before an accepted cancellation can determine the result`
- `reconstructs an applied cancellation after restart without admitting forward work`
- `coalesces cancellation redelivery after an unacknowledged journal append`
- `orders CancelRun against application Exit and existing Run termination`

Invariant mapping: D30 records no synthetic crash; D31 continues the same Run;
D32a rejects events after termination; D35 still requires settled work.

## Alice cancels while an executor is running

### Starting situation

R owns planned attempt P for task A, one exact worktree and planned Base SHA,
an exact current tracker claim, and one task-work position. The executor reports
P as running. No accepted result for P has crossed the integration cutoff.

### Trigger and chronological behavior

1. Alice submits `CancelRun(R)`, and Dalph records the applied cancellation
   before asking any outside system to change state.
2. Dalph closes new forward-work admission but retains P, its position, claim,
   worktree, commits, logs, and evidence.
3. Dalph records the existing exact suspension or stop intent and asks the
   executor to bring P to an exact terminal or safely suspended boundary. It
   does not infer safety from process death, timeout, or missing session data.
4. After the correlated safe report is durable, Dalph relinquishes P's
   implementation responsibility. The cancellation disposition preserves the
   worktree and work in progress by default; destructive cleanup requires a
   separate exact accepted disposition.
5. Dalph freshly reads the task claim and releases only the exact current
   Dalph claim through the existing intent/observation protocol. An absent or
   foreign claim is observed without mutation.
6. After every cancellation responsibility and live owner settles, Dalph makes
   the one fresh classification read. All-success still yields `Completed`;
   otherwise the final record is `Cancelled`.

If an executor or claim response is lost, the cancellation remains pending.
Restart reconstructs the exact intent and checks the owning boundary before a
retry. If the executor is unreadable or may still be writing, Dalph retains the
responsibility, claim, worktree, position, and pending cancellation. It reports
the exact wait or typed failure and does not record `Cancelled`.

Alice sees that cancellation can take time and which exact responsibility is
still pending. She does not see a false terminal result while a writer or claim
release remains unresolved.

Acceptance-test seams:

- `stops exact executor work and releases only the confirmed claim before cancelling the Run`
- `preserves worktree WIP logs and evidence under the cancellation disposition`
- `reconciles lost executor and claim responses after restart without duplicate effects`
- `keeps cancellation pending while an executor may still write`
- `admits no new forward work after cancellation is applied`

Invariant mapping: D1-D4 retain exact attempt and claim identity; D16 preserves
work in progress; D30-D31 govern ambiguous crash recovery; D35 forbids early
termination.

## Alice cancels while integration or reconciliation owns work

### Starting situation

Alice is the Operator. R has an exact integration or reconciliation
responsibility for task A. It may own an integration target, accepted candidate,
promotion request, tracker-completion request, quarantine wait, or exact cleanup
resource. Git may already have accepted an atomic ref update. No general Git
rollback protocol exists.

### Trigger and chronological behavior

1. Alice submits `CancelRun(R)`, and Dalph records the applied cancellation
   before starting another forward step.
2. Dalph closes new forward-work admission. A boundary call already sent is
   allowed to return, and an indivisible local handoff already admitted is
   allowed to install its cleanup owner.
3. Dalph does not roll back a successful promotion. It records or reconciles
   every ambiguous outcome through the responsibility's existing protocol,
   then performs only the settlement, release, preservation, or supersession
   work needed to leave no owner or ambiguous effect.
4. A quarantine or unreadable boundary remains a pending cancellation reason;
   cancellation does not relabel it as safe cleanup or as `Failed`.
5. Once all responsibilities settle, Dalph obtains the fresh complete graph.
   If the already-admitted work caused every current task to succeed, the Run
   is `Completed`. Otherwise, the applied cancellation yields `Cancelled`.

If Dalph dies at any point, restart reconstructs the applied cancellation and
the exact unfinished responsibility. It reads Git, the tracker, or the owning
boundary before retrying an ambiguous effect. It starts no replacement
integration and does not release an exact resource until its protocol proves
that release is safe.

Alice sees a pending cancellation with the exact integration, reconciliation,
or cleanup reason until it settles. Dalph must not abandon ownership, duplicate
promotion or tracker mutation, roll back Git by assumption, treat quarantine
as `Blocked`, or terminate merely because cancellation was requested.

Acceptance-test seams:

- `settles an already-admitted integration boundary before cancelling the Run`
- `does not roll back promotion and returns Completed when reconciliation proves all tasks succeeded`
- `reconstructs cancellation and reconciles an ambiguous integration effect after restart`
- `keeps cancellation pending through quarantine and unreadable cleanup authority`
- `releases each exact integration and cleanup resource once`

Invariant mapping: D26-D28 preserve Git qualification and promotion rules;
D30-D31 require reconcile-before-retry; D33 retains unresolved work with a
reason; D35 forbids terminal cancellation while it is owed.

## One non-overlapping V1 terminal decision

After quiescence, settlement, and the one fresh complete graph read, Dalph uses
the following concrete facts. The row order is explanatory precedence, not an
ordinal stored in the domain.

| Accepted current facts | Result |
| --- | --- |
| Every task in the valid complete current graph is `CompletedSuccessfully`, and no workflow responsibility or live owner remains | `Completed`, whether or not cancellation was applied |
| The all-success predicate is false, cancellation was durably applied, and all cancellation responsibilities and live owners are settled | `Cancelled` |
| The all-success predicate is false, no cancellation was applied, fresh tracker facts conclusively make success of the current graph impossible, and no responsibility or live owner remains | `Blocked` |
| Any required read is missing, stale, incomplete, contradictory, or unreadable; any responsibility, ambiguity, wait, pause, Exit, or quarantine remains; or no terminal predicate above holds | The Run remains active with an exact reason |

This makes the three V1 results non-overlapping. It also supplies the extension
boundary for a future failure result.

## `Failed` is explicit and deferred

No current Dalph event proves a conclusive whole-Run failure. Executor failure,
process death, timeout, provider failure, unreadable state, ambiguous effects,
and Integrator quarantine are nonterminal and continue through their owning
retry, reconciliation, wait, or Operator-choice protocol.

A future specification may add `Failed` only when it names one concrete
Run-level failure family, the outside rereads that make it conclusive, every
responsibility that must settle or be durably relinquished, its visible result,
and its crash and retry behavior. It must prove why those exact facts are not
tracker blockage or an applied cancellation and either remain disjoint from
the table above or explicitly revise its precedence. If a future conclusive
failure prevents safe cancellation settlement, V1 keeps the Run active rather
than falsely recording `Cancelled`.

## Model, cassette, and implementation ownership

The implementation begins from these scenarios rather than a completion
Boolean.

- `specs/runActivation.qnt` and its executable adapter cover the three terminal
  predicates, precedence, restart freshness, exact Run/root/revision/operation/
  Journal-position/coverage evidence, and the terminal-history guard. Its
  negative model independently removes decisive conditions.
- Application Exit remains in its existing model. The cancellation adapter
  proves that the Exit cutoff rejects cancellation without translating it into
  termination.
- `specs/runCancellation.qnt` owns the distinct Run-scoped cancellation
  direction and settlement boundary. Its executable adapter invokes the
  production cancellation control, executor safe-stop, exact claim release or
  typed no-release observation, integration/reconciliation settlement, fresh
  classification, and restart seams.
- `packages/dalph/test/cassettes/run-cancellation.test.ts` presents Alice's
  idle, running-executor, and integration-owned outcomes. The production
  recovery test exercises P0-P6 on both memory and SQLite journals; those
  labels remain test cut points rather than workflow stages.

## Scenario-to-test mapping at handoff

- Idle cancellation: `run-cancellation.test.ts` and
  `run-cancellation.mbt.test.ts` use `RunCancellationApplied` and production
  finality to append exactly one `Cancelled` result.
- Running executor and exact claim disposition: the same cassette and MBT run
  production safe suspension, implementation relinquishment, and claim
  release. Absent, foreign, and unreadable claim lanes prove a typed no-release
  occurrence or fail-closed retention, never a guessed release.
- Integration ownership and quarantine: the cassette and production MBT run
  promotion settlement, responsibility release, and quarantine before final
  classification.
- Pause, Exit, terminal history, and redelivery: the activation/cancellation
  Quint suites and cancellation MBT prove no new forward work, explicit Exit
  rejection, terminal-history finality, and idempotent cancellation delivery.
- Crash and retry: `run-cancellation-recovery-prefixes.test.ts` bootstraps P0-P6
  through production on memory and SQLite journals, including the ambiguous
  terminal append and exact observation-position ordering.
- Exact finality evidence: run-finality, workflow-journal lifecycle, and
  reconstruction tests reject mismatched Run, target, operation, revision,
  root, coverage, or Journal position. The activation model has independent
  negative controls for its modeled identity dimensions.
- Formal negative controls: `runActivation_negative_test.qnt` and
  `runCancellation_negative_test.qnt` make forbidden terminal shortcuts
  reachable and assert that their invariants turn red.

Aggregate checks remain supporting evidence and do not replace these mappings.
