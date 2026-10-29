import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import {
  enableGithub,
  realClick,
  realDrag,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { withNativeInput } from './helpers/nativeInput'
import { targets } from './helpers/target'
import {
  actionCoordinates,
  checkSelectionDestination,
  selectionWindowInfo,
  selectionResize,
  selectionEmulation,
  openSelectionSource,
  prepareSelectionAction,
  readSelectionBar,
  selectionCleanup,
  selectionMenu,
  selectionSetup,
  selectionShot,
  wordCoordinates,
} from './helpers/codeSelectionProbe'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const run = async <T>(script: string): Promise<T> => {
  const result = JSON.parse(await evalLong(script, 45_000)) as T & {
    error?: string
    stack?: string
  }
  if (result.error) throw new Error(`${result.error}\n${result.stack ?? ''}`)
  return result
}
type Point = { x: number; y: number }
const selectWords = async () => {
  const selection = await run<{ word: string; from: Point; to: Point }>(wordCoordinates)
  await realDrag(selection.from, selection.to)
  return selection
}

// Native input, including a right-click, travels through the real page listeners.
const rightClick = async (point: Point) =>
  withNativeInput(async () => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      runCli(
        [
          'dev:cdp',
          'method=Input.dispatchMouseEvent',
          `params=${JSON.stringify({ type, ...point, button: type === 'mouseMoved' ? 'none' : 'right', clickCount: 1 })}`,
        ],
        30_000
      )
  })

for (const layout of ['desktop', 'emulateMobile'] as const) {
  describe.skipIf(!available)(`${layout}: selected code actions`, () => {
    let github: FakeGithub | undefined
    let previous: { size: [number, number]; mobile: boolean } | undefined
    let githubEnabled = false
    const directory = `Sample code selection-${randomUUID()}`

    beforeAll(async () => {
      previous = await run(selectionWindowInfo)
      if (previous.mobile !== (layout === 'emulateMobile'))
        await reloadApp(selectionEmulation(layout === 'emulateMobile'))
      await run(
        selectionResize(layout === 'desktop' ? 1280 : 390, layout === 'desktop' ? 800 : 844)
      )
      await run(selectionSetup(directory))
      github = await startFakeGithub()
      enableGithub(github.origin)
      githubEnabled = true
    }, 90_000)

    afterAll(async () => {
      try {
        if (githubEnabled) restoreGithub()
      } finally {
        try {
          await run(selectionCleanup)
        } finally {
          try {
            await github?.stop()
          } finally {
            if (previous) {
              // Only a window this block turned into the other layout is reloaded back.
              if (evalJson<boolean>('app.isMobile') !== previous.mobile)
                await reloadApp(selectionEmulation(previous.mobile))
              await run(selectionResize(previous.size[0], previous.size[1]))
            }
          }
        }
      }
    }, 90_000)

    for (const surface of ['debugger', 'node-or-local', 'github'] as const) {
      it(`${surface}: glyphs, ordinary context menu and real draft/note destinations`, async () => {
        const source = await run<{ surface: string; node: boolean }>(
          openSelectionSource(surface, `${github!.web}/blob/main/src/app.ts`)
        )
        if (surface === 'node-or-local' && !source.node)
          console.info(
            'No open non-executing node file fixture; verifying the local code view instead.'
          )
        const selection = await selectWords()
        const bar = await run<{
          actions: { id: string; icon: string }[]
          text: string
          visible: boolean
        }>(readSelectionBar)
        expect(bar.text).toBe(selection.word)
        expect(bar.visible).toBe(true)
        const actions = [
          { id: 'ask', icon: 'message-circle-plus' },
          { id: 'add', icon: 'message-square-plus' },
          { id: 'note', icon: 'file-input' },
        ]
        if (surface === 'github')
          actions.push({ id: 'code', icon: 'file-code' }, { id: 'link', icon: 'link' })
        expect(bar.actions).toEqual(actions)
        const shot = await run<{ saved: boolean; width: number; height: number }>(
          selectionShot(`/tmp/abele-code-selection/${layout}-${source.surface}-bar.png`)
        )
        expect(shot.saved).toBe(true)
        if (layout === 'emulateMobile') expect([shot.width, shot.height]).toEqual([390, 844])

        await rightClick({
          x: Math.round((selection.from.x + selection.to.x) / 2),
          y: selection.from.y,
        })
        const menu = await run<{ items: string[] }>(selectionMenu)
        for (const label of menu.items)
          expect(label).not.toMatch(
            /ask (here|the agent)|add to (the )?(open )?chat|insert.*note|copy.*link.*lines/i
          )

        for (const action of (surface === 'github'
          ? ['ask', 'add', 'note', 'code']
          : ['ask', 'add', 'note']) as ('ask' | 'add' | 'note' | 'code')[]) {
          await run(prepareSelectionAction(action))
          await selectWords()
          await run(readSelectionBar)
          const point = await run<Point>(actionCoordinates(action))
          await realClick(point.x, point.y)
          const destination = await run<{ text: string; tabId?: string; addId?: string }>(
            checkSelectionDestination(action)
          )
          expect(destination.text).toContain(
            surface === 'github' && action === 'note' ? 'src/app.ts' : selection.word
          )
          if (action === 'add') {
            expect(destination.text).toContain('Existing draft')
            expect(destination.tabId).toBe(destination.addId)
          }
        }
      }, 120_000)
    }
  })
}
