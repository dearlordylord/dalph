# Final push to the task repository: specification audit

**Observation date:** 2026-09-15 (America/Montreal)  
**Question:** Does Dalph's accepted workflow require the integrated commit to be
published with `git push` to the task repository's `origin` or default branch?  
**Repository convention:** This is a research artifact under
[`research/`](./README.md). It records evidence and a gap; it does not change
Dalph runtime behavior.  
**Sources:** Checked-in repository documents/source and the first-party GitHub
issue bodies/comments retrieved from the Dalph repository.

## Bottom line

No. The current accepted workflow specifies promotion of a configured Git ref,
not publication of that ref to a remote hosting service. The strongest direct
statement is the production walkthrough:

> “The configured `integrationRef` is the local `refs/heads/main`; Dalph
> updates that local ref and does not promise to push it to GitHub.”

This is in [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md#L724-L729). It directly
explains why the Kimi dogfood run could close the GitHub issue while its local
target `main` was ahead of `origin/main`: that outcome is consistent with the
written contract, but it is not the end-to-end delivery behavior the operator
expected.

The missing requirement is therefore real: no accepted scenario currently
requires, models, implements, or verifies a final `origin`/remote publication
after local target promotion and before task completion/closure.

## What the accepted workflow actually requires

### 1. Promotion targets the configured local Git repository/ref

The accepted integration architecture defines the boundary as exact-head
promotion. After Git qualifies candidate `M`, Dalph atomically replaces the
configured target head `H` with `M`; the operation is an `update-ref`, not a
remote push:

- [`docs/architecture/attempt-delivery-and-integration.md`](../docs/architecture/attempt-delivery-and-integration.md#L156-L170)
  says that only exact `H` authorizes the atomic replacement and that Git's
  success or later ancestry read establishes promotion.
- [`packages/orchestrator/src/authorities/git/target-promotion.ts`](../packages/orchestrator/src/authorities/git/target-promotion.ts#L65-L118)
  runs `git update-ref <target-ref> <candidate> <expected-head>` against
  `request.integrationTarget.repository`.
- [`docs/DELIVERY-INVARIANTS.md`](../docs/DELIVERY-INVARIANTS.md#L239-L280)
  defines D26–D28 as candidate shape, compare-and-set promotion, and Git
  qualification. None adds a remote publication boundary.

The production implementation receives a `GitRepositoryLocator` and an
`IntegrationTargetRef`; it does not receive a remote name, remote URL, push
refspec, or publication policy at this boundary. The target promotion adapter
therefore cannot prove that a hosting service's `origin/<default>` ref moved.

### 2. The hermetic acceptance scenarios use a local bare target, not GitHub's remote

The no-crash acceptance scenario for [issue #86](https://github.com/dearlordylord/dalph/issues/86)
creates a local repository and a local bare remote. Its chronology says:

- the Integrator uses the bare remote's `master` head;
- Dalph replaces that bare remote's `master` with an exact compare-and-set; and
- the fixture does not contact or mutate GitHub.

See [`docs/scenarios/hermetic-no-crash-lifecycle.md`](../docs/scenarios/hermetic-no-crash-lifecycle.md#L15-L68),
especially steps 4–6 and the “does not contact or mutate GitHub” boundary.
The implemented acceptance fixture has the same shape:
[`packages/dalph/test/scenarios/hermetic-mvp.test.ts`](../packages/dalph/test/scenarios/hermetic-mvp.test.ts#L25-L42)
initializes a local bare repository, and
[`.../hermetic-mvp.test.ts`](../packages/dalph/test/scenarios/hermetic-mvp.test.ts#L518-L520)
asserts the promoted local `refs/heads/master`.

That local `git push` setup and the temporary `refs/dalph/transfer-*` object
transfer are fixture preparation/transport details. They are not a workflow
step that publishes the final promoted commit to a hosting service.

### 3. The live qualification also explicitly uses local Git

The accepted live-qualification issue describes a disposable GitHub repository
for the tracker issue, but a separate **disposable local Git repository** for
the target ref. Its expected final evidence is “final GitHub lifecycle/claim
observations” plus the “local target head”; it does not require remote Git
publication.

See [issue #261](https://github.com/dearlordylord/dalph/issues/261),
especially its starting facts, chronology, and evidence fields:

- local Git target is established at [issue #261 body](https://github.com/dearlordylord/dalph/issues/261#issue-3397672675);
- the happy path promotes `M` by exact-head compare-and-set and separately
  completes the GitHub issue;
- final evidence names the local target head, not `origin/<ref>`.

The public CLI walkthrough narrows this further: it tells the operator to clone
the repository locally, sets `integrationRef` to local `refs/heads/main`, and
then explicitly disclaims a push to GitHub. See
[`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md#L664-L727).

## What the task/finality specifications do not say

The current accepted outer-Integrator and finality issues are precise about
the local promotion and tracker order, but have no remote-publication step:

- [issue #222](https://github.com/dearlordylord/dalph/issues/222) requires an
  Integrator-reported `M` with exact direct parents `[H, C]`; it does not
  require pushing `M`.
- [issue #223](https://github.com/dearlordylord/dalph/issues/223) requires
  compare-and-set promotion, then tracker completion, claim cleanup, and
  settlement. Its acceptance criteria contain no `push`, remote, origin, or
  default-branch publication boundary.
- [issue #60](https://github.com/dearlordylord/dalph/issues/60) requires exact
  compare-and-set and explicitly forbids force-updating the target; it does not
  define a remote publication operation.
- [issue #61](https://github.com/dearlordylord/dalph/issues/61) requires a
  refreshed tracker observation before dependency release; it does not add a
  Git remote observation or push.
- [issue #86](https://github.com/dearlordylord/dalph/issues/86), [#87](https://github.com/dearlordylord/dalph/issues/87),
  [#88](https://github.com/dearlordylord/dalph/issues/88), and [#89](https://github.com/dearlordylord/dalph/issues/89)
  all stop at the local bare target/ref and the tracker/final resource ledger.
  Their accepted chronologies do not contain `git push` after promotion.

The current issue [#378](https://github.com/dearlordylord/dalph/issues/378)
also does not add this requirement. It is about bounded status publication and
graceful Exit after a real run; its observed result explicitly says no GitHub
claim, label, close, or commit mutation occurred during the interrupted run,
but it does not define a successful remote Git publication path.

## Similar wording that is not this requirement

The GitHub issue corpus contains many statements such as “implemented and
pushed,” “candidate is pushed,” or “pending final merge to `master`, push, and
hosted CI.” Those are development/repository-delivery bookkeeping statements
about committing Dalph's own implementation branch. They do not specify what a
running Dalph instance must do to publish a task result to a target repository.

For example, [issue #260's freshness note](https://github.com/dearlordylord/dalph/issues/260#issuecomment-5611101497)
says that an implementation ticket was pending “final merge to `master`, push,
and hosted CI closure.” In contrast, the same issue's production contract names
the canonical local repository/ref, and the walkthrough explicitly says that
Dalph does not promise to push the local ref. These are two different
boundaries: project-code integration versus runtime task delivery.

Likewise, [issue #365](https://github.com/dearlordylord/dalph/issues/365#issue-3410197206)
uses “the research branch has not been pushed” and says that publication does
not claim remote archival of probes. That is research-artifact provenance, not
task-repository final publication.

## Implementation evidence and resulting gap

The production code has a target-promotion service and a separate GitHub task
tracker completion service, but no final-push service or event:

- `nodeGitTargetPromotionLayer` invokes `update-ref` only, as shown above.
- The target-promotion protocol's successful terminal state is
  `TargetPromotionObservedSuccess`, followed by integration finality and
  tracker completion; no `GitPushIntent`, `GitPushObserved`, remote-head
  observation, or equivalent exists. Search of `packages/*/src`, `specs/`, and
  the accepted `docs/` scenarios found no runtime `git push` operation. The
  only production-test `push` calls are fixture setup or transfer-ref setup.
- The production walkthrough's line “does not promise to push it to GitHub” is
  therefore not merely a missing test assertion; it is an explicit current
  behavior limitation.

This explains the dogfood discrepancy precisely:

1. Kimi executor produced accepted commit `C` in the local task worktree.
2. Kimi Integrator produced candidate `M` locally.
3. Dalph qualified `M` and updated the configured local target ref with
   compare-and-set.
4. Dalph completed/closed the tracker issue after local promotion and finality.
5. No operation copied/pushed `M` to the GitHub repository's `origin/main`, and
   no final remote read guarded issue closure.

Steps 1–4 are specified and implemented. Step 5 is not specified or
implemented; treating step 4 as “integrated into GitHub master” was an
overstatement.

## Conclusion and specification action

The user's expected invariant—“task completion means the final integrated
commit is present on the task repository's remote/default branch”—is absent
from the current accepted workflow. It should be added as a new accepted
chronology before runtime implementation:

1. Define the publication target explicitly (remote identity, ref, expected
   old SHA, and whether the target is a hosting remote or local ref).
2. Record intent before `git push`/remote mutation, reconcile ambiguous push
   results by reading the owning remote authority, and forbid tracker closure
   until remote publication is proven.
3. Define stale-head, authentication, network, rejected push, and lost-response
   outcomes, including retained local `M` and claims.
4. Add a final remote-head observation and acceptance test that checks the
   actual hosted/default branch, not only the local clone's `HEAD` or
   `refs/heads/main`.
5. Update the live qualification walkthrough and dogfood gate so “integrated”
   means remote publication plus tracker finality.

Until that scenario and test exist, the correct status is: **local promotion
and tracker finality are qualified; final publication to `origin`/GitHub is
not a Dalph acceptance guarantee.**

