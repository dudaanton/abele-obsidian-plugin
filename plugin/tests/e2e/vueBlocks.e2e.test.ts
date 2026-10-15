/**
 * Small pieces the plugin draws into elements Obsidian or a library hands it: a chart block, the
 * notices with buttons, the sync item in the status bar, the menu of chat branches and the
 * popup over a pressed map place. Each is put on screen in the running app, on a desktop window
 * and under phone emulation, measured, pictured, and taken down again — leaving nothing behind.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const shots = shotDir('vue-blocks')
const original = evalJson<{ size: number[]; mobile: boolean }>(`({
  size: require('electron').remote.getCurrentWindow().getSize(),
  mobile: document.body.classList.contains('is-mobile')
})`)

afterAll(async () => {
  evalRaw(`require('electron').remote.getCurrentWindow().setSize(${original.size.join(',')})`)
  await reloadApp(`app.emulateMobile(${original.mobile})`)
})

/** Runs `body` in the app with `until`, `frames`, `shoot(name)` and `probes` in scope. */
async function inApp<T>(mode: string, body: string): Promise<T> {
  const answer = await evalLong(`(async () => {
    const until = async (name, predicate, ms = 15000) => {
      const end = Date.now() + ms
      while (!predicate()) {
        if (Date.now() > end) throw new Error('timed out: ' + name)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const shoot = async (name, rect) => {
      await frames()
      const image = await require('electron').remote.getCurrentWindow().webContents.capturePage(rect)
      require('fs').writeFileSync(${JSON.stringify(shots + '/')} + name + '-' + ${JSON.stringify(mode)} + '.png', image.toPNG())
    }
    const probes = window.__abeleTest.blockProbes
    const fixed = (cls = '') => {
      const root = document.body.createDiv({ cls })
      Object.assign(root.style, { position: 'fixed', left: '16px', right: '16px', top: '80px', zIndex: '1000', background: 'var(--background-primary)', padding: '12px' })
      return root
    }
    ${body}
  })()`)
  expect(answer).not.toMatch(/^Error:/)
  return JSON.parse(answer) as T
}

