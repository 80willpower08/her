// Mirror of the SW's IndexedDB stash for staged shares.
// SW writes here when /share-receive is POSTed; the SPA reads here on mount.

const SHARE_DB = 'time-keeper-share';
const SHARE_STORE = 'pending';

export interface StagedShare {
  id: string;
  title: string;
  text: string;
  url: string;
  stagedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SHARE_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readStagedShare(id: string): Promise<StagedShare | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readonly');
    const req = tx.objectStore(SHARE_STORE).get(id);
    req.onsuccess = () => resolve((req.result as StagedShare | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStagedShare(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.objectStore(SHARE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
