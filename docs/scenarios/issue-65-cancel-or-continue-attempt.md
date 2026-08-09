# Cancel or continue an exact pre-integration attempt

Issue: [Cancel or continue an exact pre-integration attempt](https://github.com/dearlordylord/dalph/issues/65)

Status: accepted on 2026-08-01 before behavior-changing implementation.

These scenarios begin after issue #136 has proved that tracker-authored task
instructions changed while one immutable planned attempt remains unfinished.
Issue #66 separately owns clean restart, and issue #67 owns later resource
abandonment or quarantine. Each Continue or Stop request carries one immutable
attempt-choice request identity. Exact redelivery returns its recorded result;
reuse for another Run, task, attempt, fingerprint pair, or choice is a typed
contradiction. At most one valid choice may be applied to one exposed
changed-task choice: the first valid choice committed to the journal wins, and
another request for that same choice is stale regardless of boundary arrival
order.

## Alice continues the existing attempt under changed instructions

### Starting situation

Alice is the Operator. Run R retains planned attempt P for task A. P records old
task revision fingerprint F1, its exact Base SHA, branch, worktree, executor
locator, claim authority, and responsibility. A fresh tracker observation has
proved current task revision fingerprint F2, where F2 differs from F1. Dalph
has brought the complete executor work for P to its accepted safe resumable
boundary. No integration responsibility exists for P.

The tracker owns F2 and the current claim. Git owns P's worktree and commits.
The executor owns whether its work is active or safely suspended. Dalph owns
the immutable P and the workflow history proving F1, F2, and the safe-boundary
result.

### Trigger and chronological behavior

1. Alice applies ContinueExistingAttempt for exact Run R, task A, attempt P,
   F1, and F2 under one attempt-choice request identity D1.
2. Dalph records the applied direction with both F1 and F2 before selecting
   more work.
3. Dalph retains P unchanged. It does not rewrite the planned task revision or
   claim that the executor incorporated F2.
4. Dalph freshly reads every authority required to continue P, including the
   current task lifecycle, target membership, blockers, exact claim, Git
   worktree and lineage, and executor state.
5. Continue authority names the exact planned F1 and observed F2 pair. The
   ordinary current frontier can expose resumption only while the current
   authored fingerprint remains F2. A later observation F3 does not match that
   authority and exposes a new changed-task choice for F1 and F3 instead.
6. Only an ordinary current frontier and bounded admission decision may resume
   P. Changed or conflicting authority enters its accepted wait or
   reconciliation behavior.

If Dalph crashes after step 2, restart reconstructs the applied direction and
continues with whichever fresh reads remain missing. It does not require a new
P or infer that a lost response means the direction was not applied. Exact
redelivery of D1 returns the recorded result without applying another direction.
Reusing D1 with different contents is a typed contradiction, and a new request
after the choice was applied is stale.

Alice sees that P remains the same attempt and is eligible to continue only
under current authority. Dalph must not replace F1 with F2 inside P, start a
new attempt, claim the executor used F2, release the claim, clean the worktree,
or cross the integration boundary merely because Continue was applied.

### Acceptance-test seam

- `records both task fingerprints when Alice continues the exact attempt`
- `reopens Continue and performs fresh reads before admitting the same attempt`
- `never claims the executor incorporated changed instructions`
- `coalesces exact Continue redelivery and rejects request identity reuse`
- `requires a new choice when instructions change again before continuation`
- `lets the first journaled valid choice win a concurrent Continue and Stop race`

## Runtime shutdown during delivery admission releases every process-local reservation

### Starting situation

There is no person acting at the interruption instant: this is an internal
runtime-shutdown race preserving the accepted rule that delivery work cannot
remain stuck behind lost ownership. The ordinary delivery frontier has
selected a proposal for exact attempt P. Its admission controller has
reserved P's exact planned-attempt protocol guard and one task-work position.
At the first interruption point it has entered, but not completed, the final
integration-target acquisition. At the second interruption point all three
reservations exist and P is registered as a live delivery owner. The executor
action has not begun and no external boundary call has occurred. These
reservations are process-local; Git, the tracker, the executor, and the journal
therefore have no new fact to reconcile.

### Trigger and chronological behavior

1. In the first interruption point, Dalph begins the final integration-target
   reservation and runtime shutdown requests interruption before P is
   registered as a live delivery owner.
2. Dalph finishes the indivisible admission handoff, installs the child
   finalizer as P's cleanup owner, and only then honors interruption. The
   finalizer releases P's exact protocol guard, task-work position, and
   integration-target responsibility once.
3. In the second interruption point, P is already registered as a live owner,
   but runtime shutdown requests interruption before the cleanup-owning child
   has been installed. Dalph again finishes installing that child before it
   honors interruption, and the child releases the same three exact resources
   once.
4. A later ordinary proposal for P can reserve all three resources through the
   same admission controller. Its place in the frontier and the configured
   task-work capacity are unchanged by the interrupted handoff.

No person receives a new control result from this internal shutdown. On a
later activation an operator can observe that runnable work is not stuck
behind lost process-local ownership. Dalph must not invoke the executor
before cleanup ownership exists, leak any reservation, release any reservation
twice, admit beyond task-work capacity, reorder the frontier, or manufacture a
durable ownership fact for these process-local resources.

### Acceptance-test seam

- `releases exact admission resources when interrupted after reservations and before owner registration`
- `releases exact admission resources when interrupted after owner registration and before child ownership`

## Alice stops implementation after the executor proves quiescence

### Starting situation

Run R, task A, attempt P, F1, and F2 are as above. Issue #136 exposed Alice's
choice only after an exact safely-suspended report for P proved that no
executor-owned writer remained. Dalph owns exact active claim K1 for A. No
accepted result has crossed the integration cutoff. P's worktree, WIP commits,
logs, and evidence remain readable resources, not disposable cleanup targets.

### Trigger and chronological behavior

1. Alice applies StopTaskImplementation for exact R, A, P, F1, and F2 under one
   attempt-choice request identity D2.
2. Dalph records the applied direction before asking any outside system to
   change state.
3. Dalph proves from its retained history that the exact safely-suspended report
   belongs to R and P and that no later executor start or continuation request
   was sent. That unbroken evidence is sufficient proof that no executor-owned
   writer remains; Stop does not require a redundant executor request.
4. If that proof is incomplete, or a later executor request has an ambiguous
   outcome, Dalph records the exact suspension or stoppage intent and inspects
   the executor. It accepts stoppage only from an exact terminal or safely-
   suspended report for R and P.
5. Dalph records that P's implementation responsibility is abandoned while
   leaving worktree, WIP, session history, logs, and evidence preserved for
   separately authorized disposition.
6. Dalph freshly reads the tracker claim. Only if K1 is still the exact current
   Dalph claim does it use the existing intent-before-effect claim-release
   protocol to remove K1.
7. If the claim is absent or has been replaced, Dalph leaves tracker state
   unchanged and reports that observation separately; it does not undo the
   already-proved stoppage or retain implementation responsibility merely to
   recover claim ownership.
8. Dalph records the exact release or no-release observation and selects no
   integration, tracker-completion, generic cleanup, or replacement-attempt
   operation.

If Dalph crashes after either state-changing intent, restart checks the owning
executor or tracker boundary before repeating the same exact request. A lost
response is not evidence that stoppage or claim release did not happen. If
implementation stoppage is proved but claim release remains unreadable, Dalph
durably retains a separate unresolved claim-release responsibility. Each
activation makes only a bounded reconciliation attempt; restart or a later
activation reconstructs the same responsibility and checks the tracker before
retrying. When the tracker eventually supplies readable evidence, Dalph
durably records the release or no-release result. Exact redelivery of D2 returns
the recorded direction and its current result without applying another Stop.
Reusing D2 with different contents is a typed contradiction, and a new choice
request after D2 was applied is stale.

The maintained later-command ambiguity story uses ordinary production routes
to make that race concrete. Dalph admits P's continuation and pauses it
immediately before the executor command intent. Alice applies Task Pause and
then Task Unpause; each control request performs its normal current-membership
tracker read. The live owner of the already-admitted continuation remains held
while Unpause makes P ready again. After the ordinary delivery graph refresh,
the recovery frontier selects and records a fresh task-work-specification read
returning F2. Alice then applies Stop for F1/F2, Dalph releases the held
continuation, and its later executor command makes the earlier safe proof
stale. No harness appends F2 or selects that read outside the production
delivery route.

Alice sees P stopped and its implementation artifacts preserved. If exact claim
release remains unresolved, she sees that separately instead of seeing the
whole Stop falsely fail or falsely complete. If the claim is absent or foreign,
she also sees that Dalph made no claim change. Dalph must not release a foreign
or replacement claim, reacquire a claim merely to stop, resume or integrate P
because claim release is pending, delete or reset the worktree, discard
evidence, start #66 clean restart, or start #67 disposition.

### Acceptance-test seam

- `proves the exact executor stopped before abandoning implementation responsibility`
- `releases only the freshly confirmed exact claim after Stop`
- `stops implementation without mutating an absent or foreign claim`
- `preserves worktree WIP session history and evidence after Stop`
- `reconciles ambiguous stoppage and claim release across later activations without duplicates`
- `durably reconciles an unresolved claim release through bounded later activations`
- `coalesces exact Stop redelivery and rejects request identity reuse`

## Dalph cannot prove that active writers stopped

### Starting situation

StopTaskImplementation is durably applied for P, but Dalph cannot reconstruct
an unbroken proof from P's earlier safe suspension to the Stop direction, or a
later executor request has an ambiguous outcome. The executor stoppage intent
is durable. The executor boundary is unreadable, reports a different Run or
Attempt, or reports that P is still Running. K1 may still be current.

### Trigger and chronological behavior

1. Dalph records the exact typed unreadable, contradictory, or still-running
   observation when the boundary supplies trustworthy evidence.
2. Dalph retains P's implementation responsibility, K1, worktree, WIP, session
   history, logs, and evidence.
3. Dalph does not start claim release or any disposition responsibility.
4. A later accepted activation may reread the same executor authority under
   its bounded protocol. Only an exact safe-boundary result permits the Stop
   scenario to continue.

If Dalph crashes, restart reconstructs the unresolved stoppage intent and
checks the executor before another request. Alice sees an explicit wait or
typed boundary failure rather than a false stopped result.

Dalph must not infer quiescence from process loss, timeout, missing session
data, or an unrelated terminal report. It must not release capacity, claim, or
resources as though stoppage were proved.

### Acceptance-test seam

- `preserves every exact resource when executor stoppage is unproved`
- `does not release the claim while an exact writer may remain`
- `reconstructs an ambiguous executor command before activating its continuation`

## A new Continue or Stop request arrives after integration has begun

### Starting situation

The exact responsibility for P has already crossed the durable integration-
start cutoff from issue #56. Candidate construction, verification, promotion,
or tracker completion may be pending under their own protocols.

### Trigger and chronological behavior

1. Alice submits a new ContinueExistingAttempt or StopTaskImplementation
   request for P.
2. The control boundary rejects the request as outside the pre-integration
   phase. It records no applied direction because issue #56 consumed the exact
   pre-integration choice capability when integration started.
3. Dalph performs no executor restart, claim release, candidate cancellation,
   Git rollback, tracker mutation, cleanup, or disposition because of it.

No downstream effect crosses a boundary, so crash reconciliation does not
apply. Alice sees the direction rejected rather than silently accepted. This
does not change exact redelivery: a request identity already applied before the
cutoff returns its recorded result rather than becoming a new post-cutoff
choice.

### Acceptance-test seam

- `rejects Continue and Stop after the exact integration cutoff`
- `does not cross cleanup or integration boundaries for a stale direction`

## Scenario-to-test mapping required at handoff

The implementation handoff must replace every seam above with a passing test,
authored and recorded cassette coverage for Alice-visible outcomes, and the
owning model plus executable adapter. It must cite this scenario's accepted
attempt-choice request identity and post-cutoff rejection contracts; neither
may be invented only in code.
