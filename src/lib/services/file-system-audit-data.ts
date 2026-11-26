import { ReactiveStore } from './reactive-state';
import {
  LocalAuditFormat,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '@/types/audit';
import {
  LocalAuditStorageService,
  localAuditStorage,
  parseLocalAuditFile
} from './local-audit-storage';
import { AuditResultCacheService, auditResultCache } from './audit-result-cache';

type FsaPermissionMode = 'read' | 'readwrite';
type FsaPermissionState = 'granted' | 'denied' | 'prompt';

interface FsaWritableFileStream {
  write(data: string | Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}

interface FsaFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsaWritableFileStream>;
}

interface FsaDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterableIterator<[string, FsaFileHandle | FsaDirectoryHandle]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(descriptor?: { mode?: FsaPermissionMode }): Promise<FsaPermissionState>;
  requestPermission?(descriptor?: { mode?: FsaPermissionMode }): Promise<FsaPermissionState>;
}

interface FsaWindowApi {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: FsaPermissionMode;
    startIn?: string;
  }) => Promise<FsaDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FsaFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FsaFileHandle>;
}

const IDB_NAME = 'fresnel_fsa_handles_v1';
const IDB_STORE = 'handles';
const AUDIT_DIR_KEY = 'audit_workspace_dir';
const SUPPORTED_AUDIT_EXT_RE = /\.(json|toon|md|markdown)$/i;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
}

function isSecurityOrIframeBlock(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'SecurityError' ||
      /cross-origin|sub frame|user activation|not allowed/i.test(err.message))
  );
}

export interface FileSystemAuditDataSnapshot {
  isDirectoryPickerSupported: boolean;
  isFilePickerSupported: boolean;
  connectedDirectoryName: string | null;
  needsPermissionReconnect: boolean;
  isSyncing: boolean;
  syncedDiskFilesCount: number;
  lastSyncedAtIso: string | null;
  lastSavedFilename: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
  userSavedAuditIds: Set<string>;
  hasConnectedDirectory: boolean;
}

export class FileSystemAuditDataService extends ReactiveStore<FileSystemAuditDataSnapshot> {
  private readonly localAuditStorage: LocalAuditStorageService = localAuditStorage;
  private readonly auditCache: AuditResultCacheService = auditResultCache;

  private directoryHandle: FsaDirectoryHandle | null = null;

  readonly isDirectoryPickerSupported = this.signal<boolean>(
    typeof window !== 'undefined' && typeof (window as unknown as FsaWindowApi).showDirectoryPicker === 'function'
  );
  readonly isFilePickerSupported = this.signal<boolean>(
    typeof window !== 'undefined' &&
      typeof (window as unknown as FsaWindowApi).showOpenFilePicker === 'function' &&
      typeof (window as unknown as FsaWindowApi).showSaveFilePicker === 'function'
  );

  readonly connectedDirectoryName = this.signal<string | null>(null);
  readonly needsPermissionReconnect = this.signal<boolean>(false);
  readonly isSyncing = this.signal<boolean>(false);
  readonly syncedDiskFilesCount = this.signal<number>(0);
  readonly lastSyncedAtIso = this.signal<string | null>(null);
  readonly lastSavedFilename = this.signal<string | null>(null);
  readonly statusMessage = this.signal<string | null>(null);
  readonly errorMessage = this.signal<string | null>(null);

  /** Tracks all auditIds explicitly backed by user-saved or imported local files */
  readonly userSavedAuditIds = this.signal<Set<string>>(new Set<string>());

  /** Records currently backed by disk/user-saved files or local storage */
  readonly currentSavedAudits = this.computed<LocalSavedAuditRecord[]>(() =>
    this.localAuditStorage.localAudits()
  );

