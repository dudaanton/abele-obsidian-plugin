# Desktop sync credential transport

The desktop adapter uses **Electron `session.fetch`**, from the vault window's actual
Chromium session, with `redirect: 'manual'` set **before starting the request**. This is the
session-aware equivalent of Electron `net.request` manual mode: Electron owns the entire
main-process native request lifecycle, proxy/PAC resolution and TLS verification. The
adapter does not use Node HTTP/HTTPS, browser-window fetch, or Obsidian's auto-following API.

This corrects the earlier Node adapter's system-proxy regression. A raw remote `net.request`
stream was also tried, but stalled the native gate: renderer callbacks cannot safely own
main-process response-event subscription timing. The supported session fetch lifecycle
avoids that cross-process event gap. No timeout was increased to accommodate it.

## Credential boundary

- Manual redirect mode is applied at the native session API, not inferred from a final
  followed response. No code calls `followRedirect`.
- On the tested Electron version the native API rejects redirects with **Redirect was
  cancelled**. This is normalized to the sync refusal error. Redirect responses/opaque
  redirects are also refused if another supported version exposes them.
- Caller `redirect: 'follow'` is deliberately overridden for sync, including same-origin
  redirects. Neither authorization headers nor sign-in bodies are sent to a second listener.
- `credentials: 'omit'` prevents ambient session-cookie/auth reuse. The explicitly supplied
  device authorization header remains part of the intended original request.
- `cache: 'no-store'` plus request `Cache-Control: no-store, no-cache` and `Pragma: no-cache`
  isolate permission-scoped GET/HEAD responses across credential switches.
- Credentials in URLs and non-HTTP schemes are refused. TLS verification is not disabled.
- Main-process abort signals and the supported Buffer bridge preserve cancellation and
  exact binary windows. Headers are collected synchronously through the bridge.

The shared response translator's status rejection is defence in depth only, not the
pre-follow guarantee.

## Native verification

`desktopTransport.e2e.test.ts` drives a leased vault's installed development bundle:

1. All **15** combinations of 301/302/303/307/308 and same-origin/cross-origin/HTTPS-downgrade
   locations are refused. Each original request contains synthetic credentials/password;
   **zero redirect destinations receive a request**. Default production selection is used
   for ordinary HTTP cases; only the synthetic TLS fixture uses an isolated test session.
2. An untrusted TLS certificate is refused. A successful HTTPS control and downgrade cases
   trust only the exact generated certificate in that isolated session. The verifier and
   session data/connections are cleaned up; the app's shared verifier is never changed.
3. Both an explicit session proxy and a PAC script route requests for a synthetic `.invalid`
   host through the capture proxy. Its exact POST evidence proves routing and synthetic
   credential/body delivery. The earlier Node adapter was observed red (`ENOTFOUND`) because
   it tried direct resolution instead. Only fresh nonpersistent test sessions are configured;
   no system/global app proxy setting is modified.
4. Cached-looking permission responses remain 200/first then 403/second and 403/HEAD.
5. A sliced binary PUT round-trips only its own bytes and response header; an interrupted
   native response is aborted through the main-process signal bridge.

The socket-level integration tests assert the native request policy using a manual Node
fetch **test port**, not a production fallback. The native gate proves actual Electron
behavior. Evidence was collected on Obsidian 1.13.7, Electron 43.3.0, Darwin 27.0.0.

## Limits

- Authenticated proxy challenges, integrated authentication and client-certificate deployment
  were not exercised. Proxy/PAC routing and ordinary Chromium TLS checks were exercised.
- Native mobile remains task 06: its Obsidian API path has no proven pre-follow control.
  Scoped mobile activation remains blocked. No physical iOS device was used here.
- WebSocket policy is unchanged. General buffered-download memory bounds are separate work.
- The production bundle excludes the development test API. No deployment/release is implied.
