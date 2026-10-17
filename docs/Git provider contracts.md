# Git provider contracts

The provider boundary separates deployment identity, single-hop HTTP, credential authority,
URL codecs and repository reads. GitHub is the implemented adapter. Existing commands,
tool names, tabs, snippets and notification behavior retain their GitHub contracts.

Deployments include provider, scheme, host, port and base path. Credentials belong to a
stable connection and an opaque generation. Repository authority keys also include repository
identity and immutable revision. Results must pass a current-authority check after asynchronous
reads as well as before them. HTTP records use plain strings, bytes, status and headers;
native platform adapters supply the transport. Unapproved redirects remove all supported
credential headers and private conditional-cache headers.

Repository display records live in the repository core and are re-exported from the old
GitHub modules for compatibility. The neutral conversation boundary additionally distinguishes
resource kind from display number, opaque IDs from numbers, deleted actors, unknown counts,
thread replies and outdated positions. Partial results carry completeness, continuation and
limitation fields. Existing GitHub screen capabilities remain an explicit compatibility adapter.

## Inspected schema baselines

The synthetic contracts in `plugin/tests/fixtures/forge/contracts.json` pin Forgejo **11.0.0**
and Gitea **1.24.0**. Each records the release-tag schema URL and the SHA-256 of its complete
source, plus the relevant property sets. These are exact inspected baselines; a different
version does not automatically inherit these guarantees. Codeberg is a Forgejo deployment,
not a distinct API implementation. No account responses or credentials are recorded.

| Operation | Contract |
| --- | --- |
| Draft creation | Neither create-PR schema defines a draft field. Draft creation remains unsupported without a separately verified host convention. A draft request must never silently create a published PR. |
| Comparison | Forgejo's Compare includes files; Gitea's does not. Neither inspected compare schema establishes merge-base semantics. Complete endpoint comparisons require fixed trees and blobs rather than assuming compare files are complete. |
| Changed-file patches | Neither ChangedFile schema defines a patch. A missing patch means unavailable data, not an empty diff. |
| Notification completion | Both expose unread, read and pinned states. Mark read is available; a distinct Done operation is unsupported. Read must not be relabeled Done or mapped to pinned. |
| Blame and repository Discussions | No corresponding endpoints are present in either inspected schema. Unsupported capabilities must remain explicit. |

The schema support table describes API evidence, not availability of an installed adapter.
It does not turn on additional provider connections or change the existing GitHub inbox.
