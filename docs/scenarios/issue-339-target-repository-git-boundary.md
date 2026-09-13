# Alice's integration reads the exact configured Git target

## Governing behavior

This accepted #339 repair preserves the configured IntegrationTarget identity,
the declared Base and the ordinary lineage, candidate and promotion protocols.
The configured repository worktree and its resolved common Git directory are
different existing facts. Translating the exact configured working-repository locator
at the Node Git command boundary does not redefine the target or create a
second authority. No model transition, retry policy or timeout changes.

## Starting facts and trigger

Alice invokes the ordinary built command with Q. Q names the local repository
worktree and its canonical common Git directory. Git contains H. SQLite has
acknowledged the exact task plan and real ready worktree, then the executor's
Accepted commit C and integration responsibility. The next admitted boundary
reads the current head and ancestry of the configured target.

The retained built-controller diagnostic proves those facts through journal
position 22. ReadTargetLineage intents follow without an observation. The real
Node command interprets `GitCommand.run`'s locator as `--git-dir`, but the nested
production lineage Layer passes the ordinary repository worktree. The exact
read exits 128, "not a git repository". A promotion-only host translation cannot
repair the independently constructed lineage Layer.

## Ordered calls and visible result

1. The production workflow composition retains the exact IntegrationTarget.
   Its real Git command boundary receives the working-repository locator
   explicitly alongside its already resolved common Git directory. It translates
   only that working-repository locator to that directory for `run`. The semantic
   IntegrationTarget repository is not the source of this translation rule.
   Other locators and `runInWorktree` retain their existing interpretation.
2. The ordinary lineage adapter reads the actual target head and ancestry.
   It returns the existing observation with the original target identity.
3. Candidate construction and promotion continue through their existing real
   Git boundaries, intents and observations. Expected-head comparison still
   detects a foreign move; no command result is invented or rewritten.
4. Alice's controller reaches the actual promotion boundary. Successful M has
   ordered parents H and the executor's actual C. The stale-target scenario
   still retains foreign F and reports waiting rather than false completion.

No live GitHub call applies to this controlled fixture. Crash/restart retains
the same declared target, plan and ordinary authority checks. This locator
translation is not ownership proof, permission to adopt a foreign worktree,
or permission to repeat an ambiguous mutation.

## A separate bare or unreadable integration target

Alice's maintained no-crash, concurrent and restart fixtures execute tasks in a
working repository whose common directory is `repository/.git`, but integrate
into the distinct bare repository `target.git`. Both initially contain H. The
executor produces C in the working repository; the existing Integrator and real
promotion boundary operate on the bare target. The workflow must read that same
bare target, not substitute the working repository merely because the locator
is the declared IntegrationTarget. After promotion, Git owns M at the bare ref
with ordered parents H,C. After an applied promotion whose response is lost,
restart checks that same bare ref and does not repeat the successful CAS.

In the unreadable-target refresh scenario the declared target is `missing.git`,
while the working repository remains healthy. Each autonomous notification can
acknowledge the existing target-read intent, but Git cannot supply a target
observation. Dalph retains the running responsibility and starts no executor.
Reading the healthy source instead and publishing TargetLineageObserved is
forbidden. No additional Git read, retry, model transition or timeout change is
introduced to resolve these locators. The existing resolved working-repository
and common-directory facts are explicit composition inputs, not new authority.

## Scenario-to-test mapping

- Configured repository versus common-directory locator → focused production
  composition proof uses real Git and checks actual head/ancestry observations
  retain the original IntegrationTarget.
- Other command locators and worktree commands → focused controls retain their
  existing behavior; no global PATH shim or fabricated command result.
- Separate bare and missing targets → `production-workflow-git.integration.test.ts`
  proves real bare head/ancestry and preserves a missing-target failure in both
  default and observed compositions; working-repository translation still works.
- Separate bare target lifecycle → `hermetic-mvp.test.ts`'s no-crash lifecycle
  and crash-after-promotion restart tests retain exact target heads, parents,
  journal observations and no-repeat assertions.
- Separate bare target concurrency → `hermetic-concurrency.test.ts` retains
  actual overlapping children, serialized integration and exact target lineage.
- Unreadable target during autonomous refresh → `production-reactivation.test.ts`'s
  unreadable-boundary test retains acknowledged target-read intent without a
  fabricated target observation or new executor.
- Complete ordinary built command → existing #339 controller proves actual
  ready worktree, Accepted C and real CAS with exact M parents H,C.
- Foreign target move → existing stale-CAS chronology proves F remains current,
  the same unfinished Run is recovered and graceful Exit is not Run completion.