describe.each([
  ['desktop', false, '1000,800'],
  ['phone', true, '390,844'],
] as const)('pieces drawn into host elements, %s', (mode, mobile, size) => {
  it('enters the window', async () => {
    evalRaw(`require('electron').remote.getCurrentWindow().setSize(${size})`)
    await reloadApp(`app.emulateMobile(${mobile})`)
  }, 60000)

  it('draws a chart block and says what is wrong with a broken one', async () => {
    const result = await inApp<Record<string, unknown>>(
      mode,
      `
      const { Component, MarkdownRenderer } = window.__abeleTest.rendering
      const root = fixed('markdown-rendered')
      const owner = new Component()
      owner.load()
      try {
        const chart = '\`\`\`abele-chart\\ntype: bar\\nheight: 220\\ntitle: Rows per bed\\nxLabels: [North, East, South, West]\\nseries:\\n  - name: Rows\\n    data: [3, 5, 2, 6]\\n\`\`\`'
        const broken = '\`\`\`abele-chart\\ntype: bar\\n\`\`\`'
        await MarkdownRenderer.render(app, chart + '\\n\\n' + broken, root, '', owner)
        await until('chart drawn', () => root.querySelector('.abele-chart-container canvas')?.width > 0)
        await shoot('chart')
        const container = root.querySelector('.abele-chart-container')
        const error = root.querySelector('.abele-chart-error')
        return JSON.stringify({
          height: Math.round(container.getBoundingClientRect().height),
          error: error?.textContent.trim(),
          errorRole: error?.getAttribute('role'),
        })
      } finally {
        owner.unload()
        root.remove()
      }`
    )
    expect(result).toMatchObject({ height: 220, error: 'No series defined', errorRole: 'alert' })
    expect(evalJson<number>(`document.querySelectorAll('.abele-chart-container').length`)).toBe(0)
  }, 60000)

  it('shows the notices with their buttons and takes them down', async () => {
    const result = await inApp<Record<string, unknown>>(
      mode,
      `
      const hideOffer = probes.updateOffer('1.0.0', '1.1.0')
      const hideScripts = probes.waitingScripts(['Sample script'])
      await probes.templateReview('Probe/Sample probe template.md', 'Sample probe template', 'probe ' + Date.now())
      try {
        const notices = () => [...document.querySelectorAll('.notice')].filter((n) =>
          /What's new|Sample script|Sample probe template/.test(n.textContent))
        await until('three notices', () => notices().length === 3)
        // Notices fade in; picture them once they are there.
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await shoot('notices')
        return JSON.stringify(notices().map((n) => ({
          buttons: [...n.querySelectorAll('button')].map((b) => b.textContent.trim()),
          accent: [...n.querySelectorAll('button')].map((b) => b.classList.contains('mod-cta')),
          clipped: [...n.querySelectorAll('button')].some((b) => b.getBoundingClientRect().right > n.getBoundingClientRect().right + 1),
        })))
      } finally {
        hideOffer()
        hideScripts()
        document.querySelectorAll('.notice').forEach((n) => { if (n.textContent.includes('Sample probe template')) n.remove() })
      }`
    )
    expect(result).toEqual(
      expect.arrayContaining([
        { buttons: ["What's new", 'Dismiss'], accent: [true, false], clipped: false },
        { buttons: ['Review'], accent: [true], clipped: false },
        { buttons: ['Review'], accent: [true], clipped: false },
      ])
    )
  }, 60000)

  it('opens the menu of branches with each branch named and its facts beside it', async () => {
    const result = await inApp<Record<string, unknown>>(
      mode,
      `
      const root = fixed()
      const now = Date.now()
      const unmount = probes.branchSwitch(root, [
        { id: 'a', title: 'Plan the sample garden with three beds along the fence', timestamp: now - 3600000, questions: 4 },
        { id: 'b', title: 'Plan it with raised beds', timestamp: now - 600000, questions: 2, tone: 'waiting' },
        { id: 'c', title: 'Start over from the soil test', timestamp: now, questions: 1, tone: 'failed' },
      ], 1)
      try {
        root.querySelector('.abele-chat-branch__count').click()
        await until('menu', () => document.querySelectorAll('.menu .menu-item').length >= 3)
        // On a phone the menu is a sheet that slides up.
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await shoot('branch-menu')
        const items = [...document.querySelectorAll('.menu .menu-item')].slice(0, 3)
        const report = items.map((item) => {
          const title = item.querySelector('.abele-chat-branch__title')
          const facts = item.querySelector('.abele-chat-branch__facts')
          return {
            title: title?.textContent,
            facts: !!facts,
            sameLine: !!title && !!facts && Math.abs(title.getBoundingClientRect().top - facts.getBoundingClientRect().top) < 8,
            inside: !!facts && facts.getBoundingClientRect().right <= item.getBoundingClientRect().right + 1,
            dot: item.querySelector('.abele-status-dot')?.getAttribute('aria-label') ?? null,
          }
        })
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await until('menu closed', () => !document.querySelector('.menu'), 3000).catch(() => {})
        return JSON.stringify(report)
      } finally {
        document.querySelector('.menu')?.remove()
        unmount()
        root.remove()
      }`
    )
    expect(result).toEqual([
      expect.objectContaining({ facts: true, sameLine: true, inside: true, dot: null }),
      expect.objectContaining({
        title: 'Plan it with raised beds',
        sameLine: true,
        inside: true,
        dot: 'Waiting for your approval',
      }),
      expect.objectContaining({ sameLine: true, inside: true, dot: 'Refused or failed' }),
    ])
  }, 60000)

  it('fills the popup over a pressed map place', async () => {
    const result = await inApp<Record<string, unknown>>(
      mode,
      `
      const root = fixed('abele-map')
      Object.assign(root.style, { height: '350px', padding: '0' })
      let handle
      try {
        handle = await window.__abeleTest.renderMap(root, {
          points: [], lines: [], center: { lat: 48.858, lon: 2.294 }, zoom: 16, height: 350, interactive: true,
        })
        const canvas = root.querySelector('canvas')
        await until('canvas', () => canvas.width > 0)
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const box = canvas.getBoundingClientRect()
        const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, button: 0 }
        canvas.dispatchEvent(new MouseEvent('mousedown', at))
        canvas.dispatchEvent(new MouseEvent('mouseup', at))
        canvas.dispatchEvent(new MouseEvent('click', at))
        await until('popup', () => root.querySelector('.maplibregl-popup-content .abele-map__place strong'))
        await until('lookup settled', () => !/Looking up/.test(root.querySelector('.abele-map__place strong').textContent), 10000).catch(() => {})
        await shoot('map-place')
        const place = root.querySelector('.abele-map__place')
        const popup = root.querySelector('.maplibregl-popup-content')
        const shell = popup.closest('.maplibregl-popup')
        const map = root.getBoundingClientRect()
        const drawn = popup.getBoundingClientRect()
        const onMap = drawn.width > 0 && drawn.height > 0 && drawn.left >= map.left - 1 && drawn.right <= map.right + 1 && drawn.top >= map.top - 1 && drawn.bottom <= map.bottom + 1
        const shown = getComputedStyle(shell).visibility !== 'hidden' && Number(getComputedStyle(shell).opacity) > 0
        const close = popup.querySelector('button')?.getBoundingClientRect()
        const title = place.querySelector('strong').getBoundingClientRect()
        return JSON.stringify({
          title: place.querySelector('strong').textContent,
          coordinates: place.querySelector('.abele-map__coordinates')?.textContent ?? '',
          inside: place.getBoundingClientRect().right <= popup.getBoundingClientRect().right + 1,
          onMap,
          shown,
          popups: root.querySelectorAll('.maplibregl-popup').length,
          clearOfClose: !close || close.left >= title.right || close.bottom <= title.top || close.right <= title.left,
        })
      } finally {
        handle?.destroy()
        root.remove()
      }`
    )
    expect(result).toMatchObject({
      inside: true,
      clearOfClose: true,
      onMap: true,
      shown: true,
      popups: 1,
    })
    expect(result.title).not.toBe('')
    expect(result.coordinates).toMatch(/\d/)
  }, 90000)
})

