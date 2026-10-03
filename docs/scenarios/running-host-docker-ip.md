# Alice attaches to a Dalph host on its Docker IPv4 address

Accepted requirement: the Bendvy beta operator explicitly requests native attachment using the Docker IP and authorizes fixing Dalph. This extends [running host clients](running-host-clients.md) from loopback-only addresses to explicit IPv4 addresses. It preserves the same host ownership, selected Run, passive reads, command admission, and Exit boundaries; no workflow or journal protocol changes.

## Chronology and boundaries

Alice already has a configured repository and selected Run. GitHub dependencies, claims, Git lineage, and executor sessions are unchanged by address selection. Her container owns a concrete IPv4 address. She starts `dalph host --production --config CONFIG --listen http://192.168.215.3:43127 TARGET`.

Before acquiring the host, Dalph validates a canonical literal IPv4 HTTP origin with an explicit nonzero port. It accepts loopback and the explicit Docker address, rejects DNS names, wildcard/broadcast addresses, invalid octets, URL credentials, paths, queries, fragments, and out-of-range ports. Dalph binds the listener to the requested address and port; it must not silently bind loopback or every interface. The standard descriptor is advertised only after successful bind. An unavailable address or occupied port produces the existing typed bind failure.

Alice uses `dalph attach descriptor` and `dalph attach snapshot` with that exact origin. The existing clients obtain the selected-Run descriptor and snapshot. Reads do not activate work, change control, call providers, or append journal facts. The HTTP boundary still rejects a mismatched Host authority or any browser Origin header before dispatch; non-loopback binding grants no additional command rights. This is an explicit trusted-network endpoint, not remote authentication or a browser dashboard.

A crash before bind leaves no listener. A crash after bind closes the process-owned listener; restarting uses normal same-Run recovery and reacquires the requested interface. Address selection introduces no new durable effect or retry rule. Lost-read responses are handled by the existing passive client protocol; command retries and Exit retain their existing ownership rules. Scope closure releases the listener and its connections.

## Acceptance mapping

- `accepts explicit IPv4 origins without normalization or discovery`: loopback and Docker literals; forbidden address forms rejected.
- `HTTP binds the configured interface and serves passive attachment reads`: bind to a real assigned non-loopback IPv4 address, independently inspect listener address/port, read descriptor and snapshot, verify no control reads were invoked, reject foreign Host and browser Origin, and verify listener closure.
- Existing `HTTP reads remain passive, reject wrong identities and malformed bytes, and respect Exit admission`: unchanged identity, malformed-request and closing behavior.

The non-loopback network test explicitly skips only on machines without an assigned non-loopback IPv4 interface. Docker verification requires that test to run, not skip. These tests exercise the production HTTP adapter with a controlled already-acquired host; they do not claim fresh GitHub/Codex delivery qualification. The shared [running-host scenario](running-host-clients.md) owns the retained identity, command and Exit obligations.
