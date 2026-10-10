import type { ChatSelectionSnapshot, RevisionReference, SourceRange } from './types'

export interface BindingPatch {
  range: SourceRange
  before: string
  after: string
}
export interface SelectionBindingOperation {
  id: string
  bindingId: string
  anchorId: string
  targetPath: string
  captured: RevisionReference
  patch: BindingPatch
  resulting: RevisionReference
  /** Source ownership proof, not write-acknowledgement evidence. */
  publishedContent?: string
  /** Proven inverse placement on a retained revision; source is stored once in versions. */
  ownership?: { revision: RevisionReference; start: number; after: string }
  undoneAt?: number
}
export type BindingStatus = 'pending' | 'applied' | 'known-not-written' | 'uncertain' | 'undone'
export interface SelectionBindingRecovery {
  id?: string
  anchorId?: string
  snapshot?: ChatSelectionSnapshot
  operation?: SelectionBindingOperation
  status: BindingStatus
  targetPath: string
  evidence?: string
}
export interface SelectionBindingResult {
  status: BindingStatus
  targetPath: string
  backlink: string
  operationId: string
  recoverable: boolean
  reason?: string
}
export interface SelectionBindingPort {
  bind(notePath: string): Promise<SelectionBindingResult>
}
