# Repository sources

The repository view reads through `plugin/src/repository/source.ts`. A source is bound to one
repository and one authority generation. Its identity is separate from its revision: GitHub
identities carry a connection, server and repository; node identities carry installation, node,
project and workspace IDs. Revisions discriminate immutable commits from retained working-tree
observations. Display paths and labels are not identities or cache keys.

The contract covers metadata, homes, workspaces, refs, ref resolution, trees, folders, blobs,
status, comparisons, commits/history, blame, search, definitions and invalidations. Explicit
locations keep refs and paths separate, including branches containing slashes. Navigation is
provided by the source. `repository/model.ts` owns the shared view data; existing GitHub modules
re-export the same types so agent tools and other callers keep their imports.

`githubRepositorySource` wraps the exact `GithubClient` supplied by the tab, including its chat
capability wrapper. It does not unwrap guards, select another connection, or add another content
cache. Existing GitHub readers retain their request ordering, REST/GraphQL fallback, pagination,
limits, errors, and caches. The adapter exposes GitHub hosting features as an optional capability:
legacy URL resolution/promotions, issues, pull requests, releases and languages. A source without
that capability does not show invented issue/PR sections.

`REPOSITORY_SOURCE` supplies the current source to the shared components. Standalone GitHub
previews still accept their existing client props and build an adapter when there is no injected
source. Tree/README/blame/comparison reads and repository navigation use the source. Ref and base
pickers resolve through it; source search preserves the current GitHub search and definition
fallback. Layout, tree rows, code/diff rendering and find operate on shared view data or local DOM
and do not need a provider transport.

Saved tab state has an optional discriminated `sourceTarget`. Mounted GitHub tabs save the new
format alongside the legacy URL. Old URL-only callers retain their state shape until mounting;
explicit source targets round-trip immediately. Connection routing and runtime agent grants are
unchanged; grants are never persisted as part of a target. Node targets whitelist opaque IDs,
relative paths and revisions. They are preserved without initiating a GitHub read. The actual
node tab adapter and entry points are a later stage. The shared container also accepts an explicit
source and location without a client, as exercised by full-tab fixture tests.

Comparison bases remain device-local. Existing GitHub bases retain their server/repository keys
and behavior. Local-source bases carry opaque source identity and are keyed by installation,
node, project and workspace, preventing collisions with GitHub or another workspace. Navigation
history remains Obsidian's local tab history with the source target in its saved state.

GitHub does not expose a working tree: `status()` explicitly reports `supported: false`, and
`workspaces()` returns no workspaces. Its subscription reports authority retirement, not live
filesystem changes. Local source markdown is shown as source text in this stage, avoiding GitHub image/link rewriting
and remote image requests. A source-aware safe markdown preview belongs with the node adapter.
The stage-four node adapter must implement bounded node reads, retained
observations, change notifications and source navigation; this stage introduces no node network
requests or changes to agent tools. Shared DTOs retain some legacy GitHub field names for
compatibility, and GitHub conversation rendering stays in the GitHub container.

`tests/helpers/inMemoryRepository.ts` implements the source without a GitHub client or HTTP
fixture. Component coverage exercises tree navigation/filtering, README reads, blame/commit
navigation, endpoint diff rendering, comparison commits, code search, find and local home pages.
The existing GitHub regression tests are retained.
