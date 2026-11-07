import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  getDocFromServer,
  QuerySnapshot,
  DocumentData,
  QueryDocumentSnapshot,
  FirestoreError,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Exam, ExamCategory, SiteBranding, DEFAULT_SITE_BRANDING } from './types/exam';
import { DEFAULT_ADMIN_KEY } from './utils/accessControl';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export const IGNORED_EXAM_IDS = new Set(['catalog_index', 'exam-test-123']);

export function sanitizeDocId(rawId: string): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return cleaned || `exam-${Date.now()}`;
}

export function deriveExamCode(id: string, existingCode?: string): string {
  if (existingCode && String(existingCode).trim()) {
    return String(existingCode).trim().slice(0, 32);
  }
  const digits = String(id || '').replace(/\D/g, '');
  if (digits.length >= 5) {
    return digits.slice(-5);
  }
  let hash = 0;
  const str = String(id || 'exam');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 90000;
  }
  return String(10000 + Math.abs(hash));
}

export function sanitizeSiteBrandingPayload(branding: SiteBranding): Record<string, unknown> {
  const title =
    String(branding.title || DEFAULT_SITE_BRANDING.title).trim().slice(0, 200) ||
    DEFAULT_SITE_BRANDING.title;
  const subtitle =
    String(branding.subtitle || DEFAULT_SITE_BRANDING.subtitle).trim().slice(0, 200) ||
    DEFAULT_SITE_BRANDING.subtitle;
  const version =
    String(branding.version || DEFAULT_SITE_BRANDING.version).trim().slice(0, 100) ||
    DEFAULT_SITE_BRANDING.version;
  const logoUrl = String(branding.logoUrl || '').trim().slice(0, 850000);

  return {
    title,
    subtitle,
    version,
    logoUrl,
    updatedAt: new Date().toISOString(),
    adminToken: DEFAULT_ADMIN_KEY,
  };
}

export function normalizeQuestionTableData(raw: unknown): Exam['questions'][number]['tableData'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const headers = Array.isArray(obj.headers)
    ? obj.headers.map((h) => String(h ?? '').trim())
    : [];

  let rows: string[][] = [];
  if (Array.isArray(obj.rows)) {
    rows = obj.rows
      .map((r) => {
        if (Array.isArray(r)) {
          return r.map((c) => String(c ?? '').trim());
        }
        if (r && typeof r === 'object' && Array.isArray((r as { cells?: unknown[] }).cells)) {
          return ((r as { cells: unknown[] }).cells || []).map((c) => String(c ?? '').trim());
        }
        return [];
      })
      .filter((r) => r.length > 0);
  } else if (typeof obj.rowsJson === 'string') {
    try {
      const parsed = JSON.parse(obj.rowsJson);
      if (Array.isArray(parsed)) {
        rows = parsed.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));
      }
    } catch {
      // ignore
    }
  }

  if (headers.length === 0 && rows.length === 0) return undefined;

  const colCount = Math.max(
    headers.length,
    ...rows.map((r) => r.length),
    1
  );
  const normalizedHeaders = Array.from({ length: colCount }, (_, i) => headers[i] ?? '');
  const normalizedRows = rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => r[i] ?? '')
  );

  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : undefined,
    unit: typeof obj.unit === 'string' && obj.unit.trim() ? obj.unit.trim() : undefined,
    headers: normalizedHeaders,
    rows: normalizedRows,
    sourceNote:
      typeof obj.sourceNote === 'string' && obj.sourceNote.trim()
        ? obj.sourceNote.trim()
        : undefined,
  };
}

