import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import Button from '@/components/obsidian/Button.vue'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { ShellModal } from '@/modal/ShellModal'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { SecretStore, setSecrets, secrets } from '@/secrets/SecretStore'
import { pluginStoreHost } from '@/secrets/host'
import { allowKeyRecipient, removeKeyRecipient } from '@/secrets/manualConsent'
import { allowedHttpOrigins } from '@/secrets/keyTransport'
import {
  initializeDestinations,
  checkRequestDestinations,
  destinationAccepted,
  acceptDestinations,
} from '@/secrets/destinations'
import { setRequestGuard, setRequestTransport } from '@/helpers/http'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { basicAuth } from '@/calendars/http'
import { createAgentTools } from '@/ai/tools'
import {
  needsSecretApproval,
  allowSecretOrigin,
  secretNames,
  secretRequestForTool,
} from '@/ai/tools/secretUtils'

const origin = 'http://192.168.74.32:8973'
const username = 'sample-console'
const password = 'fake-console:password'
const name = 'Console password'
const keyId = 'sample-console-password'
let disk: string
let failWrite = false
let writes = 0
let beforeWrite: (() => Promise<void>) | undefined
const pauseWrite = () => {
  let release!: () => void, started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  beforeWrite = async () => {
    started()
    await gate
  }
  return { release, entered }
}
const modalButton = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find(
    (button) => button.textContent === text
  )!
let send: ReturnType<typeof vi.fn>
const config = () => AbeleConfig.getInstance()
const ctx = () => buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })

