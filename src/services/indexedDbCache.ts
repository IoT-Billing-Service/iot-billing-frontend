const DB_NAME = 'iot-billing-cache';
const DB_VERSION = 2;
const STORES = ['telemetry', 'transactions', 'fleetViews', 'authSession', 'pendingTransactions'] as const;

type StoreName = (typeof STORES)[number];

export interface PendingTransaction {
  id: string; // unique identifier
  hash: string; // transaction hash
  contractId: string;
  amount: string;
  asset: string;
  publicKey: string;
  type: 'escrow_deposit' | 'escrow_withdrawal';
  status: 'pending' | 'confirmed' | 'failed';
  retryCount: number;
  maxRetries: number;
  lastScannedLedger?: number;
  createdAt: number;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      
      // Create stores that don't exist
      STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          if (store === 'pendingTransactions') {
            // Create pendingTransactions with indexes
            const objectStore = db.createObjectStore(store, { keyPath: 'id' });
            objectStore.createIndex('status', 'status', { unique: false });
            objectStore.createIndex('createdAt', 'createdAt', { unique: false });
            objectStore.createIndex('hash', 'hash', { unique: false });
          } else {
            db.createObjectStore(store, { keyPath: 'id' });
          }
        }
      });
      
      // Upgrade existing pendingTransactions store if upgrading from v1
      if (oldVersion < 2 && db.objectStoreNames.contains('pendingTransactions')) {
        // Note: Can't modify object store in same version, indexes already created above
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cachePut<T>(store: StoreName, id: string, data: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put({ id, data, timestamp: Date.now() });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function cacheGet<T>(store: StoreName, id: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result?.data ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function cacheDelete(store: StoreName, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function cacheClear(store: StoreName): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// Pending transactions operations
export async function savePendingTransaction(tx: PendingTransaction): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pendingTransactions', 'readwrite');
    transaction.objectStore('pendingTransactions').put(tx);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getPendingTransaction(id: string): Promise<PendingTransaction | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingTransactions', 'readonly');
    const req = tx.objectStore('pendingTransactions').get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function getAllPendingTransactions(): Promise<PendingTransaction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingTransactions', 'readonly');
    const req = tx.objectStore('pendingTransactions').getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function getPendingTransactionsByStatus(status: 'pending' | 'confirmed' | 'failed'): Promise<PendingTransaction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingTransactions', 'readonly');
    const index = tx.objectStore('pendingTransactions').index('status');
    const req = index.getAll(status);
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function deletePendingTransaction(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingTransactions', 'readwrite');
    tx.objectStore('pendingTransactions').delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deleteCompletedTransactions(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingTransactions', 'readwrite');
    const store = tx.objectStore('pendingTransactions');
    const index = store.index('status');
    const req = index.openCursor(IDBKeyRange.only('confirmed'));
    let count = 0;
    
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        count++;
        cursor.continue();
      }
    };
    
    tx.oncomplete = () => {
      db.close();
      resolve(count);
    };
    
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