function serializeQuestionForFirestore(q: Exam['questions'][number], idx: number): Record<string, unknown> {
  const qType = q.type === 'multiple' || q.type === 'short' ? q.type : 'single';
  const safeOptions = {
    A: String(q.options?.A ?? (qType === 'short' ? '' : 'Phương án A')),
    B: String(q.options?.B ?? (qType === 'short' ? '' : 'Phương án B')),
    C: String(q.options?.C ?? (qType === 'short' ? '' : 'Phương án C')),
    D: String(q.options?.D ?? (qType === 'short' ? '' : 'Phương án D')),
  };

  const serialized: Record<string, unknown> = {
    id: String(q.id || `q-${idx + 1}`),
    number: Number(q.number) || idx + 1,
    type: qType,
    text: String(q.text || `Câu hỏi ${idx + 1}`),
    options: safeOptions,
    correctAnswer: ['A', 'B', 'C', 'D'].includes(q.correctAnswer) ? q.correctAnswer : 'A',
  };

  if (q.imageUrl && typeof q.imageUrl === 'string' && q.imageUrl.trim()) {
    serialized.imageUrl = q.imageUrl.trim();
  }
  if (Array.isArray(q.correctAnswers)) {
    serialized.correctAnswers = q.correctAnswers.filter((k) =>
      ['A', 'B', 'C', 'D'].includes(k)
    );
  }
  if (typeof q.shortAnswer === 'string') {
    serialized.shortAnswer = q.shortAnswer;
  }
  if (typeof q.explanation === 'string' && q.explanation.trim()) {
    serialized.explanation = q.explanation.trim();
  }

  const normTable = normalizeQuestionTableData(q.tableData);
  if (normTable) {
    // Store rows as an array of { cells: string[] } objects because Firestore forbids nested arrays (string[][])
    const tableObj: Record<string, unknown> = {
      headers: normTable.headers,
      rows: normTable.rows.map((r) => ({ cells: r })),
    };
    if (normTable.title) tableObj.title = normTable.title;
    if (normTable.unit) tableObj.unit = normTable.unit;
    if (normTable.sourceNote) tableObj.sourceNote = normTable.sourceNote;
    serialized.tableData = tableObj;
  }

  return serialized;
}

export function sanitizeExamPayload(exam: Exam): { id: string; payload: Record<string, unknown> } {
  const safeId = sanitizeDocId(exam.id);
  const rawQuestions = Array.isArray(exam.questions) ? exam.questions.slice(0, 500) : [];
  const cleanQuestions = rawQuestions.map((q, idx) => serializeQuestionForFirestore(q, idx));

  const payload: Record<string, unknown> = {
    id: safeId,
    examCode: deriveExamCode(safeId, exam.examCode),
    title: (String(exam.title || 'Đề thi mới').trim() || 'Đề thi mới').slice(0, 300),
    category: (String(exam.category || 'Lịch sử').trim() || 'Lịch sử').slice(0, 100),
    durationMinutes: Math.min(600, Math.max(1, Number(exam.durationMinutes) || 45)),
    createdAt: (
      String(exam.createdAt || new Date().toLocaleDateString('vi-VN')).trim() || '07/11/2026'
    ).slice(0, 64),
    uploadTime: (String(exam.uploadTime || '11:30').trim() || '11:30').slice(0, 16),
    questions: cleanQuestions,
    shuffleQuestions: Boolean(exam.shuffleQuestions),
    shuffleOptions: Boolean(exam.shuffleOptions),
    isFavorite: Boolean(exam.isFavorite),
    updatedAt: new Date().toISOString(),
    adminToken: DEFAULT_ADMIN_KEY,
  };

  // Guard against Firestore 1 MiB (1,048,576 bytes) document limit when exams contain large embedded base64 images
  try {
    let serializedStr = JSON.stringify(payload);
    if (serializedStr.length > 880000) {
      for (let i = cleanQuestions.length - 1; i >= 0; i--) {
        const qObj = cleanQuestions[i];
        if (typeof qObj.imageUrl === 'string' && qObj.imageUrl.startsWith('data:image/') && qObj.imageUrl.length > 30000) {
          delete qObj.imageUrl;
          serializedStr = JSON.stringify(payload);
          if (serializedStr.length <= 880000) break;
        }
      }
    }
  } catch {
    // ignore
  }

  return { id: safeId, payload };
}

