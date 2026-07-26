# Responsibility-first resume

The task-work provider reports that independent task B has stopped, releasing
one task admission position. Dalph already owns task A, which was paused after
its prior invocation settled. Fresh pause and provider reads now say A may
continue; tracker facts also say unstarted task D is eligible.

At capacities one and two, the coordinator admits A before D. Reconstructing
the same journal history and supplying the same fresh facts selects the same
task, exact continuation tag, explanations, and controller reservations. Dalph
does not infer that A is still running merely because its worktree and session
remain.

Common-sense question: after capacity becomes available, does Dalph resume the
work it already owns before claiming unrelated new work without duplicating the
stopped invocation?
