import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import Button from '@/components/obsidian/Button.vue'
import { ChatService } from '@/ai/ChatService'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { SecretStore, setSecrets, secrets } from '@/secrets/SecretStore'
import { pluginStoreHost } from '@/secrets/host'
import { allowKeyRecipient, removeKeyRecipient } from '@/secrets/manualConsent'
import { allowedHttpOrigins } from '@/secrets/keyTransport'
import { initializeDestinations, checkRequestDestinations } from '@/secrets/destinations'
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
let send: ReturnType<typeof vi.fn>
const config = () => AbeleConfig.getInstance()
const ctx = () => buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })

beforeEach(async () => {
  const app = useVault([])
  failWrite = false
  config().applySettings(undefined)
  config().ai.providers = []
  config().ai.secrets = [{ name, keyId }]
  disk = JSON.stringify(config().exportSettings())
  const plugin = {
    app,
    manifest: { dir: '.obsidian/plugins/abele' },
    loadData: async () => JSON.parse(disk),
    saveData: async (data: AbeleSettings) => {
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
