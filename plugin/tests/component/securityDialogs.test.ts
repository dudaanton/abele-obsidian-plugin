import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ButtonComponent, type TextComponent, type DropdownComponent } from 'obsidian'
import { reviewKeyDestinations } from '@/secrets/destinationReview'
import { approveScriptKeyRequest } from '@/secrets/requestApproval'

const state = vi.hoisted(() => ({
  pending: [] as { keyId: string; name: string; origin: string }[],
  exceptions: [] as string[],
  missing: ['Sample key'] as string[],
  accept: vi.fn(),
  allowHttp: vi.fn(),
  forgetHttp: vi.fn(),
  allowSecret: vi.fn(),
}))

vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: {} }) },
}))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: { getInstance: () => ({ ai: { secrets: [] } }) },
}))
vi.mock('@/secrets/destinations', () => ({
  pendingDestinations: () => state.pending,
  destinationAccepted: () => true,
  acceptDestinations: (destinations: typeof state.pending) => {
    state.accept(destinations)
    state.pending = state.pending.filter((d) => !destinations.includes(d))
  },
}))
vi.mock('@/secrets/keyTransport', () => ({
  checkKeyTransport: (origin: string) => {
    if (origin.startsWith('http:') && !state.exceptions.includes(origin))
      throw new Error('Unencrypted')
  },
  canAllowHttp: (origin: string) => origin.startsWith('http://192.168.'),
  allowedHttpOrigins: () => state.exceptions,
  allowHttpOrigin: (origin: string) => {
    state.allowHttp(origin)
    state.exceptions.push(origin)
  },
  forgetHttpOrigin: (origin: string) => {
    state.forgetHttp(origin)
    state.exceptions = state.exceptions.filter((value) => value !== origin)
  },
}))
vi.mock('@/secrets/manualConsent', () => ({
  recipientKeys: () => [],
  recipientOrigin: (address: string) => {
    if (!address) throw new Error('Empty')
    return new URL(address).origin
  },
  allowKeyRecipient: async () => {},
  removeKeyRecipient: async () => {},
  keyConsentError: () => 'Could not save key permission',
}))
vi.mock('@/ai/tools/secretUtils', () => ({
  snapshotSecretRequest: (request: unknown) => request,
  secretRequestInfo: () => ({
    names: ['Sample key'],
    bindings: [{ name: 'Sample key', keyId: 'sample-request-key' }],
    origin: 'https://api.sample.example',
    missing: state.missing,
  }),
  allowSecretRequestOrigins: async (
    _request: unknown,
    bindings: { name: string; keyId: string }[],
    signal: AbortSignal,
    _validate: unknown,
    committed: () => void
  ) => {
    for (const binding of bindings)
      state.allowSecret(binding.name, 'https://api.sample.example', signal)
    committed()
  },
}))
// Only Setting's text and button surface is needed here; Modal and the shared shell stay real.
vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('obsidian')>()
  return {
    ...api,
    Setting: class {
      private el: HTMLElement
      constructor(parent: HTMLElement) {
        this.el = parent.createDiv({ cls: 'setting-item' })
      }
      setName(text: string) {
        this.el.createEl('div', { cls: 'setting-item-name', text })
        return this
      }
      setDesc(text: string) {
        this.el.createEl('div', { text })
        return this
      }
      addText(build: (text: TextComponent) => void) {
        build(new api.SearchComponent(this.el) as unknown as TextComponent)
        return this
      }
      addDropdown(build: (dropdown: DropdownComponent) => void) {
        build(new api.DropdownComponent(this.el))
        return this
      }
      addButton(build: (button: ButtonComponent) => void) {
        build(new api.ButtonComponent(this.el))
        return this
      }
    },
  }
})

const request = {
  url: 'https://api.sample.example/data',
  headers: { Authorization: '${abele_key:Sample key}' },
}
const buttons = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button')]
const footer = () => document.querySelector<HTMLElement>('.abele-modal__footer')!
const click = (text: string) =>
  buttons(document.querySelector('.modal')!)
    .find((button) => button.textContent === text)!
    .click()

beforeEach(() => {
  vi.clearAllMocks()
  state.pending = [
    {
      keyId: 'sample-secure-key',
      name: 'Sample secure provider',
      origin: 'https://api.sample.example',
    },
    { keyId: 'sample-home-key', name: 'Sample home provider', origin: 'http://192.168.8.20:1234' },
    {
      keyId: 'sample-public-key',
      name: 'Sample public provider',
      origin: 'http://api.sample.example',
    },
  ]
  state.exceptions = []
  state.missing = ['Sample key']
})
afterEach(() => document.body.replaceChildren())

