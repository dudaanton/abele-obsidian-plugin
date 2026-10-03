# Shared helper contracts

These contracts are for incremental adoption. Consumers with distinct existing behavior must
keep that policy explicit instead of silently switching it during a deduplication.

## Folders and attachments

- `plugin/src/helpers/folders.ts`: `ensureFolder(host, folder, signal?)` is storage-independent.
  The host's `folderExists` must distinguish a folder from a file. Parents are created in order;
  empty paths mean root. A concurrent creator is tolerated only when a folder now exists.
  Other storage errors propagate unchanged. Cancellation is checked before each new write;
  an already-admitted write is not undone.
- `plugin/src/helpers/vaultFolders.ts`: `ensureVaultFolder(vault, folder, signal?)` is the
  Obsidian adapter. Use it instead of local parent-creation loops.
- `plugin/src/media/attachmentFolder.ts`: `resolveAttachmentFolder(setting, notePath?)` and
  `attachmentPath(setting, filename, notePath?)` are pure. Root settings remain root; `./` and
  `./sub` resolve beside the source note, or from root without one. Absolute vault-relative
  folders do not depend on the source note. Filename sanitization, extension selection and
  collision suffixes belong to the caller, not to attachment resolution.
- `configuredAttachmentFolder(app, notePath?)` reads the host setting;
  `ensureAttachmentFolder(app, notePath?, signal?)` creates it using the shared folder contract.

Guards: `vaultFolders.test.ts`, `attachmentFolder.test.ts`, `imageAttachmentFolder.test.ts`,
`imageImport.test.ts`, and the built-in/user-template characterization suites.

## Note paths and filenames

`plugin/src/helpers/pathsHelpers.ts` is the pure path-policy module. `normalizeMarkdownPath`
trims whitespace and outside slashes, then appends the case-sensitive `.md` extension.
It is **not** Obsidian's slash normalizer. `normalizePath` remains a compatibility export;
new consumers should use the explicit name. `resolvePath` has the same markdown policy.
`getFolderFromPath` / `getFileNameFromPath` split rendered paths without interpreting them.

Two filename policies are intentionally separate until their consumers opt in:
`cleanFileName` is the legacy title cleaner (first line only, including removal of `%`),
while `toSafeVaultPath` preserves `%` and cleans each path segment, using `Untitled` for an
empty forbidden-only segment. Neither existing filenames nor collision rules are changed.
`getAvailablePath` still owns collision suffixes and case-only rename handling.

Guards: `pathContracts.test.ts`, `pathsHelpers.test.ts`, `vaultPathNames.test.ts`, and
`builtinTemplatesCharacterization.test.ts`.

## Media and presentation

`plugin/src/media/extensions.ts` exports basic image formats (including AVIF), gallery-specific
HEIC/HEIF additions, scanner-specific ICO and PDF additions, and video/audio lists. Keep the
consumer's rendering limits explicit; recognizing a format does not promise a model can read it.
Media scans and reference resolution use the same `SCAN_MEDIA_EXTENSIONS` / `scanMediaType`.

`plugin/src/helpers/displayFormat.ts` is pure: `formatBytes` preserves the existing binary-unit
labels; `formatDuration(seconds, padMinutes?)` preserves row versus summary padding;
`formatTokenCount(value, options?)` makes precision, letter case and million abbreviation explicit.
`parseCommaList` trims and drops empty entries, but never deduplicates or implements CSV quoting.
`relativeDayLabel` accepts a day difference already calculated by the caller, not a date string.

Guards: `sharedFormatting.test.ts`, `unusedMediaSafety.test.ts`, `deduplicateMediaSafety.test.ts`
and existing gallery/UI-kit tests. Duration/token consumer adoption and journal navigation stay
with the corresponding panel/runtime owners; this batch does not change their date arithmetic.

## Dead-code inventory

Run `node plugin/scripts/dead-code.mjs`. CI also prints the inventory. It follows static,
relative, alias and literal dynamic imports, including Vue scripts and test roots. Results
are advisory: registration by name and externally accessed APIs need manual review. A test-only
export is a contract, not automatically dead code. The inventory is not a license to delete tests.
