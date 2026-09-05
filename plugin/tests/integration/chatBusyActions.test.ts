/**
 * Branch, repeat and retry while the agent is busy.
 *
 * They used to do nothing and say nothing, which reads as broken. The tree is still not moved
 * under a turn in progress, but the person is told why.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

let session: ChatSession

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  Notice.shown.length = 0
})

describe('while the agent is answering', () => {
  it('refuses to branch, and says so', () => {
    session.isStreaming.value = true

    session.createBranch('m1')

    expect(Notice.shown.join(' ')).toContain('busy')
    expect(Notice.shown.join(' ')).toContain('branch')
  })

  it('refuses to repeat, and says so', () => {
    session.isExecutingTool.value = true

    session.repeatMessage('m1')

    expect(Notice.shown.join(' ')).toContain('repeat')
  })

  it('refuses to retry, and says so', async () => {
    session.isStreaming.value = true

    await session.retryFromMessage('m1')

    expect(Notice.shown.join(' ')).toContain('retry')
  })
})

describe('while nothing is running', () => {
  it('says nothing about being busy', () => {
    session.createBranch('m1')

    expect(Notice.shown).toEqual([])
  })
})
