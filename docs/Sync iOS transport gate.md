# Native iOS transport gate

Task 06 has **passed the cable HTTP redirect/cache/byte matrix** on native Obsidian 1.13.7
with iOS. A valid-HTTPS-to-HTTP downgrade fixture and hostname-specific cases remain untested;
this is not a full mobile-platform or automatic-publication activation pass.

## Cause and production adapter

The old mobile `requestUrl` path followed 301/307/308 redirects. It stripped the dummy bearer
in the measured sink requests but forwarded POST/PATCH password bytes, including cross-origin
requests. It also reused an authenticated GET 200 for the second principal: the server saw
only the first GET. HEAD's existing no-cache header avoided that cache reuse.

The verified iOS adapter now uses the actual `CapacitorHttp.request` bridge with
`disableRedirects: true`, explicit `Cache-Control: no-cache, no-store` for every request and
exact file-body/base64 response conversion. All bodies, including JSON, are delivered through
that byte path: native dictionary JSON encoding was physically observed to reorder keys,
which can invalidate a receipt's replay request hash. Repeated file-body JSON echo preserved
exact bytes; strict phone commit history replay was then verified.
Redirect responses are refused without a second request. There is no unsafe `requestUrl`
fallback. Unsupported API versions, platforms or missing native bridge fail explicitly before
credentials are sent. Native abort fences the returned result; the bridge cannot guarantee
cancellation of bytes already in flight, so normal durable commit replay still applies.

The legacy requestUrl translator remains for injected tests/hosts, not production iOS selection.

## Physical-device evidence

Two listeners bound to host loopback, forwarded to the phone through the driver's USB reverse
ports, supplied distinct origins by port. Only synthetic bearer/password data was used.

On the fixed production selector:

- GET/HEAD/POST/PATCH/DELETE × 301/307/308 × same/cross-origin: **30/30 refused**, all original
  source requests observed, zero followed credential-bearing sink requests. POST/PATCH body
  delivery to the original source was verified, so this is not a false pass from missing bodies.
- GET and HEAD first/second/first principal at the same cache URL: **200/403/200**, all six
  requests observed. No reused second-principal response.
- Binary POST round trip: exact `[0,255,1,128]` bytes.
- JSON POST: decoded result equals the exact synthetic object.
- Direct native option feasibility had independently returned 307, original URL and no sink
  when `disableRedirects: true` was supplied with a real nonempty text body.

A prior cable fixture crashed when given an invalid redirect route. It was repaired to return
404 and rerun; that crash is not evidence of a phone/network defect.

## Remaining boundaries

The earlier Wi-Fi LAN fixture was unreachable because phone and host were on different
networks; the USB reverse path resolved that prerequisite. Distinct ports are distinct origins.
A truly different hostname and a trusted HTTPS redirect-to-HTTP source need separate fixtures;
plain HTTP or self-signed certificate refusal is not their substitute. Android/Boox and other
native API versions remain unverified. Native cache/version publication gates remain separate.

Temporary listeners and reverse tunnels were stopped by their owners. Private addresses,
ports, native screenshots and raw evidence remain outside tracked documentation.
