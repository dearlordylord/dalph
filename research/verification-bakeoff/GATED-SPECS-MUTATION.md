# Mutation analysis of the gated Quint specs

Applies the bake-off's detection protocol to this repository's six canonical
models under `specs/` that `pnpm check:quint` gates.

The question is not "do the invariants hold". The gate already answers that.
The question is **which invariants constrain the model at all**, which only
mutation testing answers.

```sh
node research/verification-bakeoff/mutate-specs.mjs
node research/verification-bakeoff/mutate-specs.mjs --spec gitReconciliation

# Deterministic, evenly distributed diagnostic slice; this is bounded evidence,
# not a replacement for the full mutation census.
node research/verification-bakeoff/mutate-specs.mjs \
  --spec taskFactReconciliation --max-mutants 12

# Apalache instead of sampling: exact within its step bound, far slower, and
# bounded by a mandatory per-invocation budget. One process at a time.
node research/verification-bakeoff/mutate-specs.mjs \
  --spec controlDirectionApplication --verify --verify-steps 8 --timeout 60
```

Sampling is flaky at depth, so a sampled survivor may be a missed kill rather
than a true one. `--verify` removes that doubt at roughly fifty times the cost:
`controlDirectionApplication.qnt` takes seconds sampled and 2m38s verified, and
returns the same per-invariant counts. A mutant whose budget expires is
recorded separately and never counted as a kill.

The harness perturbs the model one token at a time — actions, init, and the
derivations they use — discards mutants that no longer typecheck, and records
which gated invariant kills each one. Invariant and witness declarations are
never mutated: mutating an invariant measures whether it detects changes to
itself, which is not the question.

## Results

20 000 samples, 20 steps, Quint 0.32.0.

| Spec | Mutants | Killed by an invariant | By a witness only | Survive |
|---|---|---|---|---|
| `plannedAttemptExecutor.qnt` | 23 | 9 | 4 | 10 |
| `controlDirectionApplication.qnt` | 17 | 6 | 0 | 11 |
| `taskFactReconciliation.qnt` | 71 | 25 | 0 | 46 |
| `gitReconciliation.qnt` | 62 | 19 | 0 | 43 |
| `acceptedResultIntegration.qnt` | 81 | 16 | 14 | 51 |

`gitReconciliation.qnt` is the strongest of the five: every one of its eleven
invariants kills at least one mutant, with `incompatibleRewriteConstrains
OnlyAffectedAttempt` and `promotionRequiresExactExpectedHead` at four each.

## The witnesses are doing real work

In `acceptedResultIntegration.qnt`, **14 mutants are caught by a witness and by
no invariant at all** — nearly as many as the 16 the invariants catch. The
witnesses that earn their place:

| Witness | Mutants it alone caught |
|---|---|
| `dependencyWaitReleasedTarget` | 10 |
| `correctionRequiredReached` | 7 |
| `candidateReadyReached` | 6 |
| `correctionLimitReached` | 6 |
| `startedReached` | 5 |

These are mutants that weaken a guard until part of the protocol becomes
unreachable. Every invariant stays true, because nothing bad happens in a model
where nothing happens. Only the reachability assertions notice.

This is the clearest possible vindication of the witness discipline already in
`scripts/check-quint-models.mjs`, and it is worth stating plainly: for this
spec, dropping the witnesses would cost roughly half the gate's real detection
power.

## Invariants that kill nothing

One, and by design: `typeOk` in `controlDirectionApplication.qnt`. Quint has no
natural-number type, so the bound `appliedCount >= 0` has to be stated as an
invariant. It constrains which states are representable, not how the model
behaves, and it is named to say so.

Three others were genuinely inert and were repaired, below; Repair 4 is a
rename of that same by-design invariant rather than a fourth repair. Each of
the three followed the same shape: the
invariant stated a real rule from `docs/CONTEXT.md`, and the *model* could not
express its violation. Repairing an inert invariant almost always means adding
the adversarial phenomenon, not rewriting the invariant.

Every repair keeps the guard that makes the bad branch unreachable, so no
reachable state changes and every gated invariant still holds — what changes is
that the guard becomes load-bearing.

## Repair 1: foreign claim mutation was unrepresentable

`foreignClaimIsNeverChanged` reads:

```quint
state.claimState != ForeignClaim or state.lastClaimMutationTarget != ForeignClaimMutation
```

`ForeignClaimMutation` was declared in `ClaimMutationTarget` and referenced
*only* inside that invariant. **No action ever assigned it.** The right disjunct
was therefore true in every reachable state and the invariant could not fail —
vacuous in the strict sense, not merely definitional.

The domain rule it encodes is real: per `docs/CONTEXT.md` a task claim remains
until the adapter confirms release of that exact claim, so Dalph must never
mutate a claim it does not own. The model simply had no way to express the
prohibited event, which is the same defect the bake-off hit with M6, where a
compare-and-set guard was unreachable until the model could advance the
integration target from outside.

The repair records the ownership the claim actually has when the mutation
lands, rather than assigning a constant:

```quint
action requestOwnedClaimMutation: bool = all {
  state.claimState == ExactClaim or state.claimState == ReplacementClaim,
  state' = {
    ...state,
    lastClaimMutationTarget:
      if (state.claimState == ForeignClaim) ForeignClaimMutation else OwnedClaimMutation,
  },
}
```

