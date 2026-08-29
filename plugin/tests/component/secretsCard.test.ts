/**
 * The card a secret is edited in.
 *
 * A secret has no visible value, so the only thing that says "it is stored" is the card
 * closing and the masked value coming back. Save that leaves the card open, and a close
 * button that closes nothing, both leave the person guessing — which is what happened: both
 * clicks bubbled into the card behind them and it read them as "open me". jsdom does not run
 * the microtask checkpoint a real browser runs between two listeners of one click, so the
 * card there was still marked unclickable and the tests saw nothing. What is asserted instead
 * is the thing that holds either way: a click inside the open editor never reaches the card.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp

const STUBS = { Search: true, Dropdown: true, Checkbox: true }

const open = () => mount(GeneralSettings, { global: { stubs: STUBS } })
type Screen = ReturnType<typeof open>

/** The card holding the named secret. */
const cardFor = (wrapper: Screen, name: string) =>
  wrapper.findAll('.abele-card').find((c) => c.find('.abele-card__name').text() === name)

const editorIn = (wrapper: Screen, name: string) =>
  cardFor(wrapper, name)?.find('.abele-ai-secret__editor')

const isOpen = (wrapper: Screen, name: string) => editorIn(wrapper, name)?.exists() === true

const valueField = (wrapper: Screen, name: string) =>
  cardFor(wrapper, name)?.find('input[type="password"]')

const buttonIn = (wrapper: Screen, name: string, text: string) =>
  cardFor(wrapper, name)
    ?.findAll('button')
    .find((b) => b.text() === text)

const iconIn = (wrapper: Screen, name: string, tooltip: string) =>
  cardFor(wrapper, name)
    ?.findAll('.abele-obsidian-icon')
    .find((i) => i.attributes('aria-label')?.startsWith(tooltip))

/** Types into the open editor. */
const type = async (wrapper: Screen, name: string, value: string) => {
  await valueField(wrapper, name)?.setValue(value)
}

beforeEach(() => {
  app = useVault([])
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    secrets: [{ name: 'Firefly', keyId: 'abele-secret-firefly' }],
  } as AiSettings
  app.secretStorage.setSecret('abele-secret-firefly', 'old-value')
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

describe('the open editor', () => {
  /**
   * The card underneath opens on click, and stops being clickable while it is open — but a
   * prop only stops being true after Vue re-renders, and the browser gives it the chance to
   * mid-click. So the editor swallows the click rather than relying on that race.
   */
  it('keeps its clicks to itself, so the card cannot reopen behind them', async () => {
    const wrapper = open()
    await cardFor(wrapper, 'Firefly')?.trigger('click')

    const reachedCard = vi.fn()
    cardFor(wrapper, 'Firefly')?.element.addEventListener('click', reachedCard)
    await buttonIn(wrapper, 'Firefly', 'Save')?.trigger('click')

    expect(reachedCard).not.toHaveBeenCalled()
  })
})

describe('saving a secret', () => {
  it('puts the value in the keychain', async () => {
    const wrapper = open()
    await cardFor(wrapper, 'Firefly')?.trigger('click')
    await type(wrapper, 'Firefly', 'new-value')

    await buttonIn(wrapper, 'Firefly', 'Save')?.trigger('click')

    expect(app.secretStorage.getSecret('abele-secret-firefly')).toBe('new-value')
  })

  it('closes the card and shows the value back, masked', async () => {
    const wrapper = open()
    await cardFor(wrapper, 'Firefly')?.trigger('click')
    await type(wrapper, 'Firefly', 'new-value')

    await buttonIn(wrapper, 'Firefly', 'Save')?.trigger('click')

    expect(isOpen(wrapper, 'Firefly')).toBe(false)
    expect(cardFor(wrapper, 'Firefly')?.find('.abele-card__subtitle').text()).toBe('new-••••alue')
  })
})

describe('cancelling', () => {
  const cancel = (wrapper: Screen, name: string) => iconIn(wrapper, name, 'Cancel')?.trigger('click')

  it('closes the card', async () => {
    const wrapper = open()
    await cardFor(wrapper, 'Firefly')?.trigger('click')
    await type(wrapper, 'Firefly', 'typed-but-not-saved')

    await cancel(wrapper, 'Firefly')

    expect(isOpen(wrapper, 'Firefly')).toBe(false)
  })

  it('leaves the stored value alone', async () => {
    const wrapper = open()
    await cardFor(wrapper, 'Firefly')?.trigger('click')
    await type(wrapper, 'Firefly', 'typed-but-not-saved')

    await cancel(wrapper, 'Firefly')

    expect(app.secretStorage.getSecret('abele-secret-firefly')).toBe('old-value')
  })

  it('forgets what was typed rather than offering it again next time', async () => {
    const wrapper = open()
    await cardFor(wrapper, 'Firefly')?.trigger('click')
    await type(wrapper, 'Firefly', 'typed-but-not-saved')
    await cancel(wrapper, 'Firefly')

    await cardFor(wrapper, 'Firefly')?.trigger('click')

    expect((valueField(wrapper, 'Firefly')?.element as HTMLInputElement).value).toBe('old-value')
  })

  it('puts back the name that was there before', async () => {
    const wrapper = open()
    await cardFor(wrapper, 'Firefly')?.trigger('click')
    await cardFor(wrapper, 'Firefly')?.find('input[type="text"]').setValue('Renamed')
    expect(cardFor(wrapper, 'Renamed')).toBeTruthy()

    await cancel(wrapper, 'Renamed')

    expect(cardFor(wrapper, 'Firefly')).toBeTruthy()
  })

  /** Nothing was ever stored for it, so an empty row is all that cancelling would leave. */
  it('takes a newly added secret away with it', async () => {
    const wrapper = open()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Add secret')
      ?.trigger('click')
    expect(cardFor(wrapper, '(unnamed)')).toBeTruthy()

    await cancel(wrapper, '(unnamed)')

    expect(cardFor(wrapper, '(unnamed)')).toBeFalsy()
  })

  it('keeps a secret that was added and then saved', async () => {
    const wrapper = open()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Add secret')
      ?.trigger('click')
    await cardFor(wrapper, '(unnamed)')?.find('input[type="text"]').setValue('Weather')
    await type(wrapper, 'Weather', 'wk-1234')
    await buttonIn(wrapper, 'Weather', 'Save')?.trigger('click')

    await cardFor(wrapper, 'Weather')?.trigger('click')
    await cancel(wrapper, 'Weather')

    expect(cardFor(wrapper, 'Weather')).toBeTruthy()
  })
})
