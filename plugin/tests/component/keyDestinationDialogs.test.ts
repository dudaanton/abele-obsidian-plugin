import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { openDialog } from '@/components/obsidian/dialogs'
import KeyDestinationsModal from '@/components/settings/KeyDestinationsModal.vue'
import SavedKeyRequestModal from '@/components/settings/SavedKeyRequestModal.vue'

const state = vi.hoisted(() => ({
  secrets: [] as { name: string; keyId: string; allowedOrigins?: string[] }[],
  allow: vi.fn(async (_request: unknown, _signal: AbortSignal) => {}),
}))

vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: {} }) },
}))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: { getInstance: () => ({ ai: { secrets: state.secrets } }) },
}))
vi.mock('@/secrets/destinations', () => ({
  pendingDestinations: () => [],
  destinationAccepted: () => true,
  acceptDestinations: () => {},
  forgetDestination: () => {},
}))
vi.mock('@/secrets/keyTransport', () => ({
  checkKeyTransport: () => {},
  canAllowHttp: (origin: string) => origin.startsWith('http://192.168.'),
  allowedHttpOrigins: () => [],
  allowHttpOrigin: () => {},
  forgetHttpOrigin: () => {},
}))
vi.mock('@/secrets/manualConsent', () => ({
  recipientKeys: () => [{ id: 'sample-key-id', name: 'Sample key' }],
  recipientOrigin: (address: string) => new URL(address).origin,
  allowKeyRecipient: (request: unknown, signal: AbortSignal) => state.allow(request, signal),
  removeKeyRecipient: async () => {},
  keyConsentError: () => 'Could not save key permission',
}))

const buttons = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button')]
const modal = () => document.querySelector<HTMLElement>('.modal.abele-modal')!
const footer = () => modal().querySelector<HTMLElement>('.abele-modal__footer')!
const button = (text: string) => buttons(modal()).find((b) => b.textContent === text)!
const type = async (label: string, value: string) => {
  const el = modal().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await nextTick()
}
const pick = async (value: string) => {
  const el = modal().querySelector<HTMLSelectElement>('select[aria-label="Saved key"]')!
  el.value = value
  el.dispatchEvent(new Event('change'))
  await nextTick()
}

beforeEach(() => {
  state.secrets = []
  state.allow.mockClear()
})
afterEach(() => document.body.replaceChildren())

