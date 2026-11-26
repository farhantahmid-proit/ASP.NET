import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { GlobalAuditDashboard } from '@/components/history/GlobalAuditDashboard'
import { SavedAuditDiffView } from '@/components/history/SavedAuditDiffView'
import { SavedAuditTrendChart } from '@/components/history/SavedAuditTrendChart'
import { useLocalAuditStorage } from '@/hooks/useLocalAuditStorage'
import type { SavedAuditHistoryRecord } from '@/types/audit'

export const Route = createFileRoute('/audit/compare')({
  component: CompareAuditsPage,
})

function CompareAuditsPage() {
  const navigate = useNavigate()
  const { localAudits, service } = useLocalAuditStorage()

  function handleOpenSavedAudit(record: SavedAuditHistoryRecord) {
    void navigate({
      to: '/audit/$auditId',
      params: { auditId: record.auditId },
    })
  }

  return (
    <div className="fr-audit-session">
      <header className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> HISTORICAL ANALYTICS &amp; DIFF MATRIX
          </p>
          <h1 className="fr-audit-title">Compare Saved Audits &amp; Global Trends</h1>
          <p className="fr-muted">
            Inspect chronological repository improvements, compare any two saved audit snapshots,
            and export aggregate reports.
          </p>
        </div>
      </header>

      <GlobalAuditDashboard
        savedAudits={localAudits}
        onOpenSavedAudit={handleOpenSavedAudit}
        onLoadSampleAudits={() => service.loadSampleAudits()}
        onExportAllJson={() => void service.exportFullHistoryToDeviceJson()}
        onExportAllCsv={() => void service.exportFullHistoryToDeviceCsv()}
      />

      <SavedAuditTrendChart records={localAudits} />

      <SavedAuditDiffView savedAudits={localAudits} />
    </div>
  )
}
