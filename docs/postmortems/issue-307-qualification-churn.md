# #307 qualification churn — 2026-09-14

The maintainer waited at least eight hours for a repeatedly described nearly
finished integration while the orchestrator continued repairing qualification.
The delivery outcome remained unavailable. The orchestrator owns that failure
to control scope, choose discriminating checks, and report completion accurately.
Test maintenance and gate repairs consumed the delivery window; passing more
checks was repeatedly treated as progress toward a usable release without
establishing the remaining end-to-end path early enough.

This is tooling/process documentation. It changes no Dalph runtime behavior,
provider request, journal fact, retry, or cleanup action. The affected people are
the waiting maintainer and agents implementing and qualifying the candidate.
The process scenarios and their controls are mapped below.

## Evidence and limits

The eight-hour lower bound and repeated “99% done” reports come from the
maintainer's session feedback. The repository does not contain a complete
timestamped session ledger, so this report does not invent a precise allocation
of those hours to causes. Commit history proves repairs occurred; a commit count
does not measure useful work or time lost. Some repairs corrected actual runtime
behavior. It would be inaccurate to label every changed line valueless; the
failure was spending the delivery window without delivering the accepted result.

The following evidence is independently inspectable:

| Event | Evidence and result |
| --- | --- |
| Structural failures were being discovered in separate expensive attempts. | `d559c3668` introduced the preflight failure census on September 12. `46427459f` and `638232a61` added admitted-entry controls. Current `scripts/gate-resume-integration.test.mjs` proves lint and complexity failures appear together and formal qualification does not start. The session reported 46 lint findings followed by eight complexity findings; those exact historical counts are session evidence, not reconstructed gate receipts. |
| Qualification identity and command wrapping caused repair work unrelated to the model's behavior. | `ce13305de`, `718448311`, and `cb37e74bb` stabilized the Codex argv-zero PATH entry before admission. `d86fc2c0d` and `410129094` repaired generated launcher identity/semantics. `b0478f588` and subsequent config-observer fixes addressed unrelated worktree branch configuration. `bbf80ecb4` introduced unaffected hosted formal classification. |
| Built-child test failures initially lacked useful exit diagnostics. | `06964df3a` added bounded child exit diagnostics. Later commits repaired fixture paths, ambient authentication, process census, and custody observation. These are separate phenomena; a timeout by itself did not identify a runtime defect. |
| Hosted quality failed on candidate `0850959cf`. | [Run 34833770144](https://github.com/dearlordylord/dalph/actions/runs/34833770144), September 14, 10:33:31–10:58:02 UTC, failed during coverage. The session's extracted result identified five 60-second timeouts in `production-hermetic-controller.integration.test.ts`. A focused six-test V8 run passed locally with one worker in 51.2 seconds; that local timing is session evidence. It was not proof that the hosted four-worker workload would pass. |
| The maintainer directed removal of the redundant composition suite. | `7ea130fc7` deleted its 1,302 lines. `0fbeb5be1` and `47a70eafa` reconciled acceptance documents: focused tests prove their individual boundaries; the protected live run owns final composition. Those focused tests are not claimed to be equivalent composed proof. |
| Ordinary hosted quality then passed. | [Run 34837745999](https://github.com/dearlordylord/dalph/actions/runs/34837745999), 11:20:56–11:38:07 UTC, succeeded on `47a70eafa`. Formal classification was correctly not applicable. The shorter run is an observation, not a controlled estimate of savings from deletion alone. |
| The protected workflow still failed before exercising the product. | [Run 34837785947](https://github.com/dearlordylord/dalph/actions/runs/34837785947), 11:21:24–11:44:35 UTC: all four formal shards succeeded; `Resolve current formal job provenance` rejected `v24.20.0`; `Run one protected live qualification` was skipped. No live mutation occurred in that skipped step. |
| A producer/consumer mismatch survived local tests. | The workflow wrote `process.version`, including `v`, while the validator required `24.20.0`. `b7727d2ef` changes the producer to `process.versions.node` and adds workflow and rejection controls. This is a qualification metadata defect, not evidence of a failed Dalph task turn. |

## What went wrong

1. **The orchestrator preserved a costly test as an end in itself.** Repeated
   fixture repairs prolonged a resource-sensitive composed simulation before
   asking what unique accepted behavior it proved. The removal decision and
   acceptance-map reconciliation came only after the maintainer intervened.
   The correct deletion also required admitting that final composition was
   still unproved until the protected run succeeded.
2. **Checks were poorly ordered and too broad for diagnosis.** Independent
   structural errors should have arrived in one census. Instead, another
   qualification attempt became the next diagnostic experiment. The preflight
   repair now enforces collection, but its existence does not prove that every
   earlier retry used it correctly. Cheap producer/consumer validation was also
   missing before the four formal jobs in the protected workflow.
3. **The evidence boundary was broader than the behavior being verified.**
   Formal execution was repeated for unrelated changes, while generic PATH,
   launcher, script, and shared Git observations introduced false invalidations
   or prevented reuse. Monitoring executable resolution is relevant; watching
   an unused Codex scratch shim as candidate content was an avoidable cost.
   The answer is a tested input projection, not forbidding all agents from
   using a shell while another agent qualifies a candidate.
4. **Hosted CI was used too late as a diagnostic environment.** A green focused
   run under different coverage/concurrency conditions did not settle hosted
   failures. Conversely, the Node metadata mismatch needed no hosted executor
   or provider to reproduce. The actual producing expression and consuming
   validator were tested separately with incompatible assumptions.
5. **Test machinery and product behavior were conflated.** Fixture timing,
   process-group observations, coverage overhead, output wrappers, and actual
   workflow defects require different experiments. Shared-container contention
   is a plausible contributor to the timeout cluster, supported by the focused
   versus hosted difference, but it is not a measured causal attribution for
   every failure. Increasing a timeout would not establish product correctness.
6. **Verification itself accumulated hidden boundaries.** Shard argument
   forwarding, physical shard provenance, aggregate conditions, child errors,
   and input observers each acquired additional controls after downstream
   failures. These changes had value, but exposing each boundary only after a
   costly run multiplied delay. Complete failure output and producer/consumer
   contract tests belong at those boundaries from the start.
7. **There was no effective intervention budget.** The existing two-attempt
   rule did not stop repeated local repairs from extending the same unfinished
   milestone. Repeated near-completion claims omitted the still-unexecuted
   protected suffix. More reviewers and renamed subproblems did not reset the
   maintainer's delivery clock.

## Prevention plan and validation

The task orchestrator owns application of these controls; the agent changing a
tool owns its focused regression tests; the scoped reviewer checks the evidence.
Record results in the existing issue comment or handoff, not a new ledger or
GitHub issue. A threshold triggers a change of diagnostic method; it never turns
a failed check green or permits a blind retry of a live mutation.

| Starting facts and trigger | Executable action and owner | Measurable acceptance and validation |
| --- | --- | --- |
| An agent receives a failing check. | Orchestrator records candidate/Base, run or receipt, named failed command, first causal error, unexecuted suffix, and next distinguishing experiment. Use `pnpm exec vitest run <file> -t '<case>'` for Vitest tests, `pnpm exec node --test --test-name-pattern='<case>' <file>` for Node tests, or the documented package entry point. Confirm that the intended test was collected. Match coverage/worker conditions only when they are part of the hypothesis. | Before the next broad/hosted submission, there is a focused failure reproduction and passing repair, or a concrete explanation of the missing local capability. Target: zero unexplained resubmissions. Reviewer compares issue evidence with run links. |
| Two attempts fail to advance the same accepted outcome, or 30 minutes of active repair elapse without a new distinguishing result. | Orchestrator stops repeating that experiment, lists competing causes, and chooses one discriminating test. For a costly test, name its unique scenario and current alternative evidence; remove a redundant test and reconcile its acceptance mapping, or preserve a missing required proof with an explicit next experiment. | Decision recorded within the next 10 minutes of active work. Target: zero third identical attempts. Count attempts against the parent outcome even when files, reviewers, or subtasks change. Waiting on an already running gate does not itself count as active repair. |
| A candidate has structural findings in several tools. | Tool owner preserves the preflight census. Develop with pinned-base `pnpm check:fast`; use `pnpm check:preflight --candidate=<base>` when diagnosing the complete structural set, then the required frozen candidate gate under Development policy. | `pnpm exec node --test --test-name-pattern='lint census|reports lint and complexity failures together' scripts/quality-lint-census.test.mjs scripts/gate-resume-integration.test.mjs` must report both controlled failures and prove no formal/qualification child starts. Zero hidden ordinary census failures. |
| A non-model edit lands while formal evidence exists. | Orchestrator uses guarded applicability/reuse and records its original evidence or exact changed formal input. No manual `--force` unless reproducing a formal defect or measuring timing. | `pnpm exec node --test --test-name-pattern='retains formal reuse across unrelated edits|retained exact observation ignores unrelated script' scripts/formal-input-policy.test.mjs`. Target: zero fresh formal runs without a recorded affected input or explicit reproduction reason. Protected workflow profiles remain their declared requirement; local reuse does not waive them. |
| Another agent uses a shell or creates an unrelated worktree during a gate. | Tool owner preserves resolution-aware PATH stabilization and effective candidate Git configuration projection. Independent work uses another worktree. | `pnpm exec node --test --test-name-pattern='argv-zero|unrelated branch section|candidate-relevant config replacement' scripts/gate-resume-inputs.test.mjs` proves benign changes coexist and relevant changes reject evidence. Zero invalidations attributed solely to unused argv-zero scratch. |
| A workflow generates metadata consumed by a later job. | Changing agent runs producer/consumer contract controls locally before dispatch. Use the producing field expression/schema, not a separately invented successful fixture. | For the observed regression: `pnpm exec node --test --test-name-pattern='dispatch inputs and worker toolchain|v-prefixed process.version' scripts/production-live-qualification-workflow.test.mjs scripts/run-production-live-qualification.test.mjs`. The producer must emit canonical Node version and the former prefixed payload must fail. Target: zero repeat of this defect class; a future producer extraction should execute the real emitter through the consumer. That stronger general extraction is planned, not claimed implemented here. |
| A bounded child or shard fails. | Tool owner retains the command, exit/signal, shard/profile, full log locator and first causal error; reviewer rejects a summary that erases them. Run the changed runner's focused tests before another expensive profile. | Inspect `scripts/quint-ci-contract.test.ts`, `scripts/gate-custody.test.mjs`, and the affected runner tests for the exact changed boundary. Existing custody tests reject missing/changed logs. Target: zero failures whose only retained diagnosis is a generic parent exit. Do not run every listed suite for an unrelated change. |
| An orchestrator reports status or closes a milestone. | Report separately: code merged SHA, checks passed, remaining failed/unrun accepted scenario, next action. Close only after its required artifact and issue dependencies are verified. | Zero “done”/“99%” claims with an unexecuted required suffix. Reviewer checks the final artifact and native issue edges, not elapsed effort or aggregate test totals. |

For the next three integration candidates, include one compact measurement in
the existing closure comment: elapsed time from first frozen candidate to
accepted outcome; broad/hosted attempts; repeats without new evidence; first
failure to focused diagnosis time; formal executions with their applicability
reason; and accepted scenarios still missing. Separate queued/gate wait from
active diagnosis where timestamps exist, otherwise mark it unknown. Operational
targets are zero repeats without new evidence, zero unjustified formal runs,
and the 30-minute/10-minute intervention rule above. These are proposed process
targets, not measured historical performance or additional test timeouts.

After those three candidates, the orchestrator and reviewer compare the
measurements with preserved scenario evidence. A target miss requires naming
the specific ineffective control and changing it before the next repeated
attempt. Lower gate duration alone is insufficient if required behavior lost
its proof. No new dashboard, scheduler, or always-running monitor is introduced.

The four concrete Node test commands above were executed during this report's
review: census 2/2 (1.58 seconds), formal projection 2/2 (0.43 seconds), input
observation 4/4 (1.31 seconds), metadata 2/2 (0.07 seconds). These are focused
synthetic controls, not a full gate. Review caught an error in the first draft:
it sent these Node suites to Vitest, which excluded them. Correcting the command
and observing the selected test names is part of validating this plan; an
unexecuted command in a document is not evidence of an executable control.

## State at publication

Suite deletion, acceptance-map correction, preflight collection, formal input
projection, PATH stabilization, and canonical Node metadata have committed
repairs. This document records their evidence and the operating controls; it
does not claim a new successful protected live artifact. The latest inspected
protected run above failed before the live step. Final #307/#261/#253 closure
must link the later successful artifact if and when it exists.
