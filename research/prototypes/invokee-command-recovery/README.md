# Disposable persisted-Unpause recovery probe

This probe composes the unchanged SQLite journal, inactive
`JournaledRunBootstrap`, and `RunReactivationOwner`. It validates two paths:

1. a request-owned Unpause is accepted while the current owner misses its
   observer callback; an operator-wake hint does not repair that paused local
   state, while a fresh owner reconstructs `RunUnpaused` and activates without
   another control record; and
2. a complete bootstrap Unpause forked into the existing host/test scope
   finishes after its request waiter is interrupted and reaches the actual
   paused owner exactly once at ordinal 2, restarts its timer, and activates.

Run from the repository root:

```sh
pnpm exec vitest run --config research/prototypes/invokee-command-recovery/vitest.config.ts --reporter verbose
```

The activation body is a controlled effect. SQLite, journal acceptance,
bootstrap control, owner callbacks, timer lifecycle, and scope ownership use
the existing implementations. The probe makes no production change.
