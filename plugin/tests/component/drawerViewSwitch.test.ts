import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Menu, Platform } from 'obsidian'
import { readFileSync } from 'node:fs'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import ListSectionHeader from '@/components/obsidian/ListSectionHeader.vue'
import Section from '@/components/obsidian/Section.vue'

const workspace = vi.hoisted(() => ({
  iterateAllLeaves: vi.fn(),
  setActiveLeaf: vi.fn(),
  revealLeaf: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace } }) },
}))

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.replaceChildren()
  Platform.isPhone = false
  vi.restoreAllMocks()
  workspace.iterateAllLeaves.mockReset()
  workspace.setActiveLeaf.mockReset()
  workspace.revealLeaf.mockClear()
})
async function render(phone: boolean, drawer: boolean) {
  Platform.isPhone = phone
  const host = document.createElement('div')
  if (drawer) host.className = 'workspace-drawer'
  const select = document.createElement('button')
  select.className = 'workspace-drawer-tab-select'
  host.append(select)
  document.body.append(host)
  const wrapper = mount(DrawerViewSwitch, {
    attachTo: host,
    props: { icon: 'bot', name: 'Sample panel' },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, select }
}
it.each([
  [false, true],
  [true, false],
  [false, false],
])('stays hidden on phone=%s drawer=%s', async (phone, drawer) => {
  const { wrapper } = await render(phone, drawer)
  expect(wrapper.find('.is-shown').exists()).toBe(false)
  expect(wrapper.find('span[hidden]').exists()).toBe(true)
})
it('opens its own drawer leaves by pointer and keyboard without a hidden selector click', async () => {
  const other = document.createElement('button')
  other.className = 'workspace-drawer-tab-select'
  document.body.append(other)
  const wrong = vi.spyOn(other, 'click')
  const { wrapper, select } = await render(true, true)
  const click = vi.spyOn(select, 'click')
  select.style.display = 'none'
  const root = {}
  const current = {
    getRoot: () => root,
    view: {
      containerEl: wrapper.element.parentElement!,
      getDisplayText: () => 'Sample chat',
      getIcon: () => 'bot',
    },
  }
  const calendarEl = document.createElement('div')
  // Inactive mobile drawer leaves may be detached from the document.
  const calendar = {
    getRoot: () => root,
    view: {
      containerEl: calendarEl,
      getDisplayText: () => 'Sample calendar',
      getIcon: () => 'calendar',
    },
  }
  const elsewhere = {
    getRoot: () => ({}),
    view: { containerEl: other, getDisplayText: () => 'Other panel', getIcon: () => 'file' },
  }
  workspace.iterateAllLeaves.mockImplementation((visit) => {
    // Obsidian stops iterating a subtree when the callback returns truthy.
    for (const leaf of [elsewhere, current, calendar]) {
      if (visit(leaf)) break
    }
  })
  const shown = vi.spyOn(Menu.prototype, 'showAtPosition').mockImplementation(function (
    this: Menu
  ) {
    this.unload = vi.fn()
    return this
  })
  const control = wrapper.get('.abele-drawer-switch.is-shown')
  await control.trigger('click')
  await control.trigger('keydown', { key: 'Enter' })
  await control.trigger('keydown', { key: ' ' })
  expect(shown).toHaveBeenCalledTimes(3)
  const menu = shown.mock.instances[2] as Menu
  expect(menu.items.map((item) => [item.title, item.icon, item.checked])).toEqual([
    ['Sample chat', 'bot', true],
    ['Sample calendar', 'calendar', false],
  ])
  expect(shown).toHaveBeenLastCalledWith({ x: 0, y: 0 }, control.element.ownerDocument)
  menu.items[1].handler!()
  await flushPromises()
  expect(workspace.revealLeaf).toHaveBeenCalledWith(calendar)
  expect(workspace.setActiveLeaf).toHaveBeenCalledWith(calendar, { focus: true })
  expect(click).not.toHaveBeenCalled()
  expect(wrong).not.toHaveBeenCalled()
  expect(control.attributes('aria-label')).toContain('Another view in this panel')
  expect(wrapper.get('.abele-drawer-switch__glyph').attributes('data-icon')).toBe('bot')
  expect(wrapper.get('.abele-drawer-switch__arrows').attributes('data-icon')).toBe(
    'chevrons-up-down'
  )
  await wrapper.setProps({ icon: 'calendar', name: 'Sample calendar' })
  await flushPromises()
  expect(wrapper.get('.abele-drawer-switch__glyph').attributes('data-icon')).toBe('calendar')
  expect(control.attributes('aria-label')).toContain('Sample calendar')
})
const views = [
  ['AiChat.vue', 'bot'],
  ['TimelineSidebar.vue', 'chart-gantt'],
  ['TodoSidebar.vue', 'list-todo'],
  ['FinanceSidebar.vue', 'wallet'],
  ['AccountsSidebar.vue', 'landmark'],
  ['TimeTrackingSidebar.vue', 'timer'],
  ['nodeWork/NodePanel.vue', 'server'],
  ['ScriptRuns.vue', 'terminal'],
  ['github/GithubHeader.vue', 'github'],
  ['github/GithubNotifications.vue', 'bell'],
  ['debugger/DebugPanel.vue', 'bug-play'],
  ['debugger/http/RequestsPanel.vue', 'send-horizontal'],
  ['github/GithubItem.vue', 'github'],
  ['AiRunView.vue', 'bot'],
  ['NodeSidebarChat.vue', 'bot'],
]
it.each(views)('%s carries its drawer switch with the view icon', (file, icon) => {
  const source = readFileSync(`src/components/${file}`, 'utf8')
  expect(new RegExp(`<DrawerViewSwitch[^>]*icon="${icon}"`).test(source)).toBe(true)
})
it('scripted sidebar views use their current title and icon', () => {
  const source = readFileSync('src/components/ScriptView.vue', 'utf8')
  expect(source.includes(':icon="model.view?.icon ?? \'scroll-text\'"')).toBe(true)
  expect(
    source.includes(':name="model.view?.title ?? model.saved?.script ?? \'Script view\'"')
  ).toBe(true)
})
it('follows a view moved into and out of a phone drawer', async () => {
  const { wrapper } = await render(true, false)
  const drawer = document.createElement('div')
  drawer.className = 'workspace-drawer'
  document.body.append(drawer)
  const host = wrapper.element.parentElement!
  drawer.append(host)
  await flushPromises()
  expect(wrapper.find('.is-shown').exists()).toBe(true)
  document.body.append(host)
  await flushPromises()
  expect(wrapper.find('.is-shown').exists()).toBe(false)
  expect(wrapper.emitted('shown')?.map(([value]) => value)).toEqual([false, true, false])
})
// BUG: happy-dom matches the two descendants independently inside :has(). The live
// drawer test also checks this guarantee in Chromium, including retained inactive leaves.
it.fails(
  'the footer hiding selector stops matching when a retained Abele tab becomes inactive',
  () => {
    const source = readFileSync('src/components/obsidian/DrawerViewSwitch.vue', 'utf8')
    const selector = source.match(/\.workspace-drawer:has\([^{}]+\)/)![0]
    const drawer = document.createElement('div')
    drawer.className = 'workspace-drawer'
    const active = document.createElement('div')
    active.className = 'workspace-drawer-active-tab-content'
    const control = document.createElement('div')
    control.className = 'abele-drawer-switch is-shown'
    active.append(control)
    drawer.append(active, document.createElement('div'))
    document.body.append(drawer)
    expect(drawer.matches(selector)).toBe(true)
    drawer.firstElementChild!.className = ''
    drawer.lastElementChild!.className = 'workspace-drawer-active-tab-content'
    expect(drawer.matches(selector)).toBe(false)
  }
)
it('puts the list header lead before its title, preserving the existing leading slot', () => {
  const wrapper = mount(ListSectionHeader, {
    props: { text: 'Samples', count: 3 },
    slots: { lead: '<span class="sample-switch" />', leading: '<span class="sample-action" />' },
  })
  wrappers.push(wrapper)
  const row = wrapper.get('.abele-list-section-header__leading').element
  expect(row.firstElementChild?.className).toBe('sample-switch')
  expect(row.lastElementChild?.className).toBe('sample-action')
})
it('puts a section lead before its heading and actions', () => {
  const wrapper = mount(Section, {
    props: { title: 'Samples' },
    slots: { lead: '<span class="sample-switch" />', actions: '<span class="sample-action" />' },
  })
  wrappers.push(wrapper)
  const row = wrapper.get('.abele-section__header').element
  expect(row.firstElementChild?.className).toBe('sample-switch')
  expect(row.lastElementChild?.querySelector('.sample-action')).toBeTruthy()
})
