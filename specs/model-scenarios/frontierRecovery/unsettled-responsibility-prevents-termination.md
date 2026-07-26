# Unsettled responsibility prevents termination

The tracker exposes no fresh task to start, but Dalph still owns an exact task A
responsibility. Depending on fresh boundary facts, A is paused, waiting for a
dependency or reread, or isolated behind a repair boundary.

The runnable transition list may be empty, but the coordinator keeps the run
active and exposes the exact operation-scoped explanation and wake condition.
It does not report successful run completion or discard A's obligation.

Common-sense question: can an empty runnable list end the run while Dalph still
owes a paused, waiting, or isolated action?
