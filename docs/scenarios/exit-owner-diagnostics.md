# The Operator identifies an unresolved application Exit owner

Issue: [#495](https://github.com/dearlordylord/dalph/issues/495), refining C2/O1 in
[#491](https://github.com/dearlordylord/dalph/issues/491).

## Governing behavior

When the Operator reads owners or the Supervisor requests Exit, preserve the
[five-second drain](graceful-application-exit.md#the-exit-drain-reaches-five-seconds),
[output allowance](cli-exit-output-grace.md#accepted-policy-and-scope),
[early acquisition](cli-exit-before-observation.md), and
[executor evidence](running-executor-application-exit.md).
The existing [model mapping](application-exit-model-mapping.md) owns the fifth-tick
precedence and exact safe-or-terminal evidence laws. This read-only refinement
adds no admission, suspension, finality, retry or cleanup permission (D31–D32 in
[process and durability](../DELIVERY-INVARIANTS.md#process-and-durability)).

## O1 The Operator reads admitted owners while the host lives

Starting facts: an unfinished Run retains its exact workflow intents, claims,
attempts and resources. The host has admitted forward owners, executor drains,
and provider/Journal/local-resource drains. Before selection its scope is NoRun;
this means no selected observation, not proof that no durable Run exists.
Trigger: the Operator requests ReadExitOwners at the public host boundary.
Chronology: validate exact host/request/Run correlation, read existing lifecycle
and drain registrations without querying an authority, and project only allowlisted
owner names, registration identities, scope, boundary identities and evidence.
Visible result: each admitted owner names the evidence it lacks and its permitted
next action. A produced boundary result lacks Journal acknowledgement; provider
close lacks exact closure evidence; executor drain lacks correlated suspension
or terminal evidence. A released owner disappears only through its existing owner.
Forbidden: private failure strings, provider payloads/prompts/credentials, a new
owner registry or durable Exit mailbox, and inferred safety from process age.
Crash/retry: another read has no effects. Restart discards these registrations and
reconstructs durable unsettled responsibilities through ordinary recovery.
Acceptance: `exit-owner-diagnostics.test.ts` and public
`running-host-exit-owners.acceptance.test.ts` prove named identity, evidence,
redaction and release; the read must not invoke tracker/Git/executor boundaries.

## C2 The Supervisor requests Exit with an unresolved owner

Starting facts: as O1, including acquisition before selection. Output can drain,
stall, or close; an admitted owner can withhold its existing drain acknowledgement.
Trigger: SIGTERM twice, or two Operator Exit requests.
Chronology: join the original shell cutoff and five-second driver; read the same
owner state at result production. Carry the redacted snapshot in the shared result
and public Exit record when transport permits. Reuse the accepted single 500 ms
output allowance, capped by the original deadline, with no allowance for TimedOut.
Finalize using the existing scope and retain nonzero finalization/transport failures.
Visible result: unresolved owners remain named in delivered TimedOut output.
Stalled output may omit every diagnostic and final record. A non-cooperative
owner retains custody until its existing stop/reconciliation proof; timeout and
leader termination do not release descendants or prove safe suspension or Run finality.
Crash/retry: no retrieval from a dead host is promised. Ordinary current-format
recovery reconciles original durable intents before effects; repeated signals
create neither a second deadline nor another output allowance.
Acceptance: diagnostics tests prove repeated Exit and unresolved drains; reused
`cli-exit-output-grace.test.ts`, `running-host-cli-exit.test.ts`,
`production-host-acquisition.test.ts`, `production-host-exit.test.ts`,
`node-main.integration.test.ts` and `linux-supervisor-exit.integration.test.ts`
retain draining/stalled/closed transport, NoRun, finalization failure and native
process/group/lock controls. Native owner-output controls extend that evidence;
none grants custody release from output abandonment.
