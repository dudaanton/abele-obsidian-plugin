/** One status vocabulary for item tabs, lists and the open picker. */
export function issueState(item: { state: string; state_reason?: string }): string {
  return item.state_reason === 'not_planned' ? 'not planned' : item.state
}

export function pullState(item: {
  state: string
  draft?: boolean
  merged_at?: string | null
}): string {
  return item.merged_at ? 'merged' : item.draft && item.state === 'open' ? 'draft' : item.state
}

export function discussionState(item: { closed?: boolean; isAnswered?: boolean }): string {
  return item.isAnswered ? 'answered' : item.closed ? 'closed' : 'open'
}
