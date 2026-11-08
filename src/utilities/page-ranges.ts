// One-based interface, zero-based engine. Order is intentional; duplicates are errors.
export function parsePages(value: string, count: number): number[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('There are no pages to select.')
  if (!value.trim()) throw new Error('Enter pages, for example 1-3, 5.')
  const result: number[] = [], seen = new Set<number>()
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) throw new Error('Use page numbers and ascending ranges, for example 1-3, 5.')
    const from = Number(match[1]), to = Number(match[2] ?? match[1])
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to > count || to < from) throw new Error(`Choose pages from 1 to ${count}, with ascending ranges.`)
    for (let number = from; number <= to; number++) {
      if (seen.has(number)) throw new Error(`Page ${number} is listed more than once. Remove the duplicate.`)
      seen.add(number); result.push(number - 1)
    }
  }
  return result
}
