/** Runtime evidence from a visited EPUB chapter; never persisted until explicitly confirmed. */
export interface HighlightRepairCandidate {
  cfi: string
  suggested: string
  text: string
  label: string
  context: { pre: string; match: string; post: string }
  anchored: boolean
}
