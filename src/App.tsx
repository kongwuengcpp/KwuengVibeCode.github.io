import React, {
  Component,
  ErrorInfo,
  ReactNode,
  Suspense,
  lazy,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { ShieldOff, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { Exam, ExamAttempt, SiteBranding, DEFAULT_SITE_BRANDING } from './types/exam';
import { INITIAL_ATTEMPTS, INITIAL_EXAMS } from './data/initialExams';
import { DashboardView } from './components/DashboardView';
import { ExamTakeView } from './components/ExamTakeView';
import {
  ADMIN_STORAGE_KEY,
  CUSTOM_ADMIN_KEY_STORAGE,
  DEFAULT_ADMIN_KEY,
  resolveAppRoute,
  verifyAdminKey,
} from './utils/accessControl';
import {
  subscribeToSiteBranding,
  saveSiteBrandingToCloud,
  subscribeToCloudExams,
  fetchExamsFromCloudOnce,
  saveExamToCloud,
  deleteExamFromCloud,
  syncAllToCloud,
  IGNORED_EXAM_IDS,
  sanitizeDocId,
  isOfflineErrorMessage,
  deriveExamCode,
} from './firebase';
import { fetchStaticExams } from './utils/staticExams';

const CreateExamView = lazy(() =>
  import('./components/CreateExamView').then((m) => ({
    default: m.CreateExamView,
  }))
);

interface ErrorBoundaryProps {
  onResetToLibrary: () => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Lỗi giao diện:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-900">
              Đã xảy ra lỗi hiển thị ngoài ý muốn
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Trang gặp sự cố khi hiển thị dữ liệu ({this.state.errorMessage || 'Lỗi không xác định'}). Bạn có thể tải lại trang hoặc quay về thư viện đề thi.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tải lại trang</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: '' });
                  this.props.onResetToLibrary();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Về thư viện</span>
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

/**
 * true: khách/học sinh đọc đề từ exams.json (miễn phí, không tốn lượt đọc Firestore).
 * Admin vẫn dùng Firestore thời gian thực. Đặt false để mọi người đọc Firestore như cũ.
 */
const STATIC_FIRST_FOR_VISITORS = true;
const EXAMS_STORAGE_KEY = 'luyende_online_exams_prod_v1';
const PENDING_SAVE_STORAGE_KEY = 'luyende_pending_save_ids_v1';
const ATTEMPTS_STORAGE_KEY = 'luyende_online_attempts_prod_v1';
const BRANDING_STORAGE_KEY = 'luyende_site_branding_v1';
const DARK_MODE_STORAGE_KEY = 'luyende_dark_mode_v2';
const LEGACY_KEYS_TO_CLEAR = [
  'baitaptracnghiem_exams_v3',
  'baitaptracnghiem_attempts_v3',
  'luyende_manual_done_exams_v1',
  'luyende_deleted_exam_ids_v1',
];

declare global {
  interface Window {
    admin?: (key: string) => string;
    loginAdmin?: (key: string) => string;
    logoutAdmin?: () => string;
    setAdminKey?: (newKey: string) => string;
    setBranding?: (branding: Partial<SiteBranding>) => string;
    syncCloud?: () => Promise<string>;
    ADMIN_KEY?: string;
  }
}

function getBasePathname(): string {
  const path = window.location.pathname.replace(/\/index\.html$/i, '');
  const stripped = path
    .replace(/\/(?:lam-bai|de)\/[^/]+\/?$/i, '')
    .replace(/\/(?:nguoi-dung\/)?tao-de\/?$/i, '')
    .replace(/\/thu-vien\/?$/i, '')
    .replace(/\/nguoi-dung\/?$/i, '');
  const clean = stripped.replace(/\/+$/, '');
  return clean ? `${clean}/` : '/';
}

function loadPendingSaveExamIds(): Set<string> {
  const set = new Set<string>();
  try {
    const raw = localStorage.getItem(PENDING_SAVE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === 'string' && id && !IGNORED_EXAM_IDS.has(id)) {
            set.add(id);
          }
        });
      }
    }
  } catch {
    // ignore
  }
  return set;
}

