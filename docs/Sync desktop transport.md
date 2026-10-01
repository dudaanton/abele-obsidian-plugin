# Desktop sync credential transport

Task 05 replaces the desktop sync adapter's auto-following native request with Node's
non-following HTTP/HTTPS client, loaded only behind `Platform.isDesktop`. This is a concept
branch change, not a release or native-iOS transport certification.

## Why a different desktop adapter

Obsidian's `RequestUrlParam` has no supported option to prevent following a redirect.
Checking the final response, or passing `redirect: 'error'` only to the engine's fetch
wrapper, cannot protect credentials already sent by the underlying native API.

The production desktop selection now goes through `desktopTransport()`:

- one HTTP/HTTPS request per call; no redirect helper, browser CORS or cookie jar;
- 3xx other than 304 is rejected **at receipt of response headers**, before reading the
  body; the request/response are destroyed and no destination request is constructed;
- no response cache and `Cache-Control: no-store` on outgoing requests;
- credentials in URLs and non-HTTP schemes refused;
- HTTPS certificate/hostname checks remain enabled;
- exact text/binary body windows and response status/header/body semantics retained;
- already-aborted and in-flight cancellation signals honoured.

The shared response translator also rejects redirect statuses as defence in depth. That
check is **not** the pre-follow guarantee; the desktop native client's behavior is.

## Verification

`tests/unit/transport.test.ts` first failed on redirect responses. The real-listener
`tests/integration/desktopTransport.test.ts` first failed because the production selector
still invoked Obsidian's native request function. After the cause was fixed, those suites
passed, including aborts, exact binary windows, 304, cached-looking GET/HEAD responses and
principal switching.

`tests/e2e/desktopTransport.e2e.test.ts` drives a leased pool vault's actual desktop window
and the **production selector from the installed development bundle**. Separate-process
HTTP and HTTPS listeners record only synthetic credential/password presence, never secrets.
It checks 301/302/303/307/308 against same-origin, cross-origin and HTTPS-to-HTTP downgrade
locations: **15 redirect requests reach the origin with the synthetic credentials and
password; zero requests reach a redirect destination**. The caller asks for `redirect:
'follow'` deliberately: sync refuses anyway. HTTPS first refuses the untrusted certificate;
the successful control/downgrade tests trust only the generated local certificate using a
temporary test-only agent, restored/destroyed in `finally`. TLS validation is never disabled.
The native principal-switch test receives 200/first, then 403/second and 403/HEAD despite
cacheable-looking server headers.

Native evidence was collected on Obsidian 1.13.7, Electron 43.3.0, Darwin 27.0.0. The fixture
process and its generated certificate/key directory are removed after the file. The
production bundle drops the development test API.

## Limits and review considerations

- Node uses its own TLS trust/client behavior, rather than Chromium's session/proxy/cookie
  behavior. System-proxy routing and client-certificate deployments are **not verified**.
  Do not claim equivalent networking configuration support without separate coverage.
- The native-mobile path still uses Obsidian's API. Its final-status rejection cannot prove
  pre-follow safety; task 06 must establish or replace its native adapter. **Scoped mobile
  activation remains blocked.** No physical iOS device was used for this change.
- WebSocket transport is unchanged; this task certifies desktop HTTP credential/password
  requests, not a general WebSocket endpoint-switch policy.
- This adapter, like the old one, buffers response bytes. General download memory limits
  are outside this credential-forwarding task.
