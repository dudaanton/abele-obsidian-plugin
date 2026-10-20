# Node browser packages

**Temporary, unreleased vendor.** These four exact `0.0.0` npm tarballs contain the built browser
packages of AbeleNode revision `2da32f0` (after `v0.4.18`, not a release): the shared session
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
SHA-512 integrity and the packaged file list. The node client includes the bounded
post-authentication welcome fix in `patches/paired-welcome.patch`; its JavaScript and
source map were regenerated with TypeScript 5.9.3, ES2022 and ES modules. Apply that
patch to the source revision before rebuilding to reproduce this payload. The node protocol additionally carries the folder-owner contracts from upstream
revision `324c1ea` (`patches/folder-owner.patch`): optional conversation owners,
folder execution targets and nullable conversation IDs in snapshots. Only
`debugger.ts` and `debugger-control.ts` were regenerated with TypeScript 5.9.3,
ES2022, NodeNext modules and source maps; all other payload files are unchanged.
The plugin negotiates this extension with a read-only folder session listing,
since this node revision does not advertise the protocol minor in its description.
The protocol also carries the optional breakpoint `hit_condition` and `enabled`
fields from upstream `eb1a38a`, via `patches/breakpoint-options.patch` against the
packaged `dist/` files. This adds the runtime schema fields and their generated
declaration shapes without changing other contracts. The debugger JavaScript source
map retains the original mappings with two unmapped lines inserted immediately
before `log_message`. Apply this payload patch after the source patches and build
above when reproducing these tarballs. The plugin sends these fields only when the
node advertises their capability; hit counts also require adapter support.
Other packages are unmodified. The released channel client now includes the opt-in host
liveness policy, background ping probes, delayed-deadline receive grace and
host-injected transport diagnostics previously carried by the local patch.
Their transitive Zod 3 dependency remains separate from the plugin's Zod 4.

The payloads were built from a clean archive of that revision, with `npm ci --ignore-scripts`
and `tsc -b packages/channel-protocol packages/node-protocol packages/channel-client packages/node-client`.
Apply the folder-owner patch with `git apply --unidiff-zero` and the welcome patch normally when reproducing the payloads; the folder-owner patch changes only the two debugger protocol modules. Package exports are unchanged.

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
