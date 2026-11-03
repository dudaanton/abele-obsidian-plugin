import { expect, it, vi } from 'vitest'
import { AccessClient } from '@abele/sync-sdk/core'
import { issueDeletionDevice } from '../helpers/serverDeleteSetup'
it('resolves issuer scope from connection metadata when it is absent from the token payload', async () => {
  const issue = vi.fn(async () => ({ token: 'sample-issued', info: {} }))
  const client = vi.spyOn(AccessClient, 'fromToken').mockReturnValue({
    token: {},
    connection: async () => ({ scope: { kind: 'folder', id: 'sample-root', path: '/' } }),
    issue,
  } as never)
  try {
    const transport = vi.fn<Parameters<typeof issueDeletionDevice>[3]>()
    await issueDeletionDevice('sample-token', 'Sample device', false, transport)
    expect(issue).toHaveBeenCalledWith({
      scope: { kind: 'folder', id: 'sample-root' },
      label: 'Sample device',
      read_only: false,
    })
  } finally {
    client.mockRestore()
  }
})
