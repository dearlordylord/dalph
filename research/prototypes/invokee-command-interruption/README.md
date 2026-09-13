# Disposable command-interruption probe

This probe uses Dalph's unchanged capacity and control-direction services with
the real SQLite journal adapter. It exercises these ordered cuts:

1. interrupt the request before it invokes the command service;
2. request interruption inside SQLite's transaction after the INSERT and before
   COMMIT, which the live Journal masks until append and publication finish;
3. request interruption after COMMIT but before checkpoint publication, which
   is masked by the same live-Journal atomic boundary;
4. interrupt after the service returns but before an outer response is
   delivered;
5. interrupt a request that waits on a command forked into the already-open
   host/test scope; and
6. interrupt inactive-Run Unpause during its append and observe the exact
   `JournaledRunBootstrap` post-apply control observer.

The four interruption-cut tests and host-scope test run both capacity and Run
Unpause; the bootstrap observer test exercises Run Unpause. It rereads durable SQLite records
and performs an exact retry. The post-COMMIT test also closes the first service
scope, opens a fresh caller from the same database, and retries again.
The bootstrap case proves that Unpause can be durable and accepted while the
post-apply observer is skipped; its exact retry records a second ordinal and
then invokes the observer. It does not instantiate the reactivation owner or
claim a resulting timer state.

Run from the repository root:

```sh
pnpm exec vitest run --config research/prototypes/invokee-command-interruption/vitest.config.ts --reporter verbose
```

The hooks are existing SQLite test seams. `onAppendInserted` is after the real
INSERT inside `sql.withTransaction`; `afterAppendCommit` is after that
transaction returns and before checkpoint publication. The probe does not
claim to pause inside SQLite's COMMIT engine operation. It uses the real live
Journal above SQLite; the live Journal makes storage append plus accepted
publication uninterruptible. A direct raw-store interruption would be a
different boundary and is not presented as capacity or Unpause behavior.
