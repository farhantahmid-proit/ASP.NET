import { useSyncExternalStore } from 'react'
import { localAuditStorage } from '@/lib/services/local-audit-storage'
import type { LocalAuditFormat } from '@/types/audit'

export function useLocalAuditStorage() {
  const state = useSyncExternalStore(
    localAuditStorage.subscribe,
    localAuditStorage.getSnapshot,
    localAuditStorage.getSnapshot,
  )

  return {
    ...state,
    service: localAuditStorage,
    hydrateFromIndexedDb: () => localAuditStorage.hydrateFromIndexedDb(),
    saveSessionLocally: localAuditStorage.saveSessionLocally.bind(localAuditStorage),
    upsertRecord: localAuditStorage.upsertRecord.bind(localAuditStorage),
    deleteLocalAudit: localAuditStorage.deleteLocalAudit.bind(localAuditStorage),
    setPreferredFormat: (format: LocalAuditFormat) =>
      localAuditStorage.preferredFormat.set(format),
    exportRecordPayload: localAuditStorage.exportRecordPayload.bind(localAuditStorage),
    importAuditFile: localAuditStorage.importAuditFile.bind(localAuditStorage),
    importAuditFileRecords: localAuditStorage.importAuditFileRecords.bind(localAuditStorage),
  }
}
