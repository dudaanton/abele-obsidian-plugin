/**
 * The Access tab of an agent against a large vault: listing its groups and typing in the field
 * that adds a place must not walk the vault's group membership again for every row, render and
 * keystroke. In the running app one such walk resolves a link per `groups` value of every note,
 * which on thousands of notes is a frozen window, once per keystroke.
 *
 * What is asserted is the work done — metadata reads and link resolutions counted in the page —
 * never milliseconds; the times are printed beside them for the record.
 *
 * Requires a development build in a vault with `ScaleTest/` (the pool vaults) — docs/Testing.md.
 */
import { expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

const available = isObsidianRunning() && hasTestApi()

interface Step {
  step: string
  ms: number
  fileCache: number
  links: number
  listed: number
}

interface Report {
  markdownFiles: number
  groups: number
  steps: Step[]
  error?: string
}

const probe = `(async () => {
  const T = window.__abeleTest, mc = app.metadataCache, vault = app.vault
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const until = async (f, what) => { for (let i = 0; i < 200; i++) { const v = f(); if (v) return v; await wait(50) } throw Error('Did not settle: ' + what) }
  const real = { fileCache: mc.getFileCache, links: mc.getFirstLinkpathDest, listed: vault.getAllLoadedFiles }
  const count = { fileCache: 0, links: 0, listed: 0 }
  const report = { markdownFiles: vault.getMarkdownFiles().length, groups: 0, steps: [] }
  const registry = T.AgentRegistry.getInstance()
  let agent = null
  try {
    // The biggest groups of the vault, as a person would have put them in an agent's reach.
    const sizes = [...T.ScopeResolver.getInstance().groupSizes()].sort((a, b) => b[1] - a[1])
    const groups = sizes.slice(0, 3).map(([path]) => ({ type: 'group', path }))
    report.groups = groups.length
    if (!groups.length) throw Error('No group notes in this vault')
    mc.getFileCache = function (...a) { count.fileCache++; return real.fileCache.apply(this, a) }
    mc.getFirstLinkpathDest = function (...a) { count.links++; return real.links.apply(this, a) }
    vault.getAllLoadedFiles = function (...a) { count.listed++; return real.listed.apply(this, a) }
    const measure = async (step, work) => {
      count.fileCache = count.links = count.listed = 0
      const start = performance.now()
      await work()
      await frame()
      report.steps.push({ step, ms: Math.round(performance.now() - start), ...count })
    }
    T.openDialog('agent-tools')
    const input = await until(() => document.querySelector('.modal .abele-agent-editor .abele-scope-mgr__field input'), 'the Access tab')
    agent = registry.list({ includeUtility: true }).find((a) => a.name === 'Sample tools by section')
    await measure('list three groups', async () => {
      registry.update(agent.id, { scope: groups })
      await until(() => document.querySelectorAll('.modal .abele-scope-mgr__entry_group').length === groups.length, 'the group rows')
    })
    await measure('change a tool mode', async () => { registry.update(agent.id, { toolModes: { ...agent.toolModes, geocode: 'auto' } }) })
    input.focus()
    let typed = ''
    for (const key of ['', 'n', 'no', 'not', 'note', 'notes']) {
      typed = key
      await measure(key ? 'type ' + JSON.stringify(typed) : 'open the field', async () => {
        input.value = typed
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
  } catch (e) {
    report.error = String(e && e.stack || e)
  } finally {
    mc.getFileCache = real.fileCache
    mc.getFirstLinkpathDest = real.links
    vault.getAllLoadedFiles = real.listed
    document.activeElement?.blur?.()
    document.querySelector('.modal-container .modal-close-button')?.click()
    await wait(300)
  }
  return JSON.stringify(report)
})()`

it.skipIf(!available)(
  'lists groups and suggests places without walking group membership per row and keystroke',
  async () => {
    const report = JSON.parse(await evalLong(probe, 300_000)) as Report
    console.info(
      [
        '',
        `  markdown files ${report.markdownFiles}, groups in reach ${report.groups}`,
        ...report.steps.map(
          (s) =>
            `  ${s.step.padEnd(22)} ${String(s.ms).padStart(6)} ms  getFileCache ${s.fileCache}  links ${s.links}  file lists ${s.listed}`
        ),
        '',
      ].join('\n')
    )
    expect(report.error).toBeUndefined()
    const step = (name: string) => report.steps.find((s) => s.step === name)!
    // One pass over the vault's metadata is enough to know every group's members.
    expect(step('list three groups').fileCache).toBeLessThanOrEqual(report.markdownFiles)
    // A setting unrelated to the places costs no pass over the vault at all.
    expect(step('change a tool mode').fileCache).toBe(0)
    // Group sizes are known once the field has listed them; typing does not learn them again.
    const typing = report.steps.filter((s) => s.step.startsWith('type '))
    expect(typing.slice(1).map((s) => s.links)).toEqual(typing.slice(1).map(() => 0))
    expect(typing.slice(1).map((s) => s.fileCache)).toEqual(typing.slice(1).map(() => 0))
  },
  360_000
)
