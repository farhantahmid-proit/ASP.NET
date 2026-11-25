import { Injectable, computed, inject } from '@angular/core';
import {
  AuditCommit,
  AuditImpactMetrics,
  AuditSession,
  LocalAuditFormat,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '../models/audit.model';
import { FileSystemAuditDataService } from './file-system-audit-data.service';
import {
  LocalAuditStorageService,
  buildLocalSavedAuditRecord
} from './local-audit-storage.service';

export interface StorageWriteResult {
  saved: boolean;
  filename: string;
  format: LocalAuditFormat;
  location: 'directory' | 'picker' | 'download';
}

export interface OfflineHistorySummary {
  totalCount: number;
  jsonCount: number;
  markdownCount: number;
  toonCount: number;
  folderName: string | null;
  isOfflineReady: boolean;
}

/**
 * High-level abstraction over the File System Access API and browser offline storage
 * for reading and writing audit JSON, Markdown, and TOON files, persisting audit history,
 * and supporting full offline access without a backend server.
 */
@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly fsData = inject(FileSystemAuditDataService);
  private readonly localAuditStorage = inject(LocalAuditStorageService);

  readonly isFileSystemAccessSupported = computed<boolean>(
    () => this.fsData.isFilePickerSupported() || this.fsData.isDirectoryPickerSupported()
  );

  readonly isDirectoryPickerSupported = this.fsData.isDirectoryPickerSupported;
  readonly connectedFolderName = this.fsData.connectedDirectoryName;
  readonly hasConnectedFolder = this.fsData.hasConnectedDirectory;
  readonly needsPermissionReconnect = this.fsData.needsPermissionReconnect;
  readonly isBusy = this.fsData.isSyncing;
  readonly lastSavedFilename = this.fsData.lastSavedFilename;
  readonly statusMessage = computed<string | null>(
    () => this.fsData.statusMessage() ?? this.localAuditStorage.localNotice()
  );
  readonly errorMessage = this.fsData.errorMessage;

  /** Reactive list of all persisted offline audit records (newest first). */
  readonly offlineAuditHistory = computed<LocalSavedAuditRecord[]>(() =>
    this.loadOfflineAuditHistory()
  );

  readonly offlineSummary = computed<OfflineHistorySummary>(() => {
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
      jsonCount,
      markdownCount,
      toonCount,
      folderName: this.connectedFolderName(),
      isOfflineReady: true
    };
  });

  /**
   * Returns locally persisted audit history sorted newest-first for offline access.
   */
  loadOfflineAuditHistory(): LocalSavedAuditRecord[] {
    return [...this.localAuditStorage.localAudits()].sort((a, b) => {
      const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
      const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
      return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
    });
  }

  /**
   * Opens one or more audit JSON, Markdown, or TOON files from disk via the
   * File System Access API (with `<input type="file">` fallback) and updates
   * persisted offline history.
   */
  async readAuditFiles(): Promise<LocalSavedAuditRecord[]> {
    return this.fsData.openAuditFilesFromDisk();
  }

  /**
   * Parses raw JSON, Markdown, or TOON audit content and stores it in offline history.
   */
  readAuditFileContent(filename: string, content: string): LocalSavedAuditRecord {
    return this.localAuditStorage.importAuditFile(filename, content);
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
   * Persists an audit record into offline storage (`localStorage` + LRU cache) and
   * automatically writes the JSON/Markdown file to disk when a local folder is connected
   * or when `options.promptDeviceSave` is enabled.
   */
  async persistAuditHistory(
    record: LocalSavedAuditRecord,
    format: LocalAuditFormat = 'json',
    options?: { promptDeviceSave?: boolean }
  ): Promise<LocalSavedAuditRecord> {
    return this.fsData.persistAuditResult(record, format, options);
  }

  /**
   * Converts an active `AuditSession` into a `LocalSavedAuditRecord` and persists it
   * for offline access (and optional immediate JSON/Markdown disk write).
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
   * audit JSON/Markdown files sync bidirectionally for offline access.
   */
  async connectOfflineDirectory(): Promise<{ connected: boolean; filesLoaded: number }> {
    return this.fsData.connectAuditDirectory();
  }

  /**
   * Scans the connected local folder and refreshes offline audit history from disk files.
   */
  async syncOfflineDirectory(): Promise<number> {
    return this.fsData.syncConnectedDirectory();
  }

  /**
   * Disconnects the active File System Access directory handle.
   */
  async disconnectOfflineDirectory(): Promise<void> {
    return this.fsData.disconnectAuditDirectory();
  }

  /**
   * Removes an audit record from offline storage.
   */
  deleteOfflineAudit(auditId: string): void {
    this.localAuditStorage.deleteLocalAudit(auditId);
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
}
