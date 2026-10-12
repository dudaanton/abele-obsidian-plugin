import { computed, nextTick, onUnmounted, ref, shallowRef, watch, watchEffect, type Ref } from 'vue'
import { Notice } from 'obsidian'
import type { ChatSession } from '@/ai/ChatSession'
import type { ChatService } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import type { FindPart } from '@/ai/chatFind'
import { navigationPath, type NavigationState } from '@/ai/chatNavigation'
import {
  buildNavigationTree,
  navigationFork,
  selectedNavigationFork,
} from '@/ai/chatNavigationBranches'
import type { ConversationOwner } from '@/ai/draftImports'
import type AiChatMessage from '@/components/AiChatMessage.vue'
import type { useChatFind } from './useChatFind'
import { AUTO_SCROLL_THRESHOLD_PX, type ReadingPlace, type useChatScroll } from './useChatScroll'
import { offsetOf } from './useChatScrollAnchors'

interface ChatNavigationOptions {
  session: Ref<ChatSession | null>
  chatService: ChatService
  messagesContainer: Ref<HTMLElement | null>
  composing: Ref<boolean>
  attachmentOwner: Ref<ConversationOwner | undefined>
  scroll: ReturnType<typeof useChatScroll>
  revealMessage: (
    id: string,
    passage?: undefined,
    exact?: undefined,
    flashWholeMessage?: boolean,
    currentBranchOnly?: boolean
  ) => Promise<boolean | undefined>
  messageRefs: Map<string, InstanceType<typeof AiChatMessage>>
  find: ReturnType<typeof useChatFind>
  reportReplyError: (error: unknown) => void
}

