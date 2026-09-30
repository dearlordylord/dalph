# Issue #258: production Codex Integrator recovery and cleanup

Issue: [Production Codex Integrator recovery and cleanup](https://github.com/dearlordylord/dalph/issues/258)

Status: accepted implementation chronology. No person directly triggers the
provider boundary in these cases; a Dalph delivery activation, the Git
repository, the Codex app-server, its exact thread/turn, the provider-private
store, the execution substrate, and the coordinator ownership gate are the
systems in scope. Git owns refs and worktree registration, Codex owns thread,
turn, and process observations, and the provider-private store owns only the
Integrator's recovery facts. The workflow journal and public Integrator result
never carry Codex ids, prompts, tokens, or private records.

Each chronology starts with one exact worktree and planned attempt/Base SHA,
the fixed `IntegratorSessionCorrelation`, and no candidate result. The
candidate path is the canonical path derived from that session's resource.
Every ambiguous boundary records intent before the call and rereads the
authoritative Git, Codex, or private-store fact before repeating an effect.

### Provider representation of the accepted ownership proof

The exact thread token travels in Codex's supported `threadSource` field as
`dalph-integrator-thread:v1:<token>`. The app-server must return that same
source on creation and subsequent reads. Arbitrary `metadata` and
`ownedThreadToken` response properties are not a Codex wire contract. The
adapter decodes the supported source into its private branded ownership token;
it never substitutes candidate-cwd equality for ownership.

A newly created thread may be loaded without a persisted first user message.
After a lost creation response, a complete census therefore includes both
paginated `thread/list` and `thread/loaded/list`, deduplicated by provider id,
followed by exact reads. Missing pages or unreadable threads stop adoption.
An explicitly unmaterialized, idle thread is an empty pre-turn census only
when the provider's response names that exact thread and states that no first
user message exists; an ordinary missing rollout is not that proof. A crash
that loses an unmaterialized thread permits a same-token creation only after
the complete census proves absence. A persisted or loaded matching thread is
adopted once; duplicate/foreign ownership still blocks all turn starts.

Thread history mode determines the read boundary. A legacy full-history read
may legitimately contain zero turns. A paginated thread requires every turn
page with full items, even when an embedded summary contains some turns.
Summary omission must not become an empty census or a fabricated terminal
result. The supported installed binary must exercise these contracts in the
real app-server qualification, using a local deterministic model endpoint.

These representations repair the accepted ownership, complete-census, and
lost-response scenarios above without changing their visible results or
authorizing a new retry. Focused protocol tests cover source decoding,
loaded-only adoption inputs, pagination failures, legacy empty histories, and
full paginated terminal items; the Integrator tests continue to cover exact
adoption, no duplicate turns, replay, and cleanup.

## Scenario-to-test map

| Scenario | Concrete acceptance outcome | Executable evidence |
| --- | --- | --- |
| 1. First preparation | One exact session materializes one candidate worktree, one privately owned Codex thread, one exact turn, and a public `PreparedCandidate` or sanitized `NotPrepared`; private ids remain absent. | `creates one candidate and returns the exact prepared envelope`; `keeps thread, turn, prompt, and private phases out of the public result`; `fails closed for provider errors and malformed porcelain blocks`; `seals a failed provider turn only as sanitized NotPrepared` |
| 2. Thread/start ambiguity and ownership | After a lost `thread/start`, complete pagination locates candidate thread identities, then an exact per-thread reread plus the recorded thread token adopts one thread. A list entry that omits status or turns remains an explicitly partial summary: it is not proof of idle state or an empty turn census. A sole same-cwd thread without the exact token, a foreign token/correlation, or an unreadable exact thread fails closed and starts no turn. | `reconciles a lost thread-start response through the complete thread list`; `keeps partial thread-list summaries distinct from exact thread snapshots`; `reads every persistent thread-list page before reporting a complete identity list`; `reads a complete persistent thread list and preserves malformed-list failures`; `rejects a pre-existing sole candidate thread without a durable start intent`; `rejects a foreign persistent thread before starting a provider turn` |
| 3. Turn ambiguity and terminal evidence | A lost turn response is reconciled by the exact owned token. An ID-free `turn/completed` wake prompts an exact fresh thread/turn/token reread; it never proves completion. Active state waits without polling or retry; terminal state seals only after complete owned activity is `Absent`. Stored results replay only after fresh exact validation. | `recovers a lost turn response without allocating a second token`; `seals one active turn after an ID-free completion wake arrives before the start response`; `does not poll or retry an active Integrator turn without a completion hint`; `rereads only the exact Integrator thread after an unrelated completion wake and does not seal while active`; `recovers an already-terminal observed turn after app-server replacement`; `seals only after exact owned activity is absent`; `fails closed on a tokenless terminal turn without starting a replacement`; `fails closed on a foreign terminal turn without starting a replacement`; `fails closed on duplicate exact turn tokens`; existing sealed-result replay controls; `seals a failed provider turn only as sanitized NotPrepared` |
| 4. Cleanup observation | Cleanup rereads the exact private revision, Git registration/path, exact owned thread token, exact sealed terminal turn, background terminals, and process census. Unresolved intent/activity, stale authorization, live writers, foreign registration, transferred ownership, tokenless/foreign terminal evidence, contradictory terminal status, and unresolved worktree materialization never become `Absent` or permit removal. | `carries the exact provider-private revision into candidate cleanup authorization`; `reads the exact private revision for authorization and rejects foreign evidence`; `does not silently omit candidate authorization when evidence reread fails`; `keeps an unreadable candidate pending without a terminal contradiction`; `keeps an unreadable post-removal observation retryable`; `returns foreign live-writer evidence and performs zero removal requests`; `returns foreign other-session evidence and performs zero removal requests`; `returns transferred-registration evidence and performs zero removal requests`; `fails closed when cleanup authorization carries a stale private revision`; `does not infer absence while an unresolved thread intent remains`; `requires exact thread, terminal, and process absence before settling a removal intent`; `keeps an unresolved worktree materialization unreadable and non-removable`; `rejects tokenless, foreign, active, missing, and correlated terminal evidence`; `fails closed when the fresh terminal status contradicts the sealed private result`; property `proves cleanup mutates only for exact ownership, registration, and quiescent activity` |
| 5. Cleanup mutation and retry | Cleanup writes removal intent, performs one coordinator-owned Git remove, then rereads Git/private/activity. A failed or unapplied remove with the exact resource still present remains retryable; exact absence becomes `AlreadyAbsent`/`Removed`; foreign or transferred state stays fail-closed and conclusive. | `removes only the authorized predecessor and preserves every successor resource`; `rereads exact absence after a lost candidate-removal response`; `reconciles a failed exact removal before retrying the same resource`; `refuses a same-revision private predecessor replacement before Git removal`; `maps a failed removal race to DefinitelyNotApplied when registration transfers`; `maps a successful removal race to DefinitelyNotApplied when registration transfers`; `keeps cleanup retryable when the post-removal private tombstone disappears`; property `proves cleanup mutates only for exact ownership, registration, and quiescent activity` |
| 6. Process replacement and independent sessions | A genuine second Dalph process reopens the same private store and unfinished Codex thread, performs no duplicate model call, and seals the result. Two independent exact session threads are censused separately: unrelated activity does not block another session, while exact thread activity remains blocking. | `recovers one unfinished run after the app-server process is replaced`; `keeps two independent session threads scoped to their own activity`; production app-server census tests for exact process-backed activity; direct private-store tests `reads absence, writes a record, and finds it by exact candidate path` and `replaces one session atomically and rejects malformed JSON`; mandatory live gate `pnpm qualify:codex` includes `codex-integrator-real-qualification.test.ts` |

## 1. Dalph prepares one exact candidate

Before the activation, Git reports the planned worktree/Base facts and no
candidate worktree exists. The provider-private store has no record for the
fixed session. The app-server may be absent; no thread, turn, background
terminal, or provider process is known.

Dalph first writes a private record containing the exact session correlation,
canonical candidate path, app-server incarnation, and an allocated thread
ownership token. It records worktree intent before asking Git to add the exact
detached worktree, rereads Git after any ambiguous add response, and records
thread-start intent before `thread/start`. The app-server receives the exact
candidate cwd and token. Dalph then records the owned turn token before
`turn/start`, observes the exact returned turn token, waits for a complete
activity census, and parses only the final agent message.

If Dalph exits between any two listed writes or loses a boundary response, the
next activation rereads the same private record and external authority. It
reuses the same planned session/path/token and performs each mutation only when
the reread proves the preceding mutation absent or exact. A successful terminal
message is visible as `PreparedCandidate`; malformed output or a provider
failure is visible as `NotPrepared` with a safe detail. Neither result exposes
Codex thread/turn ids, prompts, ownership tokens, or private phases.

Dalph must not update the target ref, infer a candidate from resource HEAD,
return `PreparedCandidate` while an owned writer remains live, or create a
second session/path for the same planned attempt.

## 2. A lost thread response is recovered only by exact ownership

The provider has written `threadStartIntent` for the exact session and cwd.
Codex may have created the thread while the response was lost. Git and the
private record still identify the same planned candidate path.

On retry Dalph calls the complete `thread/list` boundary, follows every
`nextCursor`, rejects malformed/repeated/unbounded pagination, and reads each
candidate-cwd match. It adopts exactly one thread only when its durable
ownership token equals the private record's token and its thread read confirms
the exact cwd. A same-cwd thread without the token, a token belonging to a
foreign session, duplicate matches, or a partial page is a contradiction.

`thread/list` may return an identity-only entry, an incomplete summary that
omits either status or turns, or a complete summary carrying both fields. Dalph
keeps those three observations distinct. Completing every list page proves a
complete identity list only; an absent status does not mean `idle`, and absent
turns do not mean an empty turn census. Before status, turns, or ownership can
be used as exact execution-substrate facts, Dalph makes the per-thread reread
for the matching identity and requires its exact snapshot. If that reread is
unavailable, malformed, or incomplete, reconciliation stops without adopting
the thread or starting a turn.

If the list boundary itself crashes or returns an unresolved cursor, the retry
stops; it does not call `thread/start`. If a complete list proves no exact
thread, Dalph repeats `thread/start` with the same token only when the recorded
intent and authoritative app incarnation permit it. The operator sees a
prepared result, a typed provider failure, or a wait for reconciliation; never
an unowned adopted thread or duplicate persistent thread.

## 3. Turn recovery requires the exact token

The private record has crossed the `turn/start` boundary with one owned token.
Codex may have completed the turn while Dalph lost the response. On retry,
Dalph reads the exact thread and accepts one terminal turn only if its token
equals the current run token and its correlation is absent or exactly the
provider-owned shape. A tokenless turn, a foreign token, a duplicated token,
or a foreign correlation contradicts the private record before any mutation.

Only a complete absence census permits retrying `turn/start`, and the retry
uses the same durable token. If Codex reports `failed`, Dalph seals a
sanitized `NotPrepared` detail and never stores a candidate from a failed
payload. A completed turn is parsed once, after an exact activity census, and
then sealed with the matching `IntegratorRunCorrelation`.

When a later activation finds a stored conclusive result, it rereads the exact
thread and terminal turn again before replaying that result. A changed turn id,
active or foreign writer, tokenless turn, or non-absent activity census fails
closed instead of returning stale success.

The operator sees one terminal result or a typed fail-closed error. Dalph must
not ignore an unknown token and start another turn, seal `PreparedCandidate`
from a failed turn, or treat an active/ambiguous turn as terminal.

### 3a. An ID-free completion wake leads to an exact reread — accepted for #386

#### Governing behavior

When Codex leaves the exact owned turn active after `turn/start`, the accepted
[Scenario 3: Turn recovery requires the exact token](#3-turn-recovery-requires-the-exact-token)
continues to govern the durable turn token, exact terminal read, complete
activity census, and prohibition on a replacement turn. The relevant
[D22 reconcile-before-retry](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence),
[D23 incomplete-or-unreadable evidence](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence),
and [D24 no inferred completion](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
invariants remain in force. The outer recovery boundary is constrained by
[`acceptedResultIntegration.qnt`](../../specs/acceptedResultIntegration.qnt),
law `noAutomaticIntegratorSuccessor`, and executable model scenario
[`unfinishedIntegratorRestoresSameSessionTest`](../../specs/acceptedResultIntegration_test.qnt#L161),
which preserves one Integrator invocation and restores its existing session.

This chronology preserves Scenario 3's exact ownership, terminal, and
quiescence requirements. It refines only how an observed active turn resumes:
an ID-free wake triggers an exact reread. It supersedes no accepted behavior
and adds no outer retry or Integrator session. It makes no new app-server
notification contract. The formal model constrains the outer invocation and
session; it does not model the app-server notification transport or this
exact-thread wake/read sequence.

This chronology accepts the existing app-server `Stream<void>` completion
boundary. The app-server may receive thread or turn ids in its notification,
but the Integrator receives no ids. A wake means only that some turn completed
on this app-server; it never proves which turn completed or that this run is
terminal. A fresh exact thread and turn read owns that proof.

**Starting facts.** One delivery Run `R` has one immutable planned attempt `A`
at Base `B`, one accepted task commit `C`, and one fixed Integrator session
`S` against integration head `H`. The provider-private record identifies one
app-server incarnation `I`, exact owned thread `T` and thread token `t`, and
one Integrator run ordinal with durable owned-turn token `u`. The journal has
`IntegratorRunStarted(R, S, ordinal)` but no
`IntegratorRunResultRecorded(R, S, ordinal)`; no candidate `M` has been
reported. The only turn start allowed is the one recorded for `(I, T, u)`.
The Integrator does not own tracker closure, target-ref updates, remote push,
local promotion, or task-work cleanup; those remain later delivery boundaries.

**Outside event and trigger.** `turn/start` may return while exact turn `U` is
`inProgress`. Codex later emits `turn/completed`, or emits a completion for an
unrelated thread while this run is still active. The app-server broadcasts an
ID-free wake through its existing coalescing stream. A delivery activation
starts the provider call; no person directly triggers this app-server boundary.

**Ordered boundaries.** Before `turn/start`, Dalph attaches a listener scoped
to incarnation `I`, records the turn-boundary intent, and calls `turn/start`
once for exact thread `T`, cwd, and token `u`. It validates the returned
owned token and persists `TurnObserved(T, U, u)`. A terminal start response
proceeds to the exact activity census; an `inProgress` response waits for a
completion wake. The subscribed stream buffers a wake that arrives before the
start response. After a wake, Dalph resumes exactly thread `T` at the recorded
cwd and reads complete current turn history, including every page when history
is paginated. It requires
thread id `T`, cwd, ownership token `t`, exactly one turn id `U` with token `u`,
and no foreign correlation. Missing, duplicate, foreign, tokenless, unreadable,
or contradictory evidence fails closed. If the exact turn remains active,
Dalph waits for another wake without sealing, starting another turn, or
creating another session. An unrelated global wake therefore causes only this
exact reread.

Only exact terminal `completed` or `failed` status proceeds to the exact
background-terminal and owned-process census. The complete census must be
`Absent` before Dalph seals. A completed turn's final agent message is parsed
once into `CompletedTurnSealed` / `PreparedCandidate`; a failed turn is sealed
only as sanitized `NotPrepared`. The workflow records the result under the
same `(R, S, ordinal)` correlation. The listener closes when this provider call
settles or is interrupted.

**Crash, retry, and reopen.** Before turn intent, no turn mutation has
occurred. If `turn/start` response is lost, a replacement activation uses
Scenario 3's complete exact absence census before any same-token retry. After
`TurnObserved`, it never starts a replacement turn. The replacement attaches
its listener before its exact thread read: an already-terminal exact turn may
be reconciled immediately, while an active turn waits for a wake and rereads
exact state. A crash after terminal observation but before quiescence or private
sealing repeats those reads. After private sealing but before journal result
append, the replacement revalidates the same exact thread, turn, and absent
activity before replaying the sealed result, with no second model call. A lost
journal append response follows existing journal reconciliation.

**Visible and forbidden results.** The operator sees one terminal
`PreparedCandidate`, sanitized `NotPrepared`, or existing typed
unavailable/unreadable wait. An active turn without a wake remains pending; no
timer, polling fallback, candidate, push, or terminal seal is introduced.
Dalph must not infer completion from `task_complete`, notification payload ids,
or a global wake; start a second turn or session; parse a partial turn; or
update refs, push, promote, close the task, or clean up a live resource.

**Inapplicable fields.** There is no new person-triggered action, provider
mutation beyond the existing single `turn/start`, tracker revision, target-ref
observation, publication proof, promotion, or cleanup disposition. The
publication scenario owns those later boundaries. There is no timeout or timer
because accepted behavior is to remain pending without a wake.

**Acceptance tests.** The asynchronous path maps to:

- `seals one active turn after an ID-free completion wake arrives before the start response` — listener order, buffered wake, one exact reread, one seal;
- `does not poll or retry an active Integrator turn without a completion hint` — no extra reread, second turn, or session;
- `rereads only the exact Integrator thread after an unrelated completion wake and does not seal while active` — one wake causes one exact reread and the active result remains unresolved;
- `recovers an already-terminal observed turn after app-server replacement` — exact terminal recovery without a replacement turn;
- `seals only after exact owned activity is absent` — terminal evidence precedes a complete `Absent` census;
- existing sealed-result replay coverage — no second model call after a crash between private sealing and journal append.

Scenario 3 maps these outcomes to focused tests. This chronology does not
change the separate S1 executor notification diagnosis or authorize a live S1
rerun.

## 4. Cleanup rereads exact evidence before deciding

The cleanup authorization names the predecessor session/resource, operation,
and the private-record revision observed by the coordinator. Git may still
register the exact detached worktree; its path may exist or be missing. The
private record may contain thread-start, removal, or worktree intents. Codex
may report exact background/process activity, no activity, unreadable facts,
or a foreign thread token.

Dalph rereads the private record and compares its actual revision to the
authorization revision. It reads Git registration and filesystem path, then
reads the exact thread and background terminals and asks the process census.
An unresolved intent, stale revision, unreadable/contradictory activity,
foreign token, foreign registration, transferred path, or live writer returns
`Unreadable`/`Foreign` and never `Absent`; no Git removal call crosses the
coordinator gate.

There is no crash shortcut: if any reread response is lost, cleanup remains
unresolved and the next attempt repeats the same observation. A worktree
materialization intent with `worktreeReady=false` is also pending, never
present or removable. The exact terminal turn must be sealed, token-owned,
conclusive, and free of foreign correlation before process absence can settle
the cleanup. Dalph must not fabricate the authorization revision from a local
counter or infer absence from a missing private record, missing path, or one
incomplete activity page.

## 5. Removal intent is reconciled before retry

The initial cleanup observation is exact `Present`, quiescent, and owned by the
authorized predecessor at the matching private revision. Dalph writes
`removalIntent` before asking the coordinator-owned Git boundary to remove the
exact candidate path.

If Git returns an error or the response is lost while the exact registration
remains, Dalph rereads Git, private state, and activity. It returns a retryable
unknown result and leaves the exact resource/removal intent available for a
later reconcile-before-retry. The next attempt must observe the same exact
owner before issuing another remove. If the reread proves exact absence, it
settles the private marker and reports `Removed` or `AlreadyAbsent`. If the
resource is foreign or transferred, it reports `DefinitelyNotApplied` and
never retries against that resource.

A crash after removal but before the private marker write is handled by the
same reread; no local success is fabricated. A removal intent is never exposed
as `Absent` until the exact absence has been reread and the private marker has
been durably settled.

## 6. A replacement process reopens one unfinished session

The first Dalph process uses the node private store and a disposable Codex
fixture. It has written the exact worktree/thread/turn facts, Codex has
completed the turn, and the first process loses the `turn/start` response
before sealing the private run. The app-server process is then closed. The
private store file and Codex thread-state file remain intact; the model server
has received exactly one request.

A genuine second Dalph process starts with the same config, node private-store
locator, Codex state, repository, and planned `IntegratorRunCorrelation`. It
reads the unfinished record, resumes the exact token-owned thread, observes
the existing terminal turn, and seals the result without calling the model or
allocating a new thread/turn. The process exits with `PreparedCandidate` and
the model server still reports one call.

The production activity census scopes process-backed activity to the exact
thread/background-terminal observation. The acceptance test presents two
independent session threads to one census service and proves that activity in
the second does not block an absent first session; an exact resource's live
terminal/process remains `Foreign`/`LiveWriter` until it disappears.
Independent sessions therefore do not block one another, while an exact
foreign resource never becomes owned by cwd coincidence.
