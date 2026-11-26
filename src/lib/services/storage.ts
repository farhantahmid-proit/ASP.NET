import { ReactiveStore } from './reactive-state';
import {
  AuditCommit,
  AuditImpactMetrics,
  AuditSession,
  LocalAuditFormat,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '@/types/audit';
import { FileSystemAuditDataService, fileSystemAuditData } from './file-system-audit-data';
import {
  LocalAuditStorageService,
  localAuditStorage,
  buildLocalSavedAuditRecord
} from './local-audit-storage';

export interface StorageWriteResult {
  saved: boolean;
  filename: string;
  format: LocalAuditFormat;
  location: 'directory' | 'picker' | 'download';
}

export interface OfflineScanResultRecord {
  scanId: string;
  auditId: string;
  repoFullName: string;
  scannedAtIso: string;
  filesAnalyzed: number;
  filesParsedWithAcorn: number;
  astNodesVisited: number;
  findingsCount: number;
  durationMs: number;
  executedInWorker: boolean;
  categoryCounts: {
    performance: number;
    accessibility: number;
    'best-practices': number;
    seo: number;
    security: number;
  };
  record: LocalSavedAuditRecord;
}

export interface OfflineHistorySummary {
  totalCount: number;
  indexedDbCount: number;
  offlineScansCount: number;
  jsonCount: number;
  markdownCount: number;
  toonCount: number;
  folderName: string | null;
  isOfflineReady: boolean;
}

const OFFLINE_IDB_NAME = 'fresnel_offline_storage_v1';
const OFFLINE_IDB_VERSION = 1;
const STORE_AUDIT_HISTORY = 'audit_history';
const STORE_SCAN_RESULTS = 'scan_results';
const MAX_IDB_RECORDS = 50;

/**
 * StorageService wraps both the File System Access API (`showDirectoryPicker`,
 * `showOpenFilePicker`, `showSaveFilePicker`) and IndexedDB (`audit_history` and
 * `scan_results` object stores) to manage local audit JSON/Markdown files, persist
 * audit history across sessions, and store offline repository AST scan results
 * without hitting browser localStorage quota limits.
 */
export interface StorageServiceSnapshot {
  indexedDbReady: boolean;
  indexedDbAudits: LocalSavedAuditRecord[];
  offlineScanResults: OfflineScanResultRecord[];
  offlineAuditHistory: LocalSavedAuditRecord[];
  offlineSummary: OfflineHistorySummary;
}

export class StorageService extends ReactiveStore<StorageServiceSnapshot> {
  private readonly fsData: FileSystemAuditDataService = fileSystemAuditData;
  private readonly localAuditStorage: LocalAuditStorageService = localAuditStorage;

  private dbPromise: Promise<IDBDatabase | null> | null = null;

  readonly indexedDbReady = this.signal<boolean>(false);
  readonly indexedDbAudits = this.signal<LocalSavedAuditRecord[]>([]);
  readonly offlineScanResults = this.signal<OfflineScanResultRecord[]>([]);

  readonly isFileSystemAccessSupported = this.computed<boolean>(
    () => this.fsData.isFilePickerSupported() || this.fsData.isDirectoryPickerSupported()
  );

  readonly isDirectoryPickerSupported = this.fsData.isDirectoryPickerSupported;
  readonly connectedFolderName = this.fsData.connectedDirectoryName;
  readonly hasConnectedFolder = this.fsData.hasConnectedDirectory;
  readonly needsPermissionReconnect = this.fsData.needsPermissionReconnect;
  readonly isBusy = this.fsData.isSyncing;
  readonly lastSavedFilename = this.fsData.lastSavedFilename;
  readonly statusMessage = this.computed<string | null>(
    () => this.fsData.statusMessage() ?? this.localAuditStorage.localNotice()
  );
  readonly errorMessage = this.fsData.errorMessage;

  /** Reactive merged list of persisted offline audit records (IndexedDB + localStorage, newest first). */
  readonly offlineAuditHistory = this.computed<LocalSavedAuditRecord[]>(() =>
    this.loadOfflineAuditHistory()
  );

  readonly offlineSummary = this.computed<OfflineHistorySummary>(() => {
    const records = this.offlineAuditHistory();
    let jsonCount = 0;
    let markdownCount = 0;
    let toonCount = 0;
    for (const rec of records) {
      if (rec.savedFormat === 'markdown') markdownCount += 1;
      else if (rec.savedFormat === 'toon') toonCount += 1;
      else jsonCount += 1;
    }
    return {
      totalCount: records.length,
      indexedDbCount: this.indexedDbAudits().length,
      offlineScansCount: this.offlineScanResults().length,
      jsonCount,
      markdownCount,
      toonCount,
      folderName: this.connectedFolderName(),
      isOfflineReady: this.indexedDbReady() || typeof localStorage !== 'undefined'
    };
  });

  constructor() {
    super();
    if (typeof window !== 'undefined') {
      void this.hydrateFromIndexedDb();
    }
  }

  // =========================================================================
  // INDEXEDDB LAYER (Persistent Audit History & Offline Repository Scans)
  // =========================================================================

  protected override buildSnapshot(): StorageServiceSnapshot {
    return {
      indexedDbReady: this.indexedDbReady(),
      indexedDbAudits: this.indexedDbAudits(),
      offlineScanResults: this.offlineScanResults(),
      offlineAuditHistory: this.offlineAuditHistory(),
      offlineSummary: this.offlineSummary(),
    };
  }

  private openIndexedDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(OFFLINE_IDB_NAME, OFFLINE_IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_AUDIT_HISTORY)) {
            const historyStore = db.createObjectStore(STORE_AUDIT_HISTORY, {
              keyPath: 'auditId'
            });
            historyStore.createIndex('updatedAtIso', 'updatedAtIso', { unique: false });
            historyStore.createIndex('repoFullName', 'repoFullName', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_SCAN_RESULTS)) {
            const scansStore = db.createObjectStore(STORE_SCAN_RESULTS, {
              keyPath: 'scanId'
            });
            scansStore.createIndex('scannedAtIso', 'scannedAtIso', { unique: false });
            scansStore.createIndex('repoFullName', 'repoFullName', { unique: false });
          }
        };
        req.onsuccess = () => {
          this.indexedDbReady.set(true);
          resolve(req.result);
        };
        req.onerror = () => {
          this.indexedDbReady.set(false);
          resolve(null);
        };
      } catch {
        this.indexedDbReady.set(false);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  async hydrateFromIndexedDb(): Promise<void> {
    const [audits, scans] = await Promise.all([
      this.getAllAuditsFromIndexedDb(),
      this.listOfflineScanResults()
    ]);

    this.indexedDbAudits.set(audits);
    this.offlineScanResults.set(scans);

    // Merge any IndexedDB records missing from localStorage so UI & D3 charts stay hydrated
    if (audits.length > 0) {
      const existingIds = new Set(this.localAuditStorage.localAudits().map((r) => r.auditId));
      for (const rec of [...audits].reverse()) {
        if (!existingIds.has(rec.auditId)) {
          this.localAuditStorage.upsertRecord(rec);
        }
      }
    }
  }

  async saveAuditToIndexedDb(record: LocalSavedAuditRecord): Promise<void> {
    const db = await this.openIndexedDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_AUDIT_HISTORY, 'readwrite');
        tx.objectStore(STORE_AUDIT_HISTORY).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

    this.indexedDbAudits.update((prev) => {
      const next = [record, ...prev.filter((item) => item.auditId !== record.auditId)];
      return this.sortByUpdatedDesc(next).slice(0, MAX_IDB_RECORDS);
    });
  }

  async getAllAuditsFromIndexedDb(): Promise<LocalSavedAuditRecord[]> {
    const db = await this.openIndexedDb();
    if (!db) return [];

    return new Promise<LocalSavedAuditRecord[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_AUDIT_HISTORY, 'readonly');
        const req = tx.objectStore(STORE_AUDIT_HISTORY).getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? (req.result as LocalSavedAuditRecord[]) : [];
          resolve(this.sortByUpdatedDesc(rows).slice(0, MAX_IDB_RECORDS));
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async getAuditFromIndexedDb(auditId: string): Promise<LocalSavedAuditRecord | null> {
    const db = await this.openIndexedDb();
    if (!db || !auditId) return null;

    return new Promise<LocalSavedAuditRecord | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_AUDIT_HISTORY, 'readonly');
        const req = tx.objectStore(STORE_AUDIT_HISTORY).get(auditId);
        req.onsuccess = () =>
          resolve((req.result as LocalSavedAuditRecord | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async deleteAuditFromIndexedDb(auditId: string): Promise<void> {
    const db = await this.openIndexedDb();
    if (db && auditId) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_AUDIT_HISTORY, 'readwrite');
          tx.objectStore(STORE_AUDIT_HISTORY).delete(auditId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    this.indexedDbAudits.update((prev) => prev.filter((item) => item.auditId !== auditId));
  }

  async saveOfflineScanResult(entry: OfflineScanResultRecord): Promise<OfflineScanResultRecord> {
    const db = await this.openIndexedDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_SCAN_RESULTS, 'readwrite');
          tx.objectStore(STORE_SCAN_RESULTS).put(entry);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }

    this.offlineScanResults.update((prev) => {
      const next = [entry, ...prev.filter((item) => item.scanId !== entry.scanId)];
      return next
        .sort((a, b) => new Date(b.scannedAtIso).getTime() - new Date(a.scannedAtIso).getTime())
        .slice(0, MAX_IDB_RECORDS);
    });

    await this.saveAuditToIndexedDb(entry.record);
    return entry;
  }

  async listOfflineScanResults(): Promise<OfflineScanResultRecord[]> {
    const db = await this.openIndexedDb();
    if (!db) return [];

    return new Promise<OfflineScanResultRecord[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_SCAN_RESULTS, 'readonly');
        const req = tx.objectStore(STORE_SCAN_RESULTS).getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? (req.result as OfflineScanResultRecord[]) : [];
          rows.sort(
            (a, b) => new Date(b.scannedAtIso).getTime() - new Date(a.scannedAtIso).getTime()
          );
          resolve(rows.slice(0, MAX_IDB_RECORDS));
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async deleteOfflineScanResult(scanId: string): Promise<void> {
    const db = await this.openIndexedDb();
    if (db && scanId) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_SCAN_RESULTS, 'readwrite');
          tx.objectStore(STORE_SCAN_RESULTS).delete(scanId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    this.offlineScanResults.update((prev) => prev.filter((item) => item.scanId !== scanId));
  }

  async clearOfflineScanResults(): Promise<void> {
    const db = await this.openIndexedDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_SCAN_RESULTS, 'readwrite');
          tx.objectStore(STORE_SCAN_RESULTS).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    this.offlineScanResults.set([]);
  }

  // =========================================================================
  // FILE SYSTEM ACCESS API + UNIFIED OFFLINE AUDIT HISTORY API
  // =========================================================================

  /**
   * Returns locally persisted audit history merged across IndexedDB and localStorage,
   * sorted newest-first for offline access.
   */
  loadOfflineAuditHistory(): LocalSavedAuditRecord[] {
    const byId = new Map<string, LocalSavedAuditRecord>();
    for (const rec of this.indexedDbAudits()) {
      byId.set(rec.auditId, rec);
    }
    for (const rec of this.localAuditStorage.localAudits()) {
      const existing = byId.get(rec.auditId);
      if (!existing) {
        byId.set(rec.auditId, rec);
      } else {
        const tNew = new Date(rec.updatedAtIso || rec.createdAtIso || 0).getTime();
        const tOld = new Date(existing.updatedAtIso || existing.createdAtIso || 0).getTime();
        if (tNew >= tOld) {
          byId.set(rec.auditId, rec);
        }
      }
    }
    return this.sortByUpdatedDesc(Array.from(byId.values()));
  }

  /**
   * Opens one or more audit JSON, Markdown, or TOON files from disk via the
   * File System Access API (with `<input type="file">` fallback) and persists
   * them into both IndexedDB and local offline history.
   */
  async readAuditFiles(): Promise<LocalSavedAuditRecord[]> {
    const loaded = await this.fsData.openAuditFilesFromDisk();
    for (const rec of loaded) {
      await this.saveAuditToIndexedDb(rec);
    }
    return loaded;
  }

  /**
   * Parses raw JSON (single record or consolidated backup bundle), Markdown, or TOON
   * audit content and stores all imported records in IndexedDB and localStorage offline history.
   */
  readAuditFileContent(filename: string, content: string): LocalSavedAuditRecord {
    const imported = this.localAuditStorage.importAuditFileRecords(filename, content);
    for (const rec of imported) {
      void this.saveAuditToIndexedDb(rec);
    }
    return imported[0];
  }

  /**
   * Exports the full Saved Audits history (or supplied merged local + cloud array)
   * as a single consolidated JSON backup report for offline analysis.
   */
  async exportConsolidatedAuditHistoryJson(
    records?: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  ): Promise<{ success: boolean; filename: string; totalCount: number }> {
    const targetRecords = records && records.length > 0 ? records : this.offlineAuditHistory();
    return this.localAuditStorage.exportFullHistoryToDeviceJson(targetRecords);
  }

  /**
   * Exports the full Saved Audits history (or supplied merged local + cloud array)
   * as an RFC-4180 CSV spreadsheet for custom reporting in Excel or Google Sheets.
   */
  async exportConsolidatedAuditHistoryCsv(
    records?: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  ): Promise<{ success: boolean; filename: string; totalCount: number }> {
    const targetRecords = records && records.length > 0 ? records : this.offlineAuditHistory();
    return this.localAuditStorage.exportFullHistoryToDeviceCsv(targetRecords);
  }

  /**
   * Downloads a single saved audit record as a CSV score summary file.
   */
  async exportSingleAuditCsv(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord
  ): Promise<{ success: boolean; filename: string }> {
    return this.localAuditStorage.saveSingleAuditCsvToDevice(record);
  }

  /**
   * Writes an audit record as a `.json` file via the File System Access API
   * (connected workspace folder -> native Save File Picker -> browser download fallback).
   */
  async writeAuditJson(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord
  ): Promise<StorageWriteResult> {
    const res = await this.fsData.saveAuditResultToDisk(record, 'json');
    return {
      ...res,
      format: 'json'
    };
  }

  /**
   * Writes an audit record as a `.md` Markdown report with YAML frontmatter via the
   * File System Access API (connected workspace folder -> native Save File Picker -> download).
   */
  async writeAuditMarkdown(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord
  ): Promise<StorageWriteResult> {
    const res = await this.fsData.saveAuditResultToDisk(record, 'markdown');
    return {
      ...res,
      format: 'markdown'
    };
  }

  /**
   * Writes an audit record in the requested format (`json`, `markdown`, or `toon`).
   */
  async writeAuditFile(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    format: LocalAuditFormat = 'json'
  ): Promise<StorageWriteResult> {
    if (format === 'markdown') {
      return this.writeAuditMarkdown(record);
    }
    if (format === 'json') {
      return this.writeAuditJson(record);
    }
    const res = await this.fsData.saveAuditResultToDisk(record, 'toon');
    return {
      ...res,
      format: 'toon'
    };
  }

  /**
   * Persists an audit record into IndexedDB, localStorage, the 5-item LRU cache,
   * and automatically writes the JSON/Markdown file to disk when a local folder
   * is connected or `options.promptDeviceSave` is enabled.
   */
  async persistAuditHistory(
    record: LocalSavedAuditRecord,
    format: LocalAuditFormat = 'json',
    options?: { promptDeviceSave?: boolean }
  ): Promise<LocalSavedAuditRecord> {
    const persisted = await this.fsData.persistAuditResult(record, format, options);
    await this.saveAuditToIndexedDb(persisted);
    return persisted;
  }

  /**
   * Converts an active `AuditSession` into a `LocalSavedAuditRecord` and persists it
   * across IndexedDB and File System Access storage for offline access.
   */
  async persistSessionAudit(
    session: AuditSession,
    impact: AuditImpactMetrics,
    selectedCommits: AuditCommit[],
    format: LocalAuditFormat = 'json',
    options?: { promptDeviceSave?: boolean }
  ): Promise<LocalSavedAuditRecord> {
    const record = buildLocalSavedAuditRecord(session, impact, selectedCommits, format);
    return this.persistAuditHistory(record, format, options);
  }

  /**
   * Connects or reconnects a local directory via `showDirectoryPicker` so all
   * audit JSON/Markdown files sync bidirectionally into IndexedDB & the Dashboard.
   */
  async connectOfflineDirectory(): Promise<{ connected: boolean; filesLoaded: number }> {
    const result = await this.fsData.connectAuditDirectory();
    if (result.connected && result.filesLoaded > 0) {
      for (const rec of this.localAuditStorage.localAudits()) {
        await this.saveAuditToIndexedDb(rec);
      }
    }
    return result;
  }

  /**
   * Scans the connected local folder and refreshes offline audit history in IndexedDB & UI.
   */
  async syncOfflineDirectory(): Promise<number> {
    const count = await this.fsData.syncConnectedDirectory();
    if (count > 0) {
      for (const rec of this.localAuditStorage.localAudits()) {
        await this.saveAuditToIndexedDb(rec);
      }
    }
    return count;
  }

  /**
   * Disconnects the active File System Access directory handle.
   */
  async disconnectOfflineDirectory(): Promise<void> {
    return this.fsData.disconnectAuditDirectory();
  }

  /**
   * Removes an audit record from both IndexedDB and localStorage offline storage.
   */
  deleteOfflineAudit(auditId: string): void {
    this.localAuditStorage.deleteLocalAudit(auditId);
    void this.deleteAuditFromIndexedDb(auditId);
  }

  /**
   * Serializes an audit record to JSON, Markdown, or TOON string payload + filename + MIME type.
   */
  serializeAudit(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    format: LocalAuditFormat
  ): { filename: string; content: string; mimeType: string } {
    return this.localAuditStorage.exportRecordPayload(record, format);
  }

  private sortByUpdatedDesc(records: LocalSavedAuditRecord[]): LocalSavedAuditRecord[] {
    return [...records].sort((a, b) => {
      const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
      const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
      return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
    });
  }
}

export const storageService = new StorageService();
