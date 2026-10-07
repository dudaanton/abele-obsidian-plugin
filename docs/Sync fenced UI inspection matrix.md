# Fenced UI inspection matrix

Task 63 uses a development-only readonly gallery of the **actual components**, with anonymous
long paths/identities/audiences and synthetic state. It never supplies an enabled mutation port,
credential or active connection. The gallery and its test API are rejected from production by
the rendered-module guard. Readonly source/review props are display data, never confirmation
identity or runtime authority.

| Screen | Native desktop | Physical iPhone | Cases |
| --- | --- | --- | --- |
| Folder receiver review | inspected | inspected | long current paths, unknown eligibility, disabled key creation |
| Group root/anchors wizard | inspected | inspected | stable root/version, scattered notes, long list; certified/preparing |
| Initial existing-image batch | inspected | inspected | exact SHA/versions/sponsors, multiple audiences, confirmation hold |
| Scoped invitation/join | inspected | inspected | no local publication/remap, credential fields disabled |
| Scoped new-file/paste choice | inspected | inspected | current root/sponsor, missing native-paste proof, no replacement |
| Owner extras/native settings | inspected | inspected | long audience/path, offline/cache-unknown, no automatic withdrawal |
| Unshare exact-target review | inspected | inspected | identity/version/audience and retry warning; mutation disabled |
| Script approval | inspected | inspected | exact identity/hash/inert source, readonly approval disabled |
| Plugin code staging | inspected | inspected | long code labels, settings/code distinction, install/keep disabled |
| Personal join choice | inspected | inspected | history-preserving merge choices; readonly/busy connect disabled |

Desktop opt-in `fencedScreens.e2e.test.ts` records geometry/screenshots for 13 cases at a real
leased window, checks no horizontal overflow, scroll-end/last-content clearance, visible close,
no undefined text and unchanged exact local connection/scoped keys; window bounds and original
plugin build are restored. A missing stage skips without resource use. This is not phone emulation
counted as native evidence; physical iPhone inspection runs separately through `pi-drive` only.

Native inspection found the folder long-list body lacked its own scroller. Added explicit scroll
body/nonshrinking Close footer, with red executable layout contract first. Group preparing
and recovery/revoke/transport explanations now appear near the top instead of hiding behind long
credential fields. Readonly irreversible actions use neutral disabled appearance rather than
active accent/warning presentation. Personal join error/source facts at the initial viewport are
normal below-fold clipping: exact bottom check verified the full warning above a separate footer.

The first desktop attempt exposed a fixture-install defect: copying `main.css` rather than
Obsidian's loaded `styles.css` left old UI styles in the app. The runner now backs up, maps current
`main.css` to `styles.css`, verifies restoration and reloads. A red install-contract regression
precedes that fix; final native desktop uses the actual current stylesheet, not stale screenshots.

Phone bodies were moved to exact scrollHeight for end-of-list/source evidence. The last group/
asset targets and warnings are reachable above the separate Close row; disabled action properties
were inspected without tapping them. Exact `app.loadLocalStorage` key comparisons—not a generic
zero-key localStorage search—verified no connection/scoped context mutation after cleanup.

Limits: portrait iPhone and desktop UI only; no native Boox/Android/e-ink transport, actual scoped
setup/publication, native paste authority or landscape/keyboard/screen-reader acceptance is
claimed. The pre-existing timeline header behind modals is unrelated UI debt. All activation
fences remain false and the sponsor proof-read gate remains blocked.
