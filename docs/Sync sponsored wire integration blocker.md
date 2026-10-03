# Reviewed sponsored wire integration and intrinsic-sponsor read blocker

## Update: the read contract landed

Core/protocol are now pinned to exact reviewed archive
`3b82b27ef378b33a7edf1bced02332612960c4b2`. `SponsoredAssetsHttpPort.sponsorProof()` uses
`GET /v1/vaults/:v/grants/:g/assets/sponsors/:f/proof` for the personal owner and
`GET /v1/scoped/vaults/:v/grants/:g/assets/sponsors/:f/proof` for the scoped editor. Strict
response identity, current version, intrinsic membership and admission generation are used by
the owner-add/native-create paths, without SQL, a generation-one guess, or credential fallback.
The stock activation fence is unchanged. See [the native owner integration](Sync%20native%20owner%20publication%20integration.md).

The text below records the **historical c3 blocker**, not the current contract.

## Historical archive and evidence

Plugin core/protocol at that checkpoint used exact reviewed archive
`c3cec3ff2d0831d10fa13fc76338c4c78ed40be3`. The archived server provides the actual sponsored
add/mutate/read, scoped upload-proof and native-sponsored-create routes. `SponsoredAssetsHttpPort`
implements those strict DTOs with separate bound personal-device and scoped credentials;
settings 42 use the bound personal context behind the unchanged activation fence. No account
credential substitutes for an owner device, and no personal credential substitutes for native
creation. Native proof maps only the fields admitted by the strict create DTO.

Disposable real HTTP integration passes owner add/replay/Unshare without resurrection, scoped
filtered reads, root-path native create/replay with this principal's opaque upload proof, and
generic private occupancy refusal without changing the private identity. Its setup obtains
admission generations from a **test-only read of database ground truth** to isolate wire behavior.
That is not an admissible production or native stand proof source.

## Missing read contract blocks gate 43

Both owner `OwnerAssetAdd.sponsors[]` and native `NativeSponsoredCreate.sponsor` require the
exact current note `admissionGeneration`. `intrinsicSponsor()` compares it with the current
intrinsic interval generation and rejects stale/guessed values.

For the first extra/native publication, the current `AssetView.entries` is empty. It supplies
no note admission data. Scoped state/snapshot/feed/content/history schemas also supply no
intrinsic per-note generation. The owner personal manifest supplies current file/version/SHA,
not grant admission intervals. The only generation exposed by AssetView is inside sponsors of
**already published** entries, too late to authorize the first publication.

An executable real HTTP regression demonstrates this on the reviewed archive: empty owner
AssetView plus scoped state/snapshot have no generation; move the note out/re-enter, and its
actual interval generation increases above one while reads still do not return it. An otherwise
exact owner add with hardcoded one is rejected as `conflict`. A path/prefix, grant revision,
current note version or new local image handle cannot replace that proof. Guessing one in a
fresh happy-path fixture or reading SQL inside gate 43 would falsify client acceptance.

Required server contract: an authorized owner-personal and scoped read returning an exact
intrinsic sponsor proof for grant/note/current version, including intrinsic status and current
admission generation (or an issuer-sealed sponsor proof accepted by both add/native-create).
It must retain the ordinary fresh authority, no-store, preparing/departure/revoke and hidden
identity protections. It may be a small batch/preview surface or an additive snapshot field,
but the owner path must not need an agent credential just to authorize owner publication.

The reviewed personal owner hooks/novel-creation outcomes are pinned and usable. An owner
adapter draft was not landed because it would have had to fabricate that missing generation.
Gate 43's two image assertions remain pending/red; automatic owner paste and native agent-root
creation cannot be credited until this read/proof surface lands. No production activation or
fake native cache/lineage evidence was enabled.
