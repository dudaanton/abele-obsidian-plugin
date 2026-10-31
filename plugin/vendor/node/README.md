## Delegation reason compatibility

The node protocol accepts any non-empty delegation reason (up to 1024 characters) upstream
since v0.4.47, so the earlier local delegation-reasons patch is no longer applied.

## Current browser payloads

All four packages are built from AbeleNode security branch commit
`449e1c5e44186b5596c29adceef6979283ce8c3d` (based on v0.4.74),
using the six source patches below, Zod 4.6.6 and TypeScript 5.9.3.
The lockfile and `integrity.json` record the exact rebuilt bytes.

Local connections use `local-proof-v1`: the client verifies the server proof before
sending the saved token. This requires a coordinated daemon/plugin upgrade; there
is no auth-first fallback. Existing `local-token-v1` targets, tokens, node IDs,
installation IDs and durable stores are preserved. The saved token hash grants
server-proof authority; this does not provide encryption, defeat a live relay or
protect against another process running as the same OS user. Paired connections
retain their existing authentication path.

Apply these source patches in order, from the release archive's root, before building:

1. `paired-welcome.patch`: use the normal record limit for the authenticated welcome;
   pre-authentication records retain their smaller bound.
2. `lsp-install-deadline.patch`: give explicit LSP installation ten minutes, retaining
   HTTP long-poll deadlines and ordinary request deadlines.
3. `execution-policy-admission.patch`: run the optional admission callback before saved
   subscriptions/outbox replay, disconnecting if it fails.
4. `repository-deadline.patch`: give `repository.*` requests thirty seconds. Expiration
   keeps the channel open, reports `outcome_unknown` and never replays mutations.
5. `command-context-errors.patch`: preserve resource-specific command/integration context
   refusal messages in durable receipts.
6. `response-compatibility.patch`: export `responseSchema` from channel-protocol and use
   it at SDK receiving boundaries, including event validation and transcript replay.
   It clones and caches Zod schemas, recursively ignores additional object fields, and
   retains known-field checks, refinements and collection limits. Shared schemas and
   outgoing requests remain strict. Cloning preserves lazy default factories and replaces
   getter-backed catchalls on merged schemas without mutating their originals.
   Normal incoming response/event/welcome envelopes
   use this compatibility view; authentication requests and outgoing encoding stay strict.
   It also describes the optional `context.run_id` emitted by the live session runtime.

Build only the browser packages, with the release dependencies already installed:

```sh
tsc -b packages/channel-protocol packages/node-protocol packages/channel-client packages/node-client
```

Then pack and install all four payloads using the commands below. The plugin's own
receiving parsers use the same compatibility view; local state and outgoing intent
validators stay strict. Responses from 0.4.72 retain the known `truncated` observation
flag and accept the live context's run identity. Further optional fields do not reject
the entire response, even inside arrays, unions, records and recursive trace shapes.

The existing `repository_watch_renewal_v1`, `command_context_v1` and
`integration_context_v1` contracts remain included. The plugin sends a repository
subscription ID only when explicit renewal is advertised. It explicitly negotiates
`execution.policy.v1` on every transport admission and separately opts into command
and integration contexts before replay. Discovery is refreshed after admission;
older nodes retain unknown policy snapshots.

## Earlier payload history

# Node browser packages

The node-protocol and node-client payloads are refreshed from released AbeleNode
`v0.4.40` (`0c43339ff4cf01f6f0cedf4ac1e75c4c44fc347b`) for `obsidian.tools.v1`,
including atomic delegation snapshots, durable questionnaires and the local delegate host.
The existing `patches/paired-welcome.patch` is applied before packaging: the authenticated
welcome uses the normal record limit while pre-authentication records retain their smaller
bound. Only paired.js and its map are regenerated with TypeScript 5.9.3, ES2022 and ES modules.
Channel payloads and their local patches below are preserved. The extension uses the public generic
request API and questionnaire helpers; atomic snapshots and structured answers pass through
ordinary SDK validation and durable retry storage. The node packages follow the released tag.

**Vendored browser packages.** Apart from the two refreshed payloads above, these exact `0.0.0` npm tarballs contain the built browser
packages of AbeleNode revision `bed6ddf19935b8527e1fa339c63ad2e556687869` (v0.4.38): delegation through installation authority (delegation_without_grant), debugger frame source paths, exception text, stop on entry, exit codes and attach breakpoint restoration, device disconnect and node.disconnect, plus durable approved manager command/integration APIs, resumable delegation deadlines, retained reports after extension warnings, and pi chat
checkpoints and online-only preview-bound restores, canonical user messages and turn identities,
model/account catalogs, and the shared session
transcript (`session.update`, modelled on ACP, with `sessionUpdatesOf` and the Claude, pi and ACP
mappers), the per-session command list (`session.commands`, `runCommand`) and ACP agents as
sessions (`provider: "acp"` with an `agent`, the agents listed under the `acp` provider in
`node.describe`). They are refreshed from released node tags. Everything listed for `v0.4.18`
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
The channel client also carries `patches/lsp-install-deadline.patch`: only explicit
`lsp.v1.install` requests have a ten-minute deadline so downloads can finish; ordinary
request deadlines are unchanged. Regenerate only `index.js` and its source map with
TypeScript 5.9.3, ES2022 and ES modules. Declarations are unchanged.
Grant-free delegation is included upstream; the local delegation compatibility patch is no longer applied. Other packages are unmodified. The released channel client now includes the opt-in host
liveness policy, background ping probes, delayed-deadline receive grace and
host-injected transport diagnostics previously carried by the local patch.
The current protocol packages share the plugin's Zod 4.6.6; only the sync SDK retains
a nested Zod 3 dependency.

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
