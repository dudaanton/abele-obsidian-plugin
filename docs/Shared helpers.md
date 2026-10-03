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

## Requests

`plugin/src/helpers/http.ts` remains the common guarded transport. `requestText(options,
lowercaseHeaders?)` is the calendar/MCP adapter: it passes status through (`throw: false`),
never parses JSON, returns empty text for a body getter that throws, and propagates transport
and guard failures unchanged. Header casing is retained by default, lowercased for MCP.
`headerValue(headers, name)` is case-insensitive and returns `undefined` when absent;
calendar's `header` preserves its existing empty-string fallback.

Timeouts, size limits, redirects and credential guards are unchanged. Streaming still uses
its existing streaming adapter. GitHub deliberately retains its redirect-controlled single-hop
transport, including the native phone bridge: replacing it with the auto-following native
Obsidian transport would change credential behavior. Domain-specific errors stay in their domains.

Guards: `requestContract.test.ts`, `networkLimits.test.ts`, `localProviderTransport.test.ts`,
and the existing calendar, MCP and GitHub transport/security suites.

## Note-property sources

`plugin/src/properties/noteCache.ts` is pure: `cachedFrontmatter(cache)` returns the original
host object or `null`, with no coercion; `frontmatterProperties(frontmatter)` makes a shallow
snapshot excluding only the host's `position` metadata. Nested objects and timestamps remain
as supplied. Cache absence is not proof that a note has no properties.

`plugin/src/properties/noteReader.ts`: `readNoteProperties(app, file, { source })` requires
`cache`, `disk`, or `text` with a captured string. It never silently falls back from cache to
disk. Disk/text use the existing `parseNoteContent` and its reserved `content` body field,
including YAML/fence semantics. Cache and parsed values are **not** interchangeable. This is
a source-selection facade for subsequent adoption, not a new parser.

The front-matter dependency, timestamp parsing and property serialization are deliberately
unchanged. Writes still use each caller's established host/serializer path; do not replace
whole-note serialization with cache data in a deduplication.

Guards: `notePropertySources.test.ts`, `frontmatterCharacterization.test.ts`, `noteInfo.test.ts`,
`userTemplatesCharacterization.test.ts`, and existing property characterization tests.

## Dead-code inventory

Run `node plugin/scripts/dead-code.mjs`. CI also prints the inventory. It follows static,
relative, alias and literal dynamic imports, including Vue scripts and test roots. Results
are advisory: registration by name and externally accessed APIs need manual review. A test-only
export is a contract, not automatically dead code. The inventory is not a license to delete tests.
