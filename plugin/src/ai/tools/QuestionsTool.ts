import type { AgentTool } from '../client'
import type { ChatSession } from '../ChatSession'

export function createQuestionsTool(owner?: ChatSession): AgentTool {
  return {
    name: 'questions',
    label: 'Questions',
    description:
      'Ask the user one or more questions with predefined answer options. The user can pick an option or type a custom answer. Use this when you need clarification or the user should choose between alternatives.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question text' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Answer options to show as buttons',
              },
            },
            required: ['question', 'options'],
          },
          description: 'Array of questions to ask the user',
        },
      },
      required: ['questions'],
    },
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      const questions = params.questions as { question: string; options: string[] }[]
      if (!questions?.length) throw new Error('No questions provided')

      if (ctx && !ctx.interactive) throw new Error('Questions require an interactive chat')
      const session = ctx?.session ?? owner
      if (!session) throw new Error('No active session')

      const abort = () => session.abortQuestions()
      signal?.addEventListener('abort', abort, { once: true })
      let answers: string[] | null
      try {
        answers = await session.askQuestions(questions)
      } finally {
        signal?.removeEventListener('abort', abort)
      }

      if (!answers) {
        return { content: [{ type: 'text', text: 'User aborted the questionnaire.' }] }
      }

      const formatted = questions.map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`).join('\n\n')

      return { content: [{ type: 'text', text: formatted }] }
    },
  }
}
