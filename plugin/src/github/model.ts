import type { GithubTarget } from './urls'
import type { GithubScreen } from './screen'
import type { BlobMode } from './markdownPreview'

/** What a GitHub tab renders from; the view writes it, the Vue side reads it. */
export interface GithubViewModel {
  url: string
  /** Null for a URL no GitHub tab can show. */
  target: GithubTarget | null
  /** Moves on every navigation, even to the same URL, so the line or comment is found again. */
  nonce: number
  /** What the tab has on screen, written by its components and read by `github_views`. */
  screen: GithubScreen
  /**
   * A markdown file shown rendered or as code, when the person switched it; unset, the link
   * decides. Part of the tab's state, so back, forward and a restart keep it.
   */
  mode?: BlobMode
}
