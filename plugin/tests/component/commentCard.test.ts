/**
 * The margin card, as phase 2 leaves it: a placeholder that names the comments sitting at its
 * marker and nothing else. Phase 4 replaces the body with the thread and the input, and grows
 * this file with it; what must hold from here on is that the card is reachable from an entry
 * and says which comments it stands for.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommentCard from '@/components/CommentCard.vue'
import { CommentEntry } from '@/entities/Comment'

function entryFor(ids: string[]): CommentEntry {
  return new CommentEntry({ id: 'vue-1', ids, notePath: 'Notes/Anchor.md', markerFrom: 20 })
}

describe('the comment card', () => {
  it('names the comment it stands for and the note it is anchored in', () => {
    const wrapper = mount(CommentCard, { props: { entry: entryFor(['k7d2ph']) } })

    expect(wrapper.text()).toContain('k7d2ph')
    expect(wrapper.text()).toContain('Notes/Anchor.md')
  })

  it('names every comment when a marker carries several', () => {
    const wrapper = mount(CommentCard, { props: { entry: entryFor(['k7d2ph', '3mq0xa']) } })

    expect(wrapper.text()).toContain('k7d2ph, 3mq0xa')
  })
})
