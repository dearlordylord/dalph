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

- `gives one exact session to the Integrator and qualifies its reported candidate`
- `never exposes Integrator-private work as separate Dalph stages`
- `restores the same unfinished Integrator session after process loss`
- `does not infer a candidate from resource head or process success`
- `rejects a reported candidate unless Git proves ordered parents H then C`

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

- `stops before the Integrator when Git cannot prove compatible target lineage`