describe('KeyDestinationsModal', () => {
  it('opens at once with the form in order and hands its shell to the opener', async () => {
    const opened = vi.fn()
    const controller = new AbortController()
    const closed = openDialog(
      KeyDestinationsModal,
      { onOpened: opened },
      { signal: controller.signal }
    )
    expect(opened).toHaveBeenCalledWith(modal())
    expect(modal().classList.contains('abele-key-destinations')).toBe(true)
    const body = modal().querySelector('.abele-modal__body')!
    expect(body.querySelector('p')!.textContent).toContain('Choose a key and recipient.')
    expect(body.querySelector('[role="status"]')!.textContent).toBe('')
    expect(
      [...body.querySelectorAll('.setting-item-name')].map((name) => name.textContent)
    ).toEqual(['Saved key', 'Recipient address'])
    expect(
      [...body.querySelectorAll<HTMLOptionElement>('select option')].map((o) => o.textContent)
    ).toEqual(['Choose a key', 'Sample key', 'Save a new named key…'])
    expect(buttons(footer()).map((b) => b.textContent)).toEqual(['Allow key and address'])
    expect(footer().querySelector('.mod-cta')).not.toBeNull()
    expect(button('Allow key and address').disabled).toBe(true)
    expect(footer().querySelector('p')!.textContent).toBe(
      'Choose a saved key and enter the recipient address.'
    )
    controller.abort()
    await expect(closed).resolves.toBeUndefined()
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('asks for a new key name and a masked value, enabling Allow only when all are given', async () => {
    void openDialog(KeyDestinationsModal)
    await pick('new')
    const value = modal().querySelector<HTMLInputElement>('input[aria-label="New key value"]')!
    expect(value.type).toBe('password')
    expect(value.autocomplete).toBe('new-password')
    await type('Recipient address', 'http://192.168.42.12:8123/status')
    await type('New key name', 'Sample new key')
    expect(button('Allow key and address').disabled).toBe(true)
    await type('New key value', 'fake-new-key')
    expect(button('Allow key and address').disabled).toBe(false)
    expect(footer().querySelector('p')!.textContent).toBe(
      'Sample new key → http://192.168.42.12:8123 — Unencrypted: anyone on the network path can read the key. Save this new key in protected storage.'
    )
    button('Allow key and address').click()
    expect(state.allow).toHaveBeenCalledWith(
      {
        address: 'http://192.168.42.12:8123/status',
        newKey: { name: 'Sample new key', value: 'fake-new-key' },
      },
      expect.any(AbortSignal)
    )
    await nextTick()
    expect(value.value).toBe('')
  })

  it('fills the address a picked key is already allowed for, and reports the save', async () => {
    state.secrets = [
      {
        name: 'Sample key',
        keyId: 'sample-key-id',
        allowedOrigins: ['https://api.sample.example'],
      },
    ]
    void openDialog(KeyDestinationsModal)
    await pick('sample-key-id')
    expect(
      modal().querySelector<HTMLInputElement>('input[aria-label="Recipient address"]')!.value
    ).toBe('https://api.sample.example')
    const row = modal().querySelector('[data-key-destination]')!
    expect(buttons(row).map((b) => b.textContent)).toEqual(['Remove key permission'])
    button('Allow key and address').click()
    await vi.waitFor(() =>
      expect(modal().querySelector('[role="status"]')!.textContent).toBe(
        'Allowed Sample key → https://api.sample.example. Retry the original script; nothing was sent automatically.'
      )
    )
  })

  it('stops a save still running when it closes', async () => {
    let signal: AbortSignal | undefined
    state.allow.mockImplementationOnce((_request, s) => {
      signal = s
      return new Promise(() => {})
    })
    const controller = new AbortController()
    void openDialog(KeyDestinationsModal, {}, { signal: controller.signal })
    await pick('sample-key-id')
    await type('Recipient address', 'https://api.sample.example')
    button('Allow key and address').click()
    controller.abort()
    expect(signal?.aborted).toBe(true)
  })
})

describe('SavedKeyRequestModal', () => {
  const props = (allow: () => Promise<void>) => ({
    names: ['Sample key', 'Other key'],
    origin: 'https://api.sample.example',
    missing: ['Other key'],
    allow,
  })

  it('names the keys and the address, and answers true once allowing has finished', async () => {
    const allow = vi.fn(async () => {})
    const answer = openDialog<boolean>(SavedKeyRequestModal, props(allow))
    const facts = modal().querySelector('dl.abele-key-request__facts')!
    expect([...facts.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Keys',
      'Sent to',
    ])
    expect([...facts.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
      'Sample key',
      'Other key',
      'https://api.sample.example',
    ])
    expect(modal().querySelector('.abele-key-request__note')!.textContent!.trim()).toBe(
      'The saved values go into the request; they are never shown here. Allowing remembers this address for Other key on this device, so it will not ask again here. Other devices will still ask.'
    )
    expect(modal().querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(true)
    expect(buttons(footer()).map((b) => b.textContent)).toEqual([
      'Cancel',
      'Allow address and send',
    ])
    expect(button('Allow address and send').classList.contains('mod-cta')).toBe(true)
    button('Allow address and send').click()
    await expect(answer).resolves.toBe(true)
    expect(allow).toHaveBeenCalledOnce()
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('says one key in the singular', () => {
    void openDialog(SavedKeyRequestModal, {
      ...props(async () => {}),
      names: ['Sample key'],
    })
    expect(modal().querySelector('dt')!.textContent).toBe('Key')
  })

  it('stays open with one failure line when allowing fails, and Cancel answers nothing', async () => {
    const allow = vi.fn(async () => {
      throw new Error('Sample failure')
    })
    const answer = openDialog<boolean>(SavedKeyRequestModal, props(allow))
    button('Allow address and send').click()
    await nextTick()
    expect(button('Allow address and send').disabled).toBe(true)
    await vi.waitFor(() =>
      expect(modal().querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(false)
    )
    expect(modal().querySelector('[role="alert"]')!.textContent).toBe(
      'Could not save this key permission, so nothing was sent. Check key destinations and try again.'
    )
    expect(button('Allow address and send').disabled).toBe(false)
    button('Cancel').click()
    await expect(answer).resolves.toBeUndefined()
  })
})
