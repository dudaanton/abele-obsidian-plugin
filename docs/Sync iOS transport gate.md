# Native iOS transport gate

Task 06 remains **BLOCKED**, not passed. The native production selector was confirmed to use
Obsidian `requestUrl` on iOS. A two-listener synthetic LAN fixture could not establish native
reachability: the initial credential-free request and subsequent redirect/cache/binary cases
all returned the same native offline error, with no HTTP status. An iOS local-network
permission prompt appeared and was left unanswered rather than changing permission state.

## Attempted matrix

- GET, HEAD, POST, PATCH and DELETE; 301/307/308; same-origin and cross-origin redirects.
- Dummy authorization only; dummy password bytes in POST/PATCH bodies.
- GET/HEAD at one cache URL with first, second, then first principal; expected 200/403/200.
- Binary POST and exact response bytes.
- Credential-free listener-evidence retrieval.

No case received a native HTTP response, so no redirect-policy refusal, secret non-delivery,
cache isolation or binary round-trip pass is inferred. Host-side fixture evidence was empty;
this is reachability/permission evidence, not a safe transport result.

The inspected mobile bridge forwards URL, method, content type, headers, body and binary
options. No pre-follow redirect control was exposed in that inspected production interface.
The existing final-3xx rejection occurs after `requestUrl` completes and cannot by itself
prove that a native implementation did not follow a redirect. The opaque native HTTP wrapper
was not independently attested.

Valid-HTTPS-source downgrade and cross-origin TLS checks require a reachable trusted fixture;
plain HTTP does not replace that proof. Native transport activation remains gated until the
actual pre-follow behavior and credential-switch caching have been verified. Desktop evidence
is separate and does not satisfy this gate.

No enrollment, credentials, network switch, connection edit or persistent fixture state was
created. Temporary host listeners were stopped. Private endpoints and raw device evidence
remain in the untracked report.
