# External file implementation inputs

## Selected revisions

The plugin base before the state work is `f2a39653` (filesystem probe documentation).
Its working tree was clean. The original core/protocol pin was
`80bc7c666ac54cc186696ebdaaccd2d9e7a735ba`. Canonical external state is now packaged from
the explicitly selected committed input `19d35b116a4ac6c062b50154b2fd33626e2ef012`, which
includes the shared core facade/schemas/error, CLI connection delegation, and the raw physical
path-length correction. It succeeds the canonical input
`1b28e55b04a1146d20b22175db5648ff9d84d939` without a plugin schema fork:

- Core source tree: `cd861dad286c0c217b36a2f41c756d32fbe2ea2c`.
- Protocol source tree: `60b9ee72eee9455b25c57ae88957faec311e6ff3`.
- Source lockfile SHA-256: `d3e42cb5c3548f605f98450070f98bf2e66488aa54e657b61b44b9824a8c1a2d`.

The reviewed scoped push payload remains byte-identical: SHA-256
`9e9c7888d8da1f7c96d8e9b1401ace2b8829af4899c948fd085364622e651983` for
`dist/scopedPush.js`. The new pin is not a Git descendant of the old one; selected shared
scoped source and this payload were compared explicitly, rather than assuming ancestry
implied compatibility. The input guard and retained scoped tests enforce the new exact pin
and preserve the previous payload guarantee.

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
that their HEADs match. The core/protocol archives, provenance, dependency entries, lockfile
and installed payload were replaced together using the clean-archive vendor procedure for
the exact canonical commit. The independent server fixture was not silently advanced to the
new core pin or to an unrelated server HEAD.

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
