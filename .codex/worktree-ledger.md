# Parallel worktree ledger

This temporary ledger tracks the dependency-ordered implementation of GitHub
issues #214, #73, #213, #76, #195, #215, #216, #212, and #159. The primary
worktree is the only integration point; task worktrees never merge one another.

## Active milestones

| Issue | Branch | Worktree | Base | Tip | State |
| --- | --- | --- | --- | --- | --- |
| #214 | `work/issue214` | `.worktrees/issue214` | `pending` | `pending` | creating |
| #213 | `work/issue213` | `.worktrees/issue213` | `pending` | `pending` | creating |
| #195 | `work/issue195` | `.worktrees/issue195` | `pending` | `pending` | creating |

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
