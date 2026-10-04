import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ButtonComponent, DropdownComponent, TextComponent } from 'obsidian'
import { reviewKeyDestinations } from '@/secrets/destinationReview'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { allowedHttpOrigins } from '@/secrets/keyTransport'
import { initializeDestinations } from '@/secrets/destinations'
import { secrets, setSecrets } from '@/secrets/SecretStore'

vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('obsidian')>()
  class Text extends api.SearchComponent {
    constructor(el: HTMLElement) {
      super(el)
      this.inputEl.type = 'text'
    }
  }
  return {
    ...api,
    TextComponent: Text,
    Setting: class {
      private el: HTMLElement
      readonly controlEl: HTMLElement
      constructor(parent: HTMLElement) {
        this.el = parent.createDiv({ cls: 'setting-item' })
        this.controlEl = this.el.createDiv({ cls: 'setting-item-control' })
      }
      setName(text: string) {
        this.el.createDiv({ cls: 'setting-item-name', text })
        return this
      }
      setDesc(text: string) {
        this.el.createDiv({ text })
        return this
      }
      addButton(build: (button: ButtonComponent) => void) {
        build(new api.ButtonComponent(this.controlEl))
        return this
      }
      addText(build: (text: TextComponent) => void) {
        build(new Text(this.controlEl) as unknown as TextComponent)
        return this
      }
      addDropdown(build: (dropdown: DropdownComponent) => void) {
        build(new api.DropdownComponent(this.controlEl))
        return this
      }
    },
  }
})
const config = () => AbeleConfig.getInstance()
const input = (root: HTMLElement, label: string, value: string) => {
  const el = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  el.value = value
  el.dispatchEvent(new Event('input'))
}
const selectNew = (root: HTMLElement) => {
  const el = root.querySelector('select')!
  el.value = 'new'
  el.dispatchEvent(new Event('change'))
}
const approve = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Allow key and address')!

beforeEach(() => {
  setSecrets(null)
  useVault([])
  config().ai = { ...DEFAULT_AI_SETTINGS, providers: [], secrets: [] }
  vi.spyOn(config(), 'saveSettings').mockResolvedValue()
  initializeDestinations(config())
})
afterEach(() => {
  document.body.replaceChildren()
  setSecrets(null)
  vi.restoreAllMocks()
})

describe('manual recipient form in an empty review', () => {
  it('offers native address and explicit protected-key creation with no pending destinations', async () => {
    const modal = reviewKeyDestinations()
    try {
      expect(modal.bodyEl.querySelector('input[aria-label="Recipient address"]')).not.toBeNull()
      expect(modal.bodyEl.querySelector('select')).not.toBeNull()
      input(modal.bodyEl, 'Recipient address', 'http://192.168.42.12:8123/status')
      selectNew(modal.bodyEl)
      input(modal.bodyEl, 'New key name', 'Sample created')
      input(modal.bodyEl, 'New key value', 'fake-created-key')
      expect(
        modal.bodyEl.querySelector<HTMLInputElement>('input[aria-label="New key value"]')!.type
      ).toBe('password')
      expect(modal.footerEl!.textContent).toContain('Sample created')
      expect(modal.footerEl!.textContent).toContain('http://192.168.42.12:8123')
      expect(modal.footerEl!.textContent).toMatch(/Unencrypted/)
      expect(modal.modalEl.textContent).not.toContain('fake-created-key')
      approve(modal.modalEl).click()
      await vi.waitFor(() => expect(allowedHttpOrigins()).toEqual(['http://192.168.42.12:8123']))
      const key = config().ai.secrets[0]
      expect(secrets().get(key.keyId)).toBe('fake-created-key')
      expect(modal.bodyEl.textContent).toMatch(/Retry/)
      const pair = modal.bodyEl.querySelector('[data-key-destination]')!
      expect(pair.textContent).toContain('Sample created')
      expect(pair.textContent).toContain('http://192.168.42.12:8123')
      expect(modal.bodyEl.querySelector<HTMLSelectElement>('select')!.value).toBe(key.keyId)
    } finally {
      modal.close()
    }
  })
  it('warns beside the imported named HTTP permission action with a reopened blank form', async () => {
    const origin = 'http://192.168.84.26:8197'
    secrets().set('sample-imported-password', 'fake-imported-password')
    config().ai.secrets = [
      { name: 'Imported sample', keyId: 'sample-imported-password', allowedOrigins: [origin] },
    ]
    const modal = reviewKeyDestinations()
    try {
      expect(
        modal.bodyEl.querySelector<HTMLInputElement>('input[aria-label="Recipient address"]')!.value
      ).toBe('')
      expect(modal.bodyEl.querySelector<HTMLSelectElement>('select')!.value).toBe('')
      const row = modal.bodyEl.querySelector('[data-key-destination]')!
      expect(row.textContent).toContain(origin)
      expect(row.textContent).toContain('Unencrypted: anyone on the network path can read the key.')
      const allow = [...row.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === 'Allow unencrypted HTTP'
      )!
      expect(allow).toBeDefined()
      expect(row.querySelector<HTMLElement>('.setting-item-control')!.style.flexWrap).toBe('wrap')
      expect(allowedHttpOrigins()).toEqual([])
      allow.click()
      await vi.waitFor(() => expect(allowedHttpOrigins()).toEqual([origin]))
    } finally {
      modal.close()
    }
  })
  it('close without approving never writes a key or permission', () => {
    const modal = reviewKeyDestinations()
    selectNew(modal.bodyEl)
    input(modal.bodyEl, 'New key name', 'Cancelled sample')
    input(modal.bodyEl, 'New key value', 'fake-cancelled-key')
    modal.close()
    expect(config().ai.secrets).toEqual([])
    expect(config().saveSettings).not.toHaveBeenCalled()
    expect(allowedHttpOrigins()).toEqual([])
  })
  it('reports a generic failure without key material and retains no grant', async () => {
    vi.mocked(config().saveSettings).mockRejectedValueOnce(new Error('fake-sensitive-error'))
    const modal = reviewKeyDestinations()
    try {
      selectNew(modal.bodyEl)
      input(modal.bodyEl, 'Recipient address', 'http://192.168.42.12:8123')
      input(modal.bodyEl, 'New key name', 'Failed sample')
      input(modal.bodyEl, 'New key value', 'fake-failed-key')
      approve(modal.modalEl).click()
      await vi.waitFor(() => expect(modal.bodyEl.textContent).toContain('Could not save'))
      expect(modal.modalEl.textContent).not.toMatch(/fake-sensitive-error|fake-failed-key/)
      expect(allowedHttpOrigins()).toEqual([])
      expect(config().ai.secrets).toEqual([])
    } finally {
      modal.close()
    }
  })
})
