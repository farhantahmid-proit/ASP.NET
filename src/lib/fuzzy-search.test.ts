import { describe, expect, it } from 'vitest'
import { fuzzySearchFresnelItems, type FresnelSearchItem } from './fuzzy-search'

const SAMPLE_ITEMS: FresnelSearchItem[] = [
  {
    id: 'audit-1',
    kind: 'audit',
    title: 'fresnel-sandbox/lumina-web-app',
    subtitle: 'Static AST · main branch · 20 commits',
    keywords: ['performance', 'accessibility', 'lcp'],
    notes: 'Preloads hero image and fixes WCAG 2.2 button-name contrast defects.',
    auditId: 'fresnel-oss-1',
  },
  {
    id: 'route-live',
    kind: 'route',
    title: 'Live URL & axe-core Audit Suite',
    subtitle: 'PageSpeed Insights, Core Web Vitals & DOM Accessibility',
    keywords: ['pagespeed', 'axe-core', 'web-vitals', 'lighthouse'],
    to: '/audit/live',
  },
  {
    id: 'route-compare',
    kind: 'route',
    title: 'Global Audit Dashboard & Trend Comparison',
    subtitle: 'Compare saved runs chronologically',
    keywords: ['compare', 'trends', 'history'],
    to: '/audit/compare',
  },
]

describe('lib/fuzzy-search', () => {
  it('returns all items when query is empty and filters cleanly by kind', () => {
    expect(fuzzySearchFresnelItems(SAMPLE_ITEMS, '').length).toBe(3)
    expect(fuzzySearchFresnelItems(SAMPLE_ITEMS, '', 'route').length).toBe(2)
  })

  it('matches exact, prefix, and 1-2 character typo queries deterministically', () => {
    const exactHits = fuzzySearchFresnelItems(SAMPLE_ITEMS, 'lumina-web-app')
    expect(exactHits[0]?.item.id).toBe('audit-1')
    expect(exactHits[0]?.matchedFields).toContain('title')

    const typoHits = fuzzySearchFresnelItems(SAMPLE_ITEMS, 'lumnia')
    expect(typoHits.length).toBeGreaterThan(0)
    expect(typoHits[0]?.item.id).toBe('audit-1')

    const routeTypoHits = fuzzySearchFresnelItems(SAMPLE_ITEMS, 'pgespeed')
    expect(routeTypoHits[0]?.item.id).toBe('route-live')
  })

  it('drops non-matching queries cleanly', () => {
    expect(fuzzySearchFresnelItems(SAMPLE_ITEMS, 'xyznonexistenttoken')).toEqual([])
  })
})
