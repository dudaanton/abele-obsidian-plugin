# Git providers

The Git repository integration opens GitHub, Forgejo and Gitea repositories in Obsidian tabs.
Codeberg is a Forgejo preset. Existing GitHub commands and `github_*` tools keep their names;
the eight `forge_*` tools offer the same provider-aware reads with independent permissions.
GitLab is not available yet.

## Connect a server

In the integration settings, add a connection and choose the provider explicitly. For a
self-hosted service enter its complete web base, for example
`https://git.example.test:8443/team`. Scheme, port and deployment path distinguish servers.
Do not enter an API endpoint, a repository URL, credentials, query or fragment. The Codeberg
preset supplies its web address while retaining Forgejo as the provider.

Give each account its own connection. Check access uses the draft token without saving it;
Save retains the checked binding and Cancel discards the draft. Changing provider or server
requires a credential for the new binding. A connection with no token can browse public
repositories. A saved token reference whose key is missing reports an unavailable token;
it never borrows another account's credential.

Paste a configured server's repository, issue, pull request, commit or file URL into the
existing open picker. Forgejo/Gitea file URLs use `src/branch`, `src/tag` or `src/commit`, and
pull requests use `pulls`. Unknown hosts stay browser links until configured. When a short
repository name could mean several connections, choose the account explicitly. An explicit
account mismatch or permission failure does not silently switch accounts.

## Supported workflows and limits

Repository home, README, branches/tags, tree, files, issue/PR lists and conversations, review
comments, changed files, commits, comparisons, code search, sharing and retained snippets use
the selected connection. Search and heuristic definitions use an exact-revision archive
within the configured size limit. They do not start a language server. Oversized native
archives report the limit rather than pretending to have searched the entire repository.

| API gap in the inspected Forgejo/Gitea versions | Behavior |
| --- | --- |
| Repository Discussions and blame | Explicit unavailable state; no fabricated empty result. |
| Global server code search | Search a named repository at a fixed revision instead. |
| Separate notification Done state | Mark read is supported; it is never presented as Done or pinned. |
| Draft PR creation and threaded review replies | Unavailable; requesting a draft never silently publishes a normal PR. |
| Complete compare patches and verified merge-base | Pin an endpoint base for tree/blob comparisons; native metadata retains its limitations. |
| Precise native diff selection anchors | Links disclose the limitation and retain an immutable file/side destination where possible. |

The inbox displays one selected connection. Switching accounts clears the old rows and rejects
old pending responses. Notification mutations do not change an issue or PR's state. Explicit
comment, merge and node PR actions are writes, separate from the read-only agent tools. After
an uncertain write, inspect the service before submitting another operation; Abele does not
blindly repeat a potentially successful request.

## Migration, transfer and access

Existing GitHub connection IDs, tokens, optional inbox token, tabs and snippets remain valid.
Missing provider fields mean GitHub. An explicitly empty connection list stays empty; a new
Forgejo/Gitea default never becomes the old single GitHub credential. Pinned repositories
travel with settings; recent repositories and comparison bases remain local to the device.

Transfer includes each connection's provider and complete deployment binding. Keys are
optional: after importing without them or reinstalling, add or unlock each missing credential
on that device. Transfer refuses to retarget an existing key reference to another provider or
deployment. Removing a connection or rotating a token invalidates its old reads and caches;
it does not revoke the remote token, delete repositories or modify node workspace files.

New connections start Off for agents. Ask authorizes one interactive operation; unattended
runs cannot ask. Auto still obeys the invoked tool's own mode and delegated access ceiling.
Enabling a `github_*` alias does not enable its `forge_*` counterpart. Unsupported future
provider settings survive transfer but remain unavailable.

The exact inspected versions and schema evidence are in [Git provider contracts](Git%20provider%20contracts.md).