  readonly hasConnectedDirectory = this.computed<boolean>(
    () => this.connectedDirectoryName() !== null && !this.needsPermissionReconnect()
  );

  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    if (typeof window !== 'undefined') {
      void this.restoreSavedDirectoryHandle();
    }
  }

  protected override buildSnapshot(): FileSystemAuditDataSnapshot {
    return {
      isDirectoryPickerSupported: this.isDirectoryPickerSupported(),
      isFilePickerSupported: this.isFilePickerSupported(),
      connectedDirectoryName: this.connectedDirectoryName(),
      needsPermissionReconnect: this.needsPermissionReconnect(),
      isSyncing: this.isSyncing(),
      syncedDiskFilesCount: this.syncedDiskFilesCount(),
      lastSyncedAtIso: this.lastSyncedAtIso(),
      lastSavedFilename: this.lastSavedFilename(),
      statusMessage: this.statusMessage(),
      errorMessage: this.errorMessage(),
      userSavedAuditIds: this.userSavedAuditIds(),
      hasConnectedDirectory: this.hasConnectedDirectory(),
    };
  }

  private setTransientStatus(msg: string): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.errorMessage.set(null);
    this.statusMessage.set(msg);
    this.statusTimer = setTimeout(() => {
      this.statusMessage.set(null);
      this.statusTimer = null;
    }, 4200);
  }

  private openHandleDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async saveDirectoryHandleToIdb(handle: FsaDirectoryHandle): Promise<void> {
    const db = await this.openHandleDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, AUDIT_DIR_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async readDirectoryHandleFromIdb(): Promise<FsaDirectoryHandle | null> {
    const db = await this.openHandleDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(AUDIT_DIR_KEY);
        req.onsuccess = () => resolve((req.result as FsaDirectoryHandle | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async clearDirectoryHandleFromIdb(): Promise<void> {
    const db = await this.openHandleDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(AUDIT_DIR_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async restoreSavedDirectoryHandle(): Promise<void> {
    try {
      const saved = await this.readDirectoryHandleFromIdb();
      if (!saved) return;
      this.directoryHandle = saved;
      this.connectedDirectoryName.set(saved.name);

      if (typeof saved.queryPermission === 'function') {
        const state = await saved.queryPermission({ mode: 'readwrite' });
        if (state === 'granted') {
          this.needsPermissionReconnect.set(false);
          await this.syncConnectedDirectory();
        } else {
          this.needsPermissionReconnect.set(true);
        }
      }
    } catch {
      // Non-fatal if browser cleared permission state
    }
  }

  /**
   * Connects a local folder using File System Access API (`showDirectoryPicker`),
   * persists the handle in IndexedDB, and immediately loads all saved audit files
   * (.json, .toon, .md) so the Dashboard D3.js donut chart renders live disk files.
   */
  async connectAuditDirectory(): Promise<{ connected: boolean; filesLoaded: number }> {
    this.errorMessage.set(null);
    if (typeof window === 'undefined') {
      return { connected: false, filesLoaded: 0 };
    }

    const win = window as unknown as FsaWindowApi;

    // If we already have a stored handle waiting for user-gesture permission grant, request it first
    if (this.directoryHandle && this.needsPermissionReconnect()) {
      try {
        const perm =
          typeof this.directoryHandle.requestPermission === 'function'
            ? await this.directoryHandle.requestPermission({ mode: 'readwrite' })
            : 'granted';
        if (perm === 'granted') {
          this.needsPermissionReconnect.set(false);
          const count = await this.syncConnectedDirectory();
          this.setTransientStatus(
            `Reconnected local audit folder "${this.directoryHandle.name}" (${count} files synced).`
          );
          return { connected: true, filesLoaded: count };
        }
      } catch {
        // Fall through to fresh picker
      }
    }

    if (typeof win.showDirectoryPicker !== 'function') {
      this.errorMessage.set(
        'Directory picker requires a Chromium-based browser in a top-level context. Use "Open Local Files" to load .json, .toon, or .md files directly.'
      );
      return { connected: false, filesLoaded: 0 };
    }

    try {
      const dirHandle = await win.showDirectoryPicker({
        id: 'fresnel-audit-folder',
        mode: 'readwrite'
      });
      this.directoryHandle = dirHandle;
      this.connectedDirectoryName.set(dirHandle.name);
      this.needsPermissionReconnect.set(false);
      await this.saveDirectoryHandleToIdb(dirHandle);

      const filesLoaded = await this.syncConnectedDirectory();
      this.setTransientStatus(
        filesLoaded > 0
          ? `Connected folder "${dirHandle.name}" · synced ${filesLoaded} saved audit ${filesLoaded === 1 ? 'file' : 'files'} to Dashboard donut chart.`
          : `Connected folder "${dirHandle.name}" · new audits will auto-save here.`
      );
      return { connected: true, filesLoaded };
    } catch (err) {
      if (isAbortError(err)) {
        return { connected: false, filesLoaded: 0 };
      }
      if (isSecurityOrIframeBlock(err)) {
        this.errorMessage.set(
          'Folder access is restricted inside an embedded preview iframe. Open the app in a new tab for persistent folder sync, or use "Open Local Files" below.'
        );
      } else {
        this.errorMessage.set(
          err instanceof Error ? err.message : 'Unable to connect local audit folder.'
        );
      }
      return { connected: false, filesLoaded: 0 };
    }
  }

  /**
   * Scans the connected local folder for all .json, .toon, and .md audit files,
   * parses them, and replaces/updates LocalAuditStorageService so the Dashboard
   * D3.js donut chart always reflects the exact current files on disk.
   */
  async syncConnectedDirectory(): Promise<number> {
    if (!this.directoryHandle) {
      return 0;
    }

    this.isSyncing.set(true);
    this.errorMessage.set(null);

    try {
      const parsedRecords: LocalSavedAuditRecord[] = [];
      for await (const [name, entry] of this.directoryHandle.entries()) {
        if (entry.kind !== 'file' || !SUPPORTED_AUDIT_EXT_RE.test(name)) {
          continue;
        }
        try {
          const file = await entry.getFile();
          if (file.size > 4 * 1024 * 1024) continue;
          const content = await file.text();
          const parsed = parseLocalAuditFile(name, content);
          parsed.storageSource = 'local';
          parsedRecords.push(parsed);
        } catch {
          // Skip non-Fresnel files gracefully
        }
      }

      parsedRecords.sort((a, b) => {
        const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
        const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
        return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
      });

      if (parsedRecords.length > 0) {
        this.localAuditStorage.replaceAllLocalAudits(parsedRecords);
        this.userSavedAuditIds.set(new Set(parsedRecords.map((r) => r.auditId)));
      }

      this.syncedDiskFilesCount.set(parsedRecords.length);
      this.lastSyncedAtIso.set(new Date().toISOString());
      return parsedRecords.length;
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to sync connected local audit folder.'
      );
      return 0;
    } finally {
      this.isSyncing.set(false);
    }
  }

  async disconnectAuditDirectory(): Promise<void> {
    this.directoryHandle = null;
    this.connectedDirectoryName.set(null);
    this.needsPermissionReconnect.set(false);
    this.syncedDiskFilesCount.set(0);
    await this.clearDirectoryHandleFromIdb();
    this.setTransientStatus('Disconnected local audit folder.');
  }

  /**
   * Opens one or more saved audit files (.json, .toon, .md) from disk via File System Access API
   * (with `<input type="file" multiple>` fallback), updates LocalAuditStorageService, and
   * immediately refreshes the Dashboard D3.js donut chart.
   */
  async openAuditFilesFromDisk(): Promise<LocalSavedAuditRecord[]> {
    this.errorMessage.set(null);
    if (typeof window === 'undefined') return [];

    const win = window as unknown as FsaWindowApi;
    const loaded: LocalSavedAuditRecord[] = [];

    if (typeof win.showOpenFilePicker === 'function') {
      try {
        const handles = await win.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Fresnel Audit Files (.json, .toon, .md)',
              accept: {
                'application/json': ['.json'],
                'text/plain': ['.toon'],
                'text/markdown': ['.md', '.markdown']
              }
            }
          ]
        });

        for (const handle of handles) {
          const file = await handle.getFile();
          const content = await file.text();
          const record = this.localAuditStorage.importAuditFile(file.name, content);
          loaded.push(record);
        }

        if (loaded.length > 0) {
          this.markAsUserSaved(loaded);
          this.setTransientStatus(
            `Loaded ${loaded.length} user-saved audit ${loaded.length === 1 ? 'file' : 'files'} into Dashboard D3.js donut chart.`
          );
        }
        return loaded;
      } catch (err) {
        if (isAbortError(err)) return [];
        if (!isSecurityOrIframeBlock(err)) {
          this.errorMessage.set(
            err instanceof Error ? err.message : 'Failed to parse selected audit file.'
          );
          return [];
        }
        // If blocked by iframe sandbox, seamlessly fall through to standard file input
      }
    }

    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.json,.toon,.md,.markdown,application/json,text/plain';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.onchange = async () => {
        const files = Array.from(input.files ?? []);
        document.body.removeChild(input);
        const imported: LocalSavedAuditRecord[] = [];
        for (const file of files) {
          try {
            const content = await file.text();
            imported.push(this.localAuditStorage.importAuditFile(file.name, content));
          } catch (e) {
            this.errorMessage.set(
              e instanceof Error ? e.message : `Could not parse ${file.name}.`
            );
          }
        }
        if (imported.length > 0) {
          this.markAsUserSaved(imported);
          this.setTransientStatus(
            `Loaded ${imported.length} user-saved audit ${imported.length === 1 ? 'file' : 'files'} into Dashboard D3.js donut chart.`
          );
        }
        resolve(imported);
      };

      input.oncancel = () => {
        document.body.removeChild(input);
        resolve([]);
      };

      input.click();
    });
  }

  /**
   * Saves a single audit record to disk via the connected FileSystemDirectoryHandle
   * (auto-save without extra dialogs) OR via File System Access API `showSaveFilePicker`
   * (falling back to instant browser download if unsupported or inside an iframe).
   */
  async saveAuditResultToDisk(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    format: LocalAuditFormat = 'json'
  ): Promise<{ saved: boolean; filename: string; location: 'directory' | 'picker' | 'download' }> {
    this.errorMessage.set(null);
    const payload = this.localAuditStorage.exportRecordPayload(record, format);

    if (typeof window === 'undefined') {
      return { saved: false, filename: payload.filename, location: 'download' };
    }

    // 1. Auto-write directly into connected File System Access directory if active
    if (this.directoryHandle && !this.needsPermissionReconnect()) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(payload.filename, {
          create: true
        });
        const writable = await fileHandle.createWritable();
        await writable.write(payload.content);
        await writable.close();

        this.lastSavedFilename.set(payload.filename);
        this.lastSyncedAtIso.set(new Date().toISOString());
        this.syncedDiskFilesCount.update((n) => Math.max(1, n));
        this.setTransientStatus(
          `Saved "${payload.filename}" directly to local folder "${this.directoryHandle.name}".`
        );
        return { saved: true, filename: payload.filename, location: 'directory' };
      } catch (err) {
        if (!isAbortError(err)) {
          // Fall back to save file picker
        }
      }
    }

    // 2. Prompt native File System Access API save dialog
    const win = window as unknown as FsaWindowApi;
    if (typeof win.showSaveFilePicker === 'function') {
      try {
        const ext = format === 'toon' ? '.toon' : format === 'markdown' ? '.md' : '.json';
        const fileHandle = await win.showSaveFilePicker({
          suggestedName: payload.filename,
          types: [
            {
              description: `Fresnel Audit (${format.toUpperCase()})`,
              accept: { [payload.mimeType.split(';')[0]]: [ext] }
            }
          ]
        });
        const writable = await fileHandle.createWritable();
        await writable.write(payload.content);
        await writable.close();

        this.lastSavedFilename.set(payload.filename);
        this.setTransientStatus(`Saved audit directly to device file "${payload.filename}".`);
        return { saved: true, filename: payload.filename, location: 'picker' };
      } catch (err) {
        if (isAbortError(err)) {
          return { saved: false, filename: payload.filename, location: 'picker' };
        }
        // If blocked by iframe sandbox, fall through to instant download
      }
    }

    // 3. Universal browser download fallback
    this.localAuditStorage.downloadPayloadAsFile(
      payload.filename,
      payload.content,
      payload.mimeType
    );
    this.lastSavedFilename.set(payload.filename);
    this.setTransientStatus(`Exported audit to device file "${payload.filename}".`);
    return { saved: true, filename: payload.filename, location: 'download' };
  }

  /**
   * Central persistence method ensuring every newly created local audit is saved
   * to LocalAuditStorageService (updating the Dashboard D3.js donut chart instantly)
   * AND persisted to disk if a local audit directory is connected or requested.
   */
  async persistAuditResult(
    record: LocalSavedAuditRecord,
    format: LocalAuditFormat = 'json',
    options?: { promptDeviceSave?: boolean }
  ): Promise<LocalSavedAuditRecord> {
    const normalized: LocalSavedAuditRecord = {
      ...record,
      storageSource: 'local',
      savedFormat: format
    };

    // If only seeded sample records existed prior to the user's first real saved audit,
    // keep the user's new audit at the top and record it as explicitly user-saved.
    this.localAuditStorage.upsertRecord(normalized);
    this.markAsUserSaved([normalized]);
    this.auditCache.cacheFromSavedRecord(normalized);

    if (this.directoryHandle && !this.needsPermissionReconnect()) {
      await this.saveAuditResultToDisk(normalized, format);
    } else if (options?.promptDeviceSave) {
      await this.saveAuditResultToDisk(normalized, format);
    }

    return normalized;
  }

  private markAsUserSaved(records: LocalSavedAuditRecord[]): void {
    this.userSavedAuditIds.update((prev) => {
      const next = new Set(prev);
      for (const r of records) {
        next.add(r.auditId);
      }
      return next;
    });
  }
}

export const fileSystemAuditData = new FileSystemAuditDataService();
