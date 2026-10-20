export interface ConfirmationDetails {
  label: string
  notice?: string
  items: { path: string; folder?: boolean; badge?: string }[]
}
