# #417: check the exact protected Codex launcher before task work

Issue: [#417](https://github.com/dearlordylord/dalph/issues/417).

Status: accepted for #417 after the scoped Astra review and its three required
corrections. The operator authorized autonomous continuation on 2026-10-02.

## Governing behavior

This setup check preserves the exact process ownership and fail-closed close
rules in [Codex app-server qualification](codex-app-server-qualification.md#scenario-to-test-mapping),
including its Prior-leader-loss refinement, and the controlled-provider isolation
in [issue #307 qualification](codex-app-server-qualification.md#issue-307-qualification-starts-one-isolated-controlled-provider-child).
It preserves the one task app-server and one shipped child in [direct remote
publication](direct-remote-publication.md#scenario-to-test-mapping). It adds a
qualification probe before the shipped child, not a task attempt, model turn,
new retry, or new rule for ordinary Dalph runs. The existing [cleanup
disposition rule](disposition-cleanup.md#git-owner-or-locator-changes-after-authorization)
and [D17](../DELIVERY-INVARIANTS.md#preservation) forbid deleting a resource on
unproved authority. [D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
and [D29](../DELIVERY-INVARIANTS.md#process-and-durability) constrain intent,
reconciliation, absence, and process recovery. No workflow model law changes
because the probe is outside the Dalph task workflow.

## Starting situation and successful journey

The protected operator has selected one pinned candidate and invoked one
qualification job. The controller has created the disposable GitHub issue and
its exact local fixture, including the generated Codex wrapper, isolated
`CODEX_HOME`, executor private directory, publication repository, and retained
fixture manifest. It has written the recoverable setup checkpoint. No shipped
Dalph child, task worktree, model request, or task app-server has started.

The controller records the complete fixture checkpoint, then asks the existing
Codex app-server owner to launch the *same wrapper path* selected by the
fixture configuration with that fixture's `CODEX_HOME`. The wrapper records
the probe process identity in a separate probe observation file inside the
manifested private directory. The task app-server observation file remains
empty. The probe gets only its isolated home, fixed system command path, and
observation selector; it does not inherit the controller's GitHub secret or
other ambient credentials. The owner reads the launched process's effective
argv and start identity, writes a redacted launch observation, and checks the
configured executable, expected app-server arguments, and exact process token
through the production ownership validator. It closes that exact process under
the existing ownership service
and proves it stopped. Only then does the controller admit the one shipped
Dalph child. That child may start one task app-server; the final composition
still requires exactly one task app-server identity. Probe evidence is outside
the public task transcript and is removed with the exact local fixture only
after the normal completed cleanup authority succeeds.

Before the owner asks the OS to spawn the wrapper, it durably records the exact
launch command and incarnation token with a `Launching` phase and no PID in
the manifested private store. The probe consumes the protected invocation's
remaining deadline; it cannot reset or extend that deadline. It sends no
Codex task turn or Responses model request and starts no tracker task.

## Failed observation, close, or interrupted controller

If the wrapper cannot launch, the process identity or effective argv cannot be
read, the executable mismatches, or close cannot prove the exact process
stopped, the controller does not start the shipped child. The `NotQualified`
checkpoint with the GitHub and local fixture locators was written before the
probe; that last complete checkpoint remains valid even if close or the
controller itself fails before another write. The private
directory retains any probe launch, process-owner, and
wrapper observation records already written for inspection and exact
reconciliation. A failure before the durable launch intent creates no probe
process. The controller does not declare the
fixture removable merely from a probe error or an absent child record.

The controller can die after the wrapper starts but before it writes its
observation, after observing it but before close, or during close. The outer
protected job retains the most recent exact checkpoint. A later operator first
reconciles the owner's durable launch record, its incarnation token, fresh OS
process observations, and fixture resources. This also applies if the
controller dies before spawn or after exact close but before child admission.
It cannot infer absence from a missing wrapper observation or absent leader,
start a shipped child under the interrupted invocation, or blindly retry a
provider or tracker mutation.
This probe makes no provider model request and no tracker mutation itself.
If an exact stopped-process observation is eventually available, cleanup
still follows the existing typed fixture authority; an unreadable identity
keeps the relevant resource retained.

If the remaining protected deadline expires during launch, observation, or
close, the controller admits no shipped child and attempts bounded exact close
through the same owner. If stopped-process proof is unavailable, the last
durable fixture checkpoint and private launch state remain retained for
reconciliation. Timeout never qualifies the invocation.

The operator sees either the existing qualified artifact after the complete
journey or a failed job with exact retained locators and redacted preflight
evidence. There is no automatic hosted S1 retry. A new protected invocation
creates a new fixture and credential under the existing job policy.

## Acceptance-test mapping

| Boundary outcome | Controlled tests and evidence |
| --- | --- |
| Exact wrapper and `CODEX_HOME` match; exact close precedes one shipped child | `production-live-launch-preflight.integration.test.ts` calls the production Effect layer with the generated Linux wrapper and controlled-provider configuration. It checks `ExactLive`, stopped PID, separate probe identity, empty task count, and zero loopback Responses requests. `production-live-qualification-runtime.test.ts` checks `LaunchPreflightClosed` before `ChildSpawned`. The probe makes no task-turn call. |
| Wrapper mismatch or unreadable process observation | The Linux integration test changes effective argv, observes `Contradictory` and retained `Launching → Spawned → Live` state, and sees no task count. `codex-app-server-process-policy.property.test.ts` checks unreadable command/identity projections and rejects every non-exact observation before a signal. The runtime failure test asserts `NotQualified`, retained exact private directory, and no child for a failed preflight. |
| Crash before spawn, after spawn before observation, or after close before child admission | `codex-app-server-process-policy.property.test.ts` checks durable-token reconciliation of `Launching` and later escaped children, including bounded failure. The runtime test checks the complete fixture checkpoint before preflight and that failure before child admission retains its locators. The post-close progress record is written before `ChildSpawned`. |
| Ambiguous close or interruption after launch | `codex-app-server-process-policy.property.test.ts` checks non-exact close and cleanup-failure preservation. The slow-wrapper Linux integration test interrupts launch, proves the process absent, and reads the durable `Launching` record. The runtime failure test forbids a child and retains the private directory. |
| Protected deadline expires during launch, observation, or close | The slow-wrapper integration test times out launch through the same scoped owner and proves no task count or live PID. The production Effect layer applies its 15-second bound, maps timeout to `Setup`, and the runtime failure test proves no child or qualification from that failure. Owner close ambiguity retains state under the previous row. |
| Successful task after probe | `production-live-qualification-runtime.test.ts` observes one `ChildSpawned` after `LaunchPreflightClosed`; existing #388 completion controls check one task app-server and one task worktree. The Linux integration test proves the probe writes only the separate count file. |
| Exact cleanup | `production-live-qualification-runtime.test.ts` checks failed-probe retention of the exact manifested private directory; existing `ProductionLiveFixtureCleanup` controls prove completed exact removal and unresolved retention. Probe records live under that manifested private directory. |

The existing protected live qualification matrix supplies an integration check
when the next hosted journey is specifically authorized. This change does not
require a fresh hosted S1 merely to accept its local probe controls.

## Controlled evidence status (2026-10-02)

The three focused Linux integration controls pass for production-layer success,
effective-executable mismatch, and interrupted launch. The controlled runtime
and shared owner-policy controls pass. These tests compose at the Effect
preflight service: the Linux controls prove the real launch and close boundary;
the runtime controls prove child admission and retention for its success or
failure; the owner-policy controls prove unreadable and ambiguous process
observations without weakening exact ownership. A fresh hosted S1 is outside
this issue's acceptance and requires separate authorization.
