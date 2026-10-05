# Alice preserves a worktree when local integration promotion is blocked

This refines [#438](https://github.com/dearlordylord/dalph/issues/438).

## Governing behavior

Preserve [remote publication before local promotion and tracker finality](direct-remote-publication.md)
and [promotion of the qualified Integrator candidate](migrate-promotion-and-finality.md).
The existing coordinator capability owns cooperative mutations in one canonical
Git common directory. The safety check and compare-and-set stay inside that
capability; neither a saved inventory nor an earlier read authorizes a write.
External Git users do not participate in this cooperative lock. This slice
makes no machine-wide atomic occupancy guarantee against an external checkout
racing after the final inventory read. Git's expected-old-SHA comparison still
rejects a competing ref movement. Dalph never automatically changes an occupied
checkout to resolve the blocker.

## R1 — Unoccupied direct target

Alice has an exact qualified candidate M, expected local head H, and durable
remote publication proof. The target is a direct ref and no registered worktree
checks it out. Dalph records the existing promotion intent, reads the current
head and ancestry, and checks direct-ref identity and complete worktree inventory.
Before a mutation it records the numbered intent and checks safety again inside
the existing coordinator capability, then sends update-ref with expected H.
Only Git success or reconciled M ancestry permits promotion proof and ordinary
tracker finality. No executor or remote push is repeated.

New acceptance: `target-promotion-safety.test.ts` — “promotes an unoccupied direct
ref with the exact expected head”; existing outer-protocol and real-Git CAS tests
retain exact-head and finality requirements.

## R2 — Clean or dirty occupied target

Alice or another Git user has the target checked out in the main or a linked
worktree, with clean, staged, unstaged, or untracked files. Existing remote proof,
candidate and claim remain valid. Promotion observes the exact registration and
returns a typed precondition refusal naming that worktree before update-ref.
It preserves ref, index, files, candidate and claim. This refusal is distinct from
an ambiguous mutation response. Dalph performs no checkout, reset, clean or
worktree removal. Occupancy is read from Git, never retained as a UI authority.

New acceptance: `target-promotion-safety.test.ts` — “refuses clean and dirty
occupied targets without changing refs, index or files”.

## R3 — Unknown identity, inventory or changed facts

Git returns unreadable, incomplete, contradictory or duplicate registration
facts, or cannot prove that the configured target is direct. Dalph refuses
before mutation and reports the failed boundary. A safety read failure cannot
mean unoccupied. An earlier safe read followed by occupancy before mutation is
refused by the mutation-boundary recheck; a changed H is rejected by CAS.
Lost coordinator ownership prevents the guarded mutation. The supported race
boundary is the cooperative scope above, not all Git users on the machine.

New acceptance: `target-promotion-safety.test.ts` — “refuses unreadable inventory
and non-direct targets before mutation”, “rechecks occupancy at the mutation
boundary and preserves exact-head rejection”; existing coordinator-ownership
negative controls prove refusal after ownership loss.

## R4 — Resolve a blocker without repeating delivery

Remote publication has succeeded, but the target is occupied. Dalph retains
that proof and integration responsibility, reports the safety refusal, and does
not complete the tracker task. Alice explicitly resolves the checkout outside
Dalph. The next authorized activation re-reads Git and finishes the existing
promotion and finality; it does not create another executor or publish M again.
Exit/restart retains the same request and remote proof. If a crash follows a
numbered promotion intent, recovery reconciles Git before any retry. M already
current or in target ancestry is observed as applied without another update-ref,
even when the target subsequently became occupied. Existing bounded retry and
claim/continuation authority remain required; this adds no retry permission.

New acceptance: `outer-protocol.test.ts` — “retains remote proof across an occupied
target refusal and promotes after explicit checkout resolution”; Memory and
reopened SQLite exercise intent/refusal/recovery cuts. Existing promotion
lost-response and publication/finality recovery cases remain governing.

Inspection and refusal are reads, so they have no ambiguous mutation to retry.
A crash after update-ref retains the existing uncertain-effect reconciliation
rule. Cleanup never treats an occupied checkout as a disposable recovery resource.
