# Node browser packages

These four exact `0.0.0` npm tarballs contain the built browser packages from
the released AbeleNode tag `v0.4.14` (revision `a328362`), including the owner git writes
(`repository_git_write_v1`: stage, unstage, discard, commit, update from base, push with an
optional lease, fetch, create branch, remote info), the repository and plain
folder change streams (`repository_changes_v1`, `workspace_changes_v1`), the recorded-run
`trace.v1` methods, paired WSS,
foreground pairing, node-path resources and execution targets, pi sessions, durable
delegation mailboxes, versioned repository reads and the gated `debugger.v1` human-channel
client. Capability checks still determine adapter availability. They are kept in the
repository so `npm ci` and the plugin build work in a clean clone without a sibling
checkout, workspace link, daemon or private registry. `integrity.json` records npm's
SHA-512 integrity and the packaged file list. All packages are unmodified, including
upstream source maps. The released channel client now includes the opt-in host
liveness policy, background ping probes, delayed-deadline receive grace and
host-injected transport diagnostics previously carried by the local patch.
Their transitive Zod 3 dependency remains separate from the plugin's Zod 4.

The payloads were built from a clean archive of the release tag, with `npm ci --ignore-scripts`
and `tsc -b packages/channel-protocol packages/node-protocol packages/channel-client packages/node-client`.
No unreleased source overlay, local patch or package export changes were applied.

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

`RequestChannel.backgroundActive` defaults to false; the plugin binds it to
admitted, still-playing background audio. Diagnostics
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
