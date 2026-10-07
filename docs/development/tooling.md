# Verification tooling ownership

[Development entry](../DEVELOPMENT.md) · [Commands](commands.md#commands)

Find the invoked driver from its package script or CI caller before reading its
policy helpers. These tools verify Dalph; they do not own Dalph task workflow
history. `package.json` and workflow callers own executable routing.

## Verification drivers and owners

| Driver and caller | Effects, evidence, time and cleanup | Overlap and disposition |
| --- | --- | --- |
| Documentation references: `check:docs` / CI `documentation-links` → [`check-docs.mjs`](../../scripts/check-docs.mjs), [`install-lychee.mjs`](../../scripts/install-lychee.mjs). | Git selects maintained Markdown; a pinned, checksum-verified native binary checks local targets and headings offline. Download, extraction, version check, and scan have finite timeouts; temporary input lists are removed. CI's required quality aggregate refuses a missing or failed result. | **Read-only navigation verifier.** It needs no workspace build, gate slot, provider access, or workflow Journal. |
| Local quality: `pnpm check:all` → [`with-gate-slot.mjs`](../../scripts/with-gate-slot.mjs) → [`run-admitted-gate.mjs`](../../scripts/run-admitted-gate.mjs) → [`run-candidate-checks.mjs`](../../scripts/run-candidate-checks.mjs); `check:ci:quality`, `check:preflight`, and `check:baseline` use the same custody launcher. | The gate owns the exact worktree/clone slot, absolute deadline, child registrations, logs, input guard, candidate manifest, stage receipts and durable stopped-writer fence. `run-admitted-gate.mjs` writes `run.json` before its child and a terminal record only after custody proof; [`run-bounded-command.mjs`](../../scripts/run-bounded-command.mjs) registers intent before spawn and proves process-group absence. [`reconcile-gate-run.mjs`](../../scripts/reconcile-gate-run.mjs) is the explicit recovery command. A failed or missing exit remains unproven. | **Keep as gate tooling.** These processes test Dalph and own gate evidence, not a Dalph task attempt. Moving this independent custody into the product's `WorkflowInterpreter` would conflate the candidate verifier with the program under test. Consolidate only duplicate gate command planning or wrappers within this gate owner. |
| Hosted quality: [CI workflow](../../.github/workflows/ci.yml) → [`quality-gate-stage-plan.mjs`](../../scripts/quality-gate-stage-plan.mjs), [`run-hosted-quality-stage.mjs`](../../scripts/run-hosted-quality-stage.mjs), [`aggregate-hosted-quality-stages.mjs`](../../scripts/aggregate-hosted-quality-stages.mjs). | The workflow chooses a Base/Candidate and matrix; each cell enters the gate custody wrapper and writes a stage report. The hosted stage creates scratch owner-reference files and relays signals to its admitted child. CI job timeouts are an outer limit; gate custody still supplies child deadline/absence evidence. The aggregate validates reported cells. | **Keep CI adapters**, with one stage plan in [`quality-gate-stage-policy.mjs`](../../scripts/quality-gate-stage-policy.mjs). Hosted matrix/artifact transport is not workflow history. Do not create a second unadmitted process supervisor in the CI adapter. |
| Formal: `check:quint` / CI formal shard → [`run-formal-gate.mjs`](../../scripts/run-formal-gate.mjs), [`run-formal-workflow.mjs`](../../scripts/run-formal-workflow.mjs), [`check-quint-models.mjs`](../../scripts/check-quint-models.mjs), [`run-hosted-formal-shard.mjs`](../../scripts/run-hosted-formal-shard.mjs); aggregate via [`aggregate-hosted-formal-shards.mjs`](../../scripts/aggregate-hosted-formal-shards.mjs). | These choose the Quint profile, run bounded prover commands, observe formal inputs, publish formal success evidence and shard reports. The formal workflow uses one decreasing allowance and the shared gate bounded runner. The hosted shard binds its CI candidate and requires custody before writing a report. | **Keep as verification tooling.** The profile/model and shard reports prove the implementation; they do not drive a Dalph task. Preserve one formal command profile and one gate custody path. [`quint-effective-profile.mjs`](../../scripts/quint-effective-profile.mjs) is substantial policy, but is not itself a process owner. |
| Delivery repetition: `test:delivery-repeatability`, `test:delivery-smoke`, and quality stages → [`run-delivery-repeatability.mjs`](../../scripts/run-delivery-repeatability.mjs). | Runs repeated Vitest/cassette children and Git reads, with its own total deadline, per-child timeout, temporary result directory and removal. It delegates fresh child spawning to `runBoundedCommand`; warm mode also owns a long-lived Vitest process and late-resolution cleanup. Reports occurrence/order evidence for the verification suite. | **Keep as test harness**, but high audit priority for its independent warm-mode cancellation path and 971-line orchestration. It overlaps gate scheduling, not Dalph's `PlannedAttemptExecutor`. A future change should first unify process custody with the gate runner, preserving fresh/warm result semantics; no product workflow migration is justified. |
| Direct Codex qualification: `qualify:codex` → [`qualify-codex-app-server.mjs`](../../scripts/qualify-codex-app-server.mjs). | Checks the pinned Codex version, builds the package closure, then runs the built launch preflight through `runBoundedCommand` before real-host tests. The probe uses the existing app-server ownership observer and close path, retaining ambiguous cleanup evidence. Build and Vitest remain inherited-stdio relays under the CI job's outer timeout. | **Verification adapter.** Product app-server ownership remains [`CodexAppServer`](../../packages/dalph/src/application/codex-app-server.ts); a passing launcher probe does not qualify a shipped task. |
| Protected live qualification: [workflow](../../.github/workflows/production-live-qualification.yml) → [`run-production-live-qualification.mjs`](../../scripts/run-production-live-qualification.mjs) → [`live-qualification-runtime.ts`](../../packages/dalph/src/qualification/live-qualification-runtime.ts) → shipped Dalph CLI. | The 962-line outer adapter validates the exact candidate, formal job provenance and environment, writes a manifest, spawns the built controller once, and captures redacted diagnostics. It checks child exit but does not itself prove descendant absence; CI sets the outer job timeout. The Effect runtime creates exact local/GitHub fixture receipts, runs the shipped CLI, publishes qualification evidence and reconciles cleanup. | **Keep CI provenance/manifest adapter; move no task ownership into it.** Split its pure CI provenance parsing from its one-shot launcher when touched. Fixture lifecycle and ambiguous outcomes already belong in the Effect qualification runtime and its cleanup services. The script must not implement independent retry/cleanup of a Dalph task. |
| Git/worktree/bootstrap: [`bootstrap-worktree.mjs`](../../scripts/bootstrap-worktree.mjs), [`changed-files.mjs`](../../scripts/changed-files.mjs), [`gate-resume-inputs.mjs`](../../scripts/gate-resume-inputs.mjs), [`classify-docs-only-change.mjs`](../../scripts/classify-docs-only-change.mjs), [`resolve-quality-gate-base.mjs`](../../scripts/resolve-quality-gate-base.mjs). | Bootstrap runs bounded install/build preparation; the rest read candidate Git/config/index/ref facts for selection and input validity. The gate guard observes exact inputs and closes after stages. | **Keep as build and gate adapters.** Git remains authoritative for the tested checkout. These do not claim task lineage or worktree ownership. Dalph's task Git calls stay behind `WorkflowInterpreter`; never feed these candidate-selection readers into task state. |
| Gate diagnostics: `gate:status`, `gate:reconcile`, `gate:diagnose`, `gate:verify-repair` → [`gate-run-status.mjs`](../../scripts/gate-run-status.mjs), [`reconcile-gate-run.mjs`](../../scripts/reconcile-gate-run.mjs), [`run-gate-diagnosis.mjs`](../../scripts/run-gate-diagnosis.mjs), [`run-gate-repair-verification.mjs`](../../scripts/run-gate-repair-verification.mjs). | They read a named retained run, prove stopped writers or execute a focused command under inherited custody; recovery cannot silently create a new full run. | **Use status/reconcile for current candidate custody.** Diagnosis/repair-permit commands serve retained recovery records; ordinary `check:all` never consults them. Do not replace this evidence with shell exit status. |
| Manual model mutation: [Quint guide](../QUINT-GUIDE.md) → [`quint-mutate-specs.mjs`](../../scripts/quint-mutate-specs.mjs). | Creates temporary mutated model files, runs repeated Quint subprocesses and removes the temporary tree. Its sampling budget comes from command arguments; it is outside the admitted formal success path and its result is diagnostic, not a formal certificate. | **Keep as an opt-in research harness.** It must not silently become a required gate or publish formal success evidence. If made routine, first move its subprocesses under bounded gate custody. No Effect task workflow overlap. |
| Manual macOS exit qualification: [accepted Linux supervisor scenario](../scenarios/linux-supervisor-exit.md) → [`qualify-macos-application-exit.sh`](../../scripts/qualify-macos-application-exit.sh). | Pins a historical commit, creates an isolated worktree, starts the built host fixture, writes unique local evidence, and traps child/worktree cleanup. It uses its own 60-second readiness polling and best-effort `kill -KILL`/`worktree remove --force` on exit. | **Keep manual and isolated** while that platform proof is needed, but rank its shell cleanup as a bounded follow-up if rerun or generalized. Its historical fixture and evidence cannot be folded into product task cleanup; a failed exact removal must remain a retained cleanup obligation. |
| Tiny adapters and non-drivers: [`run-tests.mjs`](../../scripts/run-tests.mjs), [`run-delivery-smoke.mjs`](../../scripts/run-delivery-smoke.mjs), [`run-preflight.mjs`](../../scripts/run-preflight.mjs), [`workspace-artifacts.mjs`](../../scripts/workspace-artifacts.mjs), lint/coverage verifiers, package-boundary checkers, reporters, generated declaration rewrites. | Route a command, build outputs, or inspect files; tests and `*.d.mts` provide proof/types. `run-tests.mjs` is a small unbounded Vitest relay, not a Dalph process controller. | **Keep thin** where callers still exist. Delete only obsolete entry points after a caller search; file size or extension alone is no deletion criterion. |

Formal-family additions update the independent command oracle, obligations,
effective profile, hosted ranges and their literal contract tests together.
Custody and qualification fixture sizes derive from the executable manifest;
they do not duplicate its total. This keeps command-content/order validation
independent while preventing unrelated custody tests from retaining stale totals.
The generated inventories and hosted input closure are refreshed with
`node scripts/generate-formal-command-inventory.mjs --write` and
`node scripts/generate-hosted-formal-input-manifest.mjs --write`.

## MBT corpus ownership

[The MBT inventory and provenance contract](mbt-corpus.md) maps every selected
generation option site to a corpus path, records exact model/import and runtime
inputs, and defines bounded generation, validation controls and the next-owner
file map. This tooling slice leaves Dalph runtime, model semantics, selected
scenarios and state comparisons unchanged.

## Owned Apalache endpoint observations

The formal verifier connects to `127.0.0.1:port`. Its Linux socket observer
excludes a proven different IPv4 address at the same port before proving every
remaining listener inode belongs to the exact owned process. Wildcard, IPv6 and
unknown address observations remain conservative and require the same fd proof.
An unrelated listener on `127.0.0.2:port` must neither refuse the owned endpoint
nor be stopped during cleanup. The existing native positive fixture proves that
composition and writer absence; controlled address cases cover selection, and
the foreign-endpoint fixture retains refusal before profile execution. This is
verification tooling and changes no Dalph runtime behavior.

Issue #451 retains the historical socket-proof refusal. The original failure
did not capture address/inode data, so the demonstrated same-port address defect
does not establish its cause. Future mismatches retain those fields; a passing
fixture alone cannot close that historical diagnosis.

## Focused test diagnostics

[Coverage lifecycle observations](coverage-diagnostics.md) identify unfinished
tests and scope finalization in retained child logs.
[History-copy fixtures](history-copy-fixtures.md) describe whole-record equality
and the explicit contemporary/historical constructor boundary.
