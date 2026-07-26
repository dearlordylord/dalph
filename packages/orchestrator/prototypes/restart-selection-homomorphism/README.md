# PROTOTYPE — restart selection homomorphism

Question: when uninterrupted coordination and restarted coordination receive
the same durable workflow history and the same fresh external observations, do
they select the same next operation for each responsibility?

Run:

```sh
pnpm prototype:restart-homomorphism
```

The prototype deliberately shows two restart paths:

- `#144 only` reconstructs durable state but stops before operation selection.
- `required complete path` reconstructs state and invokes the same pure
  selector used by uninterrupted coordination.

Toggle the tracker and capacity facts. The complete paths should always match,
whether the answer is to start task A, wait, reconcile, isolate, or settle.

This is throwaway code. It must not be merged into `master`.
