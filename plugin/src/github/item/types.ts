import type { NodeFilesModel } from '@/node/NodeFilesModel'
import { type RepositorySource, type RepositoryLocation } from '@/repository/source'
import { type ItemData, type PinnedLoad } from '@/github/loadItem'
import type { PaneType } from 'obsidian'
import type { GithubViewModel } from '@/github/model'
import type { GithubClient } from '@/github/client'
import { type GithubTarget } from '@/github/urls'
export interface GithubItemProps {
  model: GithubViewModel
  source?: RepositorySource
  sourceLocation?: RepositoryLocation
  documentModel?: NodeFilesModel
  editingAllowed?: boolean
  nodeOffline?: boolean
  enabled: boolean
  clientFor?: (host: string) => GithubClient
  /** Connection-aware primary loading; secondary loads stay on clientFor. */
  primaryLoad?: (
    target: GithubTarget,
    promote: (target: GithubTarget) => void,
    retry?: boolean,
    pinned?: PinnedLoad
  ) => Promise<ItemData>
  peopleClient?: () => GithubClient
  accountName?: string
  onChooseAccount?: () => void
  /** Tells the tab its name once the item's title is known. */
  onTitle?: (title: string) => void
  /** Opens another GitHub URL: by the usual rule, or in a new tab, split or window. */
  onOpen?: (url: string, pane?: PaneType | false) => void
  /** Moves each time Mod+F is pressed in the tab. */
  keys?: { find: number }
  /** The tab's state changed in a way worth saving: the file view was switched. */
  onState?: () => void
}
