# Issue #73: qualify real Git lineage, candidate shape, and ref mutation

Issue: [Qualify Git lineage, candidate, and ref behavior](https://github.com/dearlordylord/dalph/issues/73)

These scenarios qualify the existing provider-neutral Git boundaries from
#139, #57, and #60 against disposable local repositories. Git owns commits,
ancestry, refs, and atomic ref updates. Dalph records and classifies the facts
returned by Git; it never repairs a rewritten target, infers a candidate from a
worktree tip, or replaces a compare-and-set with a force update.

The candidate-submission transport and a future private session-owned
candidate ref remain the lower-level adapter work deferred by #57. This issue
qualifies the Git observations that consume an explicit submission and the
configured target ref that #60 promotes.

## Dalph observes compatible, rewritten, and unrelated target lineage

### Starting situation

No person directly triggers this qualification. A Dalph coordinator has an
immutable planned Base commit `B` and an integration target pointing at
`refs/heads/main` in a temporary local repository. Git contains one target
head `H` descended from `B`. A second branch contains an unrelated root `U`.
The repository and target ref are the only outside authorities involved; no
GitHub, executor, journal, or worktree mutation is needed for this read.

### Trigger and chronological behavior

1. The coordinator receives a request to read the target's current lineage.
2. It calls Git to resolve the configured target ref to one complete commit
   SHA, then calls Git's ancestry check for `B` and that exact head.
3. Git returns a typed observation saying that `B` is an ancestor of `H`.
   Dalph may continue the attempt; it does not require `B` to equal `H`.
4. The outside repository is changed so the same target ref points at a
   rewritten or unrelated head `U`.
5. The coordinator repeats the same read. Git returns the exact `U` head and
   a typed non-ancestral observation. Dalph preserves the attempt and records
   the constraint selected by the existing reconciliation protocol; it does
   not reset or overwrite `U`.

There is no ambiguity-crossing effect in this scenario. A crash or retry does
not authorize a mutation: a later activation repeats the read and only the
fresh Git observation can clear or retain the constraint. If target-ref
resolution or ancestry is unreadable, the adapter returns a typed Git read
failure rather than treating the ref or ancestry as absent.

The maintainer can see the exact current head and whether the immutable Base
is its ancestor. Dalph must not infer compatibility from equal file content,
rewrite the target, or block unrelated work because one attempt has a
non-ancestral target.

### Acceptance test

`reads real compatible, equivalent-content, rewritten, and unrelated target
lineage without mutation` uses a temporary repository through the public
`GitTargetLineage` seam and asserts the exact heads and typed observations.

## Dalph validates an explicit candidate's object and ordered parents

### Starting situation

No person directly triggers this qualification. An integration session has
already explicitly submitted candidate object `M` for expected target head
`H` and accepted result `C`. The candidate repository contains a commit whose
raw direct-parent headers are exactly `[H, C]`. It also contains a normal
single-parent commit and a tree object; another submitted SHA is absent.
The integration session and candidate resource are already fixed by #57. This
boundary only asks Git to qualify the submitted object.

### Trigger and chronological behavior

1. Dalph asks Git for the submitted object's type.
2. For a commit, Dalph asks Git for the raw commit body and decodes every
   ordered `parent` header.
3. Git returns `Commit([H, C])`, so the provider-neutral candidate protocol
   can establish the exact two-parent candidate. Dalph does not update the
   configured target ref or claim that the candidate is verified.
4. If the submitted SHA is missing, is a tree, or has one or otherwise wrong
   ordered parents, Git returns the distinct typed `Missing`, `NonCommit`, or
   `Commit` observation. The protocol returns the concrete correction reason
   to the same session and preserves its work.
5. If Git cannot complete either object read, Dalph returns a typed
   unreadable-Git failure. It preserves the explicit submission for a later
   read and does not ask the agent to resubmit it.

The coordinator may crash after the explicit submission or after Git has
applied a read but before Dalph records the observation. Recovery rereads the
same submitted SHA from the same repository before another agent request. It
does not infer a candidate from the newest worktree commit or create a second
session. The private candidate-ref pinning and submission transport do not
apply because they are explicitly deferred by #57.

The maintainer can distinguish exact parents, a missing object, a non-commit,
an invalid parent shape, and unreadable Git. Dalph must not reverse parent
order, accept equivalent content, promote an unverified object, or discard
the isolated session after a read failure.

### Acceptance test

`reads real candidate objects and preserves exact ordered parents and typed
negative observations` uses the public `IntegrationCandidateGit` seam against
the same temporary repository.

## Dalph compares and sets the target ref, then reconciles a lost response

### Starting situation

No person directly triggers this qualification. A verified candidate `M` has
exact first parent `H`, and the target ref currently resolves to `H`. The
promotion request names only that repository, ref, candidate, and expected
head. The process-local coordinator ownership guard is supplied by #214 at a
higher boundary; this adapter test concerns Git's exact ref effect.

### Trigger and chronological behavior

1. Dalph resolves the configured target ref and checks whether `M` is current,
   an ancestor, or absent from the current target ancestry.
2. With exact `H` observed, Dalph asks Git for one atomic
   `update-ref <target> M H` compare-and-set. Git either applies it and
   returns `Applied(M)`, or rejects it because the ref no longer equals `H`.
3. A stale rejection returns the exact current head as a typed
   `RejectedExpectedHead` result. Dalph preserves `M` and sends no force
   update or reset.
4. To qualify ambiguity, the repository wrapper applies `H -> M` but loses the
   response before Dalph receives it. The adapter returns a typed
   `TargetPromotionCompareAndSetFailure`; it does not claim success or failure.
5. Before any retry, Dalph performs the read from step 1 again. Git now proves
   `M` is the current target head, so the protocol records promotion without a
   second `update-ref`.

If the coordinator crashes after the compare-and-set intent or lost response,
restart preserves that intent and rereads Git before another mutation. If the
read is unreadable, Dalph waits with the candidate and evidence preserved. A
later exact-H observation is the only permission for a numbered retry. The
target ref is discovered by its configured full ref name; a missing or
unreadable ref is a typed read failure and is never silently created or
replaced.

The maintainer sees either exact promotion, a stale head, or an unresolved
ambiguity followed by a Git read. Dalph must not retry before that read,
send a duplicate update after `M` is already current, force-update a stale
head, or treat equivalent content as ancestry proof.

### Acceptance test

`applies a real exact-head compare-and-set and reconciles an applied update
whose response was lost before retry` uses the public `TargetPromotionGit`
seam with a temporary repository and a controlled post-application response
loss. It asserts one Git mutation, a typed ambiguous result, and a subsequent
read that discovers `M`.

## Scenario-to-test mapping

| Scenario | Concrete result | Acceptance test |
| --- | --- | --- |
| Compatible, equivalent-content, rewritten, and unrelated target lineage | Git returns exact target heads and ancestor/non-ancestor observations; equal trees do not substitute for ancestry; no mutation or inferred absence | `reads real compatible, equivalent-content, rewritten, and unrelated target lineage without mutation` |
| Explicit candidate object and ordered parents | `[H, C]` is accepted; missing, non-commit, wrong-parent, and unreadable outcomes stay distinct | `reads real candidate objects and preserves exact ordered parents and typed negative observations` |
| Exact ref compare-and-set and lost response | `H -> M` is atomic; stale is typed; an applied-but-unacknowledged update is reread before any retry and is not duplicated | `applies a real exact-head compare-and-set and reconciles an applied update whose response was lost before retry` |
