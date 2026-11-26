import { useEffect, useSyncExternalStore } from 'react'
import { astWorkerAuditService } from '@/lib/services/ast-worker-audit'

export function useAstWorkerAudit() {
  const state = useSyncExternalStore(
    astWorkerAuditService.subscribe,
    astWorkerAuditService.getSnapshot,
    astWorkerAuditService.getSnapshot,
  )

  useEffect(() => {
    return () => {
      astWorkerAuditService.terminate()
    }
  }, [])

  return {
    ...state,
    service: astWorkerAuditService,
    analyzeImportedFiles: astWorkerAuditService.analyzeImportedFiles.bind(astWorkerAuditService),
    runSampleRepositoryAstBenchmark:
      astWorkerAuditService.runSampleRepositoryAstBenchmark.bind(astWorkerAuditService),
    pickSourceFilesAndAnalyze:
      astWorkerAuditService.pickSourceFilesAndAnalyze.bind(astWorkerAuditService),
    pickRepositoryDirectoryAndAnalyze:
      astWorkerAuditService.pickRepositoryDirectoryAndAnalyze.bind(astWorkerAuditService),
  }
}
