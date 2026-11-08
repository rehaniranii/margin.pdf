export function downloadPdf(bytes: ArrayBuffer, name: string) {
  downloadFile(bytes, name, 'application/pdf')
}
export function downloadFile(bytes: ArrayBuffer, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  // Give the browser time to begin the user-requested download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
