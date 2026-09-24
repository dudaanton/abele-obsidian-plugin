/**
 * The repository a GitHub tab shows, for everything in it that renders GitHub text: a comment's
 * relative link or image means a file of that repository.
 */
import type { InjectionKey, Ref } from 'vue'
import type { RepoFile } from './markdownLinks'

export const GITHUB_REPO: InjectionKey<Ref<RepoFile | null>> = Symbol('abele-github-repo')

/** Text outside any repository: its relative links resolve to nothing that exists, harmlessly. */
export const NO_REPO: RepoFile = {
  host: 'github.com',
  owner: '-',
  repo: '-',
  ref: 'HEAD',
  path: '',
}
