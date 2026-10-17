import { expect, it, vi } from 'vitest'
import { connectionApproval } from '@/github/approveConnection'
const choose = vi.hoisted(() => vi.fn().mockResolvedValue('allow'))
vi.mock('@/components/obsidian/dialogs', () => ({ choiceDialog: choose }))
it('names the selected account and endpoint without presenting native access as GitHub', async () => {
  expect(
    await connectionApproval()({
      id: 'sample',
      name: 'Sample Gitea',
      server: 'https://git.example.test/team',
      account: { login: 'sample-user' },
    })
  ).toBe(true)
  expect(choose.mock.calls[0][0].title).toBe('Allow Git connection?')
  expect(choose.mock.calls[0][0].message).toContain('https://git.example.test/team as sample-user')
})
