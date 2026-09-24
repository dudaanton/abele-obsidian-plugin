/**
 * A GitHub tab and the agent's `github_file` against an older Enterprise Server, in the app.
 *
 * Such a server knows only the long-standing media types: asked for `raw+json` it answers with
 * the contents API's JSON object, the file in base64 — and past a megabyte with no content at
 * all. The tab and the tool must show the file, never that object. Two servers: `legacy` still
 * honours the plain raw type the plugin asks for; `no-raw` ignores that too, so the plugin's own
 * decoding, and the git blobs API for a large file, are what show it. See
 * `helpers/fakeGithubServer.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()

/** The server's log is read only while the worker is free, which it is not during an eval. */
const settle = () => new Promise((r) => setTimeout(r, 500))

for (const mode of ['legacy', 'no-raw'] as const) {
  describe.skipIf(!available)(`a GitHub file from an older Enterprise Server (${mode})`, () => {
    let gh: FakeGithub

    beforeAll(async () => {
      gh = await startFakeGithub({ mode })
      enableGithub(gh.origin)
    }, 60_000)

    afterAll(() => {
      if (!available) return
      try {
        restoreGithub()
      } finally {
        gh?.stop()
      }
    }, 60_000)

    it('opens as its code, a large one at a line, and a markdown file rendered', async () => {
      const r = evalAsync<{ error?: string; code?: string; long?: string; heading?: string }>(
        `(async () => {
          ${PRELUDE}
          const open = async (url, title) => {
            const leaf = await openTab(url)
            const ok = await until(() => loaded(leaf, title), 20000)
            return ok ? leaf : null
          }
          const report = {}
          const app1 = await open(${JSON.stringify(`${gh.web}/blob/main/src/app.ts`)}, 'app.ts')
          if (!app1) return { error: 'app.ts never loaded' }
          const code = await until(() => app1.view.containerEl.querySelector('.abele-github-blob .cm-content'), 10000)
          report.code = code ? code.textContent : app1.view.containerEl.textContent.slice(0, 400)
          const long = await open(${JSON.stringify(`${gh.web}/blob/main/src/long.ts#L200`)}, 'long.ts')
          if (!long) return { error: 'long.ts never loaded' }
          const marked = await until(() => long.view.containerEl.querySelector('.abele-github-code__line_target'), 15000)
          report.long = marked ? marked.textContent : long.view.containerEl.textContent.slice(0, 400)
          const md = await open(${JSON.stringify(`${gh.web}/blob/main/README.md`)}, 'README.md')
          if (!md) return { error: 'README.md never loaded' }
          const h2 = await until(() => md.view.containerEl.querySelector('.abele-github-md h2'), 15000)
          report.heading = h2 ? h2.textContent : md.view.containerEl.textContent.slice(0, 400)
          // Closed together: a tab opened in the place of the last one closed is never laid out.
          for (const l of [app1, long, md]) l.detach()
          return report
        })()`
      )
      expect(r.error).toBeUndefined()
      expect(r.code).toContain('const widgets = loadWidgets(count)')
      expect(r.code).not.toContain('"encoding"')
      expect(r.long).toBe('export const setting200 = 200 // line 200 of a long file, reworked')
      expect(r.heading).toBe('Install')
      await settle()
      const blobs = gh.requests().some((l) => l.includes('/git/blobs/'))
      // Only a server that ignores the raw type makes the tab go to the blob.
      expect(blobs).toBe(mode === 'no-raw')
    })

    it("the agent's github_file reads the file as text, a large one from its blob", async () => {
      const r = evalAsync<{ small?: string; long?: string; error?: string }>(`(async () => {
        const tool = window.__abeleTest.createGithubTools().find((t) => t.name === 'github_file')
        if (!tool) return { error: 'no github_file tool' }
        const text = async (repo) => (await tool.execute('e2e', { repo })).content[0].text
        return {
          small: await text(${JSON.stringify(`${gh.web}/blob/main/src/app.ts`)}),
          long: await text(${JSON.stringify(`${gh.web}/blob/main/src/long.ts#L200-L200`)}),
        }
      })()`)
      expect(r.error).toBeUndefined()
      expect(r.small).toContain('const widgets = loadWidgets(count)')
      expect(r.small).not.toContain('"encoding"')
      expect(r.long).toContain('export const setting200 = 200')
      await settle()
      expect(gh.requests().some((l) => l.includes('/git/blobs/'))).toBe(true)
    })
  })
}
