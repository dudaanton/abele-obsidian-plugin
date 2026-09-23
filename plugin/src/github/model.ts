import type { GithubTarget } from './urls'

/** What a GitHub tab renders from; the view writes it, the Vue side reads it. */
export interface GithubViewModel {
  url: string
  /** Null for a URL no GitHub tab can show. */
  target: GithubTarget | null
  /** Moves on every navigation, even to the same URL, so the line or comment is found again. */
  nonce: number
}
