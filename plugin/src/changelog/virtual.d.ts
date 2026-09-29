declare module 'virtual:abele-changelog' {
  import type { Release } from '@/changelog/model'
  export const runningVersion: string
  const releases: Release[]
  export default releases
}
