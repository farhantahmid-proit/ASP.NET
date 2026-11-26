import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzySearchFresnelItems, type FresnelSearchItem } from '@/lib/fuzzy-search'
import type { LocalSavedAuditRecord } from '@/types/audit'

export interface FresnelCommandSearchModalProps {
  isOpen: boolean
  onClose: () => void
  savedAudits: readonly LocalSavedAuditRecord[]
  quickRoutes: readonly FresnelSearchItem[]
  onSelectItem: (item: FresnelSearchItem) => void
}

export function FresnelCommandSearchModal({
  isOpen,
  onClose,
  savedAudits,
  quickRoutes,
  onSelectItem,
}: FresnelCommandSearchModalProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const allItems = useMemo<FresnelSearchItem[]>(() => {
    const auditItems: FresnelSearchItem[] = savedAudits.map((rec) => ({
      id: `saved-${rec.auditId}`,
      kind: 'audit',
      title: rec.repoFullName,
      subtitle: `${rec.runPhase.toUpperCase()} · ${rec.branch || 'main'} · Perf ${rec.performanceBefore} -> ${rec.performanceAfter}`,
      keywords: [rec.auditId, rec.savedFormat, ...(rec.commitTitles ?? []).slice(0, 6)],
      notes: rec.summaryNotes,
      auditId: rec.auditId,
    }))
    return [...quickRoutes, ...auditItems]
  }, [savedAudits, quickRoutes])

  const hits = useMemo(() => fuzzySearchFresnelItems(allItems, query).slice(0, 12), [allItems, query])

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveIdx(0)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  useEffect(() => {
    if (activeIdx >= hits.length) {
      setActiveIdx(0)
    }
  }, [hits.length, activeIdx])

  if (!isOpen) return null

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIdx((prev) => (hits.length > 0 ? (prev + 1) % hits.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIdx((prev) => (hits.length > 0 ? (prev - 1 + hits.length) % hits.length : 0))
    } else if (event.key === 'Enter' && hits[activeIdx]) {
      event.preventDefault()
      onSelectItem(hits[activeIdx].item)
      onClose()
    }
  }

  return (
    <div
      className="fr-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fr-cmd-search-title"
      onClick={onClose}
    >
      <div
        className="fr-cmd-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="fr-cmd-modal__head">
          <h2 id="fr-cmd-search-title" className="fr-cmd-modal__title">
            Search Audits &amp; Quick Actions
          </h2>
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={onClose}
            aria-label="Close command search"
          >
            Esc
          </button>
        </div>

        <input
          ref={inputRef}
          id="fresnel-cmd-search-input"
          type="search"
          className="fr-input"
          placeholder="Search saved repos, typo-tolerant (e.g. 'lumnia', 'axe', 'compare')..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIdx(0)
          }}
        />

        <ul className="fr-cmd-results" role="listbox" aria-label="Search results">
          {hits.length === 0 ? (
            <li className="fr-cmd-empty">No matching audits or routes for &ldquo;{query}&rdquo;.</li>
          ) : (
            hits.map((hit, idx) => (
              <li key={hit.item.id} role="option" aria-selected={idx === activeIdx}>
                <button
                  type="button"
                  className={`fr-cmd-item${idx === activeIdx ? ' is-active' : ''}`}
                  onClick={() => {
                    onSelectItem(hit.item)
                    onClose()
                  }}
                >
                  <div className="fr-cmd-item__top">
                    <strong>{hit.item.title}</strong>
                    <span className="fr-badge">{hit.item.kind}</span>
                  </div>
                  {hit.item.subtitle && <div className="fr-muted">{hit.item.subtitle}</div>}
                  {hit.snippet && hit.matchedFields.includes('notes') && (
                    <div className="fr-cmd-item__snippet">{hit.snippet}</div>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
