export type FresnelSearchItemKind = 'audit' | 'route' | 'action'

export interface FresnelSearchItem {
  id: string
  kind: FresnelSearchItemKind
  title: string
  subtitle?: string
  keywords?: string[]
  notes?: string
  auditId?: string
  to?: string
}

export type FresnelSearchField = 'title' | 'subtitle' | 'keywords' | 'notes'

export interface FresnelSearchHit<T extends FresnelSearchItem = FresnelSearchItem> {
  item: T
  score: number
  matchedFields: FresnelSearchField[]
  snippet: string
  highlightTerms: string[]
}

/**
 * Bounded Levenshtein edit distance for fuzzy typo tolerance on search tokens.
 */
export function boundedLevenshtein(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  if (a === b) return 0

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)

  for (let j = 0; j <= b.length; j += 1) prev[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    let rowMin = curr[0]
    const ca = a.charCodeAt(i - 1)

    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      const val = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      curr[j] = val
      if (val < rowMin) rowMin = val
    }

    if (rowMin > maxDist) return maxDist + 1
    const tmp = prev
    prev = curr
    curr = tmp
  }

  return prev[b.length]
}

function subsequenceScore(query: string, target: string): number {
  if (query.length < 2) return 0
  let qi = 0
  let firstMatch = -1
  let lastMatch = -1
  let consecutive = 0
  let maxConsecutive = 0
  let prevIdx = -2

  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target[ti] === query[qi]) {
      if (firstMatch === -1) firstMatch = ti
      lastMatch = ti
      consecutive = ti === prevIdx + 1 ? consecutive + 1 : 1
      if (consecutive > maxConsecutive) maxConsecutive = consecutive
      prevIdx = ti
      qi += 1
    }
  }

  if (qi !== query.length) return 0
  const span = Math.max(1, lastMatch - firstMatch + 1)
  const density = query.length / span
  const streak = maxConsecutive / query.length
  return Math.min(1, density * 0.55 + streak * 0.45)
}

function scoreTokenAgainstField(token: string, fieldLower: string, words: string[]): number {
  if (!fieldLower) return 0

  const exactIdx = fieldLower.indexOf(token)
  if (exactIdx !== -1) {
    return exactIdx === 0 || /[\s/_.-]/.test(fieldLower[exactIdx - 1]) ? 1.0 : 0.86
  }

  if (token.length >= 3) {
    const maxDist = token.length >= 6 ? 2 : 1
    let bestWordScore = 0
    for (const w of words) {
      if (w.length < 2) continue
      const candidate = w.length > token.length + maxDist ? w.slice(0, token.length + 1) : w
      const dist = boundedLevenshtein(token, candidate, maxDist)
      if (dist <= maxDist) {
        const s = Math.max(0.45, 0.82 - dist * 0.18)
        if (s > bestWordScore) bestWordScore = s
      }
    }
    if (bestWordScore > 0) return bestWordScore
  }

  if (token.length >= 3 && fieldLower.length <= 240) {
    const sub = subsequenceScore(token, fieldLower)
    if (sub >= 0.45) {
      return sub * 0.65
    }
  }

  return 0
}

function buildContextSnippet(bodyText: string, tokens: string[], maxLen = 140): string {
  const flat = bodyText.replace(/[#>*`[\]]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!flat) return ''

  const lower = flat.toLowerCase()
  let matchPos = -1
  for (const token of tokens) {
    const idx = lower.indexOf(token)
    if (idx !== -1 && (matchPos === -1 || idx < matchPos)) {
      matchPos = idx
    }
  }

  if (matchPos === -1 || matchPos < 45) {
    return flat.length > maxLen ? `${flat.slice(0, maxLen).trim()}...` : flat
  }

  const start = Math.max(0, matchPos - 45)
  const end = Math.min(flat.length, start + maxLen)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < flat.length ? '...' : ''
  return `${prefix}${flat.slice(start, end).trim()}${suffix}`
}

export function fuzzySearchFresnelItems<T extends FresnelSearchItem>(
  items: readonly T[],
  query: string,
  kindFilter: FresnelSearchItemKind | 'all' = 'all',
): FresnelSearchHit<T>[] {
  const filtered = kindFilter === 'all' ? items : items.filter((item) => item.kind === kindFilter)
  const trimmed = query.trim()

  if (!trimmed) {
    return filtered.map((item) => ({
      item,
      score: 1,
      matchedFields: [],
      snippet: buildContextSnippet(item.notes ?? item.subtitle ?? '', []),
      highlightTerms: [],
    }))
  }

  const tokens = trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const hits: FresnelSearchHit<T>[] = []

  for (const item of filtered) {
    const titleLower = item.title.toLowerCase()
    const subtitleLower = (item.subtitle ?? '').toLowerCase()
    const keywordsLower = (item.keywords ?? []).join(' ').toLowerCase()
    const notesRaw = item.notes ?? ''
    const notesLower = notesRaw.toLowerCase()

    const titleWords = titleLower.split(/[\s/_.-]+/).filter(Boolean)
    const subtitleWords = subtitleLower.split(/[\s/_.-]+/).filter(Boolean)
    const keywordWords = keywordsLower.split(/[\s/_.-]+/).filter(Boolean)
    const notesWords = notesLower
      .slice(0, 4000)
      .split(/[\s/_.,:;!?()[\]{}"'`]+/)
      .filter(Boolean)

    let totalScore = 0
    let matchedTokenCount = 0
    const matchedFields = new Set<FresnelSearchField>()

    for (const token of tokens) {
      const titleScore = scoreTokenAgainstField(token, titleLower, titleWords) * 3.0
      const subtitleScore = scoreTokenAgainstField(token, subtitleLower, subtitleWords) * 2.0
      const keywordScore = scoreTokenAgainstField(token, keywordsLower, keywordWords) * 1.8
      const notesScore = scoreTokenAgainstField(token, notesLower, notesWords) * 1.35

      if (titleScore > 0) matchedFields.add('title')
      if (subtitleScore > 0) matchedFields.add('subtitle')
      if (keywordScore > 0) matchedFields.add('keywords')
      if (notesScore > 0) matchedFields.add('notes')

      const best = Math.max(titleScore, subtitleScore, keywordScore, notesScore)
      if (best > 0) {
        matchedTokenCount += 1
        totalScore += best + (titleScore + subtitleScore + keywordScore + notesScore) * 0.15
      }
    }

    const minTokensRequired = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.65)
    if (matchedTokenCount >= minTokensRequired && totalScore > 0) {
      const fullPhrase = trimmed.toLowerCase()
      if (titleLower.includes(fullPhrase)) totalScore += 2.5
      else if (subtitleLower.includes(fullPhrase) || notesLower.includes(fullPhrase)) totalScore += 1.2

      hits.push({
        item,
        score: Number(totalScore.toFixed(3)),
        matchedFields: Array.from(matchedFields),
        snippet: buildContextSnippet(notesRaw || item.subtitle || '', tokens),
        highlightTerms: tokens,
      })
    }
  }

  return hits.sort((a, b) => b.score - a.score)
}
