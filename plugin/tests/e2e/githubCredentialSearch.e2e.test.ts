import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evalRaw, evalLong } from './helpers/obsidianCli'
import {
  startFakeGithub,
  enableGithub,
  restoreGithub,
  PRELUDE,
  type FakeGithub,
} from './helpers/githubLive'
import { shotDir } from './helpers/shots'

const evidence = shotDir('github-credential-search')

describe('live GitHub credential changes during code search', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub({ mode: 'accounts' })
    enableGithub(gh.origin)
  })
  afterAll(() => {
    try {
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it.each(['rotated', 'removed', 'locked'] as const)(
    'clears loaded and in-flight search when credentials are %s',
    async (change) => {
      const result = JSON.parse(
        await evalLong(
          `(async () => {
      ${PRELUDE}
      const api = window.__abeleTest
      const config = api.AbeleConfig.getInstance()
      const secrets = api.secrets()
      const status = secrets.status.value
      const originalSecret = app.secretStorage.getSecret
      const originalBytes = api.GithubClient.prototype.bytes
      let token = 'invented-connection-two'
      app.secretStorage.getSecret = function(id) { return id === 'sample-search-key' ? token : originalSecret.call(this, id) }
      config.github.connections = [{ id: 'sample-search', name: 'Sample search', server: ${JSON.stringify(gh.origin)}, keyId: 'sample-search-key', owners: [], isDefault: true }]
      const reports = []
      try {
        for (const phase of ['results', 'download']) {
          token = 'invented-connection-two'
          secrets.status.value = status
          config.version.value++
          let release = null, entered = false
          api.GithubClient.prototype.bytes = async function(path, ...args) {
            const answer = await originalBytes.call(this, path, ...args)
            if (phase === 'download' && path.includes('/tarball/')) {
              entered = true
              await new Promise(resolve => { release = resolve })
            }
            return answer
          }
          const leaf = await openTab(${JSON.stringify(gh.web + '/blob/main/src/app.ts')})
          try {
            // Use a commit unique to this tab state only in the downloaded fixture: clear a
            // previously loaded account generation before opening the in-flight case.
            await leaf.view.setState({ url: ${JSON.stringify(gh.web + '/blob/main/src/app.ts')}, connectionId: 'sample-search', connectionIntent: 'manual' }, {})
            const root = leaf.view.containerEl
            if (!await until(() => root.querySelector('.abele-github-code'), 15000)) throw Error('file did not load')
            const icon = [...root.querySelectorAll('.abele-github-header__actions .abele-obsidian-icon')].find(el => el.querySelector('svg.lucide-file-search'))
            icon.click()
            const input = await until(() => root.querySelector('.abele-github-search__query input, input.abele-github-search__query'), 5000)
            if (!input) throw Error('search input absent')
            input.value = 'formatValue'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
            if (!await until(() => phase === 'download' ? entered : root.querySelector('.abele-github-search__summary')?.textContent.includes('3 lines'), 15000)) throw Error('search phase not reached: ' + phase)
            const oldPanel = root.querySelector('.abele-github-search')
            token = ${JSON.stringify(change)} === 'rotated' ? 'invented-connection-one' : ''
            if (${JSON.stringify(change)} === 'locked') secrets.status.value = 'locked'
            config.version.value++
            if (!await until(() => !oldPanel.isConnected, 15000)) throw Error('old search panel remained')
            release?.()
            if (!await until(() => root.querySelector('.abele-github__error'), 15000)) throw Error('new credential refusal absent')
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            reports.push({ phase, oldPanelConnected: oldPanel.isConnected,
              results: root.querySelectorAll('.abele-github-search__line').length,
              oldCode: root.textContent.includes('export function formatValue'),
              refusal: root.querySelector('.abele-github__error').textContent })
          } finally { release?.(); leaf.detach(); api.GithubClient.prototype.bytes = originalBytes }
        }
        return { change: ${JSON.stringify(change)}, reports }
      } catch (error) { return { change: ${JSON.stringify(change)}, reports, error: String(error.stack || error) } }
      finally {
        app.secretStorage.getSecret = originalSecret
        api.GithubClient.prototype.bytes = originalBytes
        secrets.status.value = status
        config.version.value++
      }
    })()`,
          120000
        )
      )
      writeFileSync(
        join(evidence, change + '.json'),
        JSON.stringify({ ...result, requests: await gh.drainRequests() }, null, 2)
      )
      expect(result.error).toBeUndefined()
      expect(result.reports).toHaveLength(2)
      for (const report of result.reports)
        expect(report).toMatchObject({ oldPanelConnected: false, results: 0, oldCode: false })
    },
    150000
  )
})