export function subscribeToSiteBranding(
  onUpdate: (branding: SiteBranding | null) => void
): () => void {
  const path = 'settings/site_config';
  return onSnapshot(
    doc(db, 'settings', 'site_config'),
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null);
        return;
      }
      const data = snapshot.data();
      onUpdate({
        title: typeof data.title === 'string' && data.title ? data.title : DEFAULT_SITE_BRANDING.title,
        subtitle:
          typeof data.subtitle === 'string' && data.subtitle
            ? data.subtitle
            : DEFAULT_SITE_BRANDING.subtitle,
        version:
          typeof data.version === 'string' && data.version
            ? data.version
            : DEFAULT_SITE_BRANDING.version,
        logoUrl: typeof data.logoUrl === 'string' ? data.logoUrl : '',
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export async function saveSiteBrandingToCloud(branding: SiteBranding): Promise<void> {
  const path = 'settings/site_config';
  try {
    const payload = sanitizeSiteBrandingPayload(branding);
    await setDoc(doc(db, 'settings', 'site_config'), payload);
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Logged via handleFirestoreError
    }
  }
}

function getExamCreationSortValue(exam: Exam): number {
  const idDigits = String(exam.id || '').match(/(\d{10,15})/);
  if (idDigits) {
    return Number(idDigits[1]);
  }
  return 0;
}

export function subscribeToCloudExams(
  onUpdate: (exams: Exam[]) => void
): () => void {
  const path = 'exams';
  return onSnapshot(
    collection(db, 'exams'),
    (snapshot: QuerySnapshot<DocumentData>) => {
      const list: Exam[] = [];
      snapshot.forEach((docSnap: QueryDocumentSnapshot<DocumentData>) => {
        const docId = docSnap.id;
        const data = docSnap.data();
        if (IGNORED_EXAM_IDS.has(docId) || (data && IGNORED_EXAM_IDS.has(String(data.id || '')))) {
          void deleteDoc(doc(db, 'exams', docId)).catch(() => {});
          return;
        }
        if (data && Array.isArray(data.questions)) {
          const canonicalId = docId || String(data.id || '');
          if (!canonicalId) return;
          const normalizedQuestions: Exam['questions'] = data.questions.map(
            (rawQ: Record<string, unknown>, idx: number) => {
              const qType =
                rawQ?.type === 'multiple' || rawQ?.type === 'short' ? rawQ.type : 'single';
              const rawOpts =
                rawQ?.options && typeof rawQ.options === 'object'
                  ? (rawQ.options as Record<string, unknown>)
                  : {};
              return {
                id: String(rawQ?.id || `q-${idx + 1}`),
                number: Number(rawQ?.number) || idx + 1,
                type: qType,
                text: String(rawQ?.text || `Câu hỏi ${idx + 1}`),
                imageUrl:
                  typeof rawQ?.imageUrl === 'string' && rawQ.imageUrl.trim()
                    ? rawQ.imageUrl.trim()
                    : undefined,
                tableData: normalizeQuestionTableData(rawQ?.tableData),
                options: {
                  A: String(rawOpts.A ?? (qType === 'short' ? '' : 'Phương án A')),
                  B: String(rawOpts.B ?? (qType === 'short' ? '' : 'Phương án B')),
                  C: String(rawOpts.C ?? (qType === 'short' ? '' : 'Phương án C')),
                  D: String(rawOpts.D ?? (qType === 'short' ? '' : 'Phương án D')),
                },
                correctAnswer: ['A', 'B', 'C', 'D'].includes(String(rawQ?.correctAnswer))
                  ? (String(rawQ?.correctAnswer) as 'A' | 'B' | 'C' | 'D')
                  : 'A',
                correctAnswers: Array.isArray(rawQ?.correctAnswers)
                  ? (rawQ.correctAnswers.filter((k: unknown) =>
                      ['A', 'B', 'C', 'D'].includes(String(k))
                    ) as ('A' | 'B' | 'C' | 'D')[])
                  : undefined,
                shortAnswer:
                  typeof rawQ?.shortAnswer === 'string' ? rawQ.shortAnswer : undefined,
                explanation:
                  typeof rawQ?.explanation === 'string' ? rawQ.explanation : undefined,
              };
            }
          );

          list.push({
            id: canonicalId,
            examCode: deriveExamCode(
              canonicalId,
              typeof data.examCode === 'string' ? data.examCode : undefined
            ),
            title: String(data.title || 'Đề thi'),
            category: String(data.category || 'Lịch sử') as ExamCategory,
            durationMinutes: Number(data.durationMinutes) || 45,
            createdAt: String(data.createdAt || '07/11/2026'),
            uploadTime:
              typeof data.uploadTime === 'string' && data.uploadTime.trim()
                ? data.uploadTime.trim()
                : '11:30',
            questions: normalizedQuestions,
            shuffleQuestions: Boolean(data.shuffleQuestions),
            shuffleOptions: Boolean(data.shuffleOptions),
            isFavorite: Boolean(data.isFavorite),
          });
        }
      });

      list.sort((a, b) => {
        const diff = getExamCreationSortValue(b) - getExamCreationSortValue(a);
        if (diff !== 0) return diff;
        return b.id.localeCompare(a.id);
      });

      onUpdate(list);
    },
    (error: FirestoreError) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export async function saveExamToCloud(exam: Exam): Promise<boolean> {
  if (!exam || IGNORED_EXAM_IDS.has(exam.id)) return false;
  const { id, payload } = sanitizeExamPayload(exam);
  const path = `exams/${id}`;
  try {
    await setDoc(doc(db, 'exams', id), payload);
    return true;
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Logged via handleFirestoreError
    }
    return false;
  }
}

export async function deleteExamFromCloud(examId: string): Promise<boolean> {
  const raw = String(examId || '').trim();
  const safeId = sanitizeDocId(raw);
  const path = `exams/${safeId}`;
  try {
    await deleteDoc(doc(db, 'exams', safeId));
    if (raw && raw !== safeId) {
      await deleteDoc(doc(db, 'exams', raw)).catch(() => {});
    }
    const snap = await getDocs(collection(db, 'exams'));
    const extraDeletes: Promise<void>[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (docSnap.id === raw || docSnap.id === safeId || data?.id === raw || data?.id === safeId) {
        extraDeletes.push(deleteDoc(doc(db, 'exams', docSnap.id)));
      }
    });
    if (extraDeletes.length > 0) {
      await Promise.allSettled(extraDeletes);
    }
    return true;
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.DELETE, path);
    } catch {
      // Logged via handleFirestoreError
    }
    return false;
  }
}

