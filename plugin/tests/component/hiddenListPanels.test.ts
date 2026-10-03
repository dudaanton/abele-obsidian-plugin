import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import TodoSidebar from '@/components/TodoSidebar.vue'
import { Task } from '@/entities/Task'
import { GlobalStore } from '@/stores/GlobalStore'
import { configureAbele, useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

let view: VueWrapper | undefined
afterEach(() => {
  view?.unmount()
  vi.restoreAllMocks()
})
it('does not sort or filter tasks while hidden, then catches up once without dropping the panel', async () => {
  useVault([])
  configureAbele().applySettings(undefined)
  installFakeIntersectionObserver()
  const tasks = reactive(new Map<string, Task>())
  const sample = (n: number) => new Task({ wikilink: `[[Samples/task-${n}]]` })
  tasks.set('first', sample(1))
  GlobalStore.getInstance().tasksList.value = { tasks } as never
  const sorted = vi.spyOn(Task.prototype, 'getSortTimestamp')
  view = mount(TodoSidebar, { props: { active: true }, global: { stubs: { TaskView: true } } })
  await view.setProps({ active: false })
  sorted.mockClear()
  for (let i = 2; i < 20; i++) tasks.set(String(i), sample(i))
  await nextTick()
  expect(sorted).not.toHaveBeenCalled()
  await view.setProps({ active: true })
  expect(sorted).toHaveBeenCalled()
  const calls = sorted.mock.calls.length
  await nextTick()
  expect(sorted).toHaveBeenCalledTimes(calls)
})
