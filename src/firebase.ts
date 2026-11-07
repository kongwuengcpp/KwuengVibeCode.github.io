import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
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

export function sanitizeDocId(rawId: string): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return cleaned || `exam-${Date.now()}`;
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

export function sanitizeExamPayload(exam: Exam): { id: string; payload: Record<string, unknown> } {
  const safeId = sanitizeDocId(exam.id);
  const cleanQuestions = JSON.parse(
    JSON.stringify(Array.isArray(exam.questions) ? exam.questions : [])
  ).slice(0, 500);

  const payload: Record<string, unknown> = {
    id: safeId,
    title: (String(exam.title || 'Đề thi mới').trim() || 'Đề thi mới').slice(0, 300),
    category: (String(exam.category || 'Lịch sử').trim() || 'Lịch sử').slice(0, 100),
    durationMinutes: Math.min(600, Math.max(1, Number(exam.durationMinutes) || 45)),
    createdAt: (
      String(exam.createdAt || new Date().toLocaleDateString('vi-VN')).trim() || '2026'
    ).slice(0, 64),
    questions: cleanQuestions,
    shuffleQuestions: Boolean(exam.shuffleQuestions),
    shuffleOptions: Boolean(exam.shuffleOptions),
    isFavorite: Boolean(exam.isFavorite),
    updatedAt: new Date().toISOString(),
    adminToken: DEFAULT_ADMIN_KEY,
  };

  if (exam.examCode) {
    payload.examCode = String(exam.examCode).trim().slice(0, 32);
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
    handleFirestoreError(error, OperationType.WRITE, path);
  }
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
        if (docSnap.id === 'catalog_index') return;
        const data = docSnap.data();
        if (data && typeof data.id === 'string' && Array.isArray(data.questions)) {
          list.push({
            id: data.id,
            examCode: typeof data.examCode === 'string' ? data.examCode : undefined,
            title: String(data.title || 'Đề thi'),
            category: String(data.category || 'Lịch sử') as ExamCategory,
            durationMinutes: Number(data.durationMinutes) || 45,
            createdAt: String(data.createdAt || ''),
            questions: data.questions,
            shuffleQuestions: Boolean(data.shuffleQuestions),
            shuffleOptions: Boolean(data.shuffleOptions),
            isFavorite: Boolean(data.isFavorite),
          });
        }
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

export async function saveExamToCloud(exam: Exam): Promise<void> {
  const { id, payload } = sanitizeExamPayload(exam);
  const path = `exams/${id}`;
  try {
    await setDoc(doc(db, 'exams', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteExamFromCloud(examId: string): Promise<void> {
  const safeId = sanitizeDocId(examId);
  const path = `exams/${safeId}`;
  try {
    await deleteDoc(doc(db, 'exams', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
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

  for (const exam of exams) {
    if (!exam || !exam.id || exam.id === 'catalog_index') continue;
    const { id, payload } = sanitizeExamPayload(exam);
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

  return {
    success: successCount > 0 || !lastError,
    count: successCount,
    error: lastError || undefined,
  };
}
