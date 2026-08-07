# Scenarios

Each file here tells one chronology in prose: who acts, what is true before,
what happens outside Dalph, what Dalph does in order, where it can crash, what
a person sees, and what must not happen. `../OPERATIONAL-SCENARIOS.md` defines
the required fields and the delivery gate they satisfy.

These are the readable register. The same behavior is carried executably by
cassettes, and the *What must Dalph not do?* clauses are carried as `D`
invariants in `../DELIVERY-INVARIANTS.md`, because a recording can prove an
occurrence happened and never that one cannot.

A chronology spanning many issues belongs in `../DELIVERY-STORY.md` rather than
here. Files here are scoped to one accepted issue and carry its
acceptance-test mapping.

## Currency

The files here have not been checked against their tracker issues. Treat an
individual file as a claim to verify rather than as settled behavior until it
is marked current. `../DELIVERY-INVARIANTS.md` names the invariants most
exposed to that review.
