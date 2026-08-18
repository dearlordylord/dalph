# Recover or quarantine one integration session

Issue: [Retry, replace, or quarantine an integration session](https://github.com/dearlordylord/dalph/issues/68)

Status: accepted in the maintainer conversation on 2026-08-14.

These scenarios concern the outer Integrator only. Its merge, repository-check,
review, provider-turn, and private retry decisions are deliberately invisible
to generic Dalph.

## Dalph disappears while the Integrator session is unfinished

### Starting situation

No person triggers the failure. Task A has an integration-ready commit C, a
started integration responsibility at the front of target T's Journal-derived
queue, and one persistent integration session S with fixed target head H and
an isolated candidate resource. The Integrator has not reported a prepared
candidate or a conclusive unsuccessful result. Independent task B does not
need T.

### Chronology and visible result

1. Dalph disappears while the Integrator implementation may still have work in
   S. Process-local workers, polling, and target positions disappear with it.
2. On restart, Dalph reconstructs A's unfinished responsibility and S from the
   Journal. It does not append a crash occurrence.
3. Ordinary delivery again selects A for T. Dalph gives exact S back to the
   Integrator, whose implementation reads or reconnects to its own session.
4. B remains eligible and can progress under its own resources.

The operator need not click anything. Dalph must not quarantine S merely
because its own process disappeared, create another session, retransmit a
provider-private Codex turn, or block B.

### Scenario-to-test mapping

- `automatically restores the same unfinished integration session after process loss`
- `continues unrelated runnable work while an integration session is restored`

## The Integrator run ends without a usable candidate

### Starting situation

The same A, C, H, T, and S exist. One Integrator run for S has ended. It reports
conclusive non-success or no prepared candidate, or its provider reports no
owned activity from which that run can still progress. Alternatively, it names
M and Git conclusively reports that M is missing, is not a commit, or does not
have ordered direct parents `[H, C]`.

### Chronology and visible result

1. Dalph records the exact unsuccessful result or invalid-candidate
   observation. If the provider reports no owned activity, Dalph records that
   exact absence before it records the quarantine.
2. Dalph records one quarantine occurrence for S and preserves C, the claim,
   queue position, S, its isolated resource and edits, provider evidence, and
   error evidence.
3. If Dalph disappears after recording provider absence but before recording
   the quarantine, restart reads that absence, records the same quarantine,
   and does not call the provider again.
4. Dalph releases the live worker and process-local position for T and stops
   session-specific polling.
5. Because A is still first for T, later integration responsibility A2 for T
   cannot pass it. Work that does not require T remains eligible.
6. The operator can choose Retry or Full rerun for this quarantine occurrence.

Dalph does not automatically start another outer Integrator run after a
conclusive result. It must not discard the preserved work, mark A complete,
release A's claim, or turn the local failure into a Run-wide stop.

### Scenario-to-test mapping

- `quarantines one conclusively unsuccessful Integrator session and preserves its evidence`
- `blocks later same-target integration while unrelated work continues`
- `rejects a candidate whose Git object or ordered parents are invalid`
- `records provider-owned absence before one idempotent provider-failure quarantine`
- `recovers Q after absence was durably recorded before the process disappeared`

## The operator retries the same session

### Starting situation

Session S is quarantined at Journal position Q with its original fixed H. The
client submits Retry more than once with the same typed fingerprint
`(S, Q, Retry)` because it did not receive the first response.

### Chronology and visible result

1. Dalph accepts and records only the first valid direction for Q. The Journal,
   not a cache or counter, is the deduplication authority.
2. Ordinary delivery sees that recorded direction and starts exactly one new
   outer Integrator run using the same S and isolated resource.
3. If Dalph disappears after recording the direction, restart applies it
   automatically; the operator does not submit it again.
4. Repeated identical requests return the already-selected result. A later
   conflicting Full rerun request returns a conflict and starts nothing.
5. If the exact retry run ends without a usable candidate, the conclusive-run
   scenario applies again: Dalph records a new quarantine occurrence Q2 and
   does not start an unapproved third run. Q2 permits Full rerun only because
   the one allowed Retry for S has already been used.

If Git now reports a target head other than H, Dalph starts no Integrator run.
It records a fresh quarantine occurrence explaining that Retry is no longer
applicable; the operator may choose Full rerun for that new occurrence.

The operator sees one retry, not one per network delivery. Dalph must not make
the Integrator retry its private steps, create a new session for Retry, or run
against a target head different from S's fixed H.

### Scenario-to-test mapping

- `deduplicates repeated Retry requests by session quarantine and direction`
- `applies a recorded Retry after restart without another user request`
- `rejects a conflicting direction after the first choice`
- `starts no retry when the session target head has changed`
- `records a fresh quarantine after the authorized Retry run ends conclusively`

## The operator requests a full rerun

### Starting situation

Session S is quarantined at Q. The client submits Full rerun with fingerprint
`(S, Q, FullRerun)`. Git freshly reports current compatible target head H2.

### Chronology and visible result

1. Dalph records the first valid direction for Q exactly once.
2. Dalph preserves S and its resource as predecessor evidence. Cleanup is a
   later separately authorized responsibility.
3. It preserves A's same integration responsibility and queue position, fixes
   a successor session S2 and isolated resource against H2, and gives S2 to the
   Integrator through ordinary delivery.
4. If Dalph disappears at any point, restart continues the recorded direction
   and creates or restores at most that one S2.

The operator sees a fresh run of the same queued integration responsibility.
Dalph must not move A behind later work, reuse S's fixed H, delete S, create two
successors, or special-case restart as a different delivery path.

### Scenario-to-test mapping

- `full rerun preserves queue position and starts one successor session at the fresh head`
- `preserves predecessor resources for separately authorized cleanup`
- `recovers a recorded full rerun without creating a second successor`
- `delivers the already-recorded FullRerun successor after restart`
