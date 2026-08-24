# Revise the attempt ceiling for future Run-owned boundary scopes

Status: proposed for maintainer acceptance; this file does not authorize
implementation until its owning issue is accepted again.

Issue: [#64](https://github.com/dearlordylord/dalph/issues/64)

This proposal freshens issue #64 against the current application Exit,
planned-attempt executor, outer Integrator, and Run-policy boundaries. It
deliberately narrows the older phrases “shutdown grace,” “technical retry,” and
“integration-review limits” to one Run-owned policy value that generic Dalph
can apply without reaching inside another component.

The proposed **Run technical-attempt ceiling** is a positive whole number from
one through three. It is the maximum number of family-specific attempts one
newly begun, exact boundary scope may make. Three remains the initial value. A
terminal, contradictory, or unreadable result may stop a scope earlier; the
ceiling never requires another attempt and never permits a retry without that
protocol's ordinary intent, fresh observation, and reconcile-before-retry
rules.

The ceiling applies only to newly begun scopes in these closed Run-owned
families:

- task-claim acquisition, observation, and release;
- planned-attempt executor continuation and suspension commands;
- exact-head target promotion;
- completion-claim mutation and tracker completion; and
- disposition-authorized worktree, branch, and Integrator-candidate cleanup
  mutations.

It does not change tracker snapshot page or task limits, add a delay or remote
timeout, count a current-authority read as a mutation attempt, or control an
Operator-directed integration Retry or Full rerun.

The supported families retain distinct meanings and authority rules:

| Scope family | When the scope captures policy | What consumes one attempt |
|---|---|---|
| Task-claim acquisition | Its exact acquisition action begins | One complete fresh-read and, when still authorized, create-request pass |
| Task-claim observation | Its exact logical read action begins | One complete tracker claim read |
| Task-claim release | Its exact release action begins | One delete request; the required before/after reads do not consume deletion attempts |
| Planned-attempt executor work | Its exact executor-work responsibility begins | One accepted report authorizing continuation, or one durably intended suspension command, under the separately typed continuation and suspension counters |
| Target promotion | Its exact promotion intent is durable | One compare-and-set request; the required Git reads do not consume promotion attempts |
| Completion claim or task completion | Its exact replacement, deletion, or completion action begins | One corresponding tracker mutation request; focused authorization and confirmation reads do not consume mutation attempts |
| Disposition-authorized cleanup | The first mutation intent for one exact cleanup authorization is durable | One exact worktree, branch, or Integrator-candidate deletion request; fresh observations do not consume deletion attempts |

Each scope captures the policy in force at its first durable initiated action
or ambiguity-crossing intent. Journal order decides the race: a policy change
recorded first applies; a scope-start record written first retains the earlier
ceiling. Restart derives that captured value from the policy prefix preceding
the scope-start record. Dalph does not persist a second scope-policy snapshot,
retry counter, timer, queue, or other derived state.

## The Operator lowers the ceiling while one promotion scope is unfinished

### Starting situation

The Operator is watching Run R. Its beginning records task-work capacity two,
technical-attempt ceiling three, and policy revision one. Task A has an
accepted commit C, a prepared Integrator candidate M, and one target-promotion
intent for target head H. Git received the first compare-and-set call, but the
result was ambiguous. The promotion scope began under revision one and may
therefore make at most three complete compare-and-set attempts when its normal
fresh-Git reconciliation permits them.

Task B is otherwise eligible, but no claim-observation scope for B has begun.
The task tracker currently reports B in the target and Git still reports H as
the target head. The controlled acceptance fixture supplies those tracker and
Git facts; this scenario does not call a live provider.

### Operator action and Dalph chronology

The Operator asks the transport-independent Run control boundary to lower the
technical-attempt ceiling from three to one. The request names Run R, expected
policy revision one, ceiling one, and a non-empty reason.

1. Dalph decodes the Run identity, expected revision, ceiling, and reason.
2. Dalph reads R's complete Journal history and reconstructs revision one,
   capacity two, and ceiling three.
3. Dalph appends one past-tense Operator-initiated ceiling change at revision
   two. The event records the non-empty reason. It does not record command
   receipt or a derived active-scope projection.
4. The already-started promotion scope for A retains ceiling three. Before
   another compare-and-set call, it follows the promotion protocol's ordinary
   fresh Git read and exact-head checks.
5. A later claim-observation scope for B starts after revision two and captures
   ceiling one. If its one complete tracker read is unreadable, it reports the
   existing typed non-convergence result without a second read.

No crash occurs in this chronology. Retrying the promotion is governed by its
existing ambiguous-result reconciliation; the policy change grants no direct
permission to call Git.

### Visible and forbidden result

The Operator sees revision two with capacity still two and ceiling one. A's
promotion retains its earlier ceiling; B's later claim observation uses the
new ceiling.

Dalph must not reduce capacity, cancel A, reset A's promotion ordinal, allow a
fourth promotion call, make a second claim read for B, treat a fresh Git read
as another mutation attempt, or persist active-scope policy as separate
authority.

### Scenario-to-test mapping required from implementation

- `lowers the future technical-attempt ceiling without changing capacity or an active promotion scope`
- `a claim scope begun after the policy change stops at the new ceiling`
- `generated policy changes preserve every earlier scope ceiling and bound every later scope`

## Journal order decides a race between a policy change and new work

### Starting situation and trigger

Run R is at policy revision four with capacity two and ceiling three. The
Operator submits a ceiling-one request naming revision four while ordinary Run
activation is ready to begin one exact executor-continuation scope for task A.
No executor command has crossed its boundary yet.

The Run's existing command/admission exclusion serializes the two durable
actions. If the policy event is appended first, the later continuation scope
captures one. If the continuation intent is appended first, that scope captures
three and the later policy event affects only scopes begun afterward.

The executor receives no command until the continuation intent is durable.
The policy request itself calls no tracker, Git, executor, Integrator, or
cleanup boundary.

### Crash, retry, and visible result

If Dalph crashes after either first append, restart reads the Journal and uses
that exact order. It neither reorders the two facts nor substitutes the current
ceiling for the ceiling at A's scope-start position. Retrying the Operator
request names the same expected revision and either applies once or returns the
current typed revision conflict.

The Operator sees one deterministic winner. Dalph must not let both actions
claim they occurred first, send an executor command before its intent, or make
process scheduling order a second policy authority.

### Scenario-to-test mapping required from implementation

- `journal order decides whether a racing executor scope captures the old or new ceiling`
- `reopens both race prefixes without changing the captured ceiling or sending a duplicate command`
- `runActivation policy-change negative control turns red when a representative scope reads the latest policy instead of its start prefix`

## Capacity and ceiling requests share one policy revision

### Starting situation

Run R is at revision one with capacity two and ceiling three. The Operator has
two valid requests prepared: lower capacity to one and lower the ceiling to
two. Both name expected revision one. The capacity request belongs to issue
#54; the ceiling request belongs to #64.

### Dalph chronology

Dalph serializes both through the same Run-policy append boundary. The first
committed request writes revision two and changes only its named field. The
other request rereads the Journal, sees revision two rather than its expected
revision one, and returns a typed conflict containing the complete current
policy. It appends nothing and crosses no later workflow or provider boundary.

If the caller loses the successful response, repeating that request with
expected revision one also returns the revision-two conflict. The caller may
then deliberately submit a new request against revision two. A successful
ceiling change records its non-empty reason; a rejected request records no
applied-change event.

No crash-specific external reconciliation applies because the Journal append
is the only effect. SQLite transaction outcome and the subsequent exact read
decide whether revision two exists.

### Visible and forbidden result

The Operator sees either capacity one with ceiling three or capacity two with
ceiling two at revision two, followed by a precise stale-revision result for
the loser. Dalph must not merge the two commands silently, create two revision
two events, overwrite the winner, change capacity through the ceiling request,
or infer that a lost response means the append failed.

### Scenario-to-test mapping required from implementation

- `serializes capacity and technical-attempt changes under one Run-policy revision`
- `rejects a stale redelivery after a lost response without appending another policy event`
- `reopens the winning revision through memory and SQLite with the same complete policy`

## Invalid, unaudited, and no-op changes apply nothing

The Operator submits, one at a time, a ceiling of zero, a ceiling of four, a
blank reason, a request containing a capacity field, and a request that repeats
the current ceiling. Dalph decodes the closed request before reading or
appending Run history. The invalid values and extra field fail schema decoding.
The valid no-op request reads the current policy and returns a typed
unchanged-policy result.

No crash, retry, tracker, Git, executor, Integrator, or cleanup boundary applies
because no request reaches an ambiguity-crossing effect. The Operator sees the
exact rejection. Dalph must not increment the policy revision, accept capacity
through this command, record command receipt as application, or fabricate an
audit reason.

### Scenario-to-test mapping required from implementation

- `rejects an out-of-range ceiling, blank reason, capacity smuggling, and a no-op without appending`
- `generated ceiling requests accept only closed one-through-three values and non-empty reasons`

## Restart reconstructs current policy and earlier scope capture

Run R began at revision one with capacity two and ceiling three. Promotion
scope P began under revision one. The Operator later lowered the ceiling to one
at revision two, and Dalph then disappeared before another scope began. The
process-local policy signal, retry ordinals, timers, and active owners
disappeared; the Journal retained the Run beginning, P's exact start/intent
history, and the applied revision-two policy change.

On restart, Dalph reads the exact Run history. It reconstructs current ceiling
one for later scopes and derives P's ceiling three from the policy prefix at
P's start position. It reconciles P through the existing target-promotion
protocol before another compare-and-set call. A later completion scope captures
one. Repeated restart rereads the same facts and creates no policy event,
scope-policy snapshot, or attempt.

The Operator sees the same current policy and the same bounded continuation
after every restart. Dalph must not evaluate a replacement initial policy,
give P ceiling one, give the later completion scope ceiling three, restore a
retry counter as authority, or send an un-reconciled Git or tracker mutation.

### Scenario-to-test mapping required from implementation

- `restart reconstructs the latest ceiling and derives an earlier scope ceiling from its journal prefix`
- `recovery-prefix evidence preserves old and new scope ceilings through memory and reopened SQLite`
- `an authored policy-change cassette records the Operator action and later bounded scope without exposing derived counters`

## Deliberately excluded policy

These exclusions are part of the proposal and require no invented chronology:

- Graceful application Exit remains the process-wide fixed five-second limit.
  It is not Run policy, is not revised by #64, and may occur when no Run is
  active.
- The outer Integrator continues to own merge construction, repository checks,
  review, provider turns, and private retries. #64 neither exposes those stages
  nor changes their limits. A future configurable Integrator policy requires a
  separate accepted boundary and scenarios for when a session captures it.
- Provider-native retry, backoff, and session-retention settings remain behind
  the planned-attempt executor and Integrator boundaries.
- Tracker snapshot page/task limits, local coordinator-lock observation
  cadence, and remote latency metrics are not Run technical-attempt scopes.

## Proposed implementation ownership after acceptance

Implementation would extend the existing initial/current Run policy and its
single monotonic revision, add one separate Operator control request and
past-tense event, and make each listed protocol derive its ceiling from the
policy prefix at the scope's first durable record. The workflow Journal remains
the only durable policy history. No generic retry engine, persisted counter,
second policy store, configurable Exit deadline, or Integrator-internal stage
enters generic Dalph.

The implementation plan must map every chronology above to focused tests, an
authored and recorded cassette, and memory/SQLite recovery-prefix evidence.
The `runActivation` model and adapter own policy revision, reconstruction, and
one representative old-versus-new scope capture. The
`plannedAttemptExecutor`, `gitReconciliation`, `integrationFinality`, and
`taskFactReconciliation` models and adapters must be audited and updated for
their supported boundary families; disposition cleanup keeps its separately
accepted property/cassette/reopening evidence because no subject model owns
those three cleanup authorities. Every changed model needs a negative control
that fails when the old fixed bound or latest-policy substitution is restored.
Aggregate test and coverage totals are not this mapping.
