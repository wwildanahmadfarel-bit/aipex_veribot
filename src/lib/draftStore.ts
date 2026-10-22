// IndexedDB draft persistence for InteractiveWizard — AIPEX VeriBot
// Menyimpan seluruh state formulir (termasuk base64 gambar) per tab.
// TTL 24 jam + auto-cleanup. Data sensitif (NIK + foto) — bersihkan saat selesai.

const DB_NAME = 'aipex-wizard-draft';
const STORE_NAME = 'drafts';
const DB_VERSION = 2; // v2: added uploadMode & combinedPdfPages
const TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

export interface CombinedPdfPage {
  base64: string;
  mimeType: string;
  docType: string;
  fileName: string;
  /** Slot syarat layanan asal halaman ini (mis. "Fotokopi KTP"). */
  slotTitle?: string;
}

export interface WizardDraft {
  id: string; // fixed 'current'
  service: string;
  nik: string;
  nama: string;
  wa: string;
  alamat: string;
  currentStep: 1 | 2 | 3 | 4;
  docImageBase64: string | null;
  docImageName: string;
  supportFiles: { base64: string; name: string }[];
  uploadMode: 'individual' | 'combined';
  combinedPdfPages: CombinedPdfPage[];
  updatedAt: number;
  expiresAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB tidak tersedia'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Simpan draft (debounce di caller). Base64 besar -> try/catch quota. */
export async function saveDraft(draft: Omit<WizardDraft, 'id' | 'updatedAt' | 'expiresAt'>): Promise<void> {
  try {
    const db = await openDB();
    const now = Date.now();
    const record: WizardDraft = {
      id: 'current',
      ...draft,
      updatedAt: now,
      expiresAt: now + TTL_MS,
    };
    await withStore(db, 'readwrite', (store) => store.put(record));
    db.close();
  } catch (e) {
    // Kuota IndexedDB terlampaui (base64 terlalu besar) -- simpan tanpa gambar
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      try {
        const db = await openDB();
        const now = Date.now();
        const record: WizardDraft = {
          id: 'current',
          ...draft,
          docImageBase64: null,
          supportFiles: draft.supportFiles.map((f) => ({ base64: '', name: f.name })),
          combinedPdfPages: draft.combinedPdfPages.map((f) => ({ ...f, base64: '' })),
          updatedAt: now,
          expiresAt: now + TTL_MS,
        };
        await withStore(db, 'readwrite', (store) => store.put(record));
        db.close();
      } catch {
        // abaikan -- draft tidak tersimpan, tapi app tetap jalan
      }
    }
    // error lain: abaikan (tidak boleh blokir UX)
  }
}

/** Muat draft, auto-hapus jika expired. Return null jika tidak ada / expired. */
export async function loadDraft(): Promise<WizardDraft | null> {
  try {
    const db = await openDB();
    const record = await withStore(db, 'readonly', (store) => store.get('current')) as WizardDraft | undefined;
    db.close();
    if (!record) return null;
    if (record.expiresAt && record.expiresAt < Date.now()) {
      await clearDraft();
      return null;
    }
    // Migration from v1: add missing fields
    return {
      ...record,
      uploadMode: record.uploadMode || 'individual',
      combinedPdfPages: record.combinedPdfPages || [],
    };
  } catch {
    return null;
  }
}

/** Hapus draft (saat tiket jadi / user klik 'Hapus draft' / Selesai). */
export async function clearDraft(): Promise<void> {
  try {
    const db = await openDB();
    await withStore(db, 'readwrite', (store) => store.delete('current'));
    db.close();
  } catch {}
}
