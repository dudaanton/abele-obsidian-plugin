import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GithubConnectionEditor from '@/components/settings/GithubConnectionEditor.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import { secrets } from '@/secrets/SecretStore'
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
  it.each(['github', 'forgejo'])('shows owner examples on separate lines for %s', (provider) => {
    const connection = { ...row, provider, server: 'https://git.example.test' }
    const view = mount(GithubConnectionEditor, { props: { connection, connections: [connection] } })
    const textarea = document.body.querySelector('textarea')!
    expect(textarea.placeholder).toBe('sample-org\nsample-org/project')
    view.unmount()
  })
  it('clears a saved identity when its token is refused on a later check', async () => {
    const forge = {
      ...row,
      provider: 'forgejo',
      server: 'https://forge.example.test',
      account: { login: 'previous-user' },
      checkedAt: 1,
    }
    secrets().set(row.keyId, 'invented-token')
    request.mockResolvedValue({ ...reply(''), status: 401, json: { message: 'Unauthorized' } })
    const view = mount(GithubConnectionEditor, {
      props: { connection: forge, connections: [forge] },
    })
    await press(view, 'Check access')
    expect(document.body.querySelector('.abele-github-access')).toBeNull()
    await press(view, 'Save')
    expect(view.emitted('save')![0][0]).toMatchObject({ checkState: 'refused' })
    expect(view.emitted('save')![0][0]).not.toHaveProperty('account')
    view.unmount()
  })
  it('keeps a saved service fixed and explains invalid server syntax', async () => {
    const view = mount(GithubConnectionEditor, { props: { connection: row, connections: [row] } })
    expect(view.findComponent(Dropdown).props('disabled')).toBe(true)
    view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'github.com')!
      .vm.$emit('update:modelValue', 'https://sample.example.test?token=sample')
    await flushPromises()
    expect(document.body.textContent).toContain('Only the address: no login, query or # part')
    view.unmount()
  })
  it('discards an access result after the stored credential rotates during the check', async () => {
    secrets().set(row.keyId, 'invented-old')
    let finish!: (reply: unknown) => void
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const view = mount(GithubConnectionEditor, { props: { connection: row, connections: [row] } })
    await press(view, 'Check access')
    secrets().set(row.keyId, 'invented-new')
    await flushPromises()
    finish(reply('stale-account'))
    await flushPromises()
    await press(view, 'Save')
    expect(view.emitted('save')?.[0]?.[0]).not.toHaveProperty('account')
    view.unmount()
  })
  it('offers Forgejo and checks its native API without storing the draft token', async () => {
    const app = useVault([])
    const forge = { ...row, provider: 'forgejo', server: 'https://forge.example.test/team' }
    const view = mount(GithubConnectionEditor, {
      props: { connection: forge, connections: [forge] },
    })
    expect(view.findComponent(Dropdown).props('options')).toContainEqual({
      value: 'forgejo',
      display: 'Forgejo',
    })
    view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'Access token')!
      .vm.$emit('update:modelValue', 'invented-forgejo-token')
    request.mockResolvedValue(reply('sample-user'))
    await press(view, 'Check access')
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://forge.example.test/team/api/v1/user',
        headers: expect.objectContaining({ Authorization: 'token invented-forgejo-token' }),
      })
    )
    expect(app.secretStorage.getSecret('sample-key')).toBe('')
    expect(document.body.textContent).toContain('sample-user')
    await press(view, 'Save')
    expect(view.emitted('save')![0][0]).toMatchObject({
      provider: 'forgejo',
      checkState: 'ok',
      account: { login: 'sample-user' },
    })
    view.unmount()
  })
  it('does not retarget a stored credential when its provider changes', async () => {
    const app = useVault([])
    app.secretStorage.setSecret('sample-key', 'invented-old-token')
    const view = mount(GithubConnectionEditor, {
      props: { connection: row, connections: [row], isNew: true },
    })
    view.findComponent(Dropdown).vm.$emit('update:modelValue', 'forgejo')
    await flushPromises()
    view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'https://git.example.test')!
      .vm.$emit('update:modelValue', 'https://forge.example.test')
    request.mockResolvedValue(reply('sample-user'))
    await press(view, 'Check access')
    expect(request.mock.calls.every(([r]) => !r.headers.Authorization)).toBe(true)
    view.unmount()
  })
  it('returns the observed quota separately from persisted connection metadata', async () => {
    const view = mount(GithubConnectionEditor, { props: { connection: row, connections: [row] } })
    view
      .findAllComponents(Input)
      .find((i) => i.props('placeholder') === 'github_pat_...')!
      .vm.$emit('update:modelValue', 'invented-rate-token')
    request.mockResolvedValue({
      ...reply('sample-user'),
      headers: { 'x-ratelimit-remaining': '42', 'x-ratelimit-limit': '5000' },
    })
    await press(view, 'Check access')
    await press(view, 'Save')
    expect(view.emitted('save')?.[0]?.[2]).toMatchObject({ remaining: 42, limit: 5000 })
    expect(view.emitted('save')?.[0]?.[0]).not.toHaveProperty('rate')
    view.unmount()
  })

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
    expect(document.querySelector('.abele-avatar__image')?.getAttribute('src')).toBe(
      'https://avatars.githubusercontent.com/fake.png'
    )
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
