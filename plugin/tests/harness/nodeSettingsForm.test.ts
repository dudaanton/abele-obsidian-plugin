import { afterEach, expect, it } from 'vitest'
import { OPEN_LOCAL_NODE_FORM, CLOSE_LOCAL_NODE_FORM } from '../e2e/helpers/nodeSettingsForm'
import { readFileSync } from 'node:fs'

const run = new Function(
  'settingsRoot',
  'until',
  `return (async () => {${OPEN_LOCAL_NODE_FORM}; return nodeForm})()`
)
afterEach(() => document.body.replaceChildren())

it('opens the form in both geometry probes before looking for its fields', () => {
  for (const name of ['dialogRings', 'phoneLayout']) {
    const source = readFileSync(`tests/e2e/${name}.e2e.test.ts`, 'utf8')
    expect(source).toContain('${OPEN_LOCAL_NODE_FORM}')
    expect(source).toContain('${CLOSE_LOCAL_NODE_FORM}')
  }
})

it('closes only the child form and keeps the settings dialog mounted', async () => {
  const settings = document.createElement('div')
  settings.className = 'modal'
  const form = document.createElement('div')
  form.className = 'modal'
  form.innerHTML = '<button aria-label="Close this and add nothing">Cancel</button>'
  form.querySelector('button')!.onclick = () => form.remove()
  document.body.append(settings, form)
  const close = new Function(
    'nodeForm',
    'until',
    `return (async () => {${CLOSE_LOCAL_NODE_FORM}})()`
  )
  await close(form, async (probe: () => unknown) => probe())
  expect(form.isConnected).toBe(false)
  expect(settings.isConnected).toBe(true)
})

it('opens the local node dialog from its settings action and returns its field container', async () => {
  const settings = document.createElement('div')
  settings.innerHTML = '<button aria-label="Name the node here and paste its token">Add</button>'
  document.body.append(settings)
  settings.querySelector('button')!.onclick = () => {
    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.innerHTML = '<input aria-label="Node URL">'
    document.body.append(modal)
  }
  const form = await run(settings, async (probe: () => unknown) => probe())
  expect(form).toBe(document.querySelector('.modal'))
  expect(form.querySelector('input[aria-label="Node URL"]')).not.toBeNull()
})

it('does not silently skip fields when the dialog fails to open', async () => {
  const settings = document.createElement('div')
  settings.innerHTML = '<button aria-label="Name the node here and paste its token">Add</button>'
  await expect(run(settings, async (probe: () => unknown) => probe())).rejects.toThrow(
    'Local node fields did not open'
  )
})
