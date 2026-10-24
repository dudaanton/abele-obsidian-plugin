import { nextTick, onBeforeUnmount, watch } from 'vue'
import {
  type RepositoryChange,
  type RepositoryLocation,
  type RepositorySource,
} from '@/repository/source'
import { type ItemData } from '@/github/loadItem'
import { pinIntoView } from '@/github/scrollTo'
import { emptyScreen } from '@/github/screen'
import type { Ref } from 'vue'
import type { Loaded } from '@/github/useLoad'
import type { BasePin } from '@/github/comparison/pins'
import type { GithubScreen } from '@/github/screen'
import type { GithubItemProps } from './types'
interface LiveRefreshOptions {
  props: GithubItemProps
  source: Ref<RepositorySource | null>
  projectPin: Ref<BasePin | null>
  main: Loaded<ItemData>
  screen: GithubScreen
  root: Ref<HTMLElement | undefined>
  loadKey: Ref<string | null>
  anchorPin: { unpin: () => void }
  reload: (retry?: boolean) => Promise<void>
  isActive: () => boolean
}
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
/** Whether a batch's paths touch the file or the folder listing a tab shows. */
function shows(location: RepositoryLocation, change: RepositoryChange) {
  const paths = change.paths ?? []
  const within = (path: string, root: string) => path === root || path.startsWith(root + '/')
  if (location.kind === 'file') return paths.some((path) => within(location.path, path))
  if (location.kind === 'home' || location.kind === 'folder') {
    const folder = location.kind === 'home' ? '' : location.path
    // The home page lists the changed files too.
    if (change.kind === 'status')
      return location.kind === 'home' || paths.some((p) => parentOf(p) === folder)
    return paths.some((path) => parentOf(path) === folder || (folder && within(folder, path)))
  }
  return true
}
export function useLiveItemRefresh(options: LiveRefreshOptions) {
  const { props, source, projectPin, main, screen, root, loadKey, anchorPin, reload, isActive } =
    options
  // Invalidations follow only explicitly live Working tree locations, not retained observations,
  // pinned files or comparisons. Keep mounted viewers and scroll while replacing read data.
  let stopSource = () => {}
  let refreshRunning = false
  let refreshAgain = false
  watch(
    source,
    (current) => {
      stopSource()
      // GitHub already retires its guarded operation client through the tab's credential watcher.
      // Subscribing through an expired proxy would itself require the revoked capability.
      if (current?.identity.provider !== 'node') {
        stopSource = () => {}
        return
      }
      stopSource =
        current?.subscribe((change) => {
          if (change.kind === 'authority') {
            main.clear()
            Object.assign(screen, emptyScreen())
            main.error.value = 'Repository access changed. Reconnect or choose another workspace.'
            return
          }
          const location = props.sourceLocation
          console.debug('[Abele] node repository: view notified', {
            change,
            location,
            pinned: !!projectPin.value,
            refreshRunning,
          })
          if (
            projectPin.value ||
            !location ||
            !('ref' in location) ||
            location.ref !== 'Working tree'
          )
            return
          // A change batch has already patched the file tree; read again only what is on screen.
          if ((change.kind === 'tree' || change.kind === 'status') && !shows(location, change))
            return
          const refresh = async () => {
            if (refreshRunning) {
              refreshAgain = true
              return
            }
            refreshRunning = true
            const scroller = root.value?.closest('.abele-github-layout__main')
            const scroll = scroller?.scrollTop
            const refreshKey = loadKey.value
            let interrupted = false
            const interrupt = () => {
              interrupted = true
              anchorPin.unpin()
            }
            const gestures = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
            for (const gesture of gestures) scroller?.addEventListener(gesture, interrupt, true)
            const preserveScroll = (reading = false) => {
              if (
                !interrupted &&
                scroller &&
                scroll !== undefined &&
                root.value &&
                isActive() &&
                loadKey.value === refreshKey &&
                current === source.value
              ) {
                anchorPin.unpin()
                anchorPin.unpin = pinIntoView(
                  root.value,
                  () => {
                    const top = scroller.getBoundingClientRect().top + scroll - scroller.scrollTop
                    return reading ? { estimate: top } : top
                  },
                  { context: 0, ...(reading ? { settleMs: 30_000 } : {}) }
                )
              }
            }
            // Start before reading: another invalidation can arrive while a refresh is still
            // running, and its intermediate DOM must keep the owner's position too.
            preserveScroll(true)
            try {
              do {
                refreshAgain = false
                console.debug('[Abele] node repository: view reread requested', { location })
                await reload()
                console.debug('[Abele] node repository: view reread settled', {
                  location,
                  error: main.error.value,
                  hasData: !!main.data.value,
                  current: current === source.value,
                  sameLocation: loadKey.value === refreshKey,
                })
              } while (
                refreshAgain &&
                isActive() &&
                loadKey.value === refreshKey &&
                current === source.value
              )
              await nextTick()
              console.debug('[Abele] node repository: view updated', {
                location,
                current: current === source.value,
                sameLocation: loadKey.value === refreshKey,
                active: isActive(),
                error: main.error.value,
              })
              preserveScroll()
            } finally {
              for (const gesture of gestures)
                scroller?.removeEventListener(gesture, interrupt, true)
              refreshRunning = false
            }
          }
          void refresh()
        }) ?? (() => {})
    },
    { immediate: true }
  )
  onBeforeUnmount(() => stopSource())
}
