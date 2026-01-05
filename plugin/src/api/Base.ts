import { Notice } from 'obsidian' // Removed requestUrl, RequestUrlParam
import { AbeleConfig } from '@/services/AbeleConfig'

export class ApiClient {
  private baseUrl: string
  private apiToken: string

  constructor(config: AbeleConfig) {
    // Ensure base URL doesn't end with a slash
    this.baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl
    this.apiToken = config.apiToken
  }

  // Modified request method using fetch
  protected async request(options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: BodyInit | null
    contentType?: string // Keep for potential header setting, though fetch often infers
  }): Promise<any> {
    if (!this.baseUrl || !this.apiToken) {
      new Notice('Backend URL or API Token not configured.')
      throw new Error('API client not configured.')
    }

    // Construct URL
    const url = options.url.startsWith('http') ? options.url : `${this.baseUrl}${options.url}`

    // Prepare headers using Headers object
    const headers = new Headers(options.headers) // Initialize with provided headers
    headers.set('Authorization', `Bearer ${this.apiToken}`)

    // Set Content-Type correctly, avoiding it for FormData
    if (!(options.body instanceof FormData)) {
      if (options.contentType) {
        headers.set('Content-Type', options.contentType)
      } else if (
        options.method &&
        options.method !== 'GET' &&
        options.method !== 'HEAD' &&
        !headers.has('Content-Type')
      ) {
        // Default to application/json if not GET/HEAD, no body is FormData, and not already set
        headers.set('Content-Type', 'application/json')
      }
    }
    // Note: For FormData, 'Content-Type' (multipart/form-data) is set automatically by fetch,
    // so we don't set it here, and we don't need to delete it either.

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers: headers, // Use the Headers object
      body: options.body,
      mode: 'cors', // Ensure CORS is handled
    }

    try {
      const response = await fetch(url, fetchOptions)

      if (!response.ok) {
        let errorDetails: any = null
        try {
          // Try to parse error response as JSON
          errorDetails = await response.json()
        } catch (e) {
          // If not JSON, use text
          errorDetails = await response.text()
        }
        console.error('API Request Error:', response.status, response.statusText, errorDetails)
        const errorMessage =
          typeof errorDetails === 'object' && errorDetails?.error?.message
            ? errorDetails.error.message
            : typeof errorDetails === 'string'
              ? errorDetails
              : response.statusText
        new Notice(`API Error ${response.status}: ${errorMessage || 'See console for details.'}`)
        throw new Error(`API request failed with status ${response.status}`)
      }

      // Handle empty response body (e.g., 204 No Content)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return null // Or return an empty object/appropriate value
      }

      // Assuming JSON response for successful requests
      return await response.json()
    } catch (error: any) {
      // Handle network errors or errors thrown above
      console.error('API Request Failed:', error)
      // Avoid showing duplicate notices if error was already handled above
      if (!(error instanceof Error && error.message.startsWith('API request failed'))) {
        new Notice('API request failed. Check network connection or console.')
      }
      throw error // Re-throw after logging/notifying
    }
  }

  // Method to update configuration if changed in settings
  updateConfig(baseUrl: string, apiToken: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    this.apiToken = apiToken
    console.log('API Client config updated.')
  }
}
