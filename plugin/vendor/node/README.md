# Node browser packages

These four exact `0.0.0` npm tarballs contain the built browser packages from
the released AbeleNode tag `v0.4.1` (revision `d21c7a4`), including paired WSS,
foreground pairing, node-path resources and execution targets, pi sessions, durable
delegation mailboxes, versioned repository reads and the gated `debugger.v1` human-channel
client. Capability checks still determine adapter availability. They are kept in the
repository so `npm ci` and the plugin build work in a clean clone without a sibling
checkout, workspace link, daemon or private registry. `integrity.json` records npm's
SHA-512 integrity and the packaged file list. The channel client carries the small,
reviewable `channel-client-background.patch`: an opt-in host liveness policy, a ping
probe before background heartbeat settlement, delayed-deadline receive grace, and
reason-coded transport logs. Other packages are unmodified. The channel client's
obsolete upstream source map is omitted rather than publishing inaccurate mappings.
Their transitive Zod 3 dependency remains separate from the plugin's Zod 4.

The unpatched payloads were built from a clean archive of the release tag, with `npm ci --ignore-scripts`
and `tsc -b packages/channel-protocol packages/node-protocol packages/channel-client packages/node-client`.
No unreleased source overlay or package export changes were applied outside the documented
channel-client patch.

To refresh, build the desired released AbeleNode tag, then run from this plugin directory
(replace `/path/to/node` with that checkout):

```sh
npm pack --ignore-scripts --json --pack-destination vendor/node \
  /path/to/node/packages/channel-protocol /path/to/node/packages/node-protocol \
  /path/to/node/packages/channel-client /path/to/node/packages/node-client \
  > vendor/node/integrity.json
npm install --save-exact ./vendor/node/abele-channel-protocol-0.0.0.tgz \
  ./vendor/node/abele-node-protocol-0.0.0.tgz \
  ./vendor/node/abele-channel-client-0.0.0.tgz ./vendor/node/abele-node-client-0.0.0.tgz
```

Before packing the channel client, apply `channel-client-background.patch` to its
built package root with `patch -p1`, and remove `dist/index.js.map`. Pack that patched
package instead of the upstream channel client. The equivalent change is maintained
in the node repository's channel-client source package. Keep this plugin patch until
the next node release carrying that change is re-vendored here; remove it only in
that re-vendor update. `RequestChannel.backgroundActive` defaults to
false; the plugin binds it to admitted, still-playing background audio. Diagnostics
are host-injected through `RequestChannel.debug` (silent by default); the plugin
binds that sink to `console.debug`, leaving command-line JSON output untouched. Request
timeouts remain `outcome_unknown` and never replay a mutation: a received pong keeps
only the transport alive, not the timed-out request.

Update this revision note and verify the lockfile integrity against the manifest.
The TypeScript declaration paths in `tsconfig.json` support the plugin's existing
legacy module resolution without changing any upstream package exports.

Real daemon integration is explicit and uses a temporary state directory and a
random loopback listener, never the installed service:

```sh
ABELE_NODE_CLI=/path/to/node/packages/node-daemon/dist/cli.js npm run test:node
```
