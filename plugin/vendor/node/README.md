# Node browser packages

**Temporary, unreleased vendor.** These four exact `0.0.0` npm tarballs contain the built browser
packages of AbeleNode revision `19fc651d5f2021cd7610d22c1d781b2938ef072f` (v0.4.37): durable approved manager command/integration APIs, resumable delegation deadlines, retained reports after extension warnings, and pi chat
checkpoints and online-only preview-bound restores, canonical user messages and turn identities,
model/account catalogs, and the shared session
transcript (`session.update`, modelled on ACP, with `sessionUpdatesOf` and the Claude, pi and ACP
mappers), the per-session command list (`session.commands`, `runCommand`) and ACP agents as
sessions (`provider: "acp"` with an `agent`, the agents listed under the `acp` provider in
`node.describe`). They are replaced by the next released node. Everything listed for `v0.4.18`
(`0959374`) below is included: where a stream ends (`stream.head`,
`NodeClient.head`) and ingesting a burst of events in one store write, long-lived sessions (`session.configure`, `session.compact`, `session.stop`, `session.state`, messages between sessions), attaching the debugger to
a running program (`debugger.v1.programs`, `debugger.v1.attachProgram`), the owner git writes
(`repository_git_write_v1`: stage, unstage, discard, commit, update from base, push with an
optional lease, fetch, create branch, remote info), the repository and plain
folder change streams (`repository_changes_v1`, `workspace_changes_v1`), the recorded-run
`trace.v1` methods, paired WSS,
foreground pairing, node-path resources and execution targets, pi sessions, durable
delegation mailboxes, versioned repository reads and the gated `debugger.v1` human-channel
client. Capability checks still determine adapter availability. They are kept in the
repository so `npm ci` and the plugin build work in a clean clone without a sibling
checkout, workspace link, daemon or private registry. `integrity.json` records npm's
SHA-512 integrity and the packaged file list. This revision includes folder-owner
contracts upstream, but still needs `patches/paired-welcome.patch`: authentication
records keep the smaller authentication bound, while the authenticated welcome uses
the normal record bound. Apply that source patch before packaging; regenerate only
`paired.js` and its source map with TypeScript 5.9.3, ES2022 and ES modules. Public
declarations are unchanged. The historical folder-owner patch is no longer applied.
The plugin negotiates this extension with a read-only folder session listing,
since this node revision does not advertise the protocol minor in its description.
The protocol now includes the optional breakpoint `hit_condition` and `enabled`
fields upstream, in both runtime schemas and declarations. The historical
`patches/breakpoint-options.patch` must not be reapplied to this revision.
The plugin sends these fields only when the
node advertises their capability; hit counts also require adapter support.
Other packages are unmodified. The released channel client now includes the opt-in host
liveness policy, background ping probes, delayed-deadline receive grace and
host-injected transport diagnostics previously carried by the local patch.
Their transitive Zod 3 dependency remains separate from the plugin's Zod 4.

The payloads were built from a clean archive of that revision, with `npm ci --ignore-scripts`
and `tsc -b packages/channel-protocol packages/node-protocol packages/channel-client packages/node-client`.
Package exports are unchanged. Chat history actions are shown only when all three
checkpoint methods are advertised; older nodes retain ordinary chat behavior.

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
