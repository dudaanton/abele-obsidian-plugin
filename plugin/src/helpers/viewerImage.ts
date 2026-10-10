export interface ViewerImage {
  url: string
  alt: string
  type: 'local' | 'remote'
  path: string
  description?: string
}
