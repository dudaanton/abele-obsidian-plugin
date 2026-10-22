import { unifiedMergeView } from '@codemirror/merge'

/** Removed lines are non-document block widgets; only the working document accepts edits. */
export function workingComparison(original: string) {
  return unifiedMergeView({
    original,
    mergeControls: false,
    syntaxHighlightDeletions: true,
    allowInlineDiffs: false,
  })
}
