# Target-closure read evidence

The task tracker returns a complete target-membership read at a named read
boundary. Dalph records the read intent and its result, then the production
managed-history reducer reconstructs graph knowledge without creating task
responsibility.

This scenario keeps three facts distinct:

1. When the read explicitly covers task B and omits it, B is proven absent.
2. When a replacement read names an earlier operation as a predecessor but the
   two reads remain incomparable, that predecessor does not prove B absent.
3. When the replacement is compatible and returns every task, it supersedes
   the earlier membership observation without inventing missing-task evidence.

The three named Quint actions are each replayed through the same production
journal and reducer by Quint-connect. The adapter compares their normalized
read shape, completeness, consistency, freshness, operation, revision,
returned tasks, and profile-specific coverage or predecessor evidence.

Common-sense question: can Dalph tell the difference between “the tracker
checked B and B was absent” and “a later read happened after an earlier read”
without treating either observation as ownership of B?
