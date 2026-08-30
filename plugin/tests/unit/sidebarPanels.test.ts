/**
 * The panels the Vue app renders into: the timeline, the agent, and the rest of the sidebars.
 *
 * Each one is an Obsidian view that puts an empty div in its pane and writes its id into the
 * store; the Vue app, which is mounted once on `document.body`, teleports the real component
 * into the div with that id. So the store is the whole join between the two halves, and what
 * it holds decides whether a panel has anything in it.
 *
 * It used to hold one id per kind. Obsidian opens a second instance of a view before closing
 * the first often enough — a fresh install, a phone reattaching a drawer — and the one that
 * went away cleared the slot the one still on screen was using. The panel then sat blank until
 * the app was restarted, which is exactly what a new install looked like.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { TimelineSidebarView, TIMELINE_SIDEBAR_ID_ATTR } from '@/views/TimelineSidebarView'
import { TodoSidebarView, TODO_SIDEBAR_ID_ATTR } from '@/views/TodoSidebarView'
import { AiSidebarView, AI_SIDEBAR_ID_ATTR } from '@/views/AiSidebarView'
import { FinanceSidebarView, FINANCE_SIDEBAR_ID_ATTR } from '@/views/FinanceSidebarView'
import {
  TimeTrackingSidebarView,
  TIME_TRACKING_SIDEBAR_ID_ATTR,
} from '@/views/TimeTrackingSidebarView'
import { ScriptRunsView, SCRIPT_RUNS_ID_ATTR } from '@/views/ScriptRunsView'
import { useVault } from '../helpers/testEnv'

interface Panel {
  name: string
  attribute: string
  make: () => { onOpen(): Promise<void>; onClose(): Promise<void>; containerEl: HTMLElement }
  ids: () => Ref<string[]>
}

const store = () => GlobalStore.getInstance()

const PANELS: Panel[] = [
  {
    name: 'the timeline',
    attribute: TIMELINE_SIDEBAR_ID_ATTR,
    make: () => new TimelineSidebarView({} as never, {} as never),
    ids: () => store().timelineSidebarIds,
  },
  {
    name: 'the todo list',
    attribute: TODO_SIDEBAR_ID_ATTR,
    make: () => new TodoSidebarView({} as never, {} as never),
    ids: () => store().todoSidebarIds,
  },
  {
    name: 'the agent',
    attribute: AI_SIDEBAR_ID_ATTR,
    make: () => new AiSidebarView({} as never, {} as never),
    ids: () => store().aiSidebarIds,
  },
  {
    name: 'finance',
    attribute: FINANCE_SIDEBAR_ID_ATTR,
    make: () => new FinanceSidebarView({} as never, {} as never),
    ids: () => store().financeSidebarIds,
  },
  {
    name: 'time tracking',
    attribute: TIME_TRACKING_SIDEBAR_ID_ATTR,
    make: () => new TimeTrackingSidebarView({} as never, {} as never),
    ids: () => store().timeTrackingSidebarIds,
  },
  {
    name: 'script runs',
    attribute: SCRIPT_RUNS_ID_ATTR,
    make: () => new ScriptRunsView({} as never, {} as never),
    ids: () => store().scriptRunsIds,
  },
]

/** The id the view wrote on the div it put in its own pane, which is the teleport's target. */
const targetIn = (panel: Panel, view: { containerEl: HTMLElement }) =>
  view.containerEl.children[1].querySelector(`[${panel.attribute}]`)?.getAttribute(panel.attribute)

beforeEach(() => {
  useVault([])
  // The store is a singleton and outlives a test file; a panel left open in one test would
  // otherwise still be open in the next.
  for (const panel of PANELS) panel.ids().value = []
})

describe.each(PANELS)('$name', (panel) => {
  it('is on the list once it has opened, under the id on its own container', async () => {
    const view = panel.make()

    await view.onOpen()

    expect(panel.ids().value).toEqual([targetIn(panel, view)])
  })

  /** One in each dock is a thing a person does, and one of them rendering is a bug. */
  it('keeps both when a second one opens, rather than the second taking over', async () => {
    const first = panel.make()
    const second = panel.make()

    await first.onOpen()
    await second.onOpen()

    expect(panel.ids().value).toEqual([targetIn(panel, first), targetIn(panel, second)])
  })

  /**
   * The one that closes is the one that goes. This is the failure the report was about: the
   * panel left on screen went blank and stayed blank until Obsidian was restarted.
   */
  it('leaves the other one alone when it closes', async () => {
    const staying = panel.make()
    const going = panel.make()

    await staying.onOpen()
    await going.onOpen()
    await going.onClose()

    expect(panel.ids().value).toEqual([targetIn(panel, staying)])
  })

  it('is off the list once the last one closes', async () => {
    const view = panel.make()

    await view.onOpen()
    await view.onClose()

    expect(panel.ids().value).toEqual([])
  })

  /** Closing twice happens; it must not take a live panel with it. */
  it('is unmoved by one that closes a second time', async () => {
    const staying = panel.make()
    const going = panel.make()

    await staying.onOpen()
    await going.onOpen()
    await going.onClose()
    await going.onClose()

    expect(panel.ids().value).toEqual([targetIn(panel, staying)])
  })
})
