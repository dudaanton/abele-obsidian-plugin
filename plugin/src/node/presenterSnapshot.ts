import type { NodeClientState } from './NodeClientStore'

/** A presentation owns only its session's plain data, never store accessors or their closure. */
export function presenterSnapshot(
  state: NodeClientState,
  session: string,
  older: NodeClientState['events'][string] = []
) {
  const history = [...older, ...(state.events[session] ?? [])]
  const inputIds = new Set(
    history.map((event) => (event.data as { input_id?: string })?.input_id).filter(Boolean)
  )
  const letters = Object.fromEntries(
    Object.entries(state.nodeLetters ?? {})
      .filter(([, letter]) => letter.sessionId === session)
      .map(([id, letter]) => [id, { ...letter }])
  )
  const receipts: NodeClientState['results'] = {}
  for (const [id, receipt] of Object.entries(state.results)) {
    const result = receipt.result as
      | { session_id?: string; input_id?: string; accepted_seq?: number }
      | undefined
    if (
      receipt.input?.sessionId === session ||
      receipt.answer?.sessionId === session ||
      result?.session_id === session ||
      (result?.input_id && inputIds.has(result.input_id)) ||
      id in letters
    ) {
      receipts[id] = {
        ...(receipt.error ? { error: receipt.error } : {}),
        ...(receipt.input ? { input: { ...receipt.input } } : {}),
        ...(receipt.answer ? { answer: { ...receipt.answer } } : {}),
        ...(result
          ? {
              result:
                result.session_id === session
                  ? { ...result }
                  : { input_id: result.input_id, accepted_seq: result.accepted_seq },
            }
          : {}),
      }
    }
  }
  const artifactData: NonNullable<NodeClientState['artifactData']> = {}
  for (const event of history) {
    const id = (event.data as { artifact_id?: string })?.artifact_id
    if (id && state.artifactData?.[id]) artifactData[id] = { ...state.artifactData[id] }
  }
  return { history, letters, receipts, artifactData }
}
