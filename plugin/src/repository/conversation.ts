/** Shared display records; provider adapters normalize their wire responses here. */
export interface Label {
  name: string
  color: string
}

export interface Comment {
  id: string
  /** The login. */
  author: string
  /** The author's picture, as the answer named it. */
  avatar?: string
  body: string
  createdAt: string
  /** The `#…` a link uses for this comment, to scroll to it. */
  anchor?: string
  /** A review's verdict, or "Answer" on a discussion. */
  badge?: string
  /** Where in the code a review comment sits. */
  location?: string
  replies?: Comment[]
  /** More replies exist than were fetched. */
  moreReplies?: number
  url?: string
}

export interface ItemHead {
  title: string
  number: number
  url: string
  /** The login. */
  author: string
  authorAvatar?: string
  createdAt: string
  /** `open`, `closed`, `merged`, `draft`, `answered`. */
  state: string
  labels: Label[]
  body: string
}

export interface IssueData extends ItemHead {
  /**
   * The number is a pull request's. GitHub numbers issues and pull requests from one sequence
   * and redirects `issues/N` to `pull/N`, so a link can name either.
   */
  isPull?: boolean
  comments: Comment[]
  /** Not every comment could be fetched; the rest are on GitHub. */
  commentsComplete: boolean
  /** Why some of the comments could not be read at all, shown in their place. */
  commentsProblem?: string
}

/** The comments of an issue or pull request, read apart from it so they can be asked again. */
export interface Conversation {
  comments: Comment[]
  complete: boolean
  problem?: string
}

export interface PullData extends IssueData {
  base: string
  head: string
  /** The commit the pull request's branch is at: what its code is searched and linked at. */
  headSha?: string
  /** The commit of the base branch it is compared with: where a file it deletes still exists. */
  baseSha?: string
  additions: number
  deletions: number
  changedFiles: number
  commitsCount: number
}

export interface DiffFile {
  /** Node comparisons retain a manifest; request the patch only when expanded. */
  loadPatch?: () => Promise<void>
  staged?: boolean
  unstaged?: boolean
  untracked?: boolean
  path: string
  previousPath?: string
  status: string
  additions: number
  deletions: number
  /** The counts are not known until the diff loads (a node lists files without them). */
  countsPending?: boolean
  /** Absent for binary files and for a file whose diff GitHub will not send whole. */
  patch?: string
  /** SHA-256 of the path, as in `#diff-<hash>`. */
  hash: string
  blobUrl?: string
  reviewComments: Comment[]
  /** Why there is no diff, when it is not the file's doing. */
  diffNote?: string
}

export interface FilesData {
  files: DiffFile[]
  complete: boolean
  /** Why the review comments could not be read; the files are shown without them. */
  reviewCommentsProblem?: string
}

export interface DiscussionData extends ItemHead {
  category: string
  comments: Comment[]
  totalComments: number
}
