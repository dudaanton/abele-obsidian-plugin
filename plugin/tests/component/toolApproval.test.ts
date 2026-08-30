/**
 * What an approval prompt shows before a tool is allowed to run, and what it offers to stop
 * asking about.
 *
 * `write` replaces a file whole and refuses a path that names no file — so what it is really
 * asking approval for is the difference between what the file holds and what it would hold.
 * Shown as plain content, the prompt says only the second half, and approving it meant
 * agreeing to lose something the prompt never mentioned. `create` is the opposite case: its
 * file does not exist yet, so plain content is the whole truth and a diff would be a lie.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import Diff from '@/components/Diff.vue'
import { ChatService } from '@/ai/ChatService'
import Button from '@/components/obsidian/Button.vue'
import type { ChatMessage, PermissionMode, ToolMode } from '@/ai/types'
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

/**
 * A session standing in for the chat behind the prompt: what mode it is in, and what happens
 * when a call is approved.
 */
function sessionIn(mode: PermissionMode, toolMode: ToolMode = 'off') {
  const permissionMode = ref<PermissionMode>(mode)
  const toolModes = ref<Record<string, ToolMode>>({})
  const approvals: string[] = []
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: {
      permissionMode,
      getToolMode: () => toolMode,
      toolModes,
      approveToolCall: () => approvals.push('approved'),
      rejectToolCall: () => approvals.push('rejected'),
    },
  } as never)
  return { permissionMode, toolModes, approvals }
}

const buttonSaying = (wrapper: ReturnType<typeof approval>, text: string) =>
  wrapper.findAllComponents(Button).find((b) => b.props('text') === text)

describe('being offered to stop confirming every write', () => {
  it('is offered on a write, while each one is still being confirmed', () => {
    sessionIn('confirm-all')

    const wrapper = approval('create', { path: 'Notes/New.md', content: 'x' })

    expect(buttonSaying(wrapper, 'Always allow writes')).toBeDefined()
  })

  it('turns on the mode and approves the call that asked', () => {
    const { permissionMode, approvals } = sessionIn('confirm-all')
    const wrapper = approval('write', { path: EXISTING, content: 'x' })

    buttonSaying(wrapper, 'Always allow writes')?.vm.$emit('click')

    expect(permissionMode.value).toBe('allow-edit')
    expect(approvals).toEqual(['approved'])
  })

  it('is not offered again once writes already go through', () => {
    sessionIn('allow-edit')

    const wrapper = approval('write', { path: EXISTING, content: 'x' })

    expect(buttonSaying(wrapper, 'Always allow writes')).toBeUndefined()
  })

  it('is not offered for what the mode would not cover — deleting, moving, running code', () => {
    sessionIn('confirm-all')

    for (const [tool, params] of [
      ['rm', { path: EXISTING }],
      ['mv', { from: EXISTING, to: 'Notes/Moved.md' }],
      ['eval_js', { code: 'x' }],
    ] as const) {
      expect(buttonSaying(approval(tool, params), 'Always allow writes')).toBeUndefined()
    }
  })
})

/**
 * The button that stops a tool being asked about, and what it says it does.
 *
 * It was labelled "Allow all", which was read as "let the agent get on with everything" — the
 * natural reading with twenty calls queued behind the prompt. What it actually does is put
 * this one tool on automatic; the next call to anything else asks again, which looks like the
 * button not having worked. Both buttons now name their scope on their face.
 */
describe('being offered to stop confirming one tool', () => {
  const SCRIPT = 'script_english-word-card'

  it('is offered while that tool is still being asked about', () => {
    sessionIn('confirm-all', 'ask')

    const wrapper = approval(SCRIPT, { word: 'ellipsis' })

    expect(buttonSaying(wrapper, 'Always allow')).toBeDefined()
  })

  it('does not claim to allow everything', () => {
    sessionIn('confirm-all', 'ask')

    const wrapper = approval(SCRIPT, { word: 'ellipsis' })

    expect(buttonSaying(wrapper, 'Allow all')).toBeUndefined()
  })

  it('names the tool it would stop asking about', () => {
    sessionIn('confirm-all', 'ask')

    const wrapper = approval(SCRIPT, { word: 'ellipsis' })

    expect(buttonSaying(wrapper, 'Always allow')?.props('tooltip')).toContain(SCRIPT)
  })

  it('says that everything else still asks', () => {
    sessionIn('confirm-all', 'ask')

    const wrapper = approval(SCRIPT, { word: 'ellipsis' })

    expect(buttonSaying(wrapper, 'Always allow')?.props('tooltip')).toMatch(/still ask/i)
  })

  it('puts that tool on automatic and approves the call that asked', () => {
    const { toolModes, approvals } = sessionIn('confirm-all', 'ask')
    const wrapper = approval(SCRIPT, { word: 'ellipsis' })

    buttonSaying(wrapper, 'Always allow')?.vm.$emit('click')

    expect(toolModes.value).toEqual({ [SCRIPT]: 'auto' })
    expect(approvals).toEqual(['approved'])
  })

  it('is not offered once that tool already goes through', () => {
    sessionIn('confirm-all', 'auto')

    const wrapper = approval(SCRIPT, { word: 'ellipsis' })

    expect(buttonSaying(wrapper, 'Always allow')).toBeUndefined()
  })
})

describe('the button that stops confirming every write', () => {
  it('says on its face that writes are all it covers', () => {
    sessionIn('confirm-all')

    const wrapper = approval('write', { path: EXISTING, content: 'x' })

    expect(buttonSaying(wrapper, 'Always allow writes')).toBeDefined()
    expect(buttonSaying(wrapper, 'Approve all')).toBeUndefined()
  })
})
