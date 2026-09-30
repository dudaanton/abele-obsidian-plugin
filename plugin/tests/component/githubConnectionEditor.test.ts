import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GithubConnectionEditor from '@/components/settings/GithubConnectionEditor.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'
import { useVault } from '../helpers/testEnv'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/github/transport', () => ({ singleHopRequest: request }))
const row = {
  id: 'sample',
  name: 'Sample',
  server: '',
  keyId: 'sample-key',
  owners: ['sample-org'],
  isDefault: true,
}
const reply = (login: string) => ({
  status: 200,
  headers: {},
  json: { login, avatar_url: 'https://avatars.githubusercontent.com/fake.png' },
  text: '',
  arrayBuffer: new ArrayBuffer(0),
})

beforeEach(() => {
  useVault([])
  request.mockReset()
})
const press = async (view: ReturnType<typeof mount>, text: string) => {
  view
    .findAllComponents(Button)
    .find((b) => b.props('text') === text)!
    .vm.$emit('click')
  await flushPromises()
}

describe('GitHub connection draft', () => {
  it('checking a typed token never stores it; cancel leaves settings unchanged', async () => {
    const app = useVault([])
    const view = mount(GithubConnectionEditor, { props: { connection: row, connections: [row] } })
    view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'github_pat_...')!
      .vm.$emit('update:modelValue', 'invented-token')
    request.mockResolvedValue(reply('sample-user'))
    await press(view, 'Check access')
    expect(document.body.textContent).toContain('sample-user')
    expect(app.secretStorage.getSecret('sample-key')).toBe('')
    await press(view, 'Cancel')
    expect(view.emitted('save')).toBeUndefined()
    expect(row).not.toHaveProperty('account')
    expect(document.body.textContent).not.toContain('invented-token')
    view.unmount()
  })

  it('saves account metadata and owner preferences with an uncommitted token', async () => {
    const view = mount(GithubConnectionEditor, { props: { connection: row, connections: [row] } })
    const token = view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'github_pat_...')!
    token.vm.$emit('update:modelValue', 'invented-token')
    request.mockResolvedValue(reply('sample-user'))
    await press(view, 'Check access')
    await press(view, 'Save')
    expect(view.emitted('save')?.[0]).toEqual([
      expect.objectContaining({
        account: {
          login: 'sample-user',
          avatarUrl: 'https://avatars.githubusercontent.com/fake.png',
        },
        owners: ['sample-org'],
      }),
      'invented-token',
    ])
    view.unmount()
  })

  it('never checks a repository on another server using this connection', async () => {
    const enterprise = { ...row, server: 'https://git.example.test' }
    const view = mount(GithubConnectionEditor, {
      props: { connection: enterprise, connections: [enterprise] },
    })
    view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'owner/repo or a GitHub link')!
      .vm.$emit('update:modelValue', 'https://github.com/sample/project')
    await press(view, 'Check access')
    expect(request).not.toHaveBeenCalled()
    expect(document.body.textContent).toMatch(/another server|different server/i)
    view.unmount()
  })

  it('ignores an out-of-order identity result after the draft token changes', async () => {
    let finish!: (r: unknown) => void
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const view = mount(GithubConnectionEditor, { props: { connection: row, connections: [row] } })
    const token = view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'github_pat_...')!
    token.vm.$emit('update:modelValue', 'invented-first')
    await press(view, 'Check access')
    token.vm.$emit('update:modelValue', 'invented-second')
    await flushPromises()
    finish(reply('stale-account'))
    await flushPromises()
    expect(document.body.textContent).not.toContain('stale-account')
    await press(view, 'Save')
    expect(view.emitted('save')?.[0]?.[0]).not.toHaveProperty('account')
    view.unmount()
  })
})
