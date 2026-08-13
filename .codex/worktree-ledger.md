# Parallel worktree ledger

This temporary ledger tracks the dependency-ordered implementation of GitHub
issues #214, #73, #213, #76, #195, #215, #216, #212, and #159. The primary
worktree is the only integration point; task worktrees never merge one another.

## Active milestones

| Issue | Branch | Worktree | Base | Tip | State |
| --- | --- | --- | --- | --- | --- |
| #214 | removed | removed | `798ca724210f07709417af5e9eed62bac6232b55` | `09b6e47d0` | integrated as `d8ebf65af`; cleaned after #73 branch creation |
| #73 | `work/issue73` | `.worktrees/issue73` | `0ee1e4f8a` | `pending` | implementing after integrated #214 |
| #213 | removed | removed | `798ca724210f07709417af5e9eed62bac6232b55` | `433f7de13` | integrated as `5d64b4cb6`; cleaned after #76 branch creation |
| #76 | `work/issue76` | `.worktrees/issue76` | `5d64b4cb6` | `pending` | queued after integrated #213 |
| #195 | `work/issue195` | `.worktrees/issue195` | `798ca724210f07709417af5e9eed62bac6232b55` | `21f75d13a` | audited complete; issue closed |
| #215 | `work/issue215` | `.worktrees/issue215` | `a08f5b001dcaa0e871a453010655fba84e8079cd` | `pending` | queued after audited #195 |
| #212 | `work/issue212` | `.worktrees/issue212` | `pending` | `pending` | queued independent tooling lane |
| #159 | n/a | n/a | n/a | superseded by `360258012` | closed without code change |

## Dependency order

```text
#214 -> #73
#213 -> #76
#195 -> #215
#195 + #213 + #214 -> #216

#212 independent
#159 independent
```

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
