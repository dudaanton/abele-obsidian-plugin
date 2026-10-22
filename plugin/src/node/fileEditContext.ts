import type { PathDocument, PathFileStage } from './NodePathModel'

/** Only the working file can be edited; a preview must never become a write to that path. */
export function canEditNodeFile(document?: PathDocument, stage?: PathFileStage): boolean {
  return (
    !!document &&
    document.revision?.kind !== 'commit' &&
    stage !== 'staged' &&
    typeof stage !== 'object' &&
    document.change?.stage !== 'staged' &&
    document.change?.kind !== 'deleted' &&
    !document.image &&
    !document.note &&
    !document.change?.binary &&
    !document.change?.previewNote &&
    !document.change?.pending
  )
}
