# External file implementation inputs

## Selected revisions

The plugin base before the state work is `f2a39653` (filesystem probe documentation).
Its working tree was clean. Core and protocol remain packaged from the same committed
source, `80bc7c666ac54cc186696ebdaaccd2d9e7a735ba`:

- Core source tree: `d115692ae637461eed9c5936a209a11ca8766dc8`.
- Protocol source tree: `67d3dbbfe47516428f7856593a9ddee66ad2a499`.
- Source lockfile SHA-256: `63dda462a22f354606984d224262a1f1bae21bd820856955b5da5ca91c782773`.

`plugin/vendor/sync/provenance.json` inventories both archives and every installed payload
file. `package.json` and `package-lock.json` resolve those archives, not a sibling checkout.
The verifier also checks that archive names, installed versions and core's protocol dependency
agree with the provenance revision.

The independently pinned server test input is
`f927e62bb41817cd3cf0180e80f989e8c166ff1d`, as declared in
`plugin/scripts/server-test-fixtures.mjs`. The server external-files branch was clean at that
revision when inspected. The main server checkout was clean at
`6d0cf6e895c9072db5f696f6daa98761fa96aed0`; it is **not** an implementation input. These
historical observations do not authorize substituting its packages or another branch's build.

The different core and server commits are intentional independent pins, not a requirement
that their HEADs match. No dependency archives or lock entries were replaced for this work.
An external-files server extension can be pinned separately when its contract is integrated.

## Verification

From `plugin/`:

```sh
node scripts/verify-sync-inputs.mjs
npx vitest run tests/unit/syncBuildInputs.test.ts
node scripts/vendor-sync.mjs /path/to/sync-repository f927e62bb41817cd3cf0180e80f989e8c166ff1d fixture
```

The last command exports only committed source into disposable local scratch storage and
builds there. Its resulting real server/CLI fixture was checked with `verifySyncFixture`.
The negative tests deliberately change the archive bytes, provenance revision, independent
fixture revision and fixture payload. Each is refused. Building or packing a mutable sibling
distribution is not part of this procedure.
