export const getMimeType = (extension: string | undefined): string => {
  if (!extension) return 'application/octet-stream' // Default if no extension
  const ext = extension.toLowerCase()
  // Add more common types as needed
  switch (ext) {
    case 'txt':
      return 'text/plain'
    case 'md':
      return 'text/markdown'
    case 'pdf':
      return 'application/pdf'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'mp4':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'zip':
      return 'application/zip'
    case 'json':
      return 'application/json'
    // Add more mappings here
    default:
      return 'application/octet-stream' // Generic binary type
  }
}
