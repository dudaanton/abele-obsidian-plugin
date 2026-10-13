import { afterEach, expect, it } from 'vitest'
import { openBasePicker } from '../e2e/helpers/githubBasePicker'
import { BASE_SHA } from '../e2e/helpers/fakeGithubRepo'

const run = new Function(
  'openTab',
  'loaded',
  'until',
  `return (async () => {${openBasePicker('https://example.test/sample/repo')}})()`
)
afterEach(() => document.body.replaceChildren())

it('opens comparison from the named glyph without button text', async () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<button aria-label="Compare against a branch, tag or commit…"><span></span></button>'
  document.body.append(root)
  root.querySelector('button')!.onclick = () => {
    const prompt = document.createElement('div')
    prompt.className = 'abele-github-base-picker'
    prompt.innerHTML = '<input><div class="suggestion-note"></div>'
    prompt.querySelector('.suggestion-note')!.textContent = BASE_SHA
    document.body.append(prompt)
  }
  await run(
    async () => ({ view: { containerEl: root } }),
    () => true,
    async (probe: () => unknown) => probe()
  )
  expect(document.querySelector('.abele-github-base-picker input')).not.toBeNull()
})

it('fails when comparison is unavailable rather than skipping its geometry', async () => {
  const root = document.createElement('div')
  await expect(
    run(
      async () => ({ view: { containerEl: root } }),
      () => true,
      async (probe: () => unknown) => probe()
    )
  ).rejects.toThrow('No comparison base action')
})
