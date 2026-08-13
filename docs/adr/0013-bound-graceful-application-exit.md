# Bound graceful application Exit outside Run workflow history

Status: accepted

Dalph accepts an Operator command or process-supervisor signal through one
transport-neutral application-lifecycle protocol, atomically closes
forward-progress admission, and spends at most five seconds reaching a durably
recoverable boundary. Exit may call executor `requestSuspension` but never
`startOrContinue`; how the executor implementation handles that request remains
opaque. The drain also performs the suspension intent and report writes
required by that exact protocol, acknowledges already-produced journal writes,
and releases process-local resources; it neither finishes work nor starts
reconciliation or durable cleanup. A successful result is outside
every Run journal and may coexist with an ambiguous tracker, Git, evidence, or
cleanup effect only when the exact workflow intent is already acknowledged and
no local owner remains. A conclusive failure force-terminates after useful
quick drain work settles, and the fifth monotonic tick force-terminates a timed-
out drain; neither outcome manufactures workflow facts or safe suspension.

This keeps workflow authority in the existing Run journals and owning outside
systems, avoids a durable Exit marker that could cause restart/exit loops, and
keeps application shutdown short. The cost is that a later startup cannot use a
graceful-versus-crash mode: it always reconstructs ordinary workflow history
and reconciles unresolved intents through their owning protocols.