describe('security dialogs share the scrolling body and pinned actions', () => {
  it('reviews destinations without destroying the shell when an action renders again', () => {
    const modal = reviewKeyDestinations()
    try {
      expect(modal.modalEl.classList.contains('abele-modal')).toBe(true)
      const body = modal.modalEl.querySelector('.abele-modal__body')!
      const pinned = footer()
      expect(body.textContent).toContain('Sample secure provider')
      expect(body.textContent).toContain(
        'Public HTTP cannot receive keys. Change this address to HTTPS.'
      )
      expect(buttons(body).map((b) => b.textContent)).toEqual([
        'Allow on this device',
        'Allow unencrypted HTTP',
      ])
      expect(buttons(pinned).map((b) => b.textContent)).toEqual(['Allow key and address'])
      for (const label of ['Sample secure provider', 'Sample home provider']) {
        const row = [...body.querySelectorAll('.setting-item')].find((row) =>
          row.textContent?.includes(label)
        )!
        expect(row.querySelector('button')).not.toBeNull()
        expect(row.textContent).toContain(
          label === 'Sample secure provider'
            ? 'https://api.sample.example'
            : 'http://192.168.8.20:1234'
        )
      }
      const secure = state.pending[0]
      click('Allow on this device')
      expect(state.accept).toHaveBeenCalledWith([secure])
      expect(modal.modalEl.querySelector('.abele-modal__body')).toBe(body)
      expect(footer()).toBe(pinned)
      expect(buttons(pinned).map((b) => b.textContent)).toEqual(['Allow key and address'])
      expect(buttons(body).map((b) => b.textContent)).toEqual(['Allow unencrypted HTTP'])
      const home = state.pending[0]
      click('Allow unencrypted HTTP')
      expect(state.allowHttp).toHaveBeenCalledWith(home.origin)
      expect(state.accept).toHaveBeenLastCalledWith([home])
      expect(body.textContent).toContain('HTTP transport on this device')
      expect(buttons(pinned).map((b) => b.textContent)).toEqual(['Allow key and address'])
      expect(buttons(body).map((b) => b.textContent)).toEqual(['Remove HTTP exception'])
      click('Remove HTTP exception')
      expect(state.forgetHttp).toHaveBeenCalledWith(home.origin)
      expect(buttons(pinned).map((b) => b.textContent)).toEqual(['Allow key and address'])
    } finally {
      modal.close()
    }
  })

  it.each([true, false])(
    'pins the send action, adding an address only when missing: %s',
    async (missing) => {
      state.missing = missing ? ['Sample key'] : []
      const approval = approveScriptKeyRequest(request)
      if (!missing) {
        await approval
        expect(document.querySelector('.modal')).toBeNull()
        expect(state.allowSecret).not.toHaveBeenCalled()
        return
      }
      expect(document.querySelector('.modal.abele-modal')).not.toBeNull()
      expect(document.querySelector('.abele-modal__body')!.textContent).toContain(
        'Key values are never shown here.'
      )
      expect(buttons(document.querySelector('.abele-modal__body')!)).toEqual([])
      expect(buttons(footer()).map((b) => b.textContent)).toEqual([
        'Cancel',
        missing ? 'Allow address and send' : 'Send once',
      ])
      expect(footer().querySelector('.mod-cta')).not.toBeNull()
      click(missing ? 'Allow address and send' : 'Send once')
      await approval
      if (missing)
        expect(state.allowSecret).toHaveBeenCalledWith(
          'Sample key',
          'https://api.sample.example',
          expect.any(AbortSignal)
        )
      else expect(state.allowSecret).not.toHaveBeenCalled()
      expect(document.querySelector('.modal')).toBeNull()
    }
  )

  it('cancel rejects the request without changing the allowed list', async () => {
    const approval = approveScriptKeyRequest(request)
    const rejected = expect(approval).rejects.toThrow('Saved-key request was not approved')
    click('Cancel')
    await rejected
    expect(state.allowSecret).not.toHaveBeenCalled()
  })

  it('abort closes the shell, rejects the request and removes its listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const approval = approveScriptKeyRequest(request, controller.signal)
    const rejected = expect(approval).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(document.querySelector('.modal')).toBeNull()
    expect(state.allowSecret).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
