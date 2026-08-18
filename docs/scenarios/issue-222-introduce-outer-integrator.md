# Ask one Integrator session to prepare the exact candidate

Issue: [Introduce the outer Integrator boundary](https://github.com/dearlordylord/dalph/issues/222)

Status: accepted on 2026-08-14. This replaces the former scenario in which
Dalph scheduled candidate construction, correction, review, and repository
verification as separate stages.

## An integration-ready result produces a usable candidate

### Starting situation

No person directly triggers this work. An executor has finished one task
attempt with commit C. Delivery has derived the integration-ready result and
the Journal contains its started integration responsibility and fixed queue
position. Git reports target head H and proves the attempt's planned Base is an
ancestor of both H and C. No integration session has been started for this
responsibility.

The relevant systems are Dalph, Git, and one injected Integrator. The first
implementation uses Codex app-server, but Codex turns and messages are private
to that implementation.

### Chronology

1. Ordinary delivery selects this responsibility when it is first for its
   target and the target's process-local position is free.
2. Dalph fixes one integration-session identity and one isolated candidate
   resource for the exact Run, task attempt, C, target, and H, and records that
   the integration responsibility began.
3. Dalph asks the Integrator to start one run for that exact session. It does
   not ask for merge, test, review, or correction stages separately.
4. Inside its boundary, the Integrator owns merge construction, conflict
   resolution, repository checks, review, provider turns, and private retries.
5. The Integrator reports that candidate M is prepared. It does not update the
   configured target ref.
6. Dalph asks Git for M's object kind and complete ordered direct parents. Git
   reports one commit with parents exactly `[H, C]`.
7. Dalph records that observation and makes the exact M eligible for the
   separate compare-and-set promotion protocol.

The operator can see one integration session with one prepared candidate.
Dalph must not infer M from resource HEAD, prose, process exit, or an unreported
commit; expose the Integrator's private stages as Dalph work; reverse the
parents; substitute a newer H; or update the target before promotion.

### Crash and repeated activation

If Dalph disappears after step 2 or while step 3 is still unfinished, restart
reconstructs the same responsibility and session from the Journal and gives
that session back to the Integrator. It does not interpret process loss as an
unsuccessful Integrator result and does not start a replacement session.

If Dalph disappears after the Integrator has produced its result but before
step 7, restart obtains the existing result for the same session and performs
the Git read. An ambiguous Git read is reconciled by reading Git again; the
Integrator run is not repeated merely because Dalph lost the Git response.

### Scenario-to-test mapping

- `successful preparation returns only the Git-qualified canonical M`
- `the public result schema contains no Integrator-private stages`
- `process loss before the outer result reuses the same unfinished session`
- `resource HEAD never supplies an unreported candidate`
- `wrong ordered parents do not qualify the explicitly reported M`

## A conclusive unsuccessful result remains visible and stops automatically

### Starting situation

No person directly triggers this work. Dalph has durably fixed the exact
integration session after Git proved the compatible target head H. The
Integrator has completed its private work but cannot produce a usable
candidate. The relevant systems are Dalph and the injected Integrator; Git has
no reported candidate to inspect.

### Chronology

1. Dalph resumes the already fixed session and asks the Integrator for its
   result.
2. The Integrator reports `NotPrepared` with an operator-visible detail.
3. Dalph records that exact result and stops automatic work for the session.
4. A later ordinary activation reconstructs the same conclusive result and
   does not call either the Integrator or Git again.

The operator sees the exact session and its conclusive detail. Dalph must not
invent a candidate, treat the result as process loss, create a successor
session, automatically retry the Integrator, or ask Git to infer a candidate
from the resource.

No boundary crash or retry applies after the durable result: the result is
conclusive, and operator-directed retry or replacement belongs to issue #68.

### Scenario-to-test mapping

- `conclusive NotPrepared is retained for quarantine and is not automatically retried`

## Git rejects the Integrator's reported object

### Starting situation

No person directly triggers this work. The Integrator has reported candidate
text M for the exact fixed session and Dalph has recorded that result. M may be
missing, name a non-commit object, or name a commit whose complete ordered
direct parents are not exactly `[H, C]`. The relevant systems are Dalph, Git,
and the already-completed Integrator session.

### Chronology

1. Dalph records its intent to inspect the explicitly reported text M.
2. Dalph asks Git to resolve M, inspect its object kind, and, only for a
   commit, return all direct parents in order.
3. Git reports `Missing`, `NonCommit`, or the canonical commit and its actual
   ordered parents.
4. Dalph records that exact observation and marks the reported candidate
   ineligible for promotion.
5. A later ordinary activation reconstructs the rejected state without
   rerunning the Integrator.

The operator sees the reported M and Git's exact rejection evidence. Dalph
must not promote M, infer a replacement from resource HEAD, reorder or omit
parents, reinterpret a tag or tree as a commit, or start a successor session.

If the Git read outcome is ambiguous rather than durably observed, Dalph reads
Git again after restart. It does not retry the completed Integrator session.

### Scenario-to-test mapping

- `Missing and NonCommit Git objects never qualify as candidates`
- `wrong ordered parents do not qualify the explicitly reported M`
- `a Git read failure leaves its intent and restart rereads Git without rerunning Integrator`

## Rewritten target lineage stops before the Integrator

Git reports H but does not prove that the attempt's planned Base is an ancestor
of H. Dalph records no integration-session start and does not call the
Integrator. It preserves the integration-ready result and responsibility for
the accepted Git reconciliation path. There is no outside mutation to retry;
restart repeats the required Git qualification rather than manufacturing a
session.

The operator sees a lineage constraint. Dalph must not reset H, merge unrelated
histories, rewrite C, or release the responsibility as complete.

### Scenario-to-test mapping

- `incompatible target lineage stops before session creation`
