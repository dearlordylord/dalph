# Verification evidence

Verified on 2026-07-24 with Quint 0.32.0. The repeatable gate is:

```sh
pnpm prototype:frontier
```

## Checked properties

Every safe profile checks:

- task-work reservations never exceed capacity two;
- every external effect has a previously durable intent with the same
  operation identity;
- one operation identity never applies the same authority effect twice;
- every request uses an identity recorded by its intent;
- no request relies on authority knowledge made stale by an authority,
  coordinator-activation, or control revision;
- every task has a concrete coordinator action or an exact reason why it
  cannot act;
- a constraint on task `A` does not stop independently eligible task `C`;
  and
- tracker completion and coordinator responsibility settlement agree for the
  same task, without treating Git promotion as tracker completion.

The simulations and exhaustive checks deliberately use the named non-default
initializers and step profiles below. This prevents unrelated environment
choices from hiding the behavior each check is meant to cover.

## Deterministic scenarios

All 15 scenario tests pass. They cover deterministic admission, capacity,
all ambiguity-crossing boundaries through completion, same-identity retry,
crash recovery, whole-run pause/resume, grouping-descendant pause coverage,
task pause/interruption/resume, independent branch progress, claim loss,
unreadable authority, compatible and incompatible target changes, lost
worktree disposition, external completion, and a newly added blocker.

## Sampled witnesses

Each profile explored 10,000 traces and checked all eight properties.

| Profile | Maximum steps | Witness result | Reproduction seed |
| --- | ---: | --- | --- |
| `init` / `progressStep` | 80 | Every forward boundary witnessed; tracker completion 99.84%, task settlement 41.63% | `0x88e846819f48014d` |
| `initAnyBoundaryProfile` / `crashProfileStep` | 10 | crash/restart 99.82%, authorized retry 49.17% | `0xd590f435eadd8695` |
| `initRunningInvocationProfile` / `pauseProfileStep` | 10 | pause 100%, independent task `C` progress 75.31% | `0xa6c29b5e35d6d0f6` |
| `initReconciliationProfile` / `reconciliationProfileStep` | 10 | isolation 100%, task `C` progress during isolation 100% | `0x6be1ebfd55b8011` |

## Exhaustive finite profiles

TLC exhausted each focused reachable state graph and found no invariant
violation:

| Profile | Generated states | Distinct states | Complete graph depth |
| --- | ---: | ---: | ---: |
| all eight operation boundaries | 2,156 | 1,748 | 59 |
| crash and restart at all eight operation boundaries | 3,094 | 2,188 | 32 |
| task pause, provider interruption, and resume | 176 | 90 | 11 |
| two-revision external reconciliation window | 254 | 146 | 8 |

The reconciliation initializer begins with two authority revisions remaining.
This is a focused exhaustive fault/recovery window; the ordinary workflow model
retains the authority-revision bound of 16.

Quint's TLC backend in version 0.32.0 exhausts the finite state graph and does
not forward `--max-steps` to TLC. The table therefore reports TLC's observed
complete graph depth. A monolithic Apalache run was attempted but its nested-map
SMT encoding did not complete in a useful prototype interval; this limitation
is retained in `SPECIFICATION-PROBLEM-LOG.md`.

## Deliberately weakened rules

TLC finds the expected shortest counterexamples:

| Weakened transition | Rejected property | Counterexample |
| --- | --- | --- |
| apply an effect without intent | `everyEffectHasIntent` | initial state, then forbidden effect |
| apply the same operation effect twice | `noDuplicateAuthorityEffect` | intent, first effect, duplicate effect |
| request after restart without rereading | `noStaleAuthorityUse` | intent, crash, restart, stale request |

These expected failures demonstrate that the safety properties distinguish the
forbidden behaviors from the safe model.

## Result and limits

Within the approved four-task, capacity-two instance, the model supports the
required forward workflow, bounded ambiguity recovery, crash reconstruction,
pause/interruption/resume, branch-local isolation, and unaffected-branch
progress without violating the checked safety and exact-disposition
properties.

This is a bounded design prototype, not a proof for arbitrary graph sizes or an
implementation-conformance test. No genuine specification defect was confirmed
during this check. The persistent classification record is
`SPECIFICATION-PROBLEM-LOG.md`.
