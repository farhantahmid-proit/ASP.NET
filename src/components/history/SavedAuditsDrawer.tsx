import { useMemo, useRef, useState } from 'react'
import { useLocalAuditStorage } from '@/hooks/useLocalAuditStorage'
import { fuzzySearchFresnelItems, type FresnelSearchItem } from '@/lib/fuzzy-search'
import type { LocalAuditFormat, LocalSavedAuditRecord } from '@/types/audit'
import { SavedAuditDiffView } from './SavedAuditDiffView'
import { SavedAuditTrendChart } from './SavedAuditTrendChart'

export interface SavedAuditsDrawerProps {
  isOpen: boolean
  onClose: () => void
  onOpenSavedAudit: (record: LocalSavedAuditRecord) => void
  currentSessionRecord?: LocalSavedAuditRecord | null
}

type DrawerTab = 'list' | 'trends' | 'diff'

export function SavedAuditsDrawer({
  isOpen,
  onClose,
  onOpenSavedAudit,
  currentSessionRecord = null,
}: SavedAuditsDrawerProps) {
  const {
    localAudits,
    preferredFormat,
    localNotice,
    service,
    setPreferredFormat,
    deleteLocalAudit,
    exportRecordPayload,
    importAuditFile,
  } = useLocalAuditStorage()

  const [tab, setTab] = useState<DrawerTab>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const filteredAudits = useMemo(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed) return localAudits

    const items: Array<FresnelSearchItem & { record: LocalSavedAuditRecord }> = localAudits.map(
      (rec) => ({
        id: rec.auditId,
        kind: 'audit',
        title: rec.repoFullName,
        subtitle: `${rec.runPhase} ${rec.branch || 'main'} ${rec.savedFormat}`,
        keywords: rec.commitTitles,
        notes: rec.summaryNotes,
        auditId: rec.auditId,
        record: rec,
      }),
    )

    return fuzzySearchFresnelItems(items, trimmed).map((hit) => hit.item.record)
  }, [localAudits, searchQuery])

  if (!isOpen) return null

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportError(null)
    try {
      const content = await file.text()
      importAuditFile(file.name, content)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unable to import selected audit file.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div
      className="fr-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-audits-drawer-title"
      onClick={onClose}
    >
      <aside className="fr-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <header className="fr-section-head">
          <div>
            <p className="fr-eyebrow">
              <span className="fr-eyebrow-line" /> OFFLINE HISTORY &amp; EXPORTS
            </p>
            <h2 id="saved-audits-drawer-title" className="fr-section-title">
              Saved Audits ({localAudits.length})
            </h2>
          </div>

          <button
            type="button"
            id="saved-drawer-close-btn"
            className="fr-btn-secondary"
            aria-label="Close Saved Audits drawer"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="fr-section-head">
          <div className="fr-segmented" role="tablist" aria-label="Saved Audits Drawer views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'list'}
              className={`fr-segmented__btn${tab === 'list' ? ' is-active' : ''}`}
              onClick={() => setTab('list')}
            >
              Audits ({localAudits.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'trends'}
              className={`fr-segmented__btn${tab === 'trends' ? ' is-active' : ''}`}
              onClick={() => setTab('trends')}
            >
              Trend Chart
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'diff'}
              className={`fr-segmented__btn${tab === 'diff' ? ' is-active' : ''}`}
              onClick={() => setTab('diff')}
            >
              Run Diff
            </button>
          </div>

          <div className="fr-segmented" role="group" aria-label="Default export format">
            {(['json', 'toon', 'markdown'] as const).map((fmt: LocalAuditFormat) => (
              <button
                key={fmt}
                type="button"
                className={`fr-segmented__btn${preferredFormat === fmt ? ' is-active' : ''}`}
                onClick={() => setPreferredFormat(fmt)}
              >
                .{fmt === 'markdown' ? 'MD' : fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="fr-actions">
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={() => service.loadSampleAudits()}
          >
            Load Samples
          </button>
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Import File (.json/.toon/.md)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.toon,.md,.markdown"
            className="sr-only"
            onChange={(e) => void handleFileSelect(e)}
          />
          <button
            type="button"
            className="fr-btn-secondary"
            disabled={localAudits.length === 0}
            onClick={() => void service.exportFullHistoryToDeviceJson()}
          >
            Export All JSON
          </button>
          <button
            type="button"
            className="fr-btn-secondary"
            disabled={localAudits.length === 0}
            onClick={() => void service.exportFullHistoryToDeviceCsv()}
          >
            Export All CSV
          </button>
        </div>

        {importError && (
          <p className="fr-error" role="alert">
            {importError}
          </p>
        )}
        {localNotice && (
          <p className="fr-muted" role="status" aria-live="polite">
            {localNotice}
          </p>
        )}

        {tab === 'list' && (
          <div className="fr-saved-list">
            <input
              id="saved-drawer-search-input"
              type="search"
              className="fr-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Fuzzy search saved audits by repo, rule, or summary..."
            />

            {filteredAudits.length === 0 ? (
              <p className="fr-muted">No saved audits match your filter.</p>
            ) : (
              filteredAudits.map((rec) => (
                <article key={rec.auditId} className="fr-saved-row">
                  <div style={{ minWidth: 0 }}>
                    <strong>{rec.repoFullName}</strong>{' '}
                    <span className="fr-badge">{rec.savedFormat}</span>
                    <div className="fr-muted">
                      Perf {rec.performanceBefore} {'->'} {rec.performanceAfter} · A11y{' '}
                      {rec.accessibilityBefore} {'->'} {rec.accessibilityAfter}
                    </div>
                  </div>
                  <div className="fr-actions">
                    <button
                      type="button"
                      className="fr-btn-primary"
                      onClick={() => {
                        onOpenSavedAudit(rec)
                        onClose()
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="fr-btn-secondary"
                      onClick={() => {
                        const exported = exportRecordPayload(rec, preferredFormat)
                        service.downloadPayloadAsFile(
                          exported.filename,
                          exported.content,
                          exported.mimeType,
                        )
                      }}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="fr-btn-secondary"
                      onClick={() => deleteLocalAudit(rec.auditId)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        )}

        {tab === 'trends' && <SavedAuditTrendChart records={localAudits} />}

        {tab === 'diff' && (
          <SavedAuditDiffView
            savedAudits={localAudits}
            currentSessionRecord={currentSessionRecord}
          />
        )}
      </aside>
    </div>
  )
}
