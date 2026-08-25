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

## Scenario-to-test map

| Scenario | Concrete acceptance outcome | Executable evidence |
| --- | --- | --- |
| 1. First preparation | One exact session materializes one candidate worktree, one privately owned Codex thread, one exact turn, and a public `PreparedCandidate` or sanitized `NotPrepared`; private ids remain absent. | `creates one candidate and returns the exact prepared envelope`; `keeps thread, turn, prompt, and private phases out of the public result`; `fails closed for provider errors and malformed porcelain blocks`; `seals a failed provider turn only as sanitized NotPrepared` |
| 2. Thread/start ambiguity and ownership | After a lost `thread/start`, complete pagination plus the exact recorded thread token adopts one thread. A sole same-cwd thread without that token, or a foreign token/correlation, fails closed and starts no turn. | `reconciles a lost thread-start response through the complete thread list`; `reads a complete persistent thread list and preserves malformed-list failures`; `rejects a pre-existing sole candidate thread without a durable start intent`; `rejects a foreign persistent thread before starting a provider turn` |
| 3. Turn ambiguity and terminal evidence | A lost turn response is reconciled by the exact owned token. A tokenless or foreign token is a contradiction and cannot cause a replacement turn; a failed terminal turn seals only sanitized `NotPrepared`. | `recovers a lost turn response without allocating a second token`; `fails closed on a tokenless terminal turn without starting a replacement`; `fails closed on a foreign terminal turn without starting a replacement`; `fails closed on duplicate exact turn tokens`; `seals a failed provider turn only as sanitized NotPrepared` |
| 4. Cleanup observation | Cleanup rereads the exact private revision, Git registration/path, exact owned thread token, background terminals, and process census. Unresolved intent/activity, stale authorization, live writers, foreign registration, and transferred ownership never become `Absent` or permit removal. | `carries the exact provider-private revision into candidate cleanup authorization`; `reads the exact private revision for authorization and rejects foreign evidence`; `does not silently omit candidate authorization when evidence reread fails`; `keeps an unreadable candidate pending without a terminal contradiction`; `keeps an unreadable post-removal observation retryable`; `returns foreign live-writer evidence and performs zero removal requests`; `returns foreign other-session evidence and performs zero removal requests`; `returns transferred-registration evidence and performs zero removal requests`; `fails closed when cleanup authorization carries a stale private revision`; `does not infer absence while an unresolved thread intent remains`; `requires exact thread, terminal, and process absence before settling a removal intent`; property `proves cleanup mutates only for exact ownership, registration, and quiescent activity` |
| 5. Cleanup mutation and retry | Cleanup writes removal intent, performs one coordinator-owned Git remove, then rereads Git/private/activity. A failed or unapplied remove with the exact resource still present remains retryable; exact absence becomes `AlreadyAbsent`/`Removed`; foreign or transferred state stays fail-closed. | `observes and removes only the authorized predecessor resource`; `rereads exact absence after a lost candidate-removal response`; `reconciles a failed exact removal before retrying the same resource`; `refuses a same-revision private predecessor replacement before Git removal`; `keeps cleanup retryable when the post-removal private tombstone disappears`; property `proves cleanup mutates only for exact ownership, registration, and quiescent activity` |
| 6. Process replacement and independent sessions | A genuine second Dalph process reopens the same private store and unfinished Codex thread, performs no duplicate model call, and seals the result. App-incarnation-wide unrelated activity does not block another exact session, while exact thread activity remains blocking. | `recovers one unfinished run after the app-server process is replaced`; production app-server census tests for exact process-backed activity and independent-session composition; direct private-store tests `reads absence, writes a record, and finds it by exact candidate path` and `replaces one session atomically and rejects malformed JSON`; mandatory live gate `pnpm qualify:codex` includes `codex-integrator-real-qualification.test.ts` |

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

The operator sees one terminal result or a typed fail-closed error. Dalph must
not ignore an unknown token and start another turn, seal `PreparedCandidate`
from a failed turn, or treat an active/ambiguous turn as terminal.

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
unresolved and the next attempt repeats the same observation. Dalph must not
fabricate the authorization revision from a local counter or infer absence
from a missing private record, missing path, or one incomplete activity page.

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
thread/background-terminal observation. An unrelated session's app-incarnation
descendant is nonblocking; an exact resource's live terminal/process remains
`Foreign`/`LiveWriter` until it disappears. Independent sessions therefore do
not block one another, while an exact foreign resource never becomes owned by
cwd coincidence.
