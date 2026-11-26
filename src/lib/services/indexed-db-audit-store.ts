import { LocalSavedAuditRecord } from '@/types/audit';

export const FRESNEL_INDEXEDDB_NAME = 'fresnel_audits_db';
export const FRESNEL_INDEXEDDB_VERSION = 1;
export const FRESNEL_INDEXEDDB_STORE = 'saved_audits';

function sortAuditsNewestFirst(records: LocalSavedAuditRecord[]): LocalSavedAuditRecord[] {
  return [...records].sort((a, b) => {
    const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
    const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
    return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
  });
}

/**
 * Durable IndexedDB persistence layer (`fresnel_audits_db`) for Saved Audits.
 * Works alongside the Workbox service worker (`sw.js`) so users can save full
 * audit snapshots (including diff payloads) and browse history completely offline.
 */
export class IndexedDbAuditStoreService {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  isSupported(): boolean {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  private openDatabase(): Promise<IDBDatabase | null> {
    if (!this.isSupported()) {
      return Promise.resolve(null);
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = indexedDB.open(FRESNEL_INDEXEDDB_NAME, FRESNEL_INDEXEDDB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(FRESNEL_INDEXEDDB_STORE)) {
            const store = db.createObjectStore(FRESNEL_INDEXEDDB_STORE, {
              keyPath: 'auditId'
            });
            store.createIndex('updatedAtIso', 'updatedAtIso', { unique: false });
            store.createIndex('repoFullName', 'repoFullName', { unique: false });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          resolve(db);
        };

        request.onerror = () => {
          this.dbPromise = null;
          resolve(null);
        };

        request.onblocked = () => {
          resolve(null);
        };
      } catch {
        this.dbPromise = null;
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  async getAllAudits(): Promise<LocalSavedAuditRecord[]> {
    const db = await this.openDatabase();
    if (!db) return [];

    return new Promise<LocalSavedAuditRecord[]>((resolve) => {
      try {
        const tx = db.transaction(FRESNEL_INDEXEDDB_STORE, 'readonly');
        const store = tx.objectStore(FRESNEL_INDEXEDDB_STORE);
        const req = store.getAll();

        req.onsuccess = () => {
          const items = Array.isArray(req.result) ? req.result : [];
          const valid = items.filter(
            (item): item is LocalSavedAuditRecord =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as LocalSavedAuditRecord).auditId === 'string' &&
              typeof (item as LocalSavedAuditRecord).repoFullName === 'string'
          );
          resolve(sortAuditsNewestFirst(valid));
        };

        req.onerror = () => resolve([]);
        tx.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async putAudit(record: LocalSavedAuditRecord): Promise<boolean> {
    const db = await this.openDatabase();
    if (!db) return false;

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(FRESNEL_INDEXEDDB_STORE, 'readwrite');
        const store = tx.objectStore(FRESNEL_INDEXEDDB_STORE);
        store.put(structuredClone ? structuredClone(record) : JSON.parse(JSON.stringify(record)));

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async replaceAllAudits(records: readonly LocalSavedAuditRecord[]): Promise<boolean> {
    const db = await this.openDatabase();
    if (!db) return false;

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(FRESNEL_INDEXEDDB_STORE, 'readwrite');
        const store = tx.objectStore(FRESNEL_INDEXEDDB_STORE);
        store.clear();
        for (const rec of records) {
          store.put(structuredClone ? structuredClone(rec) : JSON.parse(JSON.stringify(rec)));
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async deleteAudit(auditId: string): Promise<boolean> {
    const db = await this.openDatabase();
    if (!db) return false;

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(FRESNEL_INDEXEDDB_STORE, 'readwrite');
        const store = tx.objectStore(FRESNEL_INDEXEDDB_STORE);
        store.delete(auditId);

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}

export const indexedDbAuditStore = new IndexedDbAuditStoreService();
