# Supervised Dalph dogfood readiness for issues #384–#389

**Observation date:** 2026-09-19 (America/Montreal)  
**Question:** Can the existing shipped Dalph workflow implement the accepted
remote-publication tickets while a supervising agent reviews candidates and
publishes them manually?  
**Scope:** Read-only source, documentation, tracker, and retained-evidence
research. No provider was launched, no heavy gate ran, and no GitHub or Git
state was changed.

## Conclusion

Yes, with a precise boundary. Current Dalph can select one ticket, create its
exact-Base task worktree, run Codex or Kimi, integrate the accepted task commit
into a configured **local** ref, clean up proven resources, and close the GitHub
task. A supervisor can then inspect that fixed local candidate, run or verify the
required checks, and perform an ordinary non-force push manually. This is enough
to dogfood implementation of #384 and then advance the dependency frontier.

This workflow does **not** give the supervisor an approval point between local
promotion and GitHub closure. Dalph currently closes the task as part of its
successful local-finality suffix and has no remote-publication operation. Manual
review and push therefore occur after Dalph returns; a failed review requires
preserving the candidate and reopening or otherwise correcting the task record.
This is operationally usable dogfooding, not proof of #384's new publication
ordering.

The existing path has stronger evidence than a smoke test. The retained audit
records a Kimi task commit, Kimi integration candidate, local compare-and-set
promotion, and GitHub closure, while the hosted branch remained unchanged—the
exact discrepancy that motivated #383
([final-push audit, lines 162–174](./final-push-requirement-audit.md#L162-L174)).
The disposable issue
[`dearlordylord/dalph-dogfood-2026-09#4`](https://github.com/dearlordylord/dalph-dogfood-2026-09/issues/4)
is closed. A fresh trivial smoke run is therefore unnecessary before #384.

## What the shipped workflow actually provides

- The public command is `dalph run github:OWNER/REPOSITORY#ISSUE --production
  --config <absolute-path>`. Production acquires live authorities and recovers an
  unfinished Run when present
  ([live CLI, lines 74–111](../packages/dalph/src/application/live-cli.ts#L74-L111)).
  It is the only public production action; resume/grant controls remain ticket
  #389 work.
- The decoded host configuration pins one local repository/common directory,
  fully qualified integration ref, planned Base SHA, executor profile, capacity,
  Journal, evidence and private-state roots
  ([configuration, lines 139–166](../packages/dalph/src/application/production-configuration.ts#L139-L166)).
- A successful current run may claim and close the GitHub task, create task and
  Integrator worktrees, and atomically update the configured local ref, but it
  does not promise a remote push
  ([walkthrough, lines 860–880](../docs/DEVELOPMENT.md#L860-L880)).
- An identical later invocation can recover the same unfinished Run from SQLite;
  it reconciles authority-owned effects rather than creating another Run
  ([walkthrough, lines 893–911](../docs/DEVELOPMENT.md#L893-L911)). Abrupt or
  uncertain runs must retain all GitHub and local resources together
  ([walkthrough, lines 929–946](../docs/DEVELOPMENT.md#L929-L946)).

The executor receives less context than an interactive supervising agent:

- GitHub supplies only the selected issue's exact title and body; the focused
  reader deliberately excludes comments, labels, lifecycle and relationship
  prose
  ([task specification reader, lines 15–67](../packages/orchestrator/src/authorities/task-tracker/github/task-work-specification-reader.ts#L15-L67)).
- Codex receives that title/body plus immutable Run, attempt, task revision,
  Base, branch and worktree facts
  ([Codex prompt, lines 470–484](../packages/dalph/src/application/codex-planned-attempt-executor.ts#L470-L484)).
  Kimi currently receives the issue body
  ([Kimi executor, lines 361–412](../packages/dalph/src/application/kimi-planned-attempt-executor.ts#L361-L412)).
- Repository instructions and scenarios are available only through the exact
  Base-SHA worktree and the provider's ambient discovery. Parent issue #383,
  issue comments and sibling ticket bodies are not injected into the prompt.
- The Integrator prompt is narrow: construct the exact `[H, C]` merge candidate
  and return its commit; it does not independently perform the issue's complete
  semantic review or qualification plan
  ([Integrator prompt, lines 62–75](../packages/dalph/src/application/codex-integrator.ts#L62-L75)).

Consequently, the accepted scenario and glossary/document amendments should be
committed and published on `master` before the run. The current local scenario
file is untracked and its companion documentation is dirty; a target clone at
the current remote Base cannot read those files. Although #384 links the full
#383 tracker specification, making the accepted repository documents part of
the Base is the most reliable way to satisfy the scenario-before-runtime gate.

## Ticket targeting and dependency safety

The CLI target is a graph root rather than a strict one-issue allowlist. Dalph
walks the root, every subissue descendant, and each node's transitive
`blockedBy` prerequisites; it does not walk upward to a parent or sideways to a
sibling
([closure traversal, lines 230–321](../packages/orchestrator/src/authorities/task-tracker/github/read-primitives.ts#L230-L321)).
Every open node in that closure whose prerequisites are satisfied is eligible,
and capacity chooses the first deterministic opaque task identity
([frontier selection, lines 108–145](../packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts#L108-L145)).

Therefore targeting #384 does not pull in parent #383 or sibling #385 merely
because #384 is a subissue of #383. Before launch, the supervisor must still
verify that #384 has no subissues and no open `blockedBy` prerequisite. Capacity
one limits concurrency but does not itself mean “only the root issue.” For later
tickets, start only a frontier ticket and repeat the same relationship check.

The documented generic walkthrough is intentionally safer and narrower: it
requires a dedicated repository and a single unblocked issue, and explicitly
forbids an existing project, shared clone, subissues and blocking relationships
([walkthrough, lines 612–619](../docs/DEVELOPMENT.md#L612-L619)). Running #384 in
the real Dalph tracker is therefore a supervised project dogfood run, not an
instance of that disposable operator walkthrough.

## Evidence and remaining uncertainty

The local-only production path is credible:

- The retained audit documents the successful #4 chronology through task
  closure, and the hosted repository still exposed the missing-push result
  ([audit, lines 146–174](./final-push-requirement-audit.md#L146-L174)).
- Earlier #378 runs exposed real failure modes before that success: a Kimi task
  commit initially stalled before Integrator admission, then a later candidate
  stalled at Codex `thread/start`. Current `master` includes later
  selected-provider integration and Kimi merge-ancestry fixes. These failures
  justify active supervision and durable retention; they do not negate the
  later successful local-only run.
- The public recovery integration test demonstrates same-Run restart through
  the shipped command, while the documentation correctly says controlled
  recovery is not live-provider evidence
  ([walkthrough, lines 913–927](../docs/DEVELOPMENT.md#L913-L927)).

Substantial implementation readiness is not yet proven. #384 combines governing
documentation/invariants, Quint and conformance amendments, runtime publication,
Git crash/reconciliation tests, focused checks, `check:fast`, and a frozen full
gate. Dalph sends all of that as one provider turn. The full local gate alone has
116.5 minutes of stage ceilings before setup and termination overhead; those are
ceilings rather than expected duration
([development guide, lines 1162–1168](../docs/DEVELOPMENT.md#L1162-L1168)).
The executor may produce a syntactically valid commit before satisfying every
criterion, and Dalph has no human semantic-acceptance boundary before local
promotion. The supervising review is therefore essential.

Provider availability must be established immediately before launch. The
current machine has the Codex and Kimi executables and an ambient Codex auth
file, but the default `~/.kimi/config.toml` path and provider credential
environment variables were absent when inspected; a configured Kimi profile may
refer elsewhere. Those facts neither prove Codex can complete a turn nor prove
Kimi is unavailable. Reuse a previously successful named profile and known auth
boundary when they remain valid. If availability is still unknown, run one
bounded profile-specific probe before allocating the Run. Do not alternate
providers inside a retained Run.

## Recommended first supervised run: issue #384

Use #384 directly; do not add a new tracker task or repeat the trivial smoke
journey. Treat this as a bounded attempt to produce a reviewable candidate, not
as automatic acceptance.

1. **Publish the accepted input first.** Commit and push the reviewed
   `direct-remote-publication` scenario and its glossary/development/catalog
   amendments. Confirm #383 and #384 bodies still match that exact revision.
   The task handoff must explicitly require focused checks, `check:fast`, and
   the required frozen full gate to pass before the executor reports its final
   accepted commit, because repository policy requires the full gate before
   Dalph integrates runtime behavior.
2. **Freeze two separate roles.** Build and validate an immutable Dalph runtime
   from a clean source checkout. Create a separate clean target clone of Dalph at
   the exact hosted `master` Base. Do not use the current dirty/shared checkout
   as the target repository. Keep runtime build, target clone, worktree roots,
   Journal, evidence, Codex/Kimi private state and Integrator private store
   disjoint. `pnpm bootstrap:worktree` is the repository command that prepares
   submodules, frozen dependencies, production artifacts and workspace bins
   ([command table, line 121](../docs/DEVELOPMENT.md#L121)).
3. **Pin the run.** Verify `origin/master`, local `refs/heads/master`, the exact
   Base SHA, clean status, canonical common directory, #384's open state and its
   empty descendant/prerequisite closure. Configure `taskWorkCapacity: 1`, one
   named provider profile, absolute private paths, and an activation interval
   suitable for observation. Inject `GITHUB_TOKEN` only in the process
   environment; never place it in config, URLs, logs or evidence.
4. **Record the bound before starting.** This operation exceeds one minute. Set
   an explicit expected duration and wall-clock stop time that allows the chosen
   provider's implementation work and any full gate it starts; 116.5 minutes is
   only the gate-stage ceiling, not the whole-run estimate. Monitor NDJSON,
   process ownership, Journal growth and target refs. If the stop time arrives,
   request graceful Exit once, wait for its actual disposition, preserve the
   complete run root, and identify the first unexecuted acceptance suffix before
   invoking the identical command again.
5. **Launch the public command once:**

   ```bash
   node /absolute/frozen-dalph/packages/dalph/dist/bin/dalph.js \
     run "github:dearlordylord/dalph#384" \
     --production \
     --config /absolute/run-root/production.json
   ```

6. **Review the fixed local candidate after return.** Capture Base, task commit
   `C`, integration head `M`, ordered parents, one task Begin, check results,
   cleanup, Run disposition and GitHub state. Review `Base..M` against #383/#384,
   the chronological S1/S3/S5/S6/S7/S8 mappings, repository standards, model
   adequacy and negative controls. If the executor did not run the required
   frozen full gate, run it in the frozen candidate worktree with
   `pnpm check:all --candidate=<Base>` and preserve its admission evidence as a
   salvage qualification step. A post-promotion pass cannot retroactively prove
   that Dalph respected the required pre-integration gate ordering; record that
   process failure and remediate the ticket before treating the dogfood run as
   accepted.
7. **Publish manually only after review and qualification.** Refresh hosted
   `master`; require the push to be an ordinary safe fast-forward, then push the
   exact candidate rather than a moving branch, for example:

   ```bash
   git -C /absolute/target-clone push --porcelain \
     origin "<M>:refs/heads/master"
   ```

   Independently read hosted `refs/heads/master` and prove it equals or contains
   `M`. If the remote advanced incompatibly, stop and integrate deliberately;
   current Dalph does not own that remote race. Never force-push.
8. **Reconcile the tracker truth.** Dalph may already have closed #384 before
   steps 6–7. Keep it closed only when the reviewed candidate is published and
   acceptance evidence is complete; otherwise preserve the run/candidate and
   reopen or correct the issue with the concrete failed criterion. Then advance
   only the next unblocked ticket (#385 and #387 after #384, followed by #386,
   #388, and lower-priority #389 according to their recorded edges).

## Supervisor boundaries to keep explicit

- Dalph owns task selection, claims, executor/Integrator work, local promotion,
  workflow history, cleanup and tracker finality during the run.
- The supervisor owns the frozen runtime/target setup, time bound, observation,
  post-run semantic review, required gate evidence, remote race check, manual
  push, hosted verification and any corrective tracker action.
- Do not manually edit SQLite, private provider stores, claims, generated refs
  or worktrees to “unstick” a retained Run. Use the identical public invocation
  for implemented recovery, or preserve the exact obstruction for the ticket
  that adds the missing control.
- Do not claim #384 accepted merely because Dalph returned success or GitHub
  closed it. Acceptance requires the reviewed implementation, required tests and
  manual hosted publication for this transitional run.
