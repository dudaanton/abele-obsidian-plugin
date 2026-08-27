/**
 * What an approval prompt shows before a tool is allowed to run.
 *
 * `write` replaces a file whole and refuses a path that names no file — so what it is really
 * asking approval for is the difference between what the file holds and what it would hold.
 * Shown as plain content, the prompt says only the second half, and approving it meant
 * agreeing to lose something the prompt never mentioned. `create` is the opposite case: its
 * file does not exist yet, so plain content is the whole truth and a diff would be a lie.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import Diff from '@/components/Diff.vue'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const EXISTING = 'Notes/Existing.md'

let app: FakeApp

beforeEach(() => {
  app = useVault([{ path: EXISTING, content: 'The original body.\n' }])
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: undefined,
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function approval(toolName: string, params: Record<string, unknown>) {
  const message: ChatMessage = {
    id: 'm1',
    role: 'tool-call',
    content: '',
    timestamp: 1,
    toolName,
    toolParams: params,
    toolStatus: 'pending',
  } as ChatMessage

  return mount(AiToolApproval, { props: { message } })
}

/** The read is asynchronous, so the diff appears a tick after mounting. */
async function settled(wrapper: ReturnType<typeof approval>) {
  await nextTick()
  await nextTick()
  return wrapper
}

describe('approving a write to a file that exists', () => {
  it('shows what it does to the file, not just what it would contain', async () => {
    const wrapper = await settled(
      approval('write', { path: EXISTING, content: 'A replacement body.\n' })
    )

    const diff = wrapper.findComponent(Diff)
    expect(diff.exists()).toBe(true)
    expect(diff.props('textLeft')).toContain('The original body.')
    expect(diff.props('textRight')).toBe('A replacement body.\n')
  })

  it('drops the plain content preview, which said only half of it', async () => {
    const wrapper = await settled(
      approval('write', { path: EXISTING, content: 'A replacement body.\n' })
    )

    expect(wrapper.find('.abele-tool-approval__code').exists()).toBe(false)
  })

  it('names the file either way', async () => {
    const wrapper = await settled(approval('write', { path: EXISTING, content: 'x' }))

    expect(wrapper.find('.abele-tool-approval__path').text()).toBe(EXISTING)
  })
})

describe('when there is nothing to compare against', () => {
  it('falls back to the content for a path naming no file', async () => {
    const wrapper = await settled(
      approval('write', { path: 'Notes/Missing.md', content: 'Some content.' })
    )

    expect(wrapper.findComponent(Diff).exists()).toBe(false)
    expect(wrapper.find('.abele-tool-approval__code').text()).toBe('Some content.')
  })

  it('leaves create showing its content, since its file does not exist yet', async () => {
    // Even on a path that does exist: `create` is not the tool that overwrites.
    const wrapper = await settled(approval('create', { path: EXISTING, content: 'New note.' }))

    expect(wrapper.findComponent(Diff).exists()).toBe(false)
    expect(wrapper.find('.abele-tool-approval__code').text()).toBe('New note.')
  })

  it('does not read a file it has no intention of comparing against', async () => {
    // An approval prompt can sit on screen for a while, and every other tool would otherwise
    // pay for a read whose result nothing displays.
    const before = app.stats.read

    await settled(approval('create', { path: EXISTING, content: 'New note.' }))

    expect(app.stats.read).toBe(before)
  })
})

describe('an edit', () => {
  it('still diffs the strings it was given, without reading the file', async () => {
    const wrapper = await settled(
      approval('edit', { path: EXISTING, old_string: 'before', new_string: 'after' })
    )

    const diff = wrapper.findComponent(Diff)
    expect(diff.props('textLeft')).toBe('before')
    expect(diff.props('textRight')).toBe('after')
  })
})
