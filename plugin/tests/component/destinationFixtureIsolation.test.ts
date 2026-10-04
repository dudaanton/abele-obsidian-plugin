import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { openDialog } from '@/testing/openDialog'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import { setSecrets } from '@/secrets/SecretStore'
import { deferred } from '../helpers/deferred'

const dialogs = vi.hoisted(() => ({ review: vi.fn(), request: vi.fn() }))
vi.mock('@/secrets/destinationReview', () => ({ reviewKeyDestinations: dialogs.review }))
vi.mock('@/secrets/requestApproval', () => ({ approveScriptKeyRequest: dialogs.request }))

const config = () => AbeleConfig.getInstance()
const localKeys = ['abele-key-destinations-v1', 'abele-key-http-origins-v1']
let snapshot: string
let ambientAi: ReturnType<typeof config>['ai']
let closeReview: () => void
let releaseRequest: ReturnType<typeof deferred>
const capture = () =>
  JSON.stringify({
    ai: config().ai,
    firefly: config().fireflyBaseUrl,
    calendars: config().calendars,
    local: localKeys.map((key) => GlobalStore.getInstance().app.loadLocalStorage(key)),
  })
const closeRequest = () => document.querySelector('.modal[data-sample="request"]')?.remove()

beforeEach(() => {
  setSecrets(null)
  const app = useVault([])
  config().applySettings(undefined)
  config().ai.secrets = [
    {
      name: 'Ambient sample key',
      keyId: 'ambient-sample-key',
      allowedOrigins: ['https://ambient.sample.example'],
    },
  ]
  config().ai.voice = {
    ...config().ai.voice,
    apiKeyId: 'ambient-voice-key',
    endpoint: 'https://voice.ambient.sample.example',
  }
  config().fireflyBaseUrl = 'https://ledger.ambient.sample.example'
  config().calendars.feeds = [
    {
      source: 'caldav',
      keyId: 'ambient-calendar-key',
      server: 'https://calendar.ambient.sample.example',
    } as never,
  ]
  app.saveLocalStorage(localKeys[0], { 'ambient-sample-key': ['https://ambient.sample.example'] })
  app.saveLocalStorage(localKeys[1], ['http://192.168.64.12:8123'])
  ambientAi = config().ai
  snapshot = capture()
  releaseRequest = deferred()
  dialogs.review.mockReset().mockImplementation(() => {
    const modal = document.body.createDiv({ cls: 'modal abele-modal' })
    let onClose = () => {}
    const fixture = {
      modalEl: modal,
      bodyEl: modal,
      get onClose() {
        return onClose
      },
      set onClose(value) {
        onClose = value
      },
    }
    // The new-key fixture uses the real form surface; model it without granting rights.
    modal.createEl('select')
    for (const label of ['Recipient address', 'New key name'])
      modal.createEl('input', { attr: { 'aria-label': label } })
    closeReview = () => {
      onClose()
      modal.remove()
    }
    return fixture
  })
  dialogs.request.mockReset().mockImplementation(() => {
    document.body.createDiv({ cls: 'modal abele-modal', attr: { 'data-sample': 'request' } })
    return releaseRequest.promise
  })
})
afterEach(async () => {
  releaseRequest.resolve()
  await flushPromises()
  if (document.querySelector('.modal:not([data-sample="request"])')) closeReview()
  await flushPromises()
  document.body.replaceChildren()
  setSecrets(null)
  vi.restoreAllMocks()
})

describe('development destination fixture ownership', () => {
  it.each(['key-destinations', 'key-destinations-new'])(
    'isolates %s from every ambient recipient source and restores exact state',
    async (name) => {
      const completion = openDialog(name)
      await flushPromises()
      expect(config().ai.secrets).toEqual([])
      expect(config().ai.imageProviders).toEqual([])
      expect(config().ai.mcpServers).toEqual([])
      expect(config().ai.braveSearchApiKey).toBe('')
      expect(config().ai.voice.apiKeyId).not.toBe('ambient-voice-key')
      expect(config().fireflyBaseUrl).toBe('')
      expect(config().calendars.feeds).toEqual([])
      expect(GlobalStore.getInstance().app.loadLocalStorage(localKeys[1])).toEqual([])
      expect(completion).toBeInstanceOf(Promise)
      closeReview()
      await completion
      expect(capture()).toBe(snapshot)
      expect(config().ai).toBe(ambientAi)
    }
  )

  it('awaits real request settlement before restoring and before opening the next fixture', async () => {
    const completion = openDialog('saved-key-request')
    await flushPromises()
    closeRequest()
    const next = openDialog('key-destinations')
    await flushPromises()
    expect(dialogs.review).not.toHaveBeenCalled()
    expect(completion).toBeInstanceOf(Promise)
    expect(config().ai.secrets.map((key) => key.name)).toEqual(['Sample key'])
    releaseRequest.resolve()
    await completion
    await flushPromises()
    expect(dialogs.review).toHaveBeenCalledTimes(1)
    expect(config().ai.secrets).toEqual([])
    closeReview()
    await next
    expect(capture()).toBe(snapshot)
  })

  it('restores exact state when opening the synthetic dialog fails', async () => {
    dialogs.review.mockImplementationOnce(() => {
      throw new Error('Sample fixture opening failure')
    })
    await expect(Promise.resolve(openDialog('key-destinations'))).rejects.toThrow(
      'Sample fixture opening failure'
    )
    expect(capture()).toBe(snapshot)
    const next = openDialog('key-destinations-new')
    await flushPromises()
    closeReview()
    await next
    expect(capture()).toBe(snapshot)
  })

  it('refuses an occupied synthetic slot without opening, changing or removing it', async () => {
    const app = GlobalStore.getInstance().app
    app.secretStorage!.setSecret('sample-request-key', 'fake-occupied-slot-value')
    await expect(Promise.resolve(openDialog('saved-key-request'))).rejects.toThrow(/occupied/i)
    expect(dialogs.request).not.toHaveBeenCalled()
    expect(capture()).toBe(snapshot)
    expect(app.secretStorage!.getSecret('sample-request-key')).toBe('fake-occupied-slot-value')
  })
})
