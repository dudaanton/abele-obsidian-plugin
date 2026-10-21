import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { PromptSchema } from '@abele/node-protocol'
import { useVault } from '../helpers/testEnv'
import NodeQuestionnaire from '@/components/NodeQuestionnaire.vue'
import ChatQuestionCard from '@/components/ChatQuestionCard.vue'
const prompt = PromptSchema.parse({
  kind: 'questionnaire',
  prompt_id: 'sample-prompt',
  session_id: 'sample-session',
  run_id: 'sample-run',
  revision: 1,
  action_digest: 'a'.repeat(64),
  expires_at: Number.MAX_SAFE_INTEGER,
  state: 'pending',
  choice: null,
  installation_id: null,
  delivered: false,
  questions: [
    { question: 'Pick a sample', options: ['First', 'Second'], allow_custom: false },
    { question: 'Pick several', options: ['Red', 'Blue'], type: 'multi' },
    { question: 'A sample text', type: 'input' },
  ],
})
it('uses ordinary question cards for single, multi and text answers in question order', async () => {
  useVault([])
  const view = mount(NodeQuestionnaire, { props: { prompt } })
  try {
    expect(view.text()).not.toContain('Your own answer')
    view.findComponent(ChatQuestionCard).vm.$emit('answer', 'Second')
    await view.vm.$nextTick()
    view.findComponent(ChatQuestionCard).vm.$emit('answer', 'Red')
    await view.vm.$nextTick()
    view.findComponent(ChatQuestionCard).vm.$emit('answer', 'Blue')
    await view.vm.$nextTick()
    await view
      .findAll('button')
      .find((button) => button.text() === 'Answer')!
      .trigger('click')
    await view.find('textarea').setValue('Sample text')
    expect(view.find('textarea').element.closest('.abele-chat-question')).not.toBeNull()
    await view
      .findAll('button')
      .find((button) => button.text() === 'Answer')!
      .trigger('click')
    expect(view.emitted('answer')).toEqual([[['Second', ['Red', 'Blue'], 'Sample text']]])
  } finally {
    view.unmount()
  }
})
it('aborts the whole questionnaire and does not accept answers while offline', async () => {
  useVault([])
  const view = mount(NodeQuestionnaire, { props: { prompt, disabled: true } })
  try {
    view.findComponent(ChatQuestionCard).vm.$emit('answer', 'First')
    await view.vm.$nextTick()
    expect(view.emitted('answer')).toBeUndefined()
    await view.setProps({ disabled: false })
    view.findComponent(ChatQuestionCard).vm.$emit('skip')
    expect(view.emitted('answer')).toEqual([[null]])
  } finally {
    view.unmount()
  }
})
