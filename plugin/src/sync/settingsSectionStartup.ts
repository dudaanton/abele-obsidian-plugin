import { noticeWithActions } from '@/components/obsidian/notice'
import { t } from '@/i18n'

export async function startSettingsSectionStorage(
  open: () => Promise<void>,
  retry: () => Promise<void>,
  register: (dispose: () => void) => void
): Promise<boolean> {
  try {
    await open()
    return true
  } catch (error) {
    console.error('[Abele] device settings section storage could not be opened', error)
    let retrying = false
    const notice = noticeWithActions(t('sync.sections.storageUnavailable'), [
      {
        text: t('sync.sections.retryStorage'),
        tooltip: t('sync.sections.retryStorage'),
        run: () => {
          if (retrying) return
          retrying = true
          // Reloading retries the complete startup, keeping saves paused until settings
          // have been read with their recovered policy instead of publishing defaults.
          void Promise.resolve()
            .then(retry)
            .then(() => notice.hide())
            .catch((retryError) => {
              console.error('[Abele] device settings section storage retry failed', retryError)
            })
            .finally(() => {
              retrying = false
            })
        },
      },
    ])
    register(() => notice.hide())
    return false
  }
}
