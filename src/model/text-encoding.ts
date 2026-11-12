// Text we write uses the standard 14 fonts with WinAnsiEncoding: basic Latin, Latin-1
// accents (é ü ñ ç ø ß …), curly quotes, dashes, €, ™ and a few more. One byte per character.
const high = '€\0‚ƒ„…†‡ˆ‰Š‹Œ\0Ž\0\0‘’“”•–—˜™š›œ\0žŸ' // codes 0x80–0x9F; \0 = unused

export function winAnsiCode(char: string): number | undefined {
  const code = char.codePointAt(0)!
  if (char.length !== 1 && code < 0x10000) return undefined
  if (code >= 0x20 && code <= 0x7e) return code
  if (code >= 0xa0 && code <= 0xff && code !== 0xad) return code // no invisible soft hyphen
  const index = char === '\0' ? -1 : high.indexOf(char)
  return index >= 0 ? 0x80 + index : undefined
}

export const supportedText = (value: string) => [...value].every(char => winAnsiCode(char) !== undefined)

// A PDF string literal in WinAnsi bytes. Content streams are passed to MuPDF as JS
// strings (UTF-8), so bytes above 0x7F must be written as octal escapes.
export function pdfLiteral(value: string) {
  return '(' + [...value].map(char => {
    const code = winAnsiCode(char)
    if (code === undefined) throw new Error(`“${char}” cannot be written with the standard PDF fonts.`)
    return char === '\\' || char === '(' || char === ')' ? '\\' + char : code < 0x80 ? char : '\\' + code.toString(8)
  }).join('') + ')'
}

export const unsupportedMessage = 'Use Latin letters, including accents like é ü ñ ç ø, numbers and punctuation. Other scripts and emoji are not supported yet.'

// Link targets we read and write: web pages, email and phone. Never javascript: or file: actions.
export const webAddress = (value: string) => value.length <= 2000 && /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d\-(). ]+)$/i.test(value)