export default function App() {
  // Keep deletedExamIdsRef in-memory only for the current browser session so stale localStorage never hides exams
  const deletedExamIdsRef = useRef<Set<string>>(new Set<string>(IGNORED_EXAM_IDS));
  const pendingSaveExamIdsRef = useRef<Set<string>>(loadPendingSaveExamIds());
  const [unsyncedExamIds, setUnsyncedExamIds] = useState<string[]>(() =>
    Array.from(pendingSaveExamIdsRef.current)
  );
  const lastSavedExamRef = useRef<Exam | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const persistDeletedIds = useCallback(() => {
    // No-op: deleted IDs are intentionally not persisted to localStorage to prevent stuck empty libraries
  }, []);

  const persistPendingSaveIds = useCallback(() => {
    const arr = Array.from(pendingSaveExamIdsRef.current);
    setUnsyncedExamIds(arr);
    try {
      localStorage.setItem(PENDING_SAVE_STORAGE_KEY, JSON.stringify(arr));
    } catch {
      // ignore
    }
  }, []);

  const showFeedback = useCallback((message: string | null, autoDismissMs?: number) => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setSyncFeedbackMessage(message);
    if (message && autoDismissMs && autoDismissMs > 0) {
      feedbackTimerRef.current = window.setTimeout(() => {
        setSyncFeedbackMessage(null);
        feedbackTimerRef.current = null;
      }, autoDismissMs);
    }
  }, []);

  const [exams, setExams] = useState<Exam[]>(() => {
    try {
      LEGACY_KEYS_TO_CLEAR.forEach((k) => localStorage.removeItem(k));
      const saved = localStorage.getItem(EXAMS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const seen = new Set<string>();
          const cleanList: Exam[] = [];
          for (const item of parsed) {
            if (
              item &&
              typeof item.id === 'string' &&
              !IGNORED_EXAM_IDS.has(item.id) &&
              !IGNORED_EXAM_IDS.has(sanitizeDocId(item.id)) &&
              !seen.has(item.id)
            ) {
              seen.add(item.id);
              cleanList.push(item);
            }
          }
          if (cleanList.length > 0) {
            return cleanList;
          }
        }
      }
    } catch {
      // Fallback to initial exams
    }
    return INITIAL_EXAMS;
  });

  const [attempts, setAttempts] = useState<ExamAttempt[]>(() => {
    try {
      const saved = localStorage.getItem(ATTEMPTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to initial attempts
    }
    return INITIAL_ATTEMPTS;
  });

  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem(ADMIN_STORAGE_KEY) === 'true' ||
        sessionStorage.getItem(ADMIN_STORAGE_KEY) === 'true'
      );
    } catch {
      return false;
    }
  });

  const [activeView, setActiveView] = useState<
    'dashboard' | 'take-exam' | 'create-exam' | 'forbidden'
  >('dashboard');
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [forbiddenReason, setForbiddenReason] = useState<string>('');
  const [activeExamId, setActiveExamId] = useState<string>(
    INITIAL_EXAMS[0]?.id || ''
  );
  const [returnToExamId, setReturnToExamId] = useState<string | null>(null);
  const [restoreScrollTrigger, setRestoreScrollTrigger] = useState<number>(0);
  const libraryScrollYRef = useRef<number>(0);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [reviewingAttempt, setReviewingAttempt] = useState<ExamAttempt | null>(null);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);
  const [cloudSynced, setCloudSynced] = useState<boolean>(false);
  const [isLoadingExams, setIsLoadingExams] = useState<boolean>(true);
  const [cloudLoadError, setCloudLoadError] = useState<string | null>(null);
  // null = đang xác định, true = đọc exams.json (khách), false = đọc Firestore
  const [staticMode, setStaticMode] = useState<boolean | null>(
    STATIC_FIRST_FOR_VISITORS && !isAdmin ? null : false
  );
  const [syncFeedbackMessage, setSyncFeedbackMessage] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(DARK_MODE_STORAGE_KEY);
      return saved ? saved !== 'false' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem(DARK_MODE_STORAGE_KEY, String(darkMode));
    } catch {
      // ignore
    }
  }, [darkMode]);

  const handleToggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  const [branding, setBranding] = useState<SiteBranding>(() => {
    try {
      const saved = localStorage.getItem(BRANDING_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return { ...DEFAULT_SITE_BRANDING, ...parsed };
        }
      }
    } catch {
      // Fallback
    }
    return DEFAULT_SITE_BRANDING;
  });

  const brandingRef = useRef<SiteBranding>(branding);
  brandingRef.current = branding;

  const examsRef = useRef<Exam[]>(exams);
  examsRef.current = exams;

  const applyCloudExamsUpdate = useCallback(
    (cloudExams: Exam[]) => {
      setIsLoadingExams(false);
      setCloudLoadError(null);
      setCloudSynced(true);
      setExams((localPrev) => {
        const filteredCloud: Exam[] = [];
        const cloudIds = new Set<string>();

        for (const exam of cloudExams) {
          const safeId = sanitizeDocId(exam.id);
          if (
            deletedExamIdsRef.current.has(exam.id) ||
            deletedExamIdsRef.current.has(safeId) ||
            IGNORED_EXAM_IDS.has(exam.id) ||
            IGNORED_EXAM_IDS.has(safeId)
          ) {
            continue;
          }
          if (!cloudIds.has(exam.id)) {
            cloudIds.add(exam.id);
            cloudIds.add(safeId);
            if (
              pendingSaveExamIdsRef.current.has(exam.id) ||
              pendingSaveExamIdsRef.current.has(safeId)
            ) {
              pendingSaveExamIdsRef.current.delete(exam.id);
              pendingSaveExamIdsRef.current.delete(safeId);
              persistPendingSaveIds();
            }
            filteredCloud.push(exam);
          }
        }

        // Preserve any exam explicitly saved offline by Admin in this browser
        const inFlightLocal = localPrev.filter((e) => {
          if (!e || !e.id) return false;
          const sid = sanitizeDocId(e.id);
          return (
            !cloudIds.has(e.id) &&
            !cloudIds.has(sid) &&
            (pendingSaveExamIdsRef.current.has(e.id) ||
              pendingSaveExamIdsRef.current.has(sid)) &&
            !deletedExamIdsRef.current.has(e.id) &&
            !deletedExamIdsRef.current.has(sid)
          );
        });

        return [...inFlightLocal, ...filteredCloud];
      });
    },
    [persistPendingSaveIds]
  );

  const handleReloadExamsFromCloud = useCallback(async () => {
    setIsLoadingExams(true);
    setCloudLoadError(null);
    if (staticMode === true) {
      // Chế độ khách: tải lại từ exams.json, không đụng tới Firestore
      const list = await fetchStaticExams();
      setIsLoadingExams(false);
      if (list.length > 0) {
        setExams(list.map((e) => ({ ...e, examCode: deriveExamCode(e.id, e.examCode) })));
        showFeedback(`✅ Đã tải lại danh sách đề (${list.length} đề thi).`, 3500);
      } else {
        setCloudLoadError('Không tải được danh sách đề. Vui lòng thử lại sau.');
      }
      return;
    }
    deletedExamIdsRef.current = new Set<string>(IGNORED_EXAM_IDS);
    const res = await fetchExamsFromCloudOnce();
    if (res.ok) {
      applyCloudExamsUpdate(res.exams);
      showFeedback(
        `✅ Đã tải lại danh sách đề từ Cloud (${res.exams.length} đề thi).`,
        3500
      );
    } else {
      setIsLoadingExams(false);
      const errMsg = res.error || 'Không thể kết nối tới máy chủ đề thi.';
      setCloudLoadError(errMsg);
      showFeedback(`❌ Tải lại danh sách đề thất bại: ${errMsg}`);
    }
  }, [applyCloudExamsUpdate, showFeedback, staticMode]);

  const handleUpdateBranding = useCallback(
    async (newBranding: Partial<SiteBranding>) => {
      const updated: SiteBranding = { ...brandingRef.current, ...newBranding };
      setBranding(updated);
      try {
        localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      const res = await saveSiteBrandingToCloud(updated);
      if (res.ok) {
        showFeedback('✅ Đã lưu và đồng bộ thông tin trang lên Cloud.', 4000);
      } else {
        showFeedback(
          `❌ Không thể lưu thông tin trang lên Cloud: ${res.error || 'Vui lòng thử lại.'}`
        );
      }
    },
    [showFeedback]
  );

  const handleRetrySyncExam = useCallback(
    async (exam: Exam) => {
      const canonicalId = sanitizeDocId(exam.id);
      const res = await saveExamToCloud({ ...exam, id: canonicalId });
      if (res.ok) {
        pendingSaveExamIdsRef.current.delete(exam.id);
        pendingSaveExamIdsRef.current.delete(canonicalId);
        persistPendingSaveIds();
        setCloudSynced(true);
        showFeedback(`✅ Đã đồng bộ đề "${exam.title}" lên Cloud thành công!`, 4000);
      } else {
        showFeedback(
          `❌ Đồng bộ lại đề "${exam.title}" thất bại: ${res.error || 'Lỗi không xác định'}`
        );
      }
    },
    [persistPendingSaveIds, showFeedback]
  );

  const handleSyncCloud = useCallback(async () => {
    setIsSyncingCloud(true);
    showFeedback(null);
    try {
      const res = await syncAllToCloud(examsRef.current, brandingRef.current);
      if (res.success) {
        pendingSaveExamIdsRef.current.clear();
        persistPendingSaveIds();
        setCloudSynced(true);
        showFeedback(
          `✅ Đã đồng bộ thành công ${res.count} đề thi và giao diện lên Cloud!`,
          5000
        );
      } else {
        for (const f of res.failed) {
          pendingSaveExamIdsRef.current.add(sanitizeDocId(f.id));
        }
        persistPendingSaveIds();
        const firstFail = res.failed[0]
          ? ` (${res.failed[0].title}: ${res.failed[0].error})`
          : '';
        const brandingFail = res.brandingError
          ? ` · Giao diện: ${res.brandingError}`
          : '';
        showFeedback(
          `⚠️ Đồng bộ: ${res.count} đề thành công, ${res.failed.length} đề lỗi${firstFail}${brandingFail}`
        );
      }
    } catch (err) {
      showFeedback(`❌ Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncingCloud(false);
    }
  }, [persistPendingSaveIds, showFeedback]);

  // Real-time Firestore listener for Site Branding (/settings/site_config)
  useEffect(() => {
    const unsubscribe = subscribeToSiteBranding((cloudBranding) => {
      if (cloudBranding) {
        setBranding(cloudBranding);
        try {
          localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(cloudBranding));
        } catch {
          // ignore
        }
      } else {
        try {
          const localSaved = localStorage.getItem(BRANDING_STORAGE_KEY);
          if (localSaved) {
            const parsed = JSON.parse(localSaved);
            if (parsed && typeof parsed === 'object') {
              void saveSiteBrandingToCloud({ ...DEFAULT_SITE_BRANDING, ...parsed });
            }
          }
        } catch {
          // ignore
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Khách/học sinh: đọc exams.json (không tốn hạn mức Firestore). Nếu file rỗng/thiếu thì dùng Firestore.
  useEffect(() => {
    if (isAdmin || !STATIC_FIRST_FOR_VISITORS) {
      setStaticMode(false);
      return;
    }
    let cancelled = false;
    void fetchStaticExams().then((list) => {
      if (cancelled) return;
      if (list.length > 0) {
        setExams(
          list
            .filter((e) => !IGNORED_EXAM_IDS.has(e.id))
            .map((e) => ({ ...e, examCode: deriveExamCode(e.id, e.examCode) }))
        );
        setIsLoadingExams(false);
        setCloudLoadError(null);
        setCloudSynced(true);
        setStaticMode(true);
      } else {
        setStaticMode(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // Real-time Firestore listener for Shared Exams (/exams): chỉ Admin (hoặc khi không có exams.json)
  useEffect(() => {
    if (staticMode !== false) return;
    const unsubscribe = subscribeToCloudExams(
      (cloudExams) => {
        applyCloudExamsUpdate(cloudExams);
      },
      (errorMsg) => {
        setIsLoadingExams(false);
        setCloudLoadError(errorMsg);
        // Cloud lỗi (vd. hết hạn mức) mà máy chưa có đề nào: dùng exams.json làm dự phòng chỉ-đọc
        if (examsRef.current.length === 0) {
          void fetchStaticExams().then((list) => {
            if (list.length > 0 && examsRef.current.length === 0) {
              setExams(list.map((e) => ({ ...e, examCode: deriveExamCode(e.id, e.examCode) })));
            }
          });
        }
      }
    );
    return () => unsubscribe();
  }, [applyCloudExamsUpdate, staticMode]);

  // Auto-retry unsynced offline exams when Admin comes back online
  useEffect(() => {
    if (!isAdmin) return;
    const retryPending = async () => {
      if (pendingSaveExamIdsRef.current.size === 0) return;
      const pendingIds = Array.from(pendingSaveExamIdsRef.current);
      for (const id of pendingIds) {
        const found = examsRef.current.find(
          (e) => e.id === id || sanitizeDocId(e.id) === sanitizeDocId(id)
        );
        if (found) {
          const res = await saveExamToCloud(found);
          if (res.ok) {
            pendingSaveExamIdsRef.current.delete(id);
            pendingSaveExamIdsRef.current.delete(sanitizeDocId(id));
            persistPendingSaveIds();
          }
        }
      }
    };
    const onOnline = () => {
      void retryPending();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [isAdmin, persistPendingSaveIds]);

  // Sync document title with branding
  useEffect(() => {
    if (branding.title) {
      document.title = `${branding.title} - ${branding.subtitle}`;
    }
  }, [branding]);

  const syncRouteFromLocation = useCallback(
    (currentExams: Exam[], currentIsAdmin: boolean) => {
      const resolved = resolveAppRoute(
        window.location.pathname,
        window.location.search,
        currentExams,
        currentIsAdmin
      );

      if (resolved.type === 'dashboard') {
        const wasInSubView =
          activeViewRef.current === 'take-exam' ||
          activeViewRef.current === 'create-exam';
        setActiveView('dashboard');
        if (typeof resolved.openLibrary === 'boolean') {
          setIsLibraryOpen(resolved.openLibrary);
        }
        if (wasInSubView && resolved.openLibrary) {
          setRestoreScrollTrigger((prev) => prev + 1);
        }
        setForbiddenReason('');
      } else if (resolved.type === 'take-exam') {
        setActiveExamId(resolved.examId);
        setReturnToExamId(resolved.examId);
        setPreviewMode(Boolean(resolved.previewOnly));
        setReviewingAttempt(null);
        setActiveView('take-exam');
        setForbiddenReason('');
      } else if (resolved.type === 'create-exam') {
        setActiveView('create-exam');
        setForbiddenReason('');
      } else {
        setActiveView('forbidden');
        setForbiddenReason(resolved.reason);
      }
    },
    []
  );

  // Initial URL resolution and popstate listener
  useEffect(() => {
    syncRouteFromLocation(examsRef.current, isAdmin);
    const onPopState = () => syncRouteFromLocation(examsRef.current, isAdmin);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isAdmin, syncRouteFromLocation]);

  // If user landed on a direct exam link (?de=...) before Cloud exams finished loading, re-check once exams arrive
  useEffect(() => {
    if (activeView === 'forbidden' && exams.length > 0) {
      syncRouteFromLocation(exams, isAdmin);
    }
  }, [exams, activeView, isAdmin, syncRouteFromLocation]);

  // Register DevTools Console-only Admin authentication commands
  useEffect(() => {
    const authenticateWithKey = (inputKey: string): string => {
      const customSaved = localStorage.getItem(CUSTOM_ADMIN_KEY_STORAGE);
      if (verifyAdminKey(inputKey, customSaved)) {
        try {
          sessionStorage.setItem(ADMIN_STORAGE_KEY, 'true');
          localStorage.setItem(ADMIN_STORAGE_KEY, 'true');
        } catch {
          // ignore
        }
        setIsAdmin(true);
        const msg =
          '✅ Đăng nhập Admin thành công! Quyền tạo đề, số hoá Word (.docx), chỉnh sửa và đồng bộ Cloud đã được mở khoá.';
        console.info(`%c${msg}`, 'color: #22c55e; font-weight: bold; font-size: 13px;');
        return msg;
      }
      const errMsg = '❌ Sai Admin Key! Bạn không có quyền tạo đề.';
      console.error(errMsg);
      return errMsg;
    };

    window.admin = authenticateWithKey;
    window.loginAdmin = authenticateWithKey;

    window.logoutAdmin = () => {
      try {
        sessionStorage.removeItem(ADMIN_STORAGE_KEY);
        localStorage.removeItem(ADMIN_STORAGE_KEY);
      } catch {
        // ignore
      }
      setIsAdmin(false);
      setActiveView((prev) => (prev === 'create-exam' ? 'dashboard' : prev));
      const msg = '🔒 Đã đăng xuất quyền Admin.';
      console.info(msg);
      return msg;
    };

    window.setAdminKey = (newKey: string) => {
      if (!isAdmin) {
        return '❌ Bạn cần đăng nhập Admin trước khi đổi key.';
      }
      if (!newKey || newKey.trim().length < 4) {
        return '❌ Key mới phải có ít nhất 4 ký tự.';
      }
      localStorage.setItem(CUSTOM_ADMIN_KEY_STORAGE, newKey.trim());
      return `✅ Đã cập nhật Admin Key mới thành công!`;
    };

    window.setBranding = (newBranding: Partial<SiteBranding>) => {
      if (!isAdmin) {
        return '❌ Bạn cần đăng nhập Admin trước khi đổi thông tin trang (tiêu đề, tên tác giả, phiên bản, logo).';
      }
      void handleUpdateBranding(newBranding);
      return `✅ Đã gửi yêu cầu cập nhật thông tin trang lên Cloud!`;
    };

    window.syncCloud = async () => {
      await handleSyncCloud();
      return '✅ Đã thực hiện đồng bộ đề thi và giao diện với Cloud!';
    };

    try {
      Object.defineProperty(window, 'ADMIN_KEY', {
        configurable: true,
        get() {
          return isAdmin ? 'Đang đăng nhập Admin' : 'Nhập: admin("wangwibu2026")';
        },
        set(val: string) {
          authenticateWithKey(String(val));
        },
      });
    } catch {
      // ignore if defineProperty fails
    }

    console.info(
      `%c[Luyện đề Online - Console Admin Auth]\n%cĐể mở khoá quyền Admin tạo đề, gõ lệnh sau vào Console:\n  admin("${DEFAULT_ADMIN_KEY}")\nHoặc đăng xuất bằng: logoutAdmin()`,
      'color: #22c55e; font-weight: bold; font-size: 13px;',
      'color: #94a3b8; font-size: 12px;'
    );
  }, [isAdmin, handleUpdateBranding, handleSyncCloud]);

  useEffect(() => {
    try {
      if (exams.length > 0 || cloudSynced) {
        localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(exams));
      }
    } catch {
      // Ignore quota errors
    }
  }, [exams, cloudSynced]);

  useEffect(() => {
    try {
      localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts));
    } catch {
      // Ignore quota errors
    }
  }, [attempts]);

  const navigateToUrl = (url: string) => {
    window.history.pushState({}, '', url);
    syncRouteFromLocation(exams, isAdmin);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenLibrary = () => {
    const base = getBasePathname();
    window.history.pushState({}, '', `${base}?view=library`);
    libraryScrollYRef.current = 0;
    setReturnToExamId(null);
    setIsLibraryOpen(true);
    setActiveView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReturnToLibrary = useCallback((focusExamId?: string) => {
    const base = getBasePathname();
    window.history.pushState({}, '', `${base}?view=library`);
    if (focusExamId) {
      setReturnToExamId(focusExamId);
    }
    setIsLibraryOpen(true);
    setActiveView('dashboard');
    setRestoreScrollTrigger((prev) => prev + 1);
  }, []);

  const handleCloseLibrary = () => {
    const base = getBasePathname();
    window.history.pushState({}, '', base);
    libraryScrollYRef.current = 0;
    setReturnToExamId(null);
    setIsLibraryOpen(false);
    setActiveView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartExam = (examId: string, previewOnly = false) => {
    const base = getBasePathname();
    const safeTarget = sanitizeDocId(examId);
    const found = exams.find((e) => e.id === examId || sanitizeDocId(e.id) === safeTarget);
    if (!found) {
      window.history.pushState({}, '', `${base}?de=${encodeURIComponent(examId)}`);
      setActiveView('forbidden');
      setForbiddenReason('Link đề thi không đúng hoặc đề thi không tồn tại.');
      return;
    }
    libraryScrollYRef.current = window.scrollY;
    setReturnToExamId(found.id);
    window.history.pushState({}, '', `${base}?de=${encodeURIComponent(found.id)}`);
    setActiveExamId(found.id);
    setPreviewMode(previewOnly);
    setReviewingAttempt(null);
    setActiveView('take-exam');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleReviewAttempt = (attempt: ExamAttempt) => {
    const base = getBasePathname();
    const exists = exams.some((e) => e.id === attempt.examId);
    if (!exists) {
      navigateToUrl(`${base}?de=${encodeURIComponent(attempt.examId)}`);
      return;
    }
    libraryScrollYRef.current = window.scrollY;
    setReturnToExamId(attempt.examId);
    window.history.pushState({}, '', `${base}?de=${encodeURIComponent(attempt.examId)}`);
    setActiveExamId(attempt.examId);
    setReviewingAttempt(attempt);
    setPreviewMode(false);
    setActiveView('take-exam');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleCompleteAttempt = (newAttempt: ExamAttempt) => {
    setAttempts((prev) => [newAttempt, ...prev]);
  };

  const handleCreateNewExam = () => {
    const base = getBasePathname();
    if (!isAdmin) {
      window.history.pushState({}, '', `${base}?view=create`);
      setActiveView('forbidden');
      setForbiddenReason('Chỉ Admin mới được phép tạo đề thi.');
      return;
    }
    libraryScrollYRef.current = window.scrollY;
    window.history.pushState({}, '', `${base}?view=create`);
    setEditingExam(null);
    setActiveView('create-exam');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleEditExam = (exam: Exam) => {
    const base = getBasePathname();
    if (!isAdmin) {
      window.history.pushState({}, '', `${base}?view=create`);
      setActiveView('forbidden');
      setForbiddenReason('Chỉ Admin mới được phép chỉnh sửa đề thi.');
      return;
    }
    libraryScrollYRef.current = window.scrollY;
    setReturnToExamId(exam.id);
    window.history.pushState({}, '', `${base}?view=create`);
    setEditingExam(exam);
    setActiveView('create-exam');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleSaveExam = async (
    savedExam: Exam,
    startImmediately: boolean,
    saveOfflineOnly = false
  ): Promise<{ ok: boolean; error?: string; offlineAvailable?: boolean }> => {
    if (!isAdmin) {
      setActiveView('forbidden');
      setForbiddenReason('Chỉ Admin mới được phép lưu đề thi.');
      return { ok: false, error: 'Chỉ Admin mới được phép lưu đề thi.' };
    }

    const canonicalId = sanitizeDocId(savedExam.id);
    const normalizedExam: Exam = {
      ...savedExam,
      id: canonicalId,
    };

    if (saveOfflineOnly) {
      lastSavedExamRef.current = normalizedExam;
      deletedExamIdsRef.current.delete(canonicalId);
      deletedExamIdsRef.current.delete(savedExam.id);
      persistDeletedIds();
      pendingSaveExamIdsRef.current.add(canonicalId);
      persistPendingSaveIds();

      setExams((prev) => {
        const exists = prev.some((e) => sanitizeDocId(e.id) === canonicalId);
        const next = exists
          ? prev.map((e) => (sanitizeDocId(e.id) === canonicalId ? normalizedExam : e))
          : [normalizedExam, ...prev];
        try {
          localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });

      setEditingExam(null);
      showFeedback(
        `⚠️ Đã lưu tạm đề "${normalizedExam.title}" trên máy (Chưa đồng bộ Cloud). Nhấn "Đồng bộ lại" khi có kết nối mạng.`
      );

      const base = getBasePathname();
      if (startImmediately) {
        setReturnToExamId(normalizedExam.id);
        window.history.pushState({}, '', `${base}?de=${encodeURIComponent(normalizedExam.id)}`);
        setActiveExamId(normalizedExam.id);
        setPreviewMode(false);
        setReviewingAttempt(null);
        setActiveView('take-exam');
        window.scrollTo({ top: 0, behavior: 'instant' });
      } else {
        handleReturnToLibrary(normalizedExam.id);
      }
      return { ok: true };
    }

    const res = await saveExamToCloud(normalizedExam);
    if (!res.ok) {
      const errMsg = res.error || 'Không thể lưu đề thi lên Cloud.';
      showFeedback(`❌ Không lưu được đề "${normalizedExam.title}" lên Cloud: ${errMsg}`);
      return {
        ok: false,
        error: errMsg,
        offlineAvailable: isOfflineErrorMessage(errMsg),
      };
    }

    lastSavedExamRef.current = normalizedExam;
    deletedExamIdsRef.current.delete(canonicalId);
    deletedExamIdsRef.current.delete(savedExam.id);
    persistDeletedIds();
    pendingSaveExamIdsRef.current.delete(canonicalId);
    pendingSaveExamIdsRef.current.delete(savedExam.id);
    persistPendingSaveIds();
    setCloudSynced(true);

    setExams((prev) => {
      const exists = prev.some((e) => sanitizeDocId(e.id) === canonicalId);
      const next = exists
        ? prev.map((e) => (sanitizeDocId(e.id) === canonicalId ? normalizedExam : e))
        : [normalizedExam, ...prev];
      try {
        localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });

    setEditingExam(null);
    showFeedback(`✅ Đã lưu đề thi "${normalizedExam.title}" lên Cloud thành công!`, 4500);

    const base = getBasePathname();
    if (startImmediately) {
      setReturnToExamId(normalizedExam.id);
      window.history.pushState({}, '', `${base}?de=${encodeURIComponent(normalizedExam.id)}`);
      setActiveExamId(normalizedExam.id);
      setPreviewMode(false);
      setReviewingAttempt(null);
      setActiveView('take-exam');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      handleReturnToLibrary(normalizedExam.id);
    }
    return { ok: true };
  };

  const handleToggleFavorite = async (examId: string) => {
    const target = examsRef.current.find((e) => e.id === examId);
    if (!target) return;
    const updated: Exam = { ...target, isFavorite: !target.isFavorite };

    setExams((prev) => prev.map((e) => (e.id === examId ? updated : e)));

    if (isAdmin) {
      const res = await saveExamToCloud(updated);
      if (!res.ok) {
        setExams((prev) => prev.map((e) => (e.id === examId ? target : e)));
        showFeedback(
          `❌ Không thể cập nhật trạng thái yêu thích lên Cloud: ${res.error || 'Lỗi mạng'}`
        );
      }
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!isAdmin) return;
    const safeTarget = sanitizeDocId(examId);
    const previousExams = examsRef.current;

    deletedExamIdsRef.current.add(examId);
    deletedExamIdsRef.current.add(safeTarget);
    persistDeletedIds();
    pendingSaveExamIdsRef.current.delete(examId);
    pendingSaveExamIdsRef.current.delete(safeTarget);
    persistPendingSaveIds();

    if (
      lastSavedExamRef.current &&
      (lastSavedExamRef.current.id === examId ||
        sanitizeDocId(lastSavedExamRef.current.id) === safeTarget)
    ) {
      lastSavedExamRef.current = null;
    }

    setExams((prev) => {
      const remaining = prev.filter(
        (e) => e.id !== examId && sanitizeDocId(e.id) !== safeTarget
      );
      try {
        localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      return remaining;
    });

    const res = await deleteExamFromCloud(examId);
    if (res.ok) {
      showFeedback('🗑️ Đã xoá vĩnh viễn đề thi khỏi thư viện và Cloud!', 4000);
    } else {
      deletedExamIdsRef.current.delete(examId);
      deletedExamIdsRef.current.delete(safeTarget);
      persistDeletedIds();
      setExams(previousExams);
      try {
        localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(previousExams));
      } catch {
        // ignore
      }
      showFeedback(
        `❌ Không xóa được đề trên Cloud: ${res.error || 'Vui lòng kiểm tra kết nối mạng.'}`
      );
    }
  };

  const handleExportExamsJson = () => {
    const exportPayload = {
      branding,
      exams,
    };
    const jsonString = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exams.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportExamsJson = async (
    importedExams: Exam[],
    importedBranding?: Partial<SiteBranding>
  ) => {
    if (!isAdmin) {
      showFeedback('❌ Bạn cần đăng nhập quyền Admin trước khi nhập dữ liệu từ file .json.');
      return;
    }
    if (!Array.isArray(importedExams) || importedExams.length === 0) {
      showFeedback('❌ File .json không hợp lệ hoặc không có đề thi nào để nhập.');
      return;
    }

    const validImported = importedExams.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        Array.isArray(item.questions) &&
        item.questions.length > 0
    );

    if (validImported.length === 0) {
      showFeedback(
        '❌ Không tìm thấy đề thi hợp lệ trong file .json (mỗi đề phải có id, title và danh sách câu hỏi).'
      );
      return;
    }

    const nextBranding =
      importedBranding && typeof importedBranding === 'object'
        ? { ...brandingRef.current, ...importedBranding }
        : brandingRef.current;

    if (importedBranding && typeof importedBranding === 'object') {
      setBranding(nextBranding);
      try {
        localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(nextBranding));
      } catch {
        // ignore
      }
    }

    const map = new Map<string, Exam>();
    for (const e of examsRef.current) {
      if (e && e.id) {
        map.set(sanitizeDocId(e.id), { ...e, id: sanitizeDocId(e.id) });
      }
    }
    for (const item of validImported) {
      const cid = sanitizeDocId(item.id);
      deletedExamIdsRef.current.delete(cid);
      map.set(cid, { ...item, id: cid });
    }
    persistDeletedIds();

    const merged = Array.from(map.values());
    setExams(merged);
    try {
      localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }

    setIsSyncingCloud(true);
    try {
      const res = await syncAllToCloud(merged, nextBranding);
      if (res.success) {
        setCloudSynced(true);
        showFeedback(
          `✅ Đã nhập và đồng bộ ${res.count} đề thi lên Cloud thành công!`,
          5000
        );
      } else {
        for (const f of res.failed) {
          pendingSaveExamIdsRef.current.add(sanitizeDocId(f.id));
        }
        persistPendingSaveIds();
        showFeedback(
          `⚠️ Nhập JSON: ${res.count} đề thành công, ${res.failed.length} đề lỗi${
            res.failed[0] ? ` (${res.failed[0].title}: ${res.failed[0].error})` : ''
          }`
        );
      }
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const currentExam =
    exams.find(
      (e) =>
        e.id === activeExamId ||
        (activeExamId && sanitizeDocId(e.id) === sanitizeDocId(activeExamId))
    ) ||
    (lastSavedExamRef.current &&
    activeExamId &&
    sanitizeDocId(lastSavedExamRef.current.id) === sanitizeDocId(activeExamId)
      ? lastSavedExamRef.current
      : undefined);

  return (
    <ErrorBoundary
      onResetToLibrary={() => {
        setReviewingAttempt(null);
        handleOpenLibrary();
      }}
    >
      <div
        className={`min-h-screen flex flex-col bg-[#f8fafc] text-slate-900 ${
          activeView === 'take-exam' && currentExam
            ? 'lg:h-screen lg:max-h-screen lg:overflow-hidden'
            : ''
        }`}
      >
        <div
          className={`flex-1 ${
            activeView === 'take-exam' && currentExam
              ? 'lg:min-h-0 lg:overflow-hidden'
              : ''
          }`}
        >
          {activeView === 'forbidden' && (
            <main className="max-w-xl mx-auto px-4 py-20 text-center">
              <div className="bg-white rounded-3xl border border-slate-200/80 shadow-md shadow-slate-200/40 p-10 space-y-5">
                <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
                  <ShieldOff className="w-8 h-8" />
                </div>

                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  bạn không nên ở đây
                </h1>

                {forbiddenReason && (
                  <p className="text-sm text-slate-500 max-w-md mx-auto">
                    {forbiddenReason}
                  </p>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleCloseLibrary}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Quay về trang chính</span>
                  </button>
                </div>
              </div>
            </main>
          )}

          <div
            className={
              activeView === 'dashboard' || (activeView === 'take-exam' && !currentExam)
                ? 'block'
                : 'hidden'
            }
          >
            <DashboardView
              exams={exams}
              attempts={attempts}
              isAdmin={isAdmin}
              branding={branding}
              onUpdateBranding={(b) => void handleUpdateBranding(b)}
              isLibraryOpen={activeView === 'take-exam' ? true : isLibraryOpen}
              onOpenLibrary={handleOpenLibrary}
              onCloseLibrary={handleCloseLibrary}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onClearFilters={() => setSearchQuery('')}
              onStartExam={handleStartExam}
              onReviewAttempt={handleReviewAttempt}
              onEditExam={handleEditExam}
              onCreateNewExam={handleCreateNewExam}
              onToggleFavorite={(id) => void handleToggleFavorite(id)}
              onDeleteExam={(id) => void handleDeleteExam(id)}
              onExportExamsJson={handleExportExamsJson}
              onImportExamsJson={(list, b) => void handleImportExamsJson(list, b)}
              onSyncCloud={handleSyncCloud}
              isSyncingCloud={isSyncingCloud}
              cloudSynced={cloudSynced}
              isLoadingExams={isLoadingExams}
              cloudLoadError={cloudLoadError}
              onReloadFromCloud={handleReloadExamsFromCloud}
              syncFeedbackMessage={syncFeedbackMessage}
              onDismissSyncFeedback={() => showFeedback(null)}
              unsyncedExamIds={unsyncedExamIds}
              onRetrySyncExam={handleRetrySyncExam}
              darkMode={darkMode}
              onToggleDarkMode={handleToggleDarkMode}
              lastActiveExamId={returnToExamId}
              savedLibraryScrollY={libraryScrollYRef.current}
              restoreScrollTrigger={restoreScrollTrigger}
            />
          </div>

          {activeView === 'take-exam' && currentExam && (
            <ExamTakeView
              exam={currentExam}
              initialAttempt={reviewingAttempt}
              previewMode={previewMode}
              onCompleteAttempt={handleCompleteAttempt}
              onBackToDashboard={() => {
                setReviewingAttempt(null);
                handleReturnToLibrary(currentExam.id);
              }}
              darkMode={darkMode}
              onToggleDarkMode={handleToggleDarkMode}
            />
          )}

          {activeView === 'create-exam' && isAdmin && (
            <Suspense
              fallback={
                <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] text-xs font-bold text-slate-600">
                  Đang tải công cụ tạo đề...
                </div>
              }
            >
              <CreateExamView
                branding={branding}
                editingExam={editingExam}
                onSaveExam={handleSaveExam}
                onCancel={() => {
                  const editedId = editingExam?.id;
                  setEditingExam(null);
                  if (isLibraryOpen || editedId) {
                    handleReturnToLibrary(editedId);
                  } else {
                    handleCloseLibrary();
                  }
                }}
                darkMode={darkMode}
                onToggleDarkMode={handleToggleDarkMode}
              />
            </Suspense>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
