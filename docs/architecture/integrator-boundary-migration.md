# Outer Integrator boundary migration

Status: complete. Issues #222, #223, #68, #138, and #224 establish the outer
boundary, run-bound promotion/finality, recovery, blocker reconciliation, and
graceful Exit behavior. Issue #225 removed the remaining legacy pipeline and
evaluation vocabulary.

## The corrected user story

An integration-ready task result reaches the front of its target's
Journal-derived queue. Dalph gives one exact persistent session and isolated
resource to an injected Integrator. That Integrator privately performs merge
construction, conflict resolution, repository checks, review, provider turns,
and technical retries. It either reports one prepared candidate commit or ends
conclusively without one.

When a commit is reported, Dalph asks Git whether that exact object is a commit
with ordered direct parents `[H, C]`. Dalph does not rerun the repository's
tests and does not schedule the Integrator's private work as stages. Exact-head
promotion remains a separate Dalph-owned Git boundary.

If Dalph disappears while the session is unfinished, restart gives the same
session back to the Integrator automatically. If the outer run ends without a
usable candidate, Dalph quarantines that session; the operator may Retry the
same session or request one Full rerun from a freshly qualified target head.
Unrelated runnable work continues.

The chronological authority is in the issue #222 and #68 scenarios. This file
only identifies the implementation evidence that must change.

## Why the current runtime is not conformance evidence

The old design split one Integrator into Dalph-owned candidate-agent,
correction, repository-verification, evidence-sealing, and promotion phases.
That split originated in issue #30 and was implemented by issues #57, #59, and
#78. Those issues are closed completed as truthful historical records; issues
#222 and #225 own correction and removal. Issue #68 supplies the implemented
recovery and operator behavior at the outer boundary.

The following checked-in areas describe or implement the rejected split and
must be replaced rather than renamed:

- `workflow/protocols/integration-candidate-construction/` and candidate-agent
  progress;
- `workflow/protocols/target-verification/` and
  `authorities/verification/`;
- integration-frontier transitions that emit `RunTargetVerification` or wait
  for a verification plan;
- Journal events, cassettes, and fixtures dedicated to candidate-agent reports
  or target-verification intents/results;
- legacy Git-reconciliation adapters and model vocabulary that invoke those
  stages;
- integration-finality inputs that require a `TargetVerificationManifest`.

The following behavior remains and should be built upon:

- issue #56's Journal-derived per-target queue order;
- Git lineage and exact candidate-object qualification;
- issue #60's intent-first exact-head compare-and-set and ambiguous-result
  reconciliation;
- content-addressed evidence storage where the corrected Integrator contract
  actually returns evidence;
- tracker completion, claim cleanup, delivery settlement, and independent-work
  progress.

## Scenario-to-test migration

| Scenario | Required replacement evidence | Old evidence that does not prove it |
| --- | --- | --- |
| #222: usable candidate | One generic fake Integrator receives exact S/H/C, reports M, and Git alone proves `[H,C]` | Candidate-agent continuation plus `TargetVerificationPassed` |
| #222: process loss | Reconstructed delivery gives the same unfinished S back to the fake Integrator | A separately restored candidate-agent report cursor |
| #222: incompatible lineage | Git stops the call before any Integrator invocation | Verification-plan/configuration waits |
| #68: conclusive non-success | One outer result creates one quarantine while unrelated work remains runnable | Verification failure or correction-limit exhaustion |
| #68: Retry | Repeated `(S,Q,Retry)` requests start exactly one new run in S | Blind provider-turn retry or a process-local dedupe cache |
| #68: Full rerun | One recorded direction preserves S and creates/restores at most one S2 at fresh H2 | Automatic candidate rebuild inside the old session |
| Promotion | Only Integrator-reported, Git-qualified M reaches exact-head CAS | A sealed target-verification manifest as promotion authority |

The corrective implementation graph was #222 → #223 → #68, with #224 after
#223, #138 after #223/#68, and final legacy removal in #225 after #68 and #224.
The completed issues remain historical records rather than being reopened or
repurposed.

The accepted-result Quint model has negative controls proving that legacy
verification evidence or an unreported candidate cannot enable promotion.
Read `docs/QUINT-GUIDE.md` before changing it or its conformance adapter.
