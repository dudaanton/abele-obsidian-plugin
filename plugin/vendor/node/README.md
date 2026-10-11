# Node browser packages

These four exact `0.0.0` npm tarballs contain the built browser packages from
the released AbeleNode tag `v0.4.1` (revision `d21c7a4`), including paired WSS,
foreground pairing, node-path resources and execution targets, pi sessions, durable
delegation mailboxes, versioned repository reads and the gated `debugger.v1` human-channel
client. Capability checks still determine adapter availability. They are kept in the
repository so `npm ci` and the plugin build work in a clean clone without a sibling
checkout, workspace link, daemon or private registry. `integrity.json` records npm's
SHA-512 integrity and the packaged file list. Runtime source has not been modified.
Their transitive Zod 3 dependency remains separate from the plugin's Zod 4.

These payloads were built from a clean archive of the release tag, with `npm ci --ignore-scripts`
and `tsc -b packages/channel-protocol packages/node-protocol packages/channel-client packages/node-client`.
No unreleased source overlay or package export changes were applied.

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

Update this revision note and verify the lockfile integrity against the manifest.
The TypeScript declaration paths in `tsconfig.json` support the plugin's existing
legacy module resolution without changing any upstream package exports.

Real daemon integration is explicit and uses a temporary state directory and a
random loopback listener, never the installed service:

```sh
ABELE_NODE_CLI=/path/to/node/packages/node-daemon/dist/cli.js npm run test:node
```
