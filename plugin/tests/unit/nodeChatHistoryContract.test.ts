import { expect, it, vi } from 'vitest'
import { NodeChatHistory } from '@/node/NodeChatHistory'

const point = {
  checkpoint_id: 'sample-point',
  input_id: 'sample-input',
  before_seq: 3,
  exclude_input_ids: [],
}
const preview = {
  preview_id: 'a'.repeat(64),
  changes: [{ path: 'sample.txt', current: 'b'.repeat(64), checkpoint: 'c'.repeat(64) }],
  files: [],
}
const fixture = (reason = '') => {
  const chat = {
    checkpoints: vi.fn(async () => [point]),
    preview: vi.fn(async () => structuredClone(preview)),
    restore: vi.fn(async () => ({ session_id: 'sample-session' })),
  }
  return {
    chat,
    history: new NodeChatHistory(
      () => ({ chat }) as never,
      'sample-session',
      () => reason
    ),
  }
}
it('loads real checkpoints and keeps conversation actions free of file consent', async () => {
  const { chat, history } = fixture()
  await history.read()
  expect(history.checkpoints.value).toEqual([point])
  for (const action of ['rewind', 'branch', 'edit', 'retry'] as const) {
    await history.restore(point, action, action === 'edit' ? 'Replacement text' : undefined)
    expect(chat.restore).toHaveBeenLastCalledWith({
      session_id: 'sample-session',
      checkpoint_id: 'sample-point',
      action,
      ...(action === 'edit' ? { text: 'Replacement text' } : {}),
    })
  }
})
it('sends the exact preview-bound file set only for an explicit rewind', async () => {
  const { chat, history } = fixture()
  const shown = await history.preview(point)
  expect(chat.restore).not.toHaveBeenCalled()
  await history.restore(point, 'rewind', undefined, shown)
  expect(chat.restore).toHaveBeenCalledExactlyOnceWith({
    session_id: 'sample-session',
    checkpoint_id: 'sample-point',
    action: 'rewind',
    restore_files: { preview_id: shown.preview_id, changes: shown.changes },
  })
  await expect(history.restore(point, 'branch', undefined, shown)).rejects.toThrow()
  expect(chat.restore).toHaveBeenCalledTimes(1)
})
it('never queues or silently retries an uncertain restore', async () => {
  const { chat, history } = fixture()
  chat.restore.mockRejectedValueOnce(new Error('outcome_unknown'))
  await expect(history.restore(point, 'retry')).rejects.toThrow('outcome_unknown')
  expect(chat.restore).toHaveBeenCalledTimes(1)
})
it('refuses legacy targets and active turns before invoking a restore', async () => {
  const { chat, history } = fixture('Choose an explicit folder or worktree first.')
  await expect(history.restore(point, 'branch')).rejects.toThrow('Choose an explicit folder')
  expect(chat.restore).not.toHaveBeenCalled()
})
