# Parallel worktree ledger

This temporary ledger tracks the dependency-ordered implementation of GitHub
issues #214, #73, #213, #76, #195, #215, #216, #212, and #159, followed by
#71, #72, #74, #103, #104, #59, #78, #69, #77, #140, and #75. The primary
worktree is the only integration point; task worktrees never merge one another.

## Active milestones

| Issue | Branch | Worktree | Base | Tip | State |
| --- | --- | --- | --- | --- | --- |
| #214 | removed | removed | `798ca724210f07709417af5e9eed62bac6232b55` | `09b6e47d0` | integrated as `d8ebf65af`; cleaned after #73 branch creation |
| #73 | removed | removed | `0ee1e4f8a` | `24fcc3573` | integrated as `5e1dc210f`; reviewed clean and cleaned |
| #213 | removed | removed | `798ca724210f07709417af5e9eed62bac6232b55` | `433f7de13` | integrated as `5d64b4cb6`; cleaned after #76 branch creation |
| #76 | removed | removed | `5d64b4cb6` | `011f32baa` | integrated as `35c698b73`; reviewed and cleaned |
| #195 | `work/issue195` | `.worktrees/issue195` | `798ca724210f07709417af5e9eed62bac6232b55` | `21f75d13a` | audited complete; issue closed |
| #215 | removed | removed | `a08f5b001dcaa0e871a453010655fba84e8079cd` | `c72a9f1f2` | integrated as `911a0aa3e..074b7a4d4`; reviewed clean and cleaned |
| #212 | removed | removed | `348731ae7` | `28e9c52ca` | integrated as `d28e5a301`; reviewed and cleaned |
| #216 | removed | removed | `da525987c` | `84b6528a0` | integrated as `a1f1a7bff`; reviewed and cleaned |
| #159 | n/a | n/a | n/a | superseded by `360258012` | closed without code change |
| #71 | removed | removed | `a1f1a7bff` | `034a1d60e` | harness integrated as `ae22e9dab`, native corrections as `88545e4da`; two-page graph passed, final full run pending GitHub create throttle cooldown; issue open |
| #72 | removed | removed | `35c698b73` | `089c9a35d` | integrated as `d6a9a63ae`, native corrections as `88545e4da`; live qualification 1/1 green, cleanup verified, issue closed |
| #74 | removed | removed | `ae22e9dab` | `eeddf5e81` | integrated as `0d88259cd`; reviewed and cleaned |
| #103 | removed | removed | `0d88259cd` | `ac0226901` | integrated as `585019cc2`; reviewed and cleaned |
| #104 | removed | removed | `d28e5a301` | `4d25e2e8a` | integrated as `07b37bdce`; reviewed and cleaned |
| #59 | removed | removed | `e4c97f028` | implemented by `87ce5512f` / `f616fff9c` | audited complete and closed; stale #57 edge did not block |
| #78 | removed | removed | `1e04e677c` | `499e5ae15..7bb1b0948` | integrated as `aeb042a74..5992d0941`; reviewed clean and cleaned |

## Dependency order

```text
#214 -> #73
#213 -> #76
#195 -> #215
#195 + #213 + #214 -> #216

#212 independent
#159 independent

then:

#71 independent
#72 independent
#74 independent
#103 independent
#104 independent
#59 -> #78
#69 -> #77
#140 -> #75
```

## External prerequisite holds

The second-wave arrows above describe only the requested local sequencing.
Live tracker metadata adds these prerequisite holds, which must be cleared or
explicitly re-decided before implementation starts:

| Requested root | Additional open blocker(s) | Consequence |
| --- | --- | --- |
| #59 | #57 | #57 behavior is integrated; edge is administratively stale. Audit #59 completion before starting #78. |
| #69 | #168 and #68 | Do not start #69 or downstream #77 yet. |
| #140 | #168 | Do not start #140 or downstream #75 yet. |

#71, #72, #74, #103, and #104 have no remaining declared blockers.

The tooling tickets #212 and #159 are logically independent but will not run
concurrently with one another because both may edit verification scripts and
quality-gate configuration.

## Integration protocol

1. Each worker commits only its owned issue in its isolated worktree.
2. The primary agent performs a light diff and scenario-to-test review.
3. The issue branch is rebased or replayed onto the then-current `master` when
   necessary, verified, and fast-forwarded or cherry-picked into `master`.
4. The ledger records the integrated commit before downstream work starts.
5. Only the primary worktree pushes `master` and mutates GitHub issue state.

## Cleanup

After an issue is integrated and its downstream branches no longer need the
worktree, run these commands from the primary worktree with the exact path and
branch from the table:

```sh
git worktree remove .worktrees/issueNNN
git branch -d work/issueNNN
git worktree prune
```

Never remove a worktree until `git status --short` is empty and its tip is
reachable from `master`. If either check fails, preserve it and investigate.
