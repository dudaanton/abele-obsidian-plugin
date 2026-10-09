import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DesignCatalogue from '@/testing/DesignCatalogue.vue'
import { CATALOGUE_PAGES, CATALOGUE_COMPONENTS } from '@/testing/designCatalogue'
import { readdirSync } from 'node:fs'

describe('test-only design catalogue', () => {
  it('inventories every shared Vue primitive, so new kit entries cannot escape review', () => {
    const kit = readdirSync('src/components/obsidian')
      .filter((name) => name.endsWith('.vue'))
      .map((name) => name.slice(0, -4))
      .sort()
    expect([...CATALOGUE_COMPONENTS].sort()).toEqual(kit)
    expect(CATALOGUE_PAGES).toEqual(expect.arrayContaining(['artifact', 'comment', 'waiting']))
  })
  it('keeps a comment draft while a swatch changes and exposes one primary action', async () => {
    const view = mount(DesignCatalogue, {
      props: { page: 'comment' },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    await view.get('textarea').setValue('Retained draft')
    await view.get('[aria-label="Green"]').trigger('click')
    expect((view.get('textarea').element as HTMLTextAreaElement).value).toBe('Retained draft')
    expect(view.findAll('.mod-cta')).toHaveLength(1)
    expect(view.text()).not.toContain('Add comment')
    view.unmount()
  })
})
