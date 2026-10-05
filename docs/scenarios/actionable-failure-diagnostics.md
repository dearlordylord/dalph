# Dalph keeps failures visible to the Operator

Accepted scope: [#430](https://github.com/dearlordylord/dalph/issues/430).
Alice reads the same compact diagnosis through CLI, MCP and the running-host
snapshot. Reading status starts no work and changes no tracker or Git facts.

## Governing behavior

The [running-host protocol](running-host-clients.md) owns snapshot/watch delivery.
[Journal reconstruction](../architecture/journal-and-reconstruction.md) owns
accepted workflow history. Tracker observations own task identity and title;
Git owns candidate/worktree facts; the execution substrate owns failure and
session observations. Application Exit remains distinct from Run termination
and task delivery. Diagnostics confer no recovery authority: #428 owns that
protocol, and unavailable recovery must be stated explicitly.

## Chronology and acceptance mapping

1. **Executor failure.** Alice has an exact planned attempt and retained
   worktree. The owned executor returns Failed after rejecting a result. Dalph
   records the existing terminal report, releases only the position justified
   by that report, and projects the failed task with its observed title, exact
   machine correlation, failing boundary and known safe reason or explicit
   unknown reason. A retained locator does not prove acceptance or delivery.
   Reading CLI/MCP/snapshot neither accepts nor publishes it. Tests:
   `retains a failed executor task in passive delivery status` in
   `delivery-status.test.ts`; `shows an executor failure without accepting its
   retained candidate` in `production-running-host.test.ts`; public projection
   and serialization variants in `production-cli.test.ts`.
2. **Liveness without progress.** The same attempt is executing. Repeated
   identical lifecycle observations and duplicate/disconnected watch frames
   do not create a later substantive observation. A real changed report,
   integration occurrence or accepted outcome may advance it. Snapshots expose
   the observation identity rather than fabricate elapsed progress. No crash
   action is needed: reconnect reads the current projection. Tests:
   `duplicate lifecycle observations do not advance substantive progress` in
   `delivery-diagnostics.test.ts`; the running-host snapshot consumes the same
   accepted-history projection, with watch transport still governed by #372.
3. **Tracker read failure and recovery.** A complete graph has been observed.
   The next logical read reports Throttled or CircuitOpen. Dalph retains that
   actual category, known provider timing only when supplied, and explicitly
   unknown timing otherwise. A later complete read clears the current wait
   without restarting work or replaying a mutation. After a crash the same
   accepted read history reconstructs the diagnosis. Tests: `projects
   throttle and circuit observations without inventing retry times` and
   `clears a recovered tracker wait without replaying mutations` at the
   `delivery-diagnostics.test.ts`; `shows tracker throttling and recovery without
   restarting the owned turn` in `production-running-host.test.ts` exercises
   actual public CLI refresh and production Git/SQLite composition. Provider
   timing is covered by the GitHub graph reader test.
4. **Delivery followed by close failure.** Delivery or supported cancellation
   has its accepted terminal Run record. Provider close then fails during
   application finalization. Dalph preserves delivered/cancelled facts and
   reports failed application Exit separately with a sanitized boundary and
   actual nonzero process disposition. It must report neither failed delivery
   from close alone nor successful shutdown from successful delivery. Reading
   after reconnect preserves the recorded Run result; it cannot reconstruct
   an unobserved process exit. Tests: `preserves Run Completed alongside failed provider finalization` and
   `preserves Run Cancelled alongside failed provider finalization` in
   `production-running-host.test.ts`; actual child-process exit cases in
   `node-main.integration.test.ts`.
5. **Retained history and privacy.** Crash after recording the terminal report,
   before publishing a snapshot. Restart reads the accepted history and current
   owning boundaries, then reconstructs failure visibility without rewriting
   terminal evidence or creating a replacement attempt. Unknown old reasons
   remain unknown. The compact diagnosis omits task bodies, provider payloads
   and credentials; exact machine identities remain structured fields.
   Tests: `reconstructs retained failure diagnostics after restart` and
   `compact diagnostics omit authored bodies and private provider payloads`.
6. **Failure before Run allocation.** Alice launches with a private directory
   whose permissions fail validation. Configuration fails before a RunId,
   journal beginning or task worktree exists. The shipped entry emits a safe
   private-store boundary and corrective guidance on stderr, leaves JSON
   stdout schema-valid, and exits nonzero. It never changes permissions
   automatically. Retrying after Alice repairs the directory uses ordinary
   validation; no workflow reconciliation is needed because allocation never
   occurred. Tests: `reports a private-store configuration failure
   before Run allocation` at Node-main and actual private-store startup seams.

All projections remain transient. Status adds no journal events, tracker
polling, provider retries or durable UI state. The bounded watch introduced
by #372 carries updates; independent authority reads must expose their own
observation identities rather than imply one atomic snapshot.

Tracker reads retain an intrinsic task descriptor (title and provider issue
ordinal) in the existing complete graph observation. The GitHub adapter obtains
these fields in the existing issue read/batch, without another request. Legacy
observations without a descriptor remain readable and display identity as
unavailable. Graph round-trip and GitHub reader tests prove descriptor retention;
descriptor changes participate in snapshot content and task revision. Authored
bodies remain outside this descriptor.

The host recalculates diagnostics when accepted history changes, including after
its execution activation returns idle. This follows the existing accepted-history
notification and reads the certified prefix; it does not introduce a provider
poll or authorize fresh work. Each diagnostic retains its own source position.

## Integration provider failure stops automatic activation

Accepted repair: [#457](https://github.com/dearlordylord/dalph/issues/457).
Dalph has recorded integration responsibility and retained the exact candidate.
The integration boundary returns `IntegratorCallFailure`, including a bounded
request timeout or transport loss before thread creation. The production owner
stops its timer and tracker notification admission, reports the same typed
failure once, and retains the candidate, responsibility and existing claim.
It creates no replacement thread, turn or server and publishes no commit.

A passive CLI/MCP snapshot returns sanitized `ReadFailed` with boundary
`IntegratorCallFailure`. An already attached watch receives the same failure
through the host-owned notification, even without another journal/state update.
The existing Run control still reports pending termination evidence; this
provider failure is not invalid finality evidence or task completion. Application
Exit remains independently available. Crash/restart requires ordinary retained
resource reconciliation before any new mutation; this process-local diagnosis
does not create durable UI state or confer recovery authority.

Acceptance: `reports activation failures and stops repeated integration calls
after provider failure` advances controlled time by an hour and proves exactly
one call; the passive HTTP read test proves pending finality and the exact
sanitized error; `publishes integration failure to an attached watch without
reactivation or false finality` proves notification, privacy and zero control
reads. `retains integration responsibility and exposes a failed candidate census
through CLI and MCP` exercises real Git/SQLite and both built public clients,
with one census call, retained claim and zero termination or cleanup records.
Existing integrator recovery tests prove retained intent/token identity.
