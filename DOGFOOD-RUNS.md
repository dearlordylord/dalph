# Isolated Dalph runs

Read this before creating, resuming, or closing an isolated dogfood Run.
Use the [production walkthrough](docs/development/walkthrough.md) for current
commands and [check selection](docs/development/checks.md#choosing-checks) for
verification. This note records preparation mistakes and lessons from the
retained 2026-10-06/07 runs; it changes no Dalph runtime behavior.

## Prepare

1. Select current tracker scope and a small graph with concrete deliverables.
   Create and read back native sub-issue and blocked-by edges. Give the root
   its own final deliverable and blockers; grouping alone does not order work.
   Done: the observed graph matches the intended dependency order.
2. Pin a built Dalph source from remote master. Create a separate target clone
   and disjoint journal, evidence, executor and integration directories. Record
   source SHA, planned Base SHA, integration ref and publication destination.
   Done: configuration names exact existing paths and commits, and the source
   stays frozen while its host runs.
3. Detach the target clone at the recorded Base **before launch**. Inspect
   `git worktree list --porcelain`; every registered worktree must leave the
   integration ref unoccupied. A clean checkout still occupies its branch.
   Done: the following check succeeds for the configured target and ref:

   ```bash
   if worktrees=$(git -C "$DALPH_TARGET_REPOSITORY" worktree list --porcelain); then
     printf '%s\n' "$worktrees" | awk -v ref="$DALPH_INTEGRATION_REF" \
       '$1 == "branch" && $2 == ref { occupied = 1 } END { exit occupied }'
   else
     exit 1
   fi
   ```

   A failed Git read supplies no worktree-absence proof. Resolve checkouts while clean;
   preserve dirty or foreign work. Dalph's promotion refusal remains the guard.
4. Check the pinned CLI's help, selected Codex executable/model, authentication
   and exact task-worktree preparation. For JEV/Hapsland, verify installed
   runtime provenance, native hook trust and credential availability in the
   actual child context; retain one observed hook result when evaluating hooks.
   Done: preparation and provider prerequisites pass independently of source
   qualification. Keep credential values out of reports and command output.

## Run and observe

5. Record expected duration and an absolute UTC stop, then launch a supervisor
   that owns graceful shutdown at that deadline. Capture stdout/stderr separately
   and retain configuration, intent, PID identity and Run ID. Give any temporary
   dashboard forward an automatic expiry. Done: host readiness and the selected
   Run identity are observed; a returned launch handle alone is insufficient.
6. Inspect public `attach snapshot --json --compact` with the exact Run ID about
   every 20 minutes and at failures. Load a full snapshot only for the named
   unresolved boundary. Use public attachment while the host owns SQLite;
   external database reads can be locked. Debug migration messages were observed
   in stdout in the #421 run, so its raw stream is not clean NDJSON evidence.
   Done: each observation records progress, a blocker, or the next diagnostic.
7. On failure, preserve evidence and diagnose one boundary. Repair preparation
   or the demonstrated source defect, then pass its focused check before broader
   qualification. Resume the same retained Run through its supported controls.
   Completed work stays completed. Use the repository's check-selection rules;
   independent work can continue while hosted CI runs. Done: the failed boundary
   is observed to recover, or a scoped obstruction remains explicitly open.

## Close and measure

8. Reconcile tracker closure, exact Git publication, Run termination, application
   Exit and native writer/resource cleanup separately. Process exit or sampled
   descendant absence alone does not prove complete delivery or cleanup. Retain
   custody evidence before deleting exact owned resources or compacting storage.
   Done: every required outcome has evidence, and every unproven suffix is named.
9. Record elapsed time, peak sampled RSS, journal rows and stored/expanded bytes,
   plus REST/GraphQL observations by reset window. Shared-token deltas include
   other callers; report attribution limits and unavailable model usage explicitly.

## Retrospective: improvements in priority order

| Observed failure or cost | Improvement |
| --- | --- |
| #414 host did not finish shutdown; later #467 needed cold recovery repairs | Keep durable Run state and prove exact stopped writers before resuming. See #466/#476 evidence; sampled process data remains diagnostic. |
| #421 reached integration before finding an occupied master checkout | The walkthrough already requires detachment. Make step 3 a mandatory launch check; current runtime protection catches this only at promotion. |
| Early runs hit status/admission defects; fixed-Base successors required explicit reconciliation | Bind recovery to exact retained attempts and accepted Base policy; use supported controls rather than editing workflow history. |
| Fixture migrations lost modern Base-policy fields | Use required modern constructors and whole-history memory/SQLite properties delivered in #481; name historical compatibility explicitly. |
| Broad coverage timed out although focused cases passed | #482 adds named test/wait/finalization evidence. #479 remains a separate causal investigation; a passing repeat alone does not explain the timeout. |
| Full snapshots and recursive log searches flooded agent context | Use #480 compact inspection and bounded searches of named evidence files. |

Evidence inventory: `/workspace/dalph-dogfood/20261006T132507Z`,
`20261006T155910Z-rerun`, `20261006T200256Z-qualified-head`,
`414-graph-run-20261007`, `night-467-20261007/EVALUATION.md`, and
`spec-421-20261007/after-checkout-repair.json` under the same parent.
Reviewed retained evaluations, process results and failure reports, not every
raw provider transcript. #421 is still running; no completion is claimed here.