describe('the sync item in the status bar', () => {
  it('draws its glyph and word as the status changes', async () => {
    evalRaw(`require('electron').remote.getCurrentWindow().setSize(1000,800)`)
    await reloadApp('app.emulateMobile(false)')
    const result = await inApp<Record<string, unknown>[]>(
      'desktop',
      `
      const bar = document.querySelector('.status-bar')
      const items = ['syncing', 'held', 'waiting'].map(() => bar.createDiv({ cls: 'status-bar-item mod-clickable' }))
      const base = { pending: 0, lastSyncAt: null, lastError: null, cursor: 0, headSeq: null, heldDeletes: 0, deferred: 0 }
      try {
        probes.syncStatus(items[0], { ...base, state: 'idle' })
        probes.syncStatus(items[0], { ...base, state: 'syncing', pending: 4 })
        probes.syncStatus(items[1], { ...base, state: 'idle', heldDeletes: 60 })
        probes.syncStatus(items[2], { ...base, state: 'idle', pending: 3 })
        const box = bar.getBoundingClientRect()
        await shoot('sync-status', { x: Math.max(0, Math.floor(box.left)), y: Math.floor(box.top) - 4, width: Math.ceil(box.width), height: Math.ceil(box.height) + 8 })
        return JSON.stringify(items.map((el) => {
          const icon = el.querySelector('.abele-sync-status-icon svg')?.getBoundingClientRect()
          const text = el.querySelector('.abele-sync-status-text')
          const word = text.getBoundingClientRect()
          return {
            text: text.textContent,
            glyphs: el.querySelectorAll('svg').length,
            warning: el.classList.contains('abele-sync-status_warning'),
            colour: getComputedStyle(el.querySelector('.abele-sync-status-icon')).color === getComputedStyle(text).color,
            centred: !!icon && Math.abs((icon.top + icon.bottom) / 2 - (word.top + word.bottom) / 2) < 3,
          }
        }))
      } finally {
        items.forEach((el) => el.remove())
      }`
    )
    expect(result).toEqual([
      { text: 'Syncing', glyphs: 1, warning: false, colour: true, centred: true },
      { text: 'Deletions held (60)', glyphs: 1, warning: true, colour: true, centred: true },
      { text: 'Waiting (3)', glyphs: 1, warning: false, colour: true, centred: true },
    ])
  }, 60000)
})