The ownership guard keeps the foreign branch unreachable, so **no reachable
state changes** and every gated invariant still holds. What changes is that the
guard is now load-bearing: weaken it and the invariant fires.

Measured, using one hand-written mutant that relaxes the guard to
`state.claimState != MissingClaim`:

| | Same mutant, `foreignClaimIsNeverChanged` |
|---|---|
| Before | survives — `[ok] No violation found` |
| After | killed in 32 ms |

And across the full generated mutant set, the invariant moved from **0 kills to
1**.

## Repair 2: one attempt cannot be mis-correlated with another

`everyReportCarriesPlannedAttempt` asserts that every executor report carries
`RUN_ID` and `ATTEMPT_ID`. Every action assigned exactly those two constants, so
the invariant restated the assignment, and mutating `RUN_ID` moved the
assignment and the invariant's reference together — an equivalent mutant rather
than a detectable one.

`CONTEXT.md` is explicit that an internal `OperationId`, coding-agent
invocation, provider request, session, or worker process cannot replace or
supplement this correlation. Testing that needs a second identity to confuse it
with.

`Running`, `SafelySuspended`, and `Terminal` are executor reports, so they now
carry the correlation the executor supplied, and a foreign identity is offered
to every report action:

```quint
pure val OTHER_RUN_ID = 159
pure val OTHER_ATTEMPT_ID = 2

pure def isPlannedAttempt(claimed: Correlation): bool =
  claimed.runId == RUN_ID and claimed.attemptId == ATTEMPT_ID
```

The correlation is the payload of those three variants, so the phases before an
executor speaks carry none: `ResponsibilityNotBegun` and `ResponsibilityBegan`
have nothing to check, and `SuspensionRequested` carries forward the correlation
the executor last claimed rather than minting one.

The invariant states the comparison itself instead of calling `isPlannedAttempt`,
which the report actions guard with. Sharing that definition would move the
guard and the requirement together, and a weakened guard would stop being
detectable — the same equivalent-mutant shape this repair removes.

The exactness guard rejects every foreign report, so behaviour is unchanged.
The invariant moved from **0 kills to 3**.

## Repair 3: a replacement claim identity that could be reused

`replacementClaimIdentityIsFresh` held because `planReplacementClaim` derived
the identity as `originalClaimIdentity + 1`. Freshness was arithmetic, not a
checked property.

`CONTEXT.md` requires that a token from an earlier claim cannot authorize a
replacement claim, so the identity is now allocated rather than derived, and the
allocator may offer the identity the earlier claim already used:

```quint
action planReplacementClaim(allocatedClaimIdentity: int): bool = all {
  ...
  allocatedClaimIdentity != state.originalClaimIdentity,
  ...
}
```

The freshness guard rejects the reused identity, so the only reachable value is
still `originalClaimIdentity + 1`. The invariant moved from **0 kills to 1**.

## Repair 4: a type constraint named as one

`appliedCountIsNonNegative` is now `typeOk`, with a comment saying it is not
evidence that any control direction was applied correctly. The gate list in
`scripts/check-quint-models.mjs` follows the rename.

## Reading the survival rates honestly

Survival is high — 51 of 81 in `acceptedResultIntegration.qnt` — and that number
should not be read as a defect count. Three reasons, in rough order of size:

**Equivalent mutants.** `pure val RUN_ID = 158` to `159` changes nothing
observable, because the model is symmetric in that constant. Several of the
highest-frequency survivors are of this kind.

**Guard weakenings that only add behaviour.** Turning `==` into `!=` in an
action guard usually enables transitions rather than corrupting state. Many
produce a model that is strictly more permissive and still satisfies every
invariant, because the invariants constrain what is true in a state rather than
which transitions exist. That is a real limitation of state invariants and the
reason the bake-off carries history variables for I8 and I13.

**A deliberately blunt operator set.** Eleven textual operators. They cannot
delete a guard line, reorder a conjunction, or remove a `+ 1`, and several of
the interesting defects in `MUTANTS.md` are exactly those shapes.

The useful output is therefore not the survival rate but the per-invariant kill
count, and specifically its zeroes.

## Suggested follow-ups, not done here

- **Check in a kill baseline.** This analysis rots the moment someone adds an
  invariant, and nothing in the gate would say so. The repository already has
  the idiom in `oxlint-complexity-suppressions.json` plus
  `check-oxlint-complexity.mjs --prune`: a committed per-invariant kill count,
  a script that fails when a count drops toward zero or a new invariant lands
  at zero, and a prune command to accept a legitimate drop in review. Not in
  `check:ci` — the full sampled run is about ten minutes and the verified run
  far longer.
- Run the remaining three specs under `--verify`. Only
  `controlDirectionApplication.qnt` and `plannedAttemptExecutor.qnt` have been
  measured that way, so some survivors elsewhere are probably flaky misses.
- Add a guard-deletion operator, which is where the remaining defect shapes
  live.
- Extend witness coverage to `taskFactReconciliation.qnt` and
  `gitReconciliation.qnt`, which caught nothing by witness alone — plausibly
  because their witness lists are already tight, but worth confirming rather
  than assuming.
