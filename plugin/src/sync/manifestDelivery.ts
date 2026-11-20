/** Page-local evidence from a host path that durably handles content outside the core pull.
 * Include pending/refused work only after its recovery intent has been committed.
 * Acknowledgements must name the exact immutable version, never just the path.
 */
export const HANDLED_MANIFEST_FILES = Symbol('abele.sync.handled-manifest-files')
export interface HandledManifestPage {
  [HANDLED_MANIFEST_FILES]?: readonly { file_id: string; version_id: string }[]
}
