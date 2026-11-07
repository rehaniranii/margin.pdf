export function downloadPdf(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  // Give the browser time to begin the user-requested download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
