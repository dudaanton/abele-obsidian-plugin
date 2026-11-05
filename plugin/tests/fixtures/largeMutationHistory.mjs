/** Synthetic retained file images, deliberately larger than ordinary receipt histories. */
export function largeMutationHistory(count = 300) {
  const records = {}
  const body = 'sample document line\n'.repeat(14000).slice(0, 256 * 1024)
  for (let i = 0; i < count; i++) {
    const operation_id = 'sample-mutation-' + i
    const before = body + '\nbefore ' + i
    records[operation_id] = {
      operation_id,
      key: i.toString(16).padStart(64, '0'),
      chat_id: 'sample-chat',
      call_id: 'sample-call-' + i,
      principal: 'sample-principal',
      tool: 'node_write',
      request: { method: 'file.write', params: {} },
      before,
      after: before + '\nnew line',
      state: i === count - 1 ? 'outcome_unknown' : 'saved',
      ...(i === count - 1 ? {} : { receipt: { operation_id, state: 'saved' } }),
    }
  }
  return records
}
