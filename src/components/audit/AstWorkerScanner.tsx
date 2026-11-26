import { useState } from 'react'
import { useAstWorkerAudit } from '@/hooks/useAstWorkerAudit'
import { fileSystemAuditData } from '@/lib/services/file-system-audit-data'
import type { LocalAuditFormat, LocalSavedAuditRecord } from '@/types/audit'

export interface AstWorkerScannerProps {
  onOpenSavedAudit?: (record: LocalSavedAuditRecord) => void
  onAuditCompleted?: (record: LocalSavedAuditRecord) => void
}

export function AstWorkerScanner({
  onOpenSavedAudit,
  onAuditCompleted,
}: AstWorkerScannerProps) {
  const workerAudit = useAstWorkerAudit()
  const [saveFormat, setSaveFormat] = useState<LocalAuditFormat>('json')
  const [autoSaveToDisk, setAutoSaveToDisk] = useState(false)

  async function handleImportFolder() {
    const rec = await workerAudit.pickRepositoryDirectoryAndAnalyze(saveFormat, autoSaveToDisk)
    if (rec) {
      onAuditCompleted?.(rec)
    }
  }

  async function handleImportFiles() {
    const rec = await workerAudit.pickSourceFilesAndAnalyze(saveFormat, autoSaveToDisk)
    if (rec) {
      onAuditCompleted?.(rec)
    }
  }

  async function handleRunSampleBenchmark() {
    const rec = await workerAudit.runSampleRepositoryAstBenchmark(saveFormat, autoSaveToDisk)
    onAuditCompleted?.(rec)
  }

  function handleSaveLatestToDisk(record: LocalSavedAuditRecord) {
    void fileSystemAuditData.saveAuditResultToDisk(record, saveFormat)
  }

  const summary = workerAudit.lastSummary
  const record = workerAudit.lastCompletedRecord

  return (
    <section className="fr-card ast-worker-panel" aria-labelledby="ast-worker-heading">
      <div className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> WEB WORKER · ACORN ESTREE AST PARSER
          </p>
          <h2 id="ast-worker-heading" className="fr-section-title">
            In-Browser Static AST Source Scanner
          </h2>
          <p className="fr-muted">
            Import a local repository folder or source files (<code>.js</code>, <code>.ts</code>,{' '}
            <code>.jsx</code>, <code>.tsx</code>, <code>.html</code>) to run Acorn JavaScript AST
            analysis inside a dedicated module Web Worker with zero main-thread blocking.
          </p>
        </div>

        <div className="fr-format-wrap">
          <span className="fr-label">Output format</span>
          <div className="fr-segmented" role="group" aria-label="AST worker output file format">
            <button
              type="button"
              className={`fr-segmented__btn${saveFormat === 'json' ? ' is-active' : ''}`}
              onClick={() => setSaveFormat('json')}
            >
              .JSON
            </button>
            <button
              type="button"
              className={`fr-segmented__btn${saveFormat === 'toon' ? ' is-active' : ''}`}
              onClick={() => setSaveFormat('toon')}
            >
              .TOON
            </button>
            <button
              type="button"
              className={`fr-segmented__btn${saveFormat === 'markdown' ? ' is-active' : ''}`}
              onClick={() => setSaveFormat('markdown')}
            >
              .MD
            </button>
          </div>
        </div>
      </div>

      <div className="fr-actions">
        <button
          type="button"
          id="ast-worker-import-folder-btn"
          className="fr-btn-primary"
          disabled={workerAudit.isAnalyzing}
          onClick={() => void handleImportFolder()}
        >
          Import Repository Folder
        </button>

        <button
          type="button"
          id="ast-worker-import-files-btn"
          className="fr-btn-secondary"
          disabled={workerAudit.isAnalyzing}
          onClick={() => void handleImportFiles()}
        >
          Import Source Files (.js / .ts / .html)
        </button>

        <button
          type="button"
          id="ast-worker-sample-benchmark-btn"
          className="fr-btn-secondary"
          disabled={workerAudit.isAnalyzing}
          onClick={() => void handleRunSampleBenchmark()}
        >
          Scan Sample Repository
        </button>

        <label className="fr-checkbox-label">
          <input
            type="checkbox"
            checked={autoSaveToDisk}
            onChange={(e) => setAutoSaveToDisk(e.target.checked)}
          />
          <span>Prompt File System save on finish</span>
        </label>
      </div>

      {workerAudit.errorMessage && (
        <p className="fr-error" role="alert">
          {workerAudit.errorMessage}
        </p>
      )}

      {workerAudit.isAnalyzing && (
        <div className="fr-progress-panel" role="status" aria-live="polite">
          <div className="fr-progress-panel__top">
            <span>
              Parsing <code>{workerAudit.currentFile}</code> ({workerAudit.processedFiles}/
              {workerAudit.totalFiles} files)
            </span>
            <span>
              {workerAudit.progressPercent}% · {workerAudit.astNodesSoFar.toLocaleString()} AST
              nodes
            </span>
          </div>
          <div className="fr-progress-track">
            <div
              className="fr-progress-fill"
              style={{ width: `${workerAudit.progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {summary && record && (
        <div className="fr-result-banner" role="status" aria-live="polite">
          <div className="fr-result-banner__info">
            <strong>{summary.repoFullName}</strong>
            <span className="fr-badge">
              {summary.executedInWorker ? 'Web Worker AST' : 'Local Async Fallback'}
            </span>
            <span className="fr-muted">
              {summary.filesAnalyzed} files ({summary.filesParsedWithAcorn} Acorn AST) ·{' '}
              {summary.astNodesVisited.toLocaleString()} nodes · {summary.findingsCount} findings ·{' '}
              {summary.durationMs} ms
            </span>
          </div>
          <div className="fr-actions">
            {onOpenSavedAudit && (
              <button
                type="button"
                id="ast-worker-open-report-btn"
                className="fr-btn-primary"
                onClick={() => onOpenSavedAudit(record)}
              >
                Open Findings Report
              </button>
            )}
            <button
              type="button"
              id="ast-worker-save-disk-btn"
              className="fr-btn-secondary"
              onClick={() => handleSaveLatestToDisk(record)}
            >
              Save .{saveFormat === 'markdown' ? 'md' : saveFormat} to Disk
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