export async function syncAllToCloud(
  exams: Exam[],
  branding: SiteBranding
): Promise<{ success: boolean; count: number; error?: string }> {
  let successCount = 0;
  let lastError = '';

  try {
    await saveSiteBrandingToCloud(branding);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  const activeCloudIds = new Set<string>();

  for (const exam of exams) {
    if (!exam || !exam.id || IGNORED_EXAM_IDS.has(exam.id)) continue;
    const { id, payload } = sanitizeExamPayload(exam);
    activeCloudIds.add(id);
    const path = `exams/${id}`;
    try {
      await setDoc(doc(db, 'exams', id), payload);
      successCount++;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  }

  try {
    const snap = await getDocs(collection(db, 'exams'));
    const staleDeletes: Promise<void>[] = [];
    snap.forEach((docSnap) => {
      if (!activeCloudIds.has(docSnap.id) || IGNORED_EXAM_IDS.has(docSnap.id)) {
        staleDeletes.push(deleteDoc(doc(db, 'exams', docSnap.id)));
      }
    });
    if (staleDeletes.length > 0) {
      await Promise.allSettled(staleDeletes);
    }
  } catch {
    // Ignore cleanup errors
  }

  return {
    success: successCount > 0 || !lastError,
    count: successCount,
    error: lastError || undefined,
  };
}