beforeEach(async () => {
  const app = useVault([])
  failWrite = false
  writes = 0
  beforeWrite = undefined
  config().applySettings(undefined)
  config().ai.providers = []
  config().ai.secrets = [{ name, keyId }]
  disk = JSON.stringify(config().exportSettings())
  const plugin = {
    app,
    manifest: { dir: '.obsidian/plugins/abele' },
    loadData: async () => JSON.parse(disk),
    saveData: async (data: AbeleSettings) => {
      writes++
      const pause = beforeWrite
      beforeWrite = undefined
      if (pause) await pause()
      if (failWrite) {
        failWrite = false
        throw new Error('Sample storage failure: ' + basicAuth(username, password))
      }
      disk = JSON.stringify(data)
    },
    syncAiFeatures: () => {},
  }
  config().init(plugin as never)
  setSecrets(new SecretStore(pluginStoreHost(plugin as unknown as Plugin)))
  secrets().set(keyId, password)
  initializeDestinations(config())
  setRequestGuard((req) => checkRequestDestinations(req, config()))
  send = vi.fn(async (req) => ({
    status: 200,
    headers: { 'content-type': 'text/plain' },
    text: req.headers?.Authorization ?? '',
    arrayBuffer: new ArrayBuffer(0),
  }))
  setRequestTransport(send)
})
afterEach(() => {
  config().destroy()
  setSecrets(null)
  setRequestGuard(undefined)
  setRequestTransport(undefined)
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const params = () => ({
  url: origin + '/stats',
  basicAuth: { username, password: '${abele_key:Console password}' },
})
const literal = (header = basicAuth(username, password), url = origin) =>
  ctx().fetch(url, { headers: { Authorization: header } })

describe('public Basic requests with real configuration persistence', () => {
  it.each(['tool', 'script'] as const)(
    'redacts all generated composed Basic material at the transformation boundary for %s HTTPS echoes',
    async (kind) => {
      const address = 'https://composed-console.sample.example/stats'
      await allowKeyRecipient({ address, keyId })
      const request = {
        url: address,
        basicAuth: { username, password: 'prefix-${abele_key:Console password}-suffix' },
      }
      const derivedPassword = 'prefix-' + password + '-suffix'
      const header = basicAuth(username, derivedPassword)
      send.mockImplementationOnce(async () => ({
        status: 200,
        headers: { 'X-Echo': header },
        text: [header, header.slice(6), username + ':' + derivedPassword].join('|'),
        arrayBuffer: new ArrayBuffer(0),
      }))
      const text =
        kind === 'tool'
          ? (
              await createAgentTools()
                .find((tool) => tool.name === 'fetch')!
                .execute('sample-composed', request)
            ).content[0].text!
          : JSON.stringify(await ctx().fetch(address, { basicAuth: request.basicAuth }))
      expect(
        [password, derivedPassword, header, header.slice(6), username + ':' + derivedPassword].some(
          (value) => text.includes(value)
        )
      ).toBe(false)
      expect(send).toHaveBeenCalledTimes(1)
    }
  )
  it.each(['Cancel', 'close', 'caller abort'] as const)(
    'rolls back deferred script consent after %s, without changing the caller signal on modal close',
    async (action) => {
      const address = 'https://cancel-console.sample.example/stats'
      const caller = new AbortController()
      const pause = pauseWrite()
      const opened = vi.spyOn(ShellModal.prototype, 'open')
      const work = buildScriptContext({ params: {}, signal: caller.signal, logs: [] }).fetch(
        address,
        { basicAuth: params().basicAuth }
      )
      const rejected = expect(work).rejects.toThrow()
      try {
        await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
        modalButton('Allow address and send').click()
        await pause.entered
        if (action === 'Cancel') modalButton('Cancel').click()
        else if (action === 'caller abort') caller.abort()
        else (opened.mock.contexts[0] as ShellModal).close()
        expect(caller.signal.aborted).toBe(action === 'caller abort')
        pause.release()
        await rejected
        await vi.waitFor(() => expect(config().ai.secrets[0].allowedOrigins ?? []).toEqual([]))
        expect(JSON.parse(disk).ai.secrets[0].allowedOrigins ?? []).toEqual([])
        expect(
          destinationAccepted({ keyId, name, origin: 'https://cancel-console.sample.example' })
        ).toBe(false)
        expect(send).not.toHaveBeenCalled()
        expect(document.querySelector('.modal')).toBeNull()
      } finally {
        pause.release()
      }
    }
  )
  it('disables duplicate script submissions throughout the deferred real save', async () => {
    const pause = pauseWrite()
    const work = ctx().fetch('https://duplicate-console.sample.example/stats', {
      basicAuth: params().basicAuth,
    })
    try {
      await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
      const button = modalButton('Allow address and send')
      button.click()
      await pause.entered
      const disabled = button.disabled
      button.click()
      pause.release()
      await work
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(disabled).toBe(true)
      expect(writes).toBe(1)
    } finally {
      pause.release()
    }
  })
  it.each([
    ['script', 'save'],
    ['tool', 'save'],
    ['script', 'grant'],
    ['tool', 'grant'],
    ['script', 'queue'],
    ['tool', 'queue'],
  ] as const)(
    'rejects a two-key %s rebinding during %s and undoes owned grants while preserving independent ones',
    async (entry, phase) => {
      const address = 'https://two-key-console.sample.example/stats'
      const recipient = new URL(address).origin
      const otherName = 'Other console password',
        otherId = 'sample-other-console',
        replacementId = 'sample-rebound-console'
      secrets().set(otherId, 'fake-other-console-value')
      secrets().set(replacementId, 'fake-rebound-console-value')
      config().ai.secrets.push({ id: 'sample-other-record', name: otherName, keyId: otherId })
      const request = {
        url: address,
        basicAuth: {
          username,
          password: '${abele_key:Console password}:${abele_key:Other console password}',
        },
      }
      const pause = pauseWrite()
      const unrelated =
        phase === 'queue'
          ? allowKeyRecipient({ keyId, address: 'https://independent-console.sample.example' })
          : undefined
      if (unrelated) await pause.entered
      let view: ReturnType<typeof mount> | undefined
      let work: Promise<unknown> | undefined
      let rejected: Promise<unknown> | undefined
      try {
        if (entry === 'script') {
          work = ctx().fetch(address, { basicAuth: request.basicAuth })
          rejected = expect(work).rejects.toThrow()
          await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
          modalButton('Allow address and send').click()
        } else {
          vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
            value: undefined,
          } as never)
          view = mount(AiToolApproval, {
            props: {
              message: {
                id: 'sample-multi-call',
                role: 'tool-call',
                content: '',
                timestamp: 1,
                toolName: 'fetch',
                toolParams: request,
                toolStatus: 'pending',
              } as never,
            },
          })
          view
            .findAllComponents(Button)
            .find((button) => button.props('text') === 'Allow this address for these keys')!
            .vm.$emit('click')
        }
        await pause.entered
        const rebind = () => {
          config().ai.secrets[1].keyId = replacementId
          config().ai.secrets[0].allowedOrigins = [
            ...(config().ai.secrets[0].allowedOrigins ?? []),
            'https://independent-console.sample.example',
          ]
          acceptDestinations([
            { keyId, name, origin: 'https://independent-console.sample.example' },
          ])
        }
        if (phase === 'save' || phase === 'queue') rebind()
        else {
          const app = GlobalStore.getInstance().app
          const save = app.saveLocalStorage.bind(app)
          let fired = false
          vi.spyOn(app, 'saveLocalStorage').mockImplementation((storageKey, value) => {
            save(storageKey, value)
            if (
              !fired &&
              storageKey === 'abele-key-destinations-v1' &&
              (value as Record<string, string[]>)[keyId]?.includes(recipient)
            ) {
              fired = true
              rebind()
            }
          })
        }
        pause.release()
        await unrelated
        if (entry === 'script') {
          await vi.waitFor(() =>
            expect(document.querySelector('.modal')!.textContent).toContain('Could not save')
          )
          modalButton('Cancel').click()
          await rejected
        } else await vi.waitFor(() => expect(view!.text()).toContain('Could not save'))
        const saved = JSON.parse(disk).ai.secrets
        expect(saved[0].allowedOrigins).not.toContain(recipient)
        expect(saved[0].allowedOrigins).toContain('https://independent-console.sample.example')
        expect(saved[1].allowedOrigins ?? []).not.toContain(recipient)
        for (const id of [keyId, otherId, replacementId])
          expect(destinationAccepted({ keyId: id, name, origin: recipient })).toBe(false)
        expect(
          destinationAccepted({ keyId, name, origin: 'https://independent-console.sample.example' })
        ).toBe(true)
        expect(secrets().get(replacementId) === 'fake-rebound-console-value').toBe(true)
        expect(send).not.toHaveBeenCalled()
      } finally {
        pause.release()
        view?.unmount()
      }
    }
  )
  it('retries the unchanged encoded header after save/readback, without a duplicate saved secret', async () => {
    await expect(literal()).rejects.toThrow()
    await allowKeyRecipient({ address: origin, keyId })
    expect(JSON.parse(disk).ai.secrets[0].allowedOrigins).toEqual([origin])
    await config().reloadSettings()
    await secrets().load()
    const result = await literal()
    expect(result.status).toBe(200)
    expect(result.text).toBe('[saved key]')
    expect(send.mock.calls[0][0].headers.Authorization).toBe(basicAuth(username, password))
    expect(config().ai.secrets).toHaveLength(1)
    expect(disk).not.toContain(password)
  })
  it('removes just the saved key recipient permission, preserving the key and HTTP transport for other approved keys', async () => {
    await allowKeyRecipient({ address: origin, keyId })
    await removeKeyRecipient(keyId, origin)
    await config().reloadSettings()
    expect(config().ai.secrets[0].allowedOrigins).toEqual([])
    expect(secrets().get(keyId)).toBe(password)
    expect(allowedHttpOrigins()).toEqual([origin])
    await expect(literal()).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
  it('restores its owned permission and preserves the key if real persistence fails during removal', async () => {
    await allowKeyRecipient({ address: origin, keyId })
    failWrite = true
    await expect(removeKeyRecipient(keyId, origin)).rejects.toThrow('Could not save key permission')
    expect(JSON.parse(disk).ai.secrets[0].allowedOrigins).toContain(origin)
    expect(secrets().get(keyId) === password).toBe(true)
    expect((await literal()).status).toBe(200)
  })
  it('advertises and discovers Basic passwords through registered tool/schema/approval contracts', async () => {
    const tool = createAgentTools().find((t) => t.name === 'fetch')!
    expect((tool.parameters as any).properties.basicAuth).toBeDefined()
    expect(secretNames(secretRequestForTool('fetch', params()))).toEqual([name])
    expect(needsSecretApproval('fetch', params())).toBe(true)
    expect(() => allowSecretOrigin(name, origin)).toThrow(/unencrypted HTTP/)
    await allowKeyRecipient({ address: origin, keyId })
    expect(needsSecretApproval('fetch', params())).toBe(false)
    const result = await tool.execute('sample-fetch', params())
    expect(result.content[0].text).toContain('HTTP 200')
    expect(result.content[0].text).not.toContain(basicAuth(username, password).slice(6))
    expect(send.mock.calls[0][0].headers.Authorization).toBe(basicAuth(username, password))
  })
  it('resolves the Basic password only after the native approval and binds the original request', async () => {
    const opts: any = { basicAuth: { username, password: '${abele_key:Console password}' } }
    const work = ctx().fetch('https://sample-console.example/stats', opts)
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    opts.basicAuth.username = 'mutated-user'
    const allow = [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find(
      (b) => b.textContent === 'Allow address and send'
    )!
    allow.click()
    await work
    expect(send.mock.calls[0][0].headers.Authorization).toBe(basicAuth(username, password))
    expect(JSON.parse(disk).ai.secrets[0].allowedOrigins).toContain(
      'https://sample-console.example'
    )
  })
  it('runs the ordinary tool approval control with real persistence before executing the registered Basic tool', async () => {
    vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
      value: undefined,
    } as never)
    const request = { ...params(), url: 'https://tool-console.sample.example/stats' }
    const view = mount(AiToolApproval, {
      props: {
        message: {
          id: 'sample-call',
          role: 'tool-call',
          content: '',
          timestamp: 1,
          toolName: 'fetch',
          toolParams: request,
          toolStatus: 'pending',
        } as never,
      },
    })
    try {
      expect(needsSecretApproval('fetch', request)).toBe(true)
      view
        .findAllComponents(Button)
        .find((b) => b.props('text') === 'Allow this address for these keys')!
        .vm.$emit('click')
      await vi.waitFor(() => expect(needsSecretApproval('fetch', request)).toBe(false))
      await nextTick()
      expect(JSON.parse(disk).ai.secrets[0].allowedOrigins).toContain(
        'https://tool-console.sample.example'
      )
      const result = await createAgentTools()
        .find((t) => t.name === 'fetch')!
        .execute('sample-approved', request)
      expect(result.content[0].text).toContain('HTTP 200')
      expect(send.mock.calls[0][0].headers.Authorization === basicAuth(username, password)).toBe(
        true
      )
    } finally {
      view.unmount()
    }
  })
  it('does not send or claim native approval success when the real settings adapter fails to write', async () => {
    const work = ctx().fetch('https://failed-console.sample.example/stats', {
      basicAuth: params().basicAuth,
    } as any)
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    failWrite = true
    ;[...document.querySelectorAll<HTMLButtonElement>('.modal button')]
      .find((b) => b.textContent === 'Allow address and send')!
      .click()
    await vi.waitFor(() =>
      expect(document.querySelector('.modal')!.textContent).toContain('Could not save')
    )
    expect(document.querySelector('.modal')!.textContent).not.toContain(password)
    expect(document.querySelector('.modal')!.textContent).not.toContain(
      basicAuth(username, password).slice(6)
    )
    expect(send).not.toHaveBeenCalled()
    expect(JSON.parse(disk).ai.secrets[0].allowedOrigins ?? []).toEqual([])
    ;[...document.querySelectorAll<HTMLButtonElement>('.modal button')]
      .find((b) => b.textContent === 'Cancel')!
      .click()
    await expect(work).rejects.toThrow('Saved-key request was not approved')
  })
  it('rejects malformed Basic, wrong password/key, changed recipient/port and mixed unknown credentials before send', async () => {
    await allowKeyRecipient({ address: origin, keyId })
    for (const header of [
      'Basic !!!',
      'Basic ' + btoa('missing-separator'),
      basicAuth(username, 'fake-wrong-password'),
      'Basic ' + btoa('user:prefix-' + password),
    ])
      await expect(literal(header)).rejects.toThrow()
    for (const url of ['http://192.168.74.32:8974', 'http://192.168.74.33:8973'])
      await expect(literal(undefined, url)).rejects.toThrow()
    await expect(
      ctx().fetch(origin, {
        headers: {
          Authorization: basicAuth(username, password),
          'X-API-Key': 'fake-unapproved-key',
        },
      })
    ).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
  it('preserves first-colon password semantics and reports HTTP 401 separately from a guard refusal', async () => {
    await allowKeyRecipient({ address: origin, keyId })
    send.mockResolvedValueOnce({
      status: 401,
      headers: {},
      text: 'Login refused',
      arrayBuffer: new ArrayBuffer(0),
    })
    const answer = await literal(basicAuth('wrong-sample-user', password))
    expect(answer.status).toBe(401)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('redacts derived credentials from responses and network errors and drops them on cross-origin redirects', async () => {
    await allowKeyRecipient({ address: origin, keyId })
    const fault = new Error('Sample failure: ' + basicAuth(username, password))
    fault.name = 'Sample ' + basicAuth(username, password)
    send.mockRejectedValueOnce(fault)
    const error = await literal().then(
      () => null,
      (error) => error as Error
    )
    expect(error).not.toBeNull()
    expect((error!.name + error!.message).includes(basicAuth(username, password).slice(6))).toBe(
      false
    )
    send.mockResolvedValueOnce({
      status: 302,
      headers: { location: 'https://redirect.sample.example/next' },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    })
    await literal()
    expect(send.mock.calls[2][0].headers.Authorization).toBeUndefined()
  })
  it('executes both registered download Basic inputs and redacts an HTTP 401 echo instead of misclassifying it as a transport refusal', async () => {
    await allowKeyRecipient({ address: origin, keyId })
    for (const toolName of ['download_image', 'download_file']) {
      send.mockResolvedValueOnce({
        status: 401,
        headers: {},
        text: basicAuth(username, password),
        arrayBuffer: new ArrayBuffer(0),
      })
      const tool = createAgentTools().find((t) => t.name === toolName)!
      await expect(tool.execute('sample-download', params())).rejects.toThrow(
        'HTTP 401: [saved key]'
      )
      expect(send.mock.lastCall![0].headers.Authorization).toBe(basicAuth(username, password))
    }
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('supports the same Basic input on downloads and rejects conflicting auth headers or usernames containing colons', async () => {
    for (const toolName of ['download_image', 'download_file']) {
      const tool = createAgentTools().find((t) => t.name === toolName)!
      expect((tool.parameters as any).properties.basicAuth).toBeDefined()
      expect(secretNames(secretRequestForTool(toolName, params()))).toEqual([name])
    }
    await allowKeyRecipient({ address: origin, keyId })
    const tool = createAgentTools().find((t) => t.name === 'fetch')!
    await expect(
      tool.execute('sample-conflict', { ...params(), headers: { authorization: 'fake-header' } })
    ).rejects.toThrow()
    await expect(
      tool.execute('sample-colon', {
        ...params(),
        basicAuth: { username: 'wrong:user', password: '${abele_key:Console password}' },
      })
    ).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
