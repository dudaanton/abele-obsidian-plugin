import { t } from '@/i18n'
import type { Menu } from 'obsidian'
import type { ChatSession } from '@/ai/ChatSession'

/**
 * How hard a chat's model thinks: what the composer's control and, on a phone, the agent's menu
 * say and offer. A chat follows its model's level until it picks one of its own.
 */
export type Effort = 'low' | 'medium' | 'high'
export const EFFORTS: Effort[] = ['low', 'medium', 'high']

export const effortLabel = (effort: Effort): string =>
  ({
    low: t('streamB.low.f793de'),
    medium: t('streamB.medium.8e588c'),
    high: t('streamB.high.c4ebc6'),
  })[effort]

/** One bar, two, three; the brain when the provider decides. */
export const effortGlyph = (effort: Effort | undefined): string =>
  effort ? { low: 'signal-low', medium: 'signal-medium', high: 'signal-high' }[effort] : 'brain'

type Session = Pick<ChatSession, 'save'> &
  Partial<Pick<ChatSession, 'resolveModel' | 'isOverridden' | 'reasoningEffort'>> & {
    isStreaming: { value: boolean }
    isExecutingTool: { value: boolean }
  }

export function effortFacts(session: Session | null | undefined) {
  const model = session?.resolveModel?.() ?? null
  const effort = session?.reasoningEffort?.value
  return {
    /** Only a model that reasons has a level to set. */
    shown: !!model?.supportsReasoning,
    own: !!session?.isOverridden?.('reasoningEffort'),
    effort,
    said: effort ? effortLabel(effort) : t('chat.effortDefault'),
    model: model?.name || model?.id || '',
    modelEffort: model?.reasoningEffort
      ? effortLabel(model.reasoningEffort).toLowerCase()
      : t('chat.effortProviderDefault'),
  }
}

/** The way back to the model's level and the three levels, checked at the one in force. */
export function addEffortItems(menu: Menu, session: Session, heading = false): void {
  const facts = effortFacts(session)
  const set = (value: Effort | undefined) => {
    if (!session.reasoningEffort) return
    session.reasoningEffort.value = value
    void session.save()
  }
  if (heading)
    menu.addItem((i) => i.setTitle(t('chat.effort')).setIsLabel(true).setSection('effort'))
  if (session.isStreaming.value || session.isExecutingTool.value)
    menu.addItem((i) => i.setTitle(t('chat.nextMessage')).setIsLabel(true).setSection('effort'))
  menu.addItem((i) =>
    i
      .setTitle(t('chat.effortFollow', { model: facts.model, effort: facts.modelEffort }))
      .setChecked(!facts.own)
      .setSection('effort')
      .onClick(() => set(undefined))
  )
  for (const level of EFFORTS)
    menu.addItem((i) =>
      i
        .setTitle(effortLabel(level))
        .setChecked(facts.own && facts.effort === level)
        .setSection('effort-levels')
        .onClick(() => set(level))
    )
}
