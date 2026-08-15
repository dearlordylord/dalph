# Complete one promoted task before a later graph read releases dependants

Issue:
[Complete the tracker task and release dependants](https://github.com/dearlordylord/dalph/issues/61)

Status: **partially superseded on 2026-08-14**. Tracker completion,
focused-success observation, exact promoted ancestry, bounded request
reconciliation, and dependant release remain accepted. Evidence premises that
require the separate #59 target-verification stage must be replaced by the
corrected Integrator evidence contract before implementation changes.

The previously accepted chronology selected the focused-success/complete-graph
split, exact ancestry and evidence premises, exact-request reconciliation,
three-call bound, and task-local conflict behavior. Runtime implementation may
not proceed from this file until its evidence premise is reconciled.

Issue #61 currently states completion criteria and a fake-provider outcome, but
does not choose the ordered boundary calls, crash and retry behavior, or human
conflict outcomes. Its linked graph-frontier specification and former ADR path
were removed when the repository adopted the current subject-scoped models and
architecture pages. These scenarios restate the request against the shipped
promotion behavior in issue #60, the accepted blocker behavior in issue #138,
the shipped completion-claim and settlement behavior in issue #141, and the
later complete-graph traversal in issue #53.

No person directly starts the protocol. The running Dalph coordinator
reacts after Git has proved an exact promotion and the task tracker reports the
task ready for completion. A maintainer observes its progress. Git owns current
target ancestry; the tracker owns task lifecycle, prerequisites, target
membership, and the exact completion claim; Dalph's journal owns only the
ordered intents, observations, and outcomes described here. The executor is not
called because its exact accepted result has already passed through integration
and promotion.

The accepted runtime contract is:

- A tracker-completion request is authorized only by the exact current
  promotion-bound completion claim, a new focused tracker read proving the task
  open, inside the target, and free of unfinished prerequisites, and a current
  Git read proving the promoted candidate remains in the target's ancestry.
- The immutable accepted result carries a content-addressed sealed acceptance
  manifest, the constructed integration candidate carries a content-addressed
  sealed passing integration-review manifest, and target verification carries
  its existing sealed passing manifest. The exact promotion proof and completion
  claim bind all three references, and Dalph rereads and decodes every manifest
  before constructing the completion request.
- One deterministic completion request retains its complete claim, task
  revision fingerprint, promotion, and evidence bindings. Every possible
  tracker call has a durable numbered attempt intent that separately names the
  current focused tracker and Git observations authorizing that call.
- A lost response never permits another call merely because the tracker later
  reports the task open. A human may have completed and reopened it. Another
  call requires a recorded exact-request lookup in the tracker to report that
  the matching request was not applied, plus the same exact current
  preconditions. A tracker that cannot supply that result leaves a visible
  task-local ambiguity wait.
- An acknowledgement, an executor report, Git promotion, or completion-claim
  deletion never establishes tracker success. A new focused task-completion
  observation must report the exact task `CompletedSuccessfully` after the
  completion intent. That observation has no complete dependency-graph
  coverage and therefore cannot make a dependant eligible.
- After the focused success observation is durable, the same Run performs one
  distinct complete target-closure read. Only that later recorded graph may
  remove A as B's unfinished prerequisite. Completion-claim cleanup from issue
  #141 may proceed independently; its success or failure neither substitutes
  for nor blocks the later graph read.
- A human's successful completion is accepted without another mutation. A
  foreign claim, terminal-without-success lifecycle, changed task revision
  fingerprint, or later reopening is preserved as current tracker authority and
  produces a task-local conflict or wait rather than an automatic overwrite or
  repair.
- Completion mutation attempts are numbered and bounded at three for one exact
  request. A fourth tracker completion call is forbidden, including after
  restart; cleanup has its existing independent three-call bound.

These accepted choices deliberately refine two earlier scenario seams. Issue
#141 currently requires a complete target-closure observation before KC
deletion; this proposal instead gives its cleanup protocol the focused success
observation and reserves the complete target-closure observation for the later
dependency refresh. Issue #138 says Dalph records an “actual successful
completion result” after the tracker accepts a completion request; this proposal
clarifies that the accepted response is only an acknowledgement and that the
focused observation establishes success. Both scenario files and their current
model/test mappings must change with the issue #61 implementation. This accepted
file explicitly amends both earlier scenario seams.

Acceptance also expands the current coarse executor and integration boundaries
only enough to return the two new sealed manifest references. It does not expose
their inner review loops, provider sessions, or process stages to generic
orchestration. Issues #57, #59, #60, and #141, their domain events, and the
architecture authority table must bind and carry those references. If the
maintainer does not accept that boundary expansion, issue #61's sealed
acceptance and integration-review evidence criterion must change before runtime
implementation; an accepted result or constructed candidate alone is not a
substitute for the required sealed evidence.

The accepted focused tracker read is a new usage-earned read shape. It covers
one exact task's lifecycle, task revision fingerprint, target membership,
complete prerequisite set, and exact current claim. It is complete only for
that task and those fact families; it is not a complete target-closure
observation and cannot release any dependant. The adapter must return one
normalized usable value or a typed incomplete, contradictory, or unreadable
result. It must not publish a partially assembled value.

The accepted `ReadTaskCompletionRequestResult` operation is a second exact read
boundary. Dalph records its intent naming Q's operation identity, asks the
tracker for that exact request's result, and records exactly one of `Applied`,
`NotApplied`, or `Unreadable`. `NotApplied` must be positive provider evidence
about Q; current open lifecycle, a missing acknowledgement, or an absent journal
outcome cannot stand in for it. If the GitHub adapter cannot obtain that
provider evidence, it cannot return `NotApplied` and the protocol
waits instead of retrying.

## Dalph confirms A, then a later graph read permits B

### Starting situation

Run R contains task A, dependant B, and independent task C. The latest recorded
complete target-closure observation G0 reports A open, B open with A as its only
unfinished prerequisite, and C governed by unrelated facts. A's exact planned
attempt T produced immutable accepted result C1 and sealed acceptance manifest
EA. The journal binds C1 and EA to constructed integration candidate M, sealed
passing integration-review manifest EI, sealed passing target-verification
manifest EV, and Git's exact promotion proof for M.

Issue #141 has replaced A's active claim K with exact completion claim KC. KC
binds R, A, T, A's task revision fingerprint, K, M's promotion correlation, and
EA, EI, and EV. The latest exact claim observation reports KC current. A's
retained integration responsibility is unsettled. No task-completion intent,
focused completion observation, or later graph read exists.

### Trigger and chronological behavior

1. Dalph records an intent for the focused task-completion
   authorization read, asks the tracker for A's lifecycle, task revision
   fingerprint, target membership, complete prerequisites, and exact current
   claim, then records the normalized result. It reports A open, unchanged, in
   the target, with no unfinished prerequisite and exact KC current.
2. Dalph records an intent for A's target-lineage read, asks Git for the current
   configured target head and M's ancestry, and records that M remains the head
   or an ancestor of it. Equality is not required.
3. Dalph asks the evidence store for exact EA, EI, and EV by their content
   digests, decodes each envelope, and checks that each passing result binds C1,
   M, T, and the exact promotion proof as applicable. A missing, malformed,
   mismatched, or non-passing manifest stops before a tracker mutation.
4. Dalph derives one deterministic request Q to complete exact task A using KC.
   Q retains the exact promotion and three sealed-evidence bindings and
   allocates no new attempt, candidate, claim, or evidence identity. Dalph
   records Q's completion intent and waits for the journal append acknowledgement
   before any state-changing tracker call.
5. Dalph records completion-attempt intent 1, including the exact observations
   from steps 1 and 2, and waits for the append acknowledgement. It then asks
   the tracker to complete exact A with Q. The tracker checks exact KC and Q's
   other immutable preconditions and returns an acknowledgement that the
   request was accepted.
6. Dalph records the acknowledgement as the result of attempt 1. It does not
   turn that acknowledgement into task lifecycle or graph knowledge.
7. Dalph records a new focused task-completion confirmation-read intent, asks
   the tracker for A, and records the returned observation. The observation is
   later than Q's intent and reports A `CompletedSuccessfully`. That recorded
   tracker observation, and no earlier result, establishes successful
   completion evidence for A's retained integration responsibility.
8. The focused success lets issue #141 delete exact KC and settle A when its
   cleanup protocol can do so. A failed or ambiguous KC deletion keeps its exact
   cleanup responsibility but cannot reopen A. B remains blocked because the
   focused observation contains no complete target-closure graph.
9. In the same Run, Dalph records a distinct `ReadTrackerGraph` intent, asks the
   tracker for the complete target closure, and records later graph G1. G1
   reports A `CompletedSuccessfully`, B open, and no other unfinished
   prerequisite for B.
10. Only after G1 is accepted into the current graph relation may ordinary
   delivery stop excluding B because of A. B proceeds through its own claim,
   planned attempt, worktree, and executor protocol. C remains governed by its
   own facts throughout.

A maintainer sees A become successfully completed before B becomes eligible,
and can distinguish KC cleanup from dependency release. Dalph must not complete
A from the executor result, promotion proof, request intent, acknowledgement,
or claim deletion; release B from the focused observation; attach A's claim or
evidence to B; repeat integration; or wait for KC cleanup before obtaining G1.

If Dalph dies after step 1 or 2 but before Q is durable, restart repeats both
current authorization reads and all three evidence-store rereads instead of
turning an old process-local selection into permission. Death after step 4
reconstructs the same Q, repeats the focused tracker and Git reads, and records
a call intent naming those later observations. Death after step 5 but before a
known tracker result follows the ambiguous-response scenario below; the call
intent means the request may have crossed the boundary. Death after step 7 but
before step 9 reconstructs A's success while G0 still keeps B blocked. Death
after the tracker returns G1 but before
its journal append likewise keeps B blocked and resumes only the unresolved
graph read. After the G1 append, restart reconstructs B's eligibility without
another completion request.

Forbidden-result mapping: D1 requires Q's exact identities, D9 requires G1
before B's eligibility changes, D21 requires Q's intent and the call intent before
the tracker call, D24 forbids inferred completion, D28 retains the sealed
verification premise, and D30-D31 preserve the same work across restart.

### Proposed acceptance-test and cassette mapping

- `completes exact A only after its promotion claim current facts and ancestry are recorded`
- `refuses completion when any required sealed evidence manifest is missing or mismatched`
- `records a focused success for A without releasing B before a later complete graph read`
- `continues the same Run with B only after the post-success graph observation is durable`
- `releases B even while A's exact completion-claim cleanup remains recoverably pending`
- Authored and recorded happy cassette:
  `Dalph confirms A before a later graph read releases B`

## A lost completion response is reconciled without overwriting a human edit

### Starting situation

The journal contains Q's completion intent and completion-attempt intent 1.
Dalph asked the tracker to complete A, but the response was lost. The tracker
may have completed A or may not have received the call. No attempt result or
focused post-request observation is durable. KC and every promotion and
evidence binding remain preserved.

### Trigger and chronological behavior

1. On the live continuation or after restart, Dalph records a focused
   task-completion confirmation-read intent before any second mutation. It asks
   the tracker for A's exact current completion facts.
2. When the tracker reports A `CompletedSuccessfully`, Dalph records that fresh
   observation and sends no second completion request. This is the readable
   ambiguous-completion happy path required by issue #165.
3. Dalph then performs the separate complete target-closure read described in
   the first scenario. Only that later graph can make B eligible.
4. If the tracker instead reports A open with KC current, that state alone does
   not prove attempt 1 was absent: another tracker client could have completed
   and reopened A. Dalph records an ambiguity wait and sends no second request.
5. Dalph records a `ReadTaskCompletionRequestResult` intent naming Q, asks the
   tracker whether that exact request was applied, and records the result. Only
   `NotApplied` may clear the ambiguity. `Applied` still requires the focused
   lifecycle observation, while `Unreadable` keeps the wait.
6. After `NotApplied`, Dalph repeats the focused authorization and Git-ancestry
   reads. If every exact precondition still matches, it records the next
   numbered attempt intent and may send the same Q. It never allocates Q2 or
   changes KC, M, EA, EI, EV, or the task revision fingerprint. Every later lost
   response follows steps 1-6 again before another call.
7. An unreadable, incomplete, or contradictory tracker result records or
   exposes its typed wait. It proves neither success nor non-application and
   authorizes no mutation.

A crash after a focused-read intent resumes only that read. A crash after the
exact-request lookup intent resumes only that lookup. A crash after an explicit
non-application result but before the next numbered attempt recomputes current
authorization; it does not remember process-local permission. The fixed request
identity and consumed attempt ordinals come from durable journal history. The
tracker adapter's transport retries inside each logical read or mutation remain
bounded by its selected policy; an unchanged wait does not produce a
process-local busy loop.

A maintainer sees either confirmed A or an exact ambiguity wait. Dalph must not
infer rejection from a lost response, use open lifecycle as proof of absence,
replace KC, overwrite a human reopen, release B before the later graph, or
discard promoted work.

Forbidden-result mapping: D5 prevents foreign-state mutation, D21-D22 require
intent and read-before-retry, D23 keeps unreadable and absent distinct, D29
forbids persisted process-local permission, and D33 requires the retained wait
to state its exact reason.

### Proposed acceptance-test and cassette mapping

- `checks A after losing the completion response and records fresh success without a second request`
- `does not retry ambiguous completion merely because A currently appears open`
- `reuses exact Q only after its recorded result lookup proves non-application`
- `waits without mutation when completion reconciliation is unreadable or contradictory`
- Authored and recorded ambiguous cassette:
  `Dalph checks A after losing the tracker completion response`
- Model negative control: a second request after only an open lifecycle read
  must violate the owning completion invariants.

## A tracker client changes A while completion is pending

### Starting situation

Q's intent is durable, but no completion attempt has a known successful result.
A's promotion proof, KC, and retained integration responsibility remain exact.
B depends on A, and independent C needs none of A's facts or resources.

### Trigger and chronological behavior

1. Before Dalph's next state-changing call, another tracker client changes A.
   Dalph does not infer who that person is.
2. If the focused authorization or confirmation read reports A already
   `CompletedSuccessfully`, Dalph records that fresh success and sends no
   completion request. It later obtains the distinct complete graph before B
   can proceed.
3. If it reports a terminal lifecycle other than successful completion, Dalph
   records a task-local lifecycle conflict. The promoted code and evidence stay
   preserved, B remains blocked, and C remains independently eligible.
4. If it reports KC absent or a different claim current while A is not
   successfully complete, Dalph records the exact missing- or foreign-claim
   conflict. It never edits the foreign record or automatically reacquires a
   claim.
5. If A's task revision fingerprint no longer matches KC, Dalph preserves both
   fingerprints and follows the accepted task-change reconciliation. It does
   not pretend the promoted result contains the new instructions.
6. If a change races after the authorization reads, the tracker completion
   request must return a typed precondition conflict rather than overwrite the
   changed claim or task. Dalph records that result, performs the focused
   confirmation read, and follows the matching branch above.

If the other tracker client completes A and then reopens it after Dalph records
focused success but before the later complete graph read, the later graph keeps
B blocked and exposes a current lifecycle conflict beside the retained success
history. Dalph does not automatically complete A again, reverse Git, or erase
the earlier observation. A separately accepted operator repair must decide the
external lifecycle conflict.

A crash never changes which application owns these facts. Restart checks the
tracker and Git through the same reads and does not attribute the edit to the
maintainer watching the Run.

The maintainer sees the exact lifecycle, claim, revision, or precondition
conflict and sees C remain available. Dalph must not hide the conflict behind
an ambiguity retry, repair a human edit, treat terminal-without-success as a
satisfied prerequisite, reopen executor or integration work, or block the
whole Run.

Forbidden-result mapping: D5 preserves a foreign claim, D18 localizes the
conflict, D19 keeps independent constraints separate, D24 allows only successful
completion, and D25 forbids an invented human actor.

### Proposed acceptance-test and cassette mapping

- `accepts a human's successful completion of A without another completion request`
- `preserves terminal-without-success A and keeps B blocked while C continues`
- `never mutates a missing foreign or revision-mismatched completion claim`
- `does not automatically re-complete A when the later graph reports a human reopen`
- Authored and recorded conflict cassette:
  `A tracker client changes A while Dalph's completion request is pending`

## Restart between success confirmation and graph refresh still keeps B blocked

### Starting situation

The journal contains Q and a focused observation proving A
`CompletedSuccessfully`. No later complete target-closure observation exists;
the best complete graph knowledge remains G0, which reports A open and B
blocked. KC cleanup may be complete, pending, failed, or ambiguous under issue
#141.

### Trigger and chronological behavior

1. The coordinator process dies. It records no synthetic crash event and loses
   every process-local proposal and owner.
2. Restart reduces the journal. It reconstructs A's successful-completion fact,
   the exact status of KC cleanup, and the obligation to obtain a later complete
   graph. It does not project B from the focused observation.
3. Dalph records one new `ReadTrackerGraph` intent, asks the tracker for the
   complete target closure, and records the result when usable.
4. If the tracker response is lost before the append, another restart resumes
   that exact read protocol. B remains blocked by G0.
5. If the recorded later graph reports A `CompletedSuccessfully` and every
   prerequisite of B satisfied, ordinary graph projection may make B eligible.
6. If the read is incomplete, unreadable, or contradictory, Dalph exposes the
   typed graph-read failure and releases no dependant. It does not busy-loop;
   a later activation may perform the accepted bounded read protocol.

The maintainer sees successful A together with B still waiting until the later
complete graph is durable. Dalph must not persist a released-dependant flag,
reuse the focused fact as complete graph coverage, equate restart with a read,
or terminate R while the later graph and other responsibilities remain
unsettled.

Forbidden-result mapping: D9 requires the later graph, D23 rejects partial
coverage, D29 keeps derived eligibility process-local, D30 makes the crash an
absence rather than an event, D34 forbids completion from quiescence, and D36
forbids a continuous unchanged-fact read loop.

### Proposed acceptance-test and cassette mapping

- `restart after focused success keeps B blocked until a later graph observation is durable`
- `a lost post-success graph response authorizes no dependant and resumes only that read`
- `an invalid post-success graph read keeps A successful and B blocked without busy-looping`
- Authored and recorded recovery cassette:
  `Restart keeps B blocked between A's success confirmation and the later graph`

## The later graph releases only what its complete current facts permit

### Starting situation

A has a recorded focused successful-completion observation. B previously
depended only on A, while D is another task that may concurrently become B's
prerequisite. No later complete graph has yet been accepted.

### Trigger and chronological behavior

1. Dalph records a `ReadTrackerGraph` intent and waits for its append, asks the
   tracker for the complete target closure, and records the normalized graph
   observation before any delivery projection consumes it.
2. If graph G1 reports A `CompletedSuccessfully`, B open, and every B
   prerequisite successfully complete, ordinary graph projection removes the
   prerequisite exclusion from B.
3. If G1 instead reports D as an unfinished prerequisite of B, A no longer
   blocks B but B remains ineligible because of D. Dalph neither claims D on
   B's behalf nor calls any separate dependant-release boundary.
4. If G1 reports A terminal without success or reopened, A still does not
   satisfy B. The focused success stays in workflow history, current tracker
   facts govern B, and the contradiction or lifecycle change remains visible
   for reconciliation.
5. If G1 omits B from complete target membership before B has an exact
   outstanding workflow responsibility, B is not selected. If B already has
   one, the existing membership-constraint behavior retains it instead of
   treating removal as cleanup.

There is no tracker mutation called “release dependant.” Release means only
that the current complete graph no longer excludes a task for an unfinished
prerequisite. Dalph persists neither that derived result nor a release event.

If Dalph crashes after the graph-read intent, restart resumes only that exact
read protocol. If the tracker returns G1 but Dalph dies before the observation
append, the return authorizes no dependant and restart repeats the unresolved
read. A typed incomplete, contradictory, or unreadable result authorizes no
projection; the tracker adapter applies its selected bounded read policy, and a
later Run activation may try a new logical read. After G1 is durable, restart
reconstructs its graph facts without another completion request.

The maintainer sees the current reason B can or cannot proceed. Dalph must not
release B from A's historical success when G1 disagrees, overlook D, persist a
frontier or release flag, manufacture target membership, or settle B's existing
outstanding workflow responsibility from a graph edit.

Forbidden-result mapping: D8 requires an exact exclusion reason, D9 makes G1
the authority for eligibility, D10 retains an existing outstanding workflow
responsibility, D11 forbids creating one from placement, and D29 keeps the
projection process-local.

### Proposed acceptance-test and cassette mapping

- `releases B only when the later complete graph reports every prerequisite successful`
- `keeps B blocked when the later graph adds unfinished D`
- `does not release B when the later graph reports A terminal without success or reopened`
- `does not persist or call a separate dependant-release operation`
- Authored and recorded graph cassette:
  `The later complete graph gives the current reason B may proceed`

## Accepted S1-S5 scenario-to-test mapping

The implementation must preserve these five chronological scenarios and prove
each through the named seam before handoff:

- S1, `Dalph confirms A, then a later graph read permits B`: focused success
  precedes KC cleanup and only a later complete graph makes B eligible. Prove
  with `completes exact A ...`, `records focused success ...`, and the happy
  authored/recorded cassette.
- S2, `A lost completion response is reconciled ...`: fresh success avoids a
  duplicate call; open alone does not authorize retry; positive `NotApplied`
  plus fresh premises permits the same request up to three calls. Prove with
  `checks A after losing ...`, `reuses exact Q ...`, and the ambiguous cassette.
- S3, `A tracker client changes A ...`: human success is accepted; foreign,
  terminal, revision, and reopen outcomes stay task-local and preserve C.
  Prove with the conflict cassette and focused authority tests.
- S4, `Restart between success confirmation and graph refresh ...`: a crash
  retains A's focused success but keeps B blocked until the later graph append.
  Prove with the recovery cassette and append cut-point tests.
- S5, `The later graph releases only what ...`: current complete facts alone
  decide each dependant; added blockers, reopenings, and membership changes do
  not manufacture release. Prove with the graph cassette and frontier tests.

The complete-task request, focused observation, and later complete graph are
separate workflow occurrences. No `dependant release` mutation or persisted
frontier is added. The three-call completion bound is part of every S1-S3
retry/restart test; cleanup from #141 may wait independently of S4/S5.

## Model, executable adapter, and reopening seams after acceptance

The current owning model is `specs/integrationFinality.qnt`. It presently keeps
`completeTaskRequests` and `dependantReleases` at zero to prove issue #141 does
not absorb issue #61. Acceptance and implementation should extend that model
rather than create a parallel completion model. The corresponding deterministic
scenarios belong in `specs/integrationFinality_test.qnt`, and the production
seam remains the executable integration-finality adapter under
`packages/dalph/test/conformance/`.

The same implementation change amends the issue #138 and #141 scenarios as
described above, their authored/recorded cassettes, and #141's current
production history rule. #141 now recognizes successful completion from the
focused task observation; only #53's later complete target-closure observation
may release dependants. Leaving those artifacts unchanged would encode two
competing answers to which first observation proves A successful.

The extension must model the exact Q identity and evidence bindings, completion
intent and numbered calls, lost response, exact-request result lookup, explicit
non-application proof, focused success observation, later complete graph
observation, and dependant eligibility. It must state at least these properties:

- exact promotion, evidence, KC, current task facts, and current ancestry
  precede a completion call;
- every completion call has its durable intent and uses Q unchanged;
- a second call requires a fresh reconciliation result that explicitly proves
  non-application and unchanged exact preconditions;
- only a focused fresh tracker observation establishes successful completion;
- no dependant eligibility change occurs until a distinct later complete graph
  reports successful prerequisites; and
- a task-local ambiguity or human conflict does not stop independent C.

The executable adapter must replay every applicable durable cut point before
intent, after intent, before and after each focused authorization read and Git
ancestry read, after each numbered call intent, after an acknowledgement or
lost response, before and after the exact-request result lookup, after each
focused success observation, and before and after the later graph append.
P0-P6 remain conformance-test labels only, never production phases. Issue #142
owns later SQLite reopening qualification; issue #61 should add only the
applicable in-memory paths at its current dependency point. The happy and
lost-response cassettes above satisfy issue #165's readable register and must
feed issue #167's later graph-eating capstone.

## Gate outcome

This accepted chronology is the implementation gate. Runtime changes are
required and must keep the S1-S5 mapping above; #53, #60, and #141 remain open
dependency edges and are not closed or absorbed by #61.
