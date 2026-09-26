/**
 * What the quick button's menu holds, in what order, for the thing on screen.
 *
 * The user's own actions first — a command only where it can run, so a flat list of his still
 * says only what applies here — then the note's header buttons, then what the plugin offers for
 * the view in front, then the command palette as the way to everything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Menu, MarkdownView, TFile } from 'obsidian'
import { fillQuickMenu, commandAvailable, type QuickMenuDeps } from '@/quickButton/menu'
import type { QuickAction } from '@/quickButton/settings'

interface FakeCommand {
  id: string
  name: string
  icon?: string
  callback?: () => void
  checkCallback?: (checking: boolean) => boolean | void
  editorCallback?: () => void
  editorCheckCallback?: (checking: boolean) => boolean | void
}

const command = (c: FakeCommand) => c

function fakeApp(commands: FakeCommand[], markdown: MarkdownView | null = null) {
  const byId = Object.fromEntries(commands.map((c) => [c.id, c]))
  const executed: string[] = []
  return {
    executed,
    app: {
      commands: {
        commands: byId,
        findCommand: (id: string) => byId[id],
        executeCommandById: (id: string) => {
          executed.push(id)
          return true
        },
      },
      workspace: {
        getActiveViewOfType: () => markdown,
      },
    },
  }
}

const action = (a: Partial<QuickAction>): QuickAction => ({
  id: a.id ?? 'x',
  type: a.type ?? 'command',
  commandId: a.commandId ?? '',
  scriptName: a.scriptName ?? '',
  name: a.name ?? '',
  icon: a.icon ?? '',
})

const titles = (menu: Menu) => menu.items.map((i) => i.title)
const sections = (menu: Menu) => menu.items.map((i) => i.section)

describe('whether a command can run here', () => {
  it('asks a command that can say so', () => {
    const { app } = fakeApp([
      command({ id: 'yes', name: 'Yes', checkCallback: () => true }),
      command({ id: 'no', name: 'No', checkCallback: () => false }),
      command({ id: 'plain', name: 'Plain', callback: () => {} }),
    ])
    expect(commandAvailable(app as never, 'yes')).toBe(true)
    expect(commandAvailable(app as never, 'no')).toBe(false)
    expect(commandAvailable(app as never, 'plain')).toBe(true)
    expect(commandAvailable(app as never, 'gone')).toBe(false)
  })

  it('offers an editor command only with a note open for editing', () => {
    const cmds = [
      command({ id: 'ed', name: 'Ed', editorCallback: () => {} }),
      command({ id: 'edc', name: 'Edc', editorCheckCallback: () => false }),
    ]
    expect(commandAvailable(fakeApp(cmds).app as never, 'ed')).toBe(false)
    const view = Object.assign(Object.create(MarkdownView.prototype), { editor: {} })
    expect(commandAvailable(fakeApp(cmds, view).app as never, 'ed')).toBe(true)
    expect(commandAvailable(fakeApp(cmds, view).app as never, 'edc')).toBe(false)
  })
})

describe('the menu', () => {
  let ran: { script: string; params: Record<string, unknown> }[]
  let settingsOpened: number

  beforeEach(() => {
    ran = []
    settingsOpened = 0
  })

  const deps = (over: Partial<QuickMenuDeps>): QuickMenuDeps => ({
    app: fakeApp([]).app as never,
    view: null,
    actions: [],
    headerButtons: [],
    runScript: async (script, params) => void ran.push({ script, params }),
    openSettings: () => settingsOpened++,
    noteActions: () => {},
    ...over,
  })

  it('lists the user’s own first, leaving out a command that cannot run here', () => {
    const { app, executed } = fakeApp([
      command({ id: 'core:daily', name: 'Open today', icon: 'calendar', callback: () => {} }),
      command({ id: 'core:note-only', name: 'Note only', checkCallback: () => false }),
      command({ id: 'command-palette:open', name: 'Open command palette' }),
    ])
    const menu = new Menu()
    fillQuickMenu(
      menu as never,
      deps({
        app: app as never,
        actions: [
          action({ id: 'a', commandId: 'core:daily' }),
          action({ id: 'b', commandId: 'core:note-only' }),
          action({
            id: 'c',
            type: 'script',
            scriptName: 'Add film',
            name: 'New film',
            icon: 'film',
          }),
        ],
      })
    )
    expect(titles(menu)).toEqual(['Open today', 'New film', 'Command palette'])
    expect(menu.items[0].icon).toBe('calendar')
    expect(menu.items[1].icon).toBe('film')
    expect(sections(menu)).toEqual(['abele-mine', 'abele-mine', 'abele-always'])

    menu.items[0].handler!()
    menu.items[1].handler!()
    menu.items[2].handler!()
    expect(executed).toEqual(['core:daily', 'command-palette:open'])
    expect(ran).toEqual([{ script: 'Add film', params: {} }])
  })

  it('drops the plugin prefix from a command’s own name', () => {
    const { app } = fakeApp([command({ id: 'abele:x', name: 'Abele: Start timer', callback() {} })])
    const menu = new Menu()
    fillQuickMenu(
      menu as never,
      deps({ app: app as never, actions: [action({ commandId: 'abele:x' })] })
    )
    expect(titles(menu)[0]).toBe('Start timer')
  })

  it('then the note’s header buttons, then what the view offers', () => {
    const view = {
      fillQuickMenu: (menu: Menu) =>
        menu.addItem((item) => item.setTitle('Search in the book').setIcon('search')),
    }
    const menu = new Menu()
    fillQuickMenu(
      menu as never,
      deps({
        view: view as never,
        headerButtons: [
          {
            id: 'h',
            name: 'Rate',
            icon: 'star',
            run: () => void ran.push({ script: 'Rate', params: {} }),
          },
        ],
      })
    )
    expect(titles(menu)).toEqual(['Rate', 'Search in the book', 'Command palette'])
    expect(sections(menu).slice(0, 2)).toEqual(['abele-mine', 'abele-here'])
  })

  it('asks for the note’s own actions when a note is in front', () => {
    const file = Object.assign(new TFile(), { path: 'Films/Heat.md' })
    const view = Object.assign(Object.create(MarkdownView.prototype), { file })
    const noteActions = vi.fn((menu: Menu) => menu.addItem((i) => i.setTitle('Start timer')))
    const menu = new Menu()
    fillQuickMenu(menu as never, deps({ view: view as never, noteActions }))
    expect(noteActions).toHaveBeenCalledWith(menu, file)
    expect(titles(menu)).toContain('Start timer')
  })

  it('with nothing of his own, offers to choose what it holds', () => {
    const menu = new Menu()
    fillQuickMenu(menu as never, deps({}))
    expect(titles(menu)).toEqual(['Choose what this menu holds…', 'Command palette'])
    menu.items[0].handler!()
    expect(settingsOpened).toBe(1)
  })
})
