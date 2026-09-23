/**
 * The find-and-replace base view is teleported into like the sidebars are, and a base can be
 * opened in a phone's closed drawer, where a selector finds nothing in the document.
 */
import { describe, it, expect } from 'vitest'
import { GlobalStore } from '@/stores/GlobalStore'
import { FindAndReplaceView } from '@/bases/FindAndReplaceView'

describe('find and replace base view', () => {
  it('hands over the element it renders into, even when it is not in the page', () => {
    const host = document.createElement('div')
    const view = new FindAndReplaceView({} as never, host)
    const instances = GlobalStore.getInstance().findAndReplaceBasesInstances.value
    const [instance] = [...instances.values()].filter((i) => host.contains(i.el))
    expect(instance).toBeDefined()
    expect(instance.el.isConnected).toBe(false)

    view.onunload()
    expect(GlobalStore.getInstance().findAndReplaceBasesInstances.value.has(instance.id)).toBe(
      false
    )
  })
})