/** Navigation: memory only, never a send. Branch choices retain their existing turn guards. */
export function useChatNavigation(options: ChatNavigationOptions) {
  const {
    session,
    chatService,
    messagesContainer,
    composing,
    attachmentOwner,
    scroll,
    revealMessage,
    messageRefs,
    find,
    reportReplyError,
  } = options
  const { olderCount, clearAnchor, endSteady, scrollOnUserSend, returnTo } = scroll
  let closed = false
  onUnmounted(() => {
    closed = true
  })

  const navigationOpen = ref(false)
  const navigationActiveMessage = ref<string>()
  const navigationState = shallowRef<NavigationState>({ expanded: [], scrollTop: 0 })
  const navigationMemory = new WeakMap<
    ChatSession,
    { version: number; state: NavigationState; indicator?: NavigationIndicator | null }
  >()
  const navigationFocusFork = ref<string>()
  interface NavigationIndicator {
    owner: ChatSession
    version: number
    parentId?: string
  }
  const navigationIndicator = shallowRef<NavigationIndicator | null>(null)
  const indicatorFor = (owner: ChatSession) => {
    const indicator =
      navigationIndicator.value?.owner === owner
        ? navigationIndicator.value
        : navigationMemory.get(owner)?.indicator
    return indicator?.version === owner.conversationVersion.value ? indicator : null
  }
  const rememberNavigationIndicator = (
    owner: ChatSession,
    indicator: NavigationIndicator | null
  ) => {
    const memory = navigationMemory.get(owner) ?? {
      version: owner.conversationVersion.value,
      state: { expanded: [], scrollTop: 0 },
    }
    memory.indicator = indicator
    navigationMemory.set(owner, memory)
    navigationIndicator.value = indicator
  }
  const navigationBadge = computed(() => {
    const owner = session.value
    const indicator = owner ? indicatorFor(owner) : null
    if (!indicator || !owner) return null
    const fork = navigationFork(
      buildNavigationTree(owner.allMessages.value),
      indicator.parentId,
      owner.messages.value.map((m) => m.id)
    )
    const index = fork?.choices.findIndex((choice) => choice.selected) ?? -1
    return fork && index >= 0 ? { fork, index } : null
  })
  let navigationIntent = 0
  interface PendingNavigation {
    owner: ChatSession
    source: ChatSession | null
    version: number
    selection: number
    intent: number
    label: string
    run: () => Promise<void>
  }
  const pendingNavigation = shallowRef<PendingNavigation | null>(null)
  const branchBlocked = (owner: ChatSession) =>
    owner.branchSwitchBlocked ??
    (owner.isMidTurn ||
      owner.isExecutingTool.value ||
      !!owner.retrying?.value ||
      owner.interceptor.streaming.value ||
      owner.moving.value)
  const pendingIsCurrent = (pending: PendingNavigation) =>
    !closed &&
    !pending.owner.isDestroyed &&
    pending.source === session.value &&
    pending.version === pending.owner.conversationVersion.value &&
    pending.selection === chatService.tabSelectionVersion &&
    pending.intent === navigationIntent
  const cancelPendingNavigation = () => {
    navigationIntent++
    pendingNavigation.value = null
  }
  const deferNavigation = (owner: ChatSession, run: () => Promise<void>) => {
    pendingNavigation.value = {
      owner,
      source: session.value,
      version: owner.conversationVersion.value,
      selection: chatService.tabSelectionVersion,
      intent: navigationIntent,
      label: 'Switch to the selected continuation when the agent finishes',
      run,
    }
  }
  watch(
    [
      pendingNavigation,
      session,
      () => pendingNavigation.value?.owner.messages.value,
      () => (pendingNavigation.value ? branchBlocked(pendingNavigation.value.owner) : false),
    ],
    () => {
      const pending = pendingNavigation.value
      if (!pending) return
      if (!pendingIsCurrent(pending)) {
        pendingNavigation.value = null
        return
      }
      if (branchBlocked(pending.owner)) return
      pendingNavigation.value = null
      void pending.run().catch(reportReplyError)
    },
    { flush: 'post' }
  )
  interface NavigationPlace {
    owner: ChatSession
    version: number
    leafId: string | null
    branchVersion: number
    grows: boolean
    indicator: NavigationIndicator | null
    place: ReadingPlace | null
  }
  const navigationReturns = shallowRef<NavigationPlace[]>([])
  watchEffect(
    () => {
      for (const place of navigationReturns.value) {
        const owner = place.owner
        if (
          !place.grows ||
          owner.isDestroyed ||
          owner.conversationVersion.value !== place.version ||
          (owner.branchSelectionVersion ?? 0) !== place.branchVersion
        )
          continue
        if (place.leafId && owner.messages.value.some((message) => message.id === place.leafId))
          place.leafId = owner.branchLeafId ?? owner.messages.value.at(-1)?.id ?? place.leafId
      }
    },
    { flush: 'sync' }
  )
  let navigationOpenedAt: NavigationPlace | null = null
  const pruneNavigationReturns = () => {
    navigationReturns.value = navigationReturns.value.filter(
      (place) => !place.owner.isDestroyed && place.owner.conversationVersion.value === place.version
    )
  }

  const openNavigation = (forkId?: string) => {
    const owner = session.value
    if (!owner) return
    pruneNavigationReturns()
    const version = owner.conversationVersion.value
    let memory = navigationMemory.get(owner)
    if (!memory || memory.version !== version) {
      memory = { version, state: { expanded: [], scrollTop: 0 } }
      navigationMemory.set(owner, memory)
    }
    navigationFocusFork.value = forkId
    if (forkId && !memory.state.expanded.includes(`fork:${forkId}`))
      memory.state.expanded.push(`fork:${forkId}`)
    navigationState.value = memory.state
    const el = messagesContainer.value
    const top = el?.getBoundingClientRect().top ?? 0
    const first = Array.from(el?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find(
      (m) => m.getBoundingClientRect().bottom > top
    )
    navigationActiveMessage.value = first?.dataset.messageId
    const atEnd = !el || el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX
    navigationOpenedAt = {
      owner,
      version,
      leafId: owner.branchLeafId ?? owner.messages.value.at(-1)?.id ?? null,
      branchVersion: owner.branchSelectionVersion ?? 0,
      grows: !owner.allMessages.value.some(
        (message) => message.parentId === (owner.branchLeafId ?? owner.messages.value.at(-1)?.id)
      ),
      indicator: indicatorFor(owner),
      place:
        !atEnd && first?.dataset.messageId && el
          ? {
              messageId: first.dataset.messageId,
              offset: offsetOf(first, el),
              hidden: olderCount.value,
            }
          : null,
    }
    navigationOpen.value = true
  }
  const saveNavigationReturn = () => {
    pruneNavigationReturns()
    const place = navigationOpenedAt
    if (
      !place ||
      place.owner !== session.value ||
      place.version !== place.owner.conversationVersion.value
    )
      return
    const previous = navigationReturns.value.at(-1)
    if (previous?.owner !== place.owner || previous.version !== place.version)
      navigationReturns.value = [...navigationReturns.value, place]
  }
  const applyNavigationJump = async (
    owner: ChatSession,
    id: string,
    part?: FindPart,
    query?: string
  ) => {
    const intent = navigationIntent
    const version = owner.conversationVersion.value
    if (session.value !== owner || !owner.allMessages.value.some((m) => m.id === id && !m.draft))
      return
    if (!owner.messages.value.some((m) => m.id === id)) {
      if (branchBlocked(owner)) {
        deferNavigation(owner, () => applyNavigationJump(owner, id, part, query))
        return
      }
      if (!owner.switchBranch(id)) {
        new Notice('That continuation is unavailable')
        return
      }
      const chosen = selectedNavigationFork(
        buildNavigationTree(owner.allMessages.value),
        navigationPath(owner.allMessages.value, id)
      )
      rememberNavigationIndicator(
        owner,
        chosen ? { owner, version, parentId: chosen.fork.parentId } : null
      )
    }
    scroll.shouldAutoScroll = false
    composing.value = false
    await revealMessage(id, undefined, undefined, true, true)
    if (
      session.value !== owner ||
      owner.conversationVersion.value !== version ||
      intent !== navigationIntent ||
      !owner.messages.value.some((m) => m.id === id)
    )
      return
    const revealPart =
      part ??
      (owner.messages.value.find((m) => m.id === id)?.role === 'tool-call' ? 'params' : undefined)
    if (revealPart) messageRefs.get(id)?.revealPart(revealPart)
    if (query) find.openAt(query, id, false, part)
  }
  const navigationJump = async (id: string, part?: FindPart, query?: string) => {
    const owner = session.value
    if (!owner || !id || !owner.allMessages.value.some((m) => m.id === id && !m.draft)) return
    cancelPendingNavigation()
    saveNavigationReturn()
    navigationOpen.value = false
    await applyNavigationJump(owner, id, part, query)
  }
  const navigationLatest = () => {
    cancelPendingNavigation()
    saveNavigationReturn()
    navigationOpen.value = false
    clearAnchor()
    endSteady(messagesContainer.value)
    scrollOnUserSend()
  }
  const navigationDiscussion = async (
    id: string,
    messageId?: string,
    part?: FindPart,
    query?: string
  ) => {
    const owner = session.value
    if (!owner) return
    cancelPendingNavigation()
    const intent = navigationIntent
    const version = owner.conversationVersion.value
    const selection = chatService.tabSelectionVersion
    const isCurrent = () =>
      !closed &&
      !owner.isDestroyed &&
      navigationIntent === intent &&
      owner.conversationVersion.value === version &&
      chatService.tabSelectionVersion === selection
    saveNavigationReturn()
    navigationOpen.value = false
    const comments = CommentService.getInstance()
    // Read first so a delayed file cannot take over a different chat. Opening uses the marker's
    // existing path, including replacing the one contextual tab for a nested discussion.
    const loaded = await comments.load(id)
    if (!isCurrent() || session.value !== owner) return
    const opened = loaded && (await comments.showInSidebar(id, isCurrent))
    if (!opened && isCurrent()) new Notice('Discussion could not be opened — it may be unavailable')
    if (opened && messageId && session.value === loaded && intent === navigationIntent)
      await applyNavigationJump(loaded, messageId, part, query)
  }
  const navigationPlaceExists = (saved: NavigationPlace) => {
    const owner = saved.owner
    const messageId = saved.place?.messageId
    return (
      !owner.isDestroyed &&
      owner.conversationVersion.value === saved.version &&
      (!saved.leafId || owner.allMessages.value.some((message) => message.id === saved.leafId)) &&
      (!messageId || owner.allMessages.value.some((message) => message.id === messageId))
    )
  }
  const expireNavigationPlace = (saved: NavigationPlace) => {
    new Notice('The saved place is no longer in this conversation')
    navigationReturns.value = navigationReturns.value.filter((place) => place !== saved)
  }
  const restoreNavigationPlace = async (saved: NavigationPlace) => {
    const owner = saved.owner
    const currentLeaf = () => owner.branchLeafId ?? owner.messages.value.at(-1)?.id ?? null
    const needsBranch = () => saved.leafId !== currentLeaf()
    const intent = navigationIntent
    if (!navigationPlaceExists(saved)) {
      expireNavigationPlace(saved)
      return
    }
    if (needsBranch() && branchBlocked(owner)) {
      deferNavigation(owner, () => restoreNavigationPlace(saved))
      return
    }
    const source = session.value
    const sourceVersion = source?.conversationVersion.value
    const selection = chatService.tabSelectionVersion
    const isCurrent = () =>
      !closed &&
      intent === navigationIntent &&
      owner.conversationVersion.value === saved.version &&
      source?.conversationVersion.value === sourceVersion &&
      chatService.tabSelectionVersion === selection
    let returnPointExpired = false
    // The contextual tab is adopted before its phone drawer finishes revealing. Retire an
    // arrived return step at selection, so a second Back advances rather than repeating it.
    const stopSelected = watch(
      session,
      (current) => {
        if (current !== owner || intent !== navigationIntent || needsBranch()) return
        if (!navigationPlaceExists(saved)) {
          returnPointExpired = true
          expireNavigationPlace(saved)
        } else navigationReturns.value = navigationReturns.value.filter((place) => place !== saved)
      },
      { flush: 'sync' }
    )
    try {
      if (owner.kind === 'comment' && owner.commentId) {
        if (
          source !== owner &&
          !(await CommentService.getInstance().showInSidebar(owner.commentId, isCurrent))
        )
          return
      } else chatService.switchTab(owner.id)
    } finally {
      stopSelected()
    }
    if (returnPointExpired) return
    const selected = chatService.tabSelectionVersion
    await nextTick()
    if (
      session.value !== owner ||
      intent !== navigationIntent ||
      selected !== chatService.tabSelectionVersion ||
      owner.conversationVersion.value !== saved.version
    )
      return
    // Opening a discussion can reconcile a changed file without replacing its lifetime.
    if (!navigationPlaceExists(saved)) {
      expireNavigationPlace(saved)
      return
    }
    if (needsBranch()) {
      if (branchBlocked(owner)) {
        deferNavigation(owner, () => restoreNavigationPlace(saved))
        return
      }
      if (!saved.leafId || !owner.switchBranch(saved.leafId, false)) {
        new Notice('The saved continuation is unavailable')
        return
      }
    }
    if (
      saved.place &&
      !owner.messages.value.some((message) => message.id === saved.place!.messageId)
    ) {
      expireNavigationPlace(saved)
      return
    }
    navigationReturns.value = navigationReturns.value.filter((place) => place !== saved)
    rememberNavigationIndicator(owner, saved.indicator)
    clearAnchor()
    endSteady(messagesContainer.value)
    scroll.shouldAutoScroll = saved.place === null
    if (saved.place) await returnTo(saved.place)
    else scrollOnUserSend()
  }
  const navigationBack = async () => {
    cancelPendingNavigation()
    pruneNavigationReturns()
    const saved = navigationReturns.value.at(-1)
    if (!saved) return
    navigationOpen.value = false
    await restoreNavigationPlace(saved)
  }
  watch(
    () => attachmentOwner.value,
    () => {
      navigationOpen.value = false
      pruneNavigationReturns()
    }
  )

  return {
    branchBlocked,
    deferNavigation,
    navigationOpen,
    navigationActiveMessage,
    navigationState,
    navigationFocusFork,
    navigationBadge,
    pendingNavigation,
    navigationReturns,
    cancelPendingNavigation,
    openNavigation,
    navigationJump,
    navigationLatest,
    navigationDiscussion,
    navigationBack,
  }
}
