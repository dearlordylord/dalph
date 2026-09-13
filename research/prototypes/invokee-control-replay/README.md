# Invokee Unpause replay probe

This disposable probe executes the existing built
`ControlDirectionApplication` against Dalph's in-memory journal. It models:

1. client A applies Run Unpause and loses the response;
2. client B applies Run Pause; and
3. client A repeats the exact Unpause request.

Run it from the repository root:

```sh
node research/prototypes/invokee-control-replay/run.mjs
```

The command prints each returned control record as harness evidence, all durable
control records, the effective state after client B's Pause, and the state after
client A's replay. It exits unsuccessfully unless the three records have
ordinals 1, 2, and 3, B's direction changes the Run to paused, and A's replay
changes it back to unpaused. The harness retains A's first returned record only
to expose evidence; the simulated client does not receive it.

The probe uses built workspace package exports. It does not model HTTP,
response transport, caller cancellation during append, concurrent processes,
or the production reactivation owner's accepted-control callback. Discarding
client A's first returned value models response loss only after the underlying
command has completed.
