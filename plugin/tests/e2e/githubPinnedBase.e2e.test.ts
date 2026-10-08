import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  enableGithub,
  evalAsync,
  PRELUDE,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { BASE_SHA, HEAD_SHA } from './helpers/fakeGithubRepo'
import { openBasePicker, basePickerGeometry } from './helpers/githubBasePicker'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi(),
  SHOTS = shotDir('abele-phone')

describe.skipIf(!available)('exact pinned-base GitHub links', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub({ mode: 'pinned' })
    enableGithub(gh.origin, false)
  }, 60000)
  afterAll(() => {
    if (!available) return
    try {
      evalAsync(`(async () => {
        ${PRELUDE}
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
        for (const leaf of githubLeaves()) [...leaf.view.containerEl.querySelectorAll('button')].find(b => b.textContent === 'Unpin')?.click()
        return { ok: true }
      })()`)
    } finally {
      try {
        restoreGithub()
      } finally {
        gh?.stop()
      }
    }
  })

  it('shows the full resolved commit in the native base picker before confirmation', () => {
    const result = evalAsync<{
      sha: string
      clipped: string[]
      over: string[]
      shot: string
    }>(`(async () => {
      ${PRELUDE}
      ${openBasePicker(gh.web)}
      ${basePickerGeometry}
      const shot = ${JSON.stringify(`${SHOTS}/github-pinned-picker.png`)}
      if (window.__e2eHost) pickerReport.shot = await window.__e2eHost.shot(shot)
      else { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(shot, image.toPNG()); pickerReport.shot = shot }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      await until(() => !document.querySelector('.abele-github-base-picker'), 3000)
      leaf.detach()
      return pickerReport
    })()`)
    expect(result.sha).toContain(BASE_SHA)
    expect(result.clipped).toEqual([])
    expect(result.over).toEqual([])
    expect(result.shot).toMatch(/\.png$/)
  }, 90000)

  it('pins a resolved SHA, follows target context, and agrees across both project modes', async () => {
    const result = evalAsync<{
      error?: string
      target?: string
      base?: string
      line?: string
      all?: string[]
      changed?: string[]
      removedUrl?: string
      removedTarget?: string
      over?: string[]
      shot?: string
    }>(
      `(async () => {
      ${PRELUDE}
      try {
        ${openBasePicker(gh.web)}
        prompt.querySelector('.suggestion-item').click()
        if (!(await until(() => root.querySelector('.abele-github-pinned .cm-editor'), 20000))) throw Error('No pinned diff')
        await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(`${gh.web}/blob/${HEAD_SHA}/src/long.ts#L399`)} }, active: true })
        if (!(await until(() => [...root.querySelectorAll('.abele-github-code__line_target')].some(l => l.textContent.includes('setting399')), 20000))) throw Error('Linked unchanged context did not show')
        const report = { base: leaf.view.model.screen.comparison.baseSha, target: leaf.view.model.screen.comparison.targetSha, line: root.querySelector('.abele-github-code__line_target').textContent }
        root.querySelector('[aria-label="Toggle the file tree"]')?.click()
        if (!root.querySelector('.abele-github-tree')) {
          root.querySelector('.abele-github-header__actions .lucide-folder-tree')?.closest('.abele-obsidian-icon')?.click()
        }
        if (!(await until(() => root.querySelector('.abele-github-tree [data-path="src/old.ts"]'), 20000))) throw Error('No deleted project entry')
        const paths = () => [...root.querySelectorAll('.abele-github-tree .tree-item-self')].map(r => r.dataset.path)
        report.all = paths()
        ;[...root.querySelectorAll('.abele-github-tree .abele-tabs__tab')].find(t => t.textContent.trim() === 'Changed files').click()
        await wait(300)
        report.changed = paths()
        // Side-opening preserves the exact target, including for a path absent on that side.
        root.querySelector('.abele-github-tree [data-path="src/old.ts"]').click()
        if (!(await until(() => leaf.view.model.url.endsWith('/src/old.ts') && root.querySelector('.abele-github-pinned[data-path="src/old.ts"]') && leaf.view.model.screen.comparison?.targetSha === ${JSON.stringify(HEAD_SHA)}, 20000))) throw Error('Deleted file did not open')
        report.removedUrl = leaf.view.model.url
        report.removedTarget = leaf.view.model.screen.comparison.targetSha
        const content = root.querySelector('.abele-github-layout__main')
        report.over = [...content.querySelectorAll('.abele-github-base > *, .abele-github-pinned > *')].filter(el => el.getBoundingClientRect().right > content.getBoundingClientRect().right + 1).map(el => el.className)
        const shot = ${JSON.stringify(`${SHOTS}/github-pinned-project.png`)}
        if (window.__e2eHost) report.shot = await window.__e2eHost.shot(shot)
        else { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(shot, image.toPNG()); report.shot = shot }
        return report
      } catch (error) { return { error: String(error.message || error) } }
    })()`,
      90000
    )
    expect(result.error).toBeUndefined()
    expect(result.base).toBe(BASE_SHA)
    expect(result.target).toBe(HEAD_SHA)
    expect(result.line).toContain('setting399')
    expect(result.all).toContain('src/README.md')
    expect(result.changed).not.toContain('src/README.md')
    expect(result.changed).toContain('src/old.ts')
    expect(result.removedTarget).toBe(HEAD_SHA)
    expect(result.removedUrl).toBe(`${gh.web}/blob/${HEAD_SHA}/src/old.ts`)
    expect(result.over).toEqual([])
    expect(result.shot).toMatch(/\.png$/)
  }, 120000)

  it('keeps replacement entries distinct in the drawer and opens removed and renamed paths at the same target', () => {
    const result = evalAsync<{
      error?: string
      all?: number
      changed?: number
      target?: string
      renamed?: string
      survivingLabel?: string
      folderAction?: boolean
      modifiedUrl?: string
      over?: string[]
      shot?: string
    }>(
      `(async () => {
      ${PRELUDE}
      try {
        ${openBasePicker(gh.web)}
        prompt.querySelector('.suggestion-item').click()
        await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(gh.web)} }, active: true })
        if (!(await until(() => root.querySelector('.abele-github-home'), 20000))) throw Error('No project page')
        if (!root.querySelector('.abele-github-tree')) root.querySelector('.abele-github-header__actions .lucide-folder-tree').closest('.abele-obsidian-icon').click()
        const replacements = () => root.querySelectorAll('.abele-github-tree [data-path="sample-replacement"]')
        if (!(await until(() => replacements().length === 2, 20000))) throw Error('Replacement entries were lost')
        const report = { all: replacements().length }
        const panel = root.querySelector('.abele-github-tree')
        ;[...panel.querySelectorAll('.abele-tabs__tab')].find(t => t.textContent.trim() === 'Changed files').click()
        await until(() => replacements().length === 2)
        report.changed = replacements().length
        const surviving = panel.querySelector('[data-path="surviving"]')
        report.survivingLabel = surviving?.textContent
        report.folderAction = !!surviving?.querySelector('.abele-github-tree__open-folder')
        panel.querySelector('[data-path="sample-replacement"][aria-expanded]').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true }))
        if (!(await until(() => panel.querySelector('[data-path="sample-replacement/old.ts"]'), 5000))) throw Error('The removed folder modifier click did not expand its own entries')
        report.modifiedUrl = leaf.view.model.url
        report.over = [...panel.querySelectorAll('.tree-item-self')].filter(el => el.getBoundingClientRect().right > panel.getBoundingClientRect().right + 1).map(el => el.dataset.path)
        const shot = ${JSON.stringify(`${SHOTS}/github-pinned-replacements.png`)}
        if (window.__e2eHost) report.shot = await window.__e2eHost.shot(shot)
        else { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(shot, image.toPNG()); report.shot = shot }
        panel.querySelector('[data-path="sample-directory"]:not([aria-expanded])').click()
        if (!(await until(() => root.querySelector('.abele-github-pinned[data-path="sample-directory"]') && leaf.view.model.screen.comparison, 20000))) throw Error('The removed file was interpreted as a target folder')
        report.target = leaf.view.model.screen.comparison.targetSha
        await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(`${gh.web}/blob/${HEAD_SHA}/renamed-old.ts`)} }, active: true })
        if (!(await until(() => root.querySelector('.abele-github-pinned[data-path="renamed-new.ts"]'), 20000))) throw Error('The old rename path did not open')
        report.renamed = root.querySelector('.abele-github-pinned .abele-github-file__head').textContent
        return report
      } catch (error) { return { error: String(error.message || error) } }
    })()`,
      90000
    )
    expect(result.error).toBeUndefined()
    expect(result.all).toBe(2)
    expect(result.changed).toBe(2)
    expect(result.target).toBe(HEAD_SHA)
    expect(result.renamed).toContain('renamed-old.ts → renamed-new.ts')
    expect(result.survivingLabel).not.toContain('removed folder')
    expect(result.folderAction).toBe(true)
    expect(result.modifiedUrl).toBe(gh.web)
    expect(result.over).toEqual([])
    expect(result.shot).toMatch(/\.png$/)
  }, 120000)

  it('computes a larger full-file diff in the bundled worker and preserves original/unpin exits', () => {
    const result = evalAsync<{
      error?: string
      stats?: string
      original?: boolean
      restored?: boolean
    }>(
      `(async () => {
      ${PRELUDE}
      try {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
        ${openBasePicker(gh.web)}
        prompt.querySelector('.suggestion-item').click()
        await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(`${gh.web}/blob/${HEAD_SHA}/src/worker.ts#L2999`)} }, active: true })
        if (!(await until(() => root.querySelector('.abele-github-pinned .cm-editor'), 30000))) throw Error('The worker diff never rendered: ' + root.textContent.slice(-500))
        const report = { stats: root.querySelector('.abele-github-pinned .abele-github-file__stats').textContent }
        ;[...root.querySelectorAll('button')].find(b => b.textContent === 'Original file').click()
        report.original = !!(await until(() => root.querySelector('.abele-github-blob .cm-editor'), 20000))
        ;[...root.querySelectorAll('button')].find(b => b.textContent === 'Show comparison').click()
        if (!(await until(() => root.querySelector('.abele-github-pinned .cm-editor'), 30000))) throw Error('Comparison did not return')
        ;[...root.querySelectorAll('button')].find(b => b.textContent === 'Unpin').click()
        report.restored = !!(await until(() => root.querySelector('.abele-github-blob .cm-editor') && !leaf.view.model.screen.comparison, 20000))
        return report
      } catch (error) { return { error: String(error.message || error) } }
    })()`,
      120000
    )
    expect(result.error).toBeUndefined()
    expect(result.stats).toContain('+300')
    expect(result.stats).toContain('−300')
    expect(result.original).toBe(true)
    expect(result.restored).toBe(true)
  }, 150000)
})
