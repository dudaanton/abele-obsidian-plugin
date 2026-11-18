/** A probe owns only its own fixture paths, including after an interrupted earlier run. */
export function layoutFixtureScript(source: string, id: string): string {
  return source
    .replaceAll('probe-skill-', 'probe-skill-' + id + '-')
    .replaceAll('probe-prompt-', 'probe-prompt-' + id + '-')
    .replaceAll('Phone probe', 'Sample layout ' + id)
    .replaceAll('pnest', 'sample-comment-' + id + '-')
    .replaceAll('sample-word-layout.docx', 'sample-word-layout-' + id + '.docx')
}
