import { afterEach, expect, it, vi } from 'vitest'
import { SHARE_SET_PICKER } from '../e2e/helpers/shareSetPicker'

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.style.removeProperty('--keyboard-height')
})

it('recovers phone focus lost after typing instead of searching a missing inline list', async () => {
  const box = document.createElement('div'),
    picker = document.createElement('div')
  picker.className = 'abele-share-picker'
  picker.dataset.sharePickerMode = 'inline'
  const input = document.createElement('input'),
    results = document.createElement('div')
  results.className = 'abele-share-picker__results'
  const row = document.createElement('div')
  row.className = 'suggestion-item'
  row.dataset.shareKind = 'folder'
  row.dataset.sharePath = 'Sample'
  results.append(row)
  picker.append(input, results)
  box.append(picker)
  document.body.append(box)
  input.addEventListener('focus', () => {
    if (!results.isConnected) picker.append(results)
  })
  row.scrollIntoView = vi.fn()
  row.getBoundingClientRect = () => ({ top: 100, bottom: 150, height: 50 }) as DOMRect
  const click = vi.fn()
  row.addEventListener('click', click)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction(
    'box',
    'poll',
    'typeInto',
    SHARE_SET_PICKER + '\nawait pickShareItem(box,"Folder: Sample",false)'
  )(
    box,
    async (check: () => boolean, _: unknown, label: string) => {
      if (check()) return
      await Promise.resolve()
      if (!check()) throw new Error(label)
    },
    (field: HTMLInputElement, value: string) => {
      field.value = value
      field.blur()
      results.remove()
    }
  )
  expect(click).toHaveBeenCalledOnce()
})

it.each([true, false])(
  'scrolls the requested suggestion and keeps the keyboard visibility guarantee (scroll works=%s)',
  async (works) => {
    document.documentElement.style.setProperty('--keyboard-height', '300px')
    const box = document.createElement('div')
    box.className = 'modal-content'
    const picker = document.createElement('div'),
      results = document.createElement('div')
    picker.className = 'abele-share-picker'
    const kindTab = document.createElement('button')
    kindTab.dataset.scopeKind = 'folder'
    const selectKind = vi.fn()
    kindTab.addEventListener('click', selectKind)
    picker.append(kindTab)
    results.className = 'abele-share-picker__results'
    const option = document.createElement('div')
    option.className = 'suggestion-item'
    option.dataset.shareKind = 'folder'
    option.dataset.sharePath = 'Sample'
    option.textContent = 'Sample'
    results.append(option)
    picker.append(document.createElement('input'), results)
    box.append(picker)
    document.body.append(box)
    const row = box.querySelector<HTMLElement>('.suggestion-item')!
    let above = false
    row.getBoundingClientRect = () =>
      ({ top: above ? 100 : 600, bottom: above ? 150 : 650, height: 50 }) as DOMRect
    row.scrollIntoView = vi.fn(() => {
      above = works
    })
    const click = vi.fn()
    row.addEventListener('click', click)
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const run = new AsyncFunction(
      'box',
      'poll',
      'typeInto',
      SHARE_SET_PICKER + '\nawait pickShareItem(box, "Folder: Sample", false)'
    )
    const pending = run(
      box,
      async (check: () => boolean, _: unknown, label: string) => {
        if (!check()) throw new Error(label)
      },
      (input: HTMLInputElement, value: string) => {
        input.value = value
      }
    )
    if (works) {
      await pending
      expect(row.scrollIntoView).toHaveBeenCalled()
      expect(click).toHaveBeenCalledOnce()
      expect(selectKind).toHaveBeenCalledOnce()
    } else {
      await expect(pending).rejects.toThrow('suggestion fully above keyboard')
      expect(click).not.toHaveBeenCalled()
    }
  }
)
