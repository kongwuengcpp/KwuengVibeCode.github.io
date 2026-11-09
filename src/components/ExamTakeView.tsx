import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Clock,
  GraduationCap,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ArrowLeft,
  HelpCircle,
  Award,
  Sparkles,
  Minus,
  Plus,
  CheckSquare,
  Type,
  ZoomIn,
  X,
  Shuffle,
  Check,
  LayoutGrid,
  ChevronRight,
  Moon,
  Sun,
} from 'lucide-react';
import {
  Exam,
  ExamAttempt,
  OPTION_KEYS,
  OptionKey,
  Question,
  QuestionType,
  TrueFalseAnswerMap,
  UserAnswerValue,
} from '../types/exam';
import {
  createShuffledExam,
  formatCorrectAnswerLabel,
  formatUserAnswerLabel,
  getQuestionTrueKeys,
  gradeExam,
  groupQuestionsIntoSections,
  isQuestionAnswered,
  isQuestionCorrect,
  isTrueFalseAnswerMap,
  organizeQuestionsBySection,
  shouldShowInstantFeedback,
} from '../utils/examParser';
import { QuestionDataTable } from './QuestionDataTable';

interface ExamTakeViewProps {
  exam: Exam;
  initialAttempt?: ExamAttempt | null;
  previewMode?: boolean;
  onCompleteAttempt: (attempt: ExamAttempt) => void;
  onBackToDashboard: () => void;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

interface SavedInProgressAttempt {
  examId: string;
  answers: Record<string, UserAnswerValue>;
  confirmedQuestions: Record<string, boolean>;
  questionOrder: Array<{
    id: string;
    options: Record<OptionKey, string>;
    correctAnswer: OptionKey;
    correctAnswers?: OptionKey[];
  }>;
  deadline: number;
  startedAt: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
}

function getAttemptStorageKey(examId: string): string {
  return `luyende_attempt_${examId}`;
}

export const ExamTakeView: React.FC<ExamTakeViewProps> = ({
  exam,
  initialAttempt = null,
  previewMode = false,
  onCompleteAttempt,
  onBackToDashboard,
  darkMode = true,
  onToggleDarkMode,
}) => {
  const [answers, setAnswers] = useState<Record<string, UserAnswerValue>>(
    initialAttempt ? { ...initialAttempt.answers } : {}
  );
  const [confirmedQuestions, setConfirmedQuestions] = useState<Record<string, boolean>>(
    {}
  );
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(
    Boolean(exam.shuffleQuestions)
  );
  const [shuffleOptions, setShuffleOptions] = useState<boolean>(
    Boolean(exam.shuffleOptions)
  );
  const [activeQuestions, setActiveQuestions] = useState<Question[]>(() => {
    if (initialAttempt?.questionsSnapshot && initialAttempt.questionsSnapshot.length > 0) {
      return organizeQuestionsBySection(initialAttempt.questionsSnapshot);
    }
    return createShuffledExam(exam, {
      shuffleQuestions: Boolean(exam.shuffleQuestions),
      shuffleOptions: Boolean(exam.shuffleOptions),
    }).questions;
  });

  const [isStarted, setIsStarted] = useState<boolean>(!previewMode && !initialAttempt);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(Boolean(initialAttempt));
  const [attemptResult, setAttemptResult] = useState<ExamAttempt | null>(initialAttempt);
  const [instantFeedback, setInstantFeedback] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobilePaletteOpen, setMobilePaletteOpen] = useState<boolean>(false);
  const [resultFilter, setResultFilter] = useState<'all' | 'correct' | 'wrong' | 'unanswered'>('all');
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);
  const [pendingShuffleAction, setPendingShuffleAction] = useState<{
    nextSQ: boolean;
    nextSO: boolean;
  } | null>(null);
  const [savedProgressToResume, setSavedProgressToResume] =
    useState<SavedInProgressAttempt | null>(null);

  const totalSeconds = exam.durationMinutes * 60;
  const [remainingSeconds, setRemainingSeconds] = useState<number>(totalSeconds);
  const startTimeRef = useRef<number>(Date.now());
  const deadlineRef = useRef<number>(Date.now() + totalSeconds * 1000);

  useEffect(() => {
    if (initialAttempt) {
      setAnswers({ ...initialAttempt.answers });
      setConfirmedQuestions({});
      setActiveQuestions(
        initialAttempt.questionsSnapshot && initialAttempt.questionsSnapshot.length > 0
          ? organizeQuestionsBySection(initialAttempt.questionsSnapshot)
          : organizeQuestionsBySection(exam.questions)
      );
      setIsSubmitted(true);
      setAttemptResult(initialAttempt);
      setIsStarted(false);
      setSavedProgressToResume(null);
    } else {
      const initSQ = Boolean(exam.shuffleQuestions);
      const initSO = Boolean(exam.shuffleOptions);
      setShuffleQuestions(initSQ);
      setShuffleOptions(initSO);
      setActiveQuestions(
        createShuffledExam(exam, {
          shuffleQuestions: initSQ,
          shuffleOptions: initSO,
        }).questions
      );
      setAnswers({});
      setConfirmedQuestions({});
      setIsSubmitted(false);
      setAttemptResult(null);
      setIsStarted(!previewMode);
      const nextDurationSec = exam.durationMinutes * 60;
      setRemainingSeconds(nextDurationSec);
      const now = Date.now();
      startTimeRef.current = now;
      deadlineRef.current = now + nextDurationSec * 1000;

      if (!previewMode) {
        try {
          const raw = localStorage.getItem(getAttemptStorageKey(exam.id));
          if (raw) {
            const parsed = JSON.parse(raw) as SavedInProgressAttempt;
            if (
              parsed &&
              parsed.examId === exam.id &&
              typeof parsed.deadline === 'number' &&
              parsed.deadline > now &&
              parsed.answers &&
              Object.keys(parsed.answers).length > 0
            ) {
              setSavedProgressToResume(parsed);
            } else {
              localStorage.removeItem(getAttemptStorageKey(exam.id));
              setSavedProgressToResume(null);
            }
          } else {
            setSavedProgressToResume(null);
          }
        } catch {
          setSavedProgressToResume(null);
        }
      } else {
        setSavedProgressToResume(null);
      }
    }
    setResultFilter('all');
    setMobilePaletteOpen(false);
    setPendingShuffleAction(null);
  }, [exam.id, initialAttempt, previewMode]);

  // Timestamp-based timer that stays accurate across background tabs
  useEffect(() => {
    if (!isStarted || isSubmitted) return;

    const updateRemainingFromDeadline = () => {
      const nextRem = Math.max(
        0,
        Math.round((deadlineRef.current - Date.now()) / 1000)
      );
      setRemainingSeconds(nextRem);
    };

    updateRemainingFromDeadline();
    const timer = window.setInterval(updateRemainingFromDeadline, 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateRemainingFromDeadline();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isStarted, isSubmitted]);

  useEffect(() => {
    if (isStarted && !isSubmitted && remainingSeconds === 0) {
      handleSubmitExam();
    }
  }, [remainingSeconds, isStarted, isSubmitted]);

  // Debounced auto-save of in-progress attempt to localStorage (excluding base64 images)
  useEffect(() => {
    if (!isStarted || isSubmitted || previewMode || savedProgressToResume) return;
    if (Object.keys(answers).length === 0) return;

    const handle = window.setTimeout(() => {
      try {
        const payload: SavedInProgressAttempt = {
          examId: exam.id,
          answers,
          confirmedQuestions,
          questionOrder: activeQuestions.map((q) => ({
            id: q.id,
            options: q.options,
            correctAnswer: q.correctAnswer,
            correctAnswers: q.correctAnswers,
          })),
          deadline: deadlineRef.current,
          startedAt: startTimeRef.current,
          shuffleQuestions,
          shuffleOptions,
        };
        localStorage.setItem(getAttemptStorageKey(exam.id), JSON.stringify(payload));
      } catch {
        // ignore quota errors
      }
    }, 500);

    return () => window.clearTimeout(handle);
  }, [
    exam.id,
    isStarted,
    isSubmitted,
    previewMode,
    savedProgressToResume,
    answers,
    confirmedQuestions,
    activeQuestions,
    shuffleQuestions,
    shuffleOptions,
  ]);

  // Warn before closing/reloading tab when user has answered at least 1 question
  useEffect(() => {
    const hasProgress =
      isStarted && !isSubmitted && Object.keys(answers).length > 0;
    if (!hasProgress) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isStarted, isSubmitted, answers]);

  // Escape key handler for dialogs & drawers
  useEffect(() => {
    if (
      !zoomedImageUrl &&
      !mobilePaletteOpen &&
      !pendingShuffleAction &&
      !savedProgressToResume
    ) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomedImageUrl) setZoomedImageUrl(null);
        else if (pendingShuffleAction) setPendingShuffleAction(null);
        else if (mobilePaletteOpen) setMobilePaletteOpen(false);
        else if (savedProgressToResume) setSavedProgressToResume(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomedImageUrl, mobilePaletteOpen, pendingShuffleAction, savedProgressToResume]);

  const handleResumeSavedProgress = (saved: SavedInProgressAttempt) => {
    const baseById = new Map<string, Question>();
    for (const q of exam.questions) {
      baseById.set(q.id, q);
    }
    const restoredQuestions: Question[] = [];
    for (const item of saved.questionOrder || []) {
      const base = baseById.get(item.id);
      if (base) {
        restoredQuestions.push({
          ...base,
          options: item.options || base.options,
          correctAnswer: item.correctAnswer || base.correctAnswer,
          correctAnswers: item.correctAnswers ?? base.correctAnswers,
        });
      }
    }
    if (restoredQuestions.length === exam.questions.length) {
      setActiveQuestions(
        restoredQuestions.map((q, idx) => ({ ...q, number: idx + 1 }))
      );
    }
    setShuffleQuestions(Boolean(saved.shuffleQuestions));
    setShuffleOptions(Boolean(saved.shuffleOptions));
    setAnswers(saved.answers || {});
    setConfirmedQuestions(saved.confirmedQuestions || {});
    deadlineRef.current = saved.deadline;
    startTimeRef.current = saved.startedAt || Date.now();
    setRemainingSeconds(
      Math.max(1, Math.round((saved.deadline - Date.now()) / 1000))
    );
    setIsStarted(true);
    setIsSubmitted(false);
    setSavedProgressToResume(null);
  };

  const handleDiscardSavedProgress = () => {
    try {
      localStorage.removeItem(getAttemptStorageKey(exam.id));
    } catch {
      // ignore
    }
    setSavedProgressToResume(null);
    const now = Date.now();
    startTimeRef.current = now;
    deadlineRef.current = now + exam.durationMinutes * 60 * 1000;
    setRemainingSeconds(exam.durationMinutes * 60);
  };

  const ensureExamStarted = () => {
    if (!isStarted) {
      setIsStarted(true);
      const now = Date.now();
      startTimeRef.current = now;
      deadlineRef.current = now + exam.durationMinutes * 60 * 1000;
    }
  };

  const handleStartExam = () => {
    setIsStarted(true);
    setIsSubmitted(false);
    setAttemptResult(null);
    const now = Date.now();
    startTimeRef.current = now;
    deadlineRef.current = now + exam.durationMinutes * 60 * 1000;
  };

  const handleSelectSingleOption = (questionId: string, optionKey: OptionKey) => {
    if (isSubmitted) return;
    ensureExamStarted();
    setAnswers((prev) => ({
      ...prev,
      [questionId]: optionKey,
    }));
  };

  const handleSelectTrueFalseOption = (
    questionId: string,
    optionKey: OptionKey,
    value: boolean
  ) => {
    if (isSubmitted) return;
    ensureExamStarted();
    setConfirmedQuestions((prev) => ({
      ...prev,
      [questionId]: false,
    }));
    setAnswers((prev) => {
      const current = prev[questionId];
      let nextMap: TrueFalseAnswerMap = {};
      if (isTrueFalseAnswerMap(current)) {
        nextMap = { ...current };
      } else if (Array.isArray(current)) {
        OPTION_KEYS.forEach((k) => {
          nextMap[k] = current.includes(k);
        });
      }
      nextMap[optionKey] = value;
      return {
        ...prev,
        [questionId]: nextMap,
      };
    });
  };

  const handleChangeShortAnswer = (questionId: string, value: string) => {
    if (isSubmitted) return;
    ensureExamStarted();
    setConfirmedQuestions((prev) => ({
      ...prev,
      [questionId]: false,
    }));
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  };

  const handleConfirmQuestion = (question: Question) => {
    if (isSubmitted) return;
    if (!isQuestionAnswered(question, answers[question.id])) return;
    ensureExamStarted();
    setConfirmedQuestions((prev) => ({
      ...prev,
      [question.id]: true,
    }));
  };

  const handleSubmitExam = () => {
    if (isSubmitted) return;
    try {
      localStorage.removeItem(getAttemptStorageKey(exam.id));
    } catch {
      // ignore
    }
    const elapsedSeconds = Math.max(
      1,
      Math.round((Date.now() - startTimeRef.current) / 1000)
    );
    const examWithActiveQuestions: Exam = {
      ...exam,
      questions: activeQuestions,
    };
    const graded = gradeExam(examWithActiveQuestions, answers, elapsedSeconds, new Date());
    setAttemptResult(graded);
    setIsSubmitted(true);
    setIsStarted(false);
    setMobilePaletteOpen(false);
    onCompleteAttempt(graded);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const applyShuffleAndReset = (nextSQ: boolean, nextSO: boolean) => {
    try {
      localStorage.removeItem(getAttemptStorageKey(exam.id));
    } catch {
      // ignore
    }
    setShuffleQuestions(nextSQ);
    setShuffleOptions(nextSO);
    const nextExam = createShuffledExam(exam, {
      shuffleQuestions: nextSQ,
      shuffleOptions: nextSO,
    });
    setActiveQuestions(nextExam.questions);
    setAnswers({});
    setConfirmedQuestions({});
    setIsSubmitted(false);
    setAttemptResult(null);
    setResultFilter('all');
    const nextDurationSec = exam.durationMinutes * 60;
    setRemainingSeconds(nextDurationSec);
    const now = Date.now();
    startTimeRef.current = now;
    deadlineRef.current = now + nextDurationSec * 1000;
  };

  const requestShuffle = (nextSQ: boolean, nextSO: boolean) => {
    if (isSubmitted || Object.keys(answers).length === 0) {
      applyShuffleAndReset(nextSQ, nextSO);
      return;
    }
    setPendingShuffleAction({ nextSQ, nextSO });
  };

  const handleRetakeExam = () => {
    try {
      localStorage.removeItem(getAttemptStorageKey(exam.id));
    } catch {
      // ignore
    }
    const nextExam = createShuffledExam(exam, {
      shuffleQuestions,
      shuffleOptions,
    });
    setActiveQuestions(nextExam.questions);
    setAnswers({});
    setConfirmedQuestions({});
    setIsSubmitted(false);
    setAttemptResult(null);
    setIsStarted(true);
    const nextDurationSec = exam.durationMinutes * 60;
    setRemainingSeconds(nextDurationSec);
    setResultFilter('all');
    setMobilePaletteOpen(false);
    const now = Date.now();
    startTimeRef.current = now;
    deadlineRef.current = now + nextDurationSec * 1000;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToQuestion = (questionNumber: number) => {
    setMobilePaletteOpen(false);
    const el = document.getElementById(`question-block-${questionNumber}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;
  };

  const answeredCount = activeQuestions.filter((q) =>
    isQuestionAnswered(q, answers[q.id])
  ).length;

  const filteredQuestions = activeQuestions.filter((q) => {
    if (!isSubmitted || resultFilter === 'all') return true;
    const userAns = answers[q.id];
    const hasAns = isQuestionAnswered(q, userAns);
    if (resultFilter === 'unanswered') return !hasAns;
    const isCorr = isQuestionCorrect(q, userAns);
    if (resultFilter === 'correct') return isCorr;
    if (resultFilter === 'wrong') return hasAns && !isCorr;
    return true;
  });

  const renderPaletteNumbers = () => {
    const paletteSections = groupQuestionsIntoSections(activeQuestions).filter(
      (sec) => sec.items.length > 0
    );

    return (
      <div className="space-y-3.5">
        {paletteSections.map((sec) => {
          const badgeColor =
            sec.type === 'single'
              ? 'text-[#2563eb] bg-blue-50 border-blue-200/80'
              : sec.type === 'multiple'
              ? 'text-indigo-700 bg-indigo-50 border-indigo-200/80'
              : 'text-amber-800 bg-amber-50 border-amber-200/80';

          return (
            <div key={sec.type} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-bold ${badgeColor}`}
                >
                  {sec.shortTitle}
                </span>
                <span className="text-[11px] text-slate-400 font-semibold tabular-nums">
                  {sec.items.length} câu
                </span>
              </div>

              <div className="grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-5 gap-1.5">
                {sec.items.map(({ question: q }) => {
                  const userAns = answers[q.id];
                  const hasAns = isQuestionAnswered(q, userAns);
                  const isCorr = isQuestionCorrect(q, userAns);
                  const isConf = Boolean(confirmedQuestions[q.id]);
                  const qType: QuestionType = q.type || 'single';
                  const needsConfirm = qType === 'multiple' || qType === 'short';
                  const showEval = shouldShowInstantFeedback(q, userAns, {
                    isSubmitted,
                    instantFeedback,
                    isConfirmed: isConf,
                  });

                  let btnClass =
                    'bg-slate-50/80 border-slate-200 text-slate-700 hover:border-[#2563eb] hover:text-[#2563eb]';

                  if (showEval) {
                    if (isCorr) {
                      btnClass = 'bg-emerald-500 border-emerald-600 text-white font-bold';
                    } else if (hasAns) {
                      btnClass = 'bg-rose-500 border-rose-600 text-white font-bold';
                    } else {
                      btnClass = 'bg-amber-50 border-amber-300 text-amber-800';
                    }
                  } else if (hasAns) {
                    if (needsConfirm && !isConf) {
                      btnClass = 'bg-blue-50 border-blue-400 text-[#2563eb] font-bold';
                    } else {
                      btnClass = 'bg-[#2563eb] border-[#2563eb] text-white font-bold';
                    }
                  }

                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => scrollToQuestion(q.number)}
                      aria-label={`Đi tới câu ${q.number}`}
                      className={`h-9 lg:h-8 rounded-lg border text-xs font-semibold tabular-nums transition-colors cursor-pointer ${btnClass}`}
                    >
                      {q.number}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] text-slate-900">
      {/* Lightbox Modal for Enlarged Question Image */}
      {zoomedImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Xem ảnh phóng to"
          onClick={() => setZoomedImageUrl(null)}
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-2xl p-4 max-w-4xl max-h-[90vh] overflow-auto shadow-xl"
          >
            <button
              type="button"
              onClick={() => setZoomedImageUrl(null)}
              aria-label="Đóng ảnh phóng to"
              className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900/80 text-white hover:bg-slate-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={zoomedImageUrl}
              alt="Hình minh hoạ câu hỏi phóng to"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[82vh] object-contain mx-auto rounded-lg"
            />
          </div>
        </div>
      )}

      {/* Confirmation Dialog before Shuffling when Answers Exist */}
      {pendingShuffleAction && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shuffle-confirm-title"
          onClick={() => setPendingShuffleAction(null)}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
                  <Shuffle className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="shuffle-confirm-title"
                    className="text-base font-extrabold text-slate-900"
                  >
                    Xác nhận đổi chế độ xáo trộn?
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Bạn đã trả lời {answeredCount}/{exam.questions.length} câu hỏi
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingShuffleAction(null)}
                aria-label="Đóng thông báo xáo trộn"
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Đổi chế độ xáo trộn sẽ <strong>xóa toàn bộ đáp án đã chọn</strong> và{' '}
              <strong>đặt lại đồng hồ</strong> về ban đầu. Tiếp tục?
            </p>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setPendingShuffleAction(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Huỷ bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  const { nextSQ, nextSO } = pendingShuffleAction;
                  setPendingShuffleAction(null);
                  applyShuffleAndReset(nextSQ, nextSO);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Tiếp tục xáo trộn</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume Saved In-Progress Attempt Dialog */}
      {savedProgressToResume && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-attempt-title"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-200 text-[#2563eb] flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3
                  id="resume-attempt-title"
                  className="text-base font-extrabold text-slate-900"
                >
                  Tiếp tục bài đang làm dở?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Đã lưu tự động {Object.keys(savedProgressToResume.answers).length} câu đã chọn
                </p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Hệ thống tìm thấy bài làm đang dở của bạn cho đề{' '}
              <strong>{exam.title}</strong>. Bạn muốn tiếp tục làm tiếp hay bắt đầu lại từ đầu?
            </p>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleDiscardSavedProgress}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Làm lại từ đầu
              </button>
              <button
                type="button"
                onClick={() => handleResumeSavedProgress(savedProgressToResume)}
                className="px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                Tiếp tục làm bài
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Slide-Up Question Palette Drawer */}
      {mobilePaletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Bảng câu hỏi trên điện thoại"
          onClick={() => setMobilePaletteOpen(false)}
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex flex-col justify-end lg:hidden"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-t-3xl border-t border-slate-200 max-h-[82vh] flex flex-col shadow-2xl"
          >
            <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-2.5 mb-1 shrink-0" />
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200/70 text-[#2563eb] flex items-center justify-center">
                  <LayoutGrid className="w-4 h-4" />
                </span>
                <span className="text-sm font-extrabold text-slate-900">
                  Bảng Câu Hỏi ({answeredCount}/{exam.questions.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobilePaletteOpen(false)}
                aria-label="Đóng bảng câu hỏi"
                className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4">
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    Hiển thị kết quả ngay sau khi trả lời
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Chế độ luyện tập · Chấm & hiện giải ngay
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={instantFeedback}
                  aria-label="Hiển thị kết quả ngay sau khi trả lời (Mobile)"
                  onClick={() => setInstantFeedback(!instantFeedback)}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                    instantFeedback ? 'bg-[#2563eb]' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                      instantFeedback ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {!isSubmitted && (
                <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Xáo trộn câu hỏi
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={shuffleQuestions}
                      onClick={() => requestShuffle(!shuffleQuestions, shuffleOptions)}
                      className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                        shuffleQuestions ? 'bg-[#2563eb]' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                          shuffleQuestions ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Xáo trộn đáp án (A, B, C, D)
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={shuffleOptions}
                      onClick={() => requestShuffle(shuffleQuestions, !shuffleOptions)}
                      className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                        shuffleOptions ? 'bg-[#2563eb]' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                          shuffleOptions ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}

              {renderPaletteNumbers()}
            </div>
          </div>
        </div>
      )}

      {/* Compact Sticky Header matching Trang chủ & Thư Viện Đề Thi */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 border border-blue-100 text-[#2563eb] flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-lg font-extrabold text-[#1e293b] truncate">
                {exam.title}
              </h1>
              <span className="hidden md:inline-block px-2.5 py-0.5 rounded-md bg-[#f1f5f9] border border-slate-200/70 text-slate-700 text-[11px] font-bold shrink-0">
                {exam.category}
              </span>
            </div>
            <p className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
              <span className="hidden sm:inline">Luyện đề Online · From : NguyenCongQuang · </span>
              {exam.category} · {exam.questions.length} câu ({exam.durationMinutes}p)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {!isSubmitted && (
            <div className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-blue-50 border border-blue-200/80 text-[#2563eb] text-xs font-extrabold tabular-nums">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{formatTimer(remainingSeconds)}</span>
            </div>
          )}

          {!isSubmitted && (
            <button
              type="button"
              onClick={handleSubmitExam}
              className="hidden sm:inline-flex px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wide shadow-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              NỘP BÀI ({answeredCount}/{exam.questions.length})
            </button>
          )}

          {onToggleDarkMode && (
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
              title={darkMode ? 'Chế độ sáng' : 'Chế độ tối'}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              {darkMode ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onBackToDashboard}
            className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-slate-700 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">QUAY LẠI</span>
            <span className="sm:hidden">THOÁT</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1380px] w-full mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-24 lg:pb-8 flex-1">
        {/* Instant Result Summary Panel */}
        {isSubmitted && attemptResult && (
          <section
            aria-label="Kết quả chấm bài"
            className="mb-5 sm:mb-6 bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-md shadow-slate-200/40 p-4 sm:p-8"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 sm:gap-6 pb-5 sm:pb-6 border-b border-slate-100">
              <div className="flex items-start gap-3.5 sm:gap-4">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#2563eb] shrink-0">
                  <Award className="w-6 h-6 sm:w-8 sm:h-8" />
                </div>
                <div>
                  <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-[#2563eb]">
                    Kết quả hoàn thành bài thi · Luyện đề Online
                  </div>
                  <h2 className="text-lg sm:text-xl font-extrabold text-[#1e293b] mt-0.5">
                    {exam.title}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Hoàn thành ngày {attemptResult.completedAt} · Thời gian làm bài:{' '}
                    <strong className="text-slate-700 tabular-nums">
                      {formatTimer(attemptResult.durationSeconds)}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
                <div className="bg-blue-50/80 border border-blue-200/80 rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-center">
                  <div className="text-[11px] font-semibold text-[#2563eb]">Điểm số (Hệ 10)</div>
                  <div className="text-lg sm:text-xl font-extrabold text-[#2563eb] tabular-nums mt-0.5">
                    {attemptResult.scoreTen.toFixed(2)}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-center">
                  <div className="text-[11px] font-semibold text-slate-500">Tỉ lệ đúng</div>
                  <div className="text-lg sm:text-xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                    {attemptResult.scorePercent}%
                  </div>
                </div>
                <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-center">
                  <div className="text-[11px] font-semibold text-emerald-700">Câu đúng</div>
                  <div className="text-lg sm:text-xl font-bold text-emerald-600 tabular-nums mt-0.5">
                    {attemptResult.correctCount}
                  </div>
                </div>
                <div className="bg-rose-50/60 border border-rose-200/80 rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-center">
                  <div className="text-[11px] font-semibold text-rose-700">Câu sai</div>
                  <div className="text-lg sm:text-xl font-bold text-rose-600 tabular-nums mt-0.5">
                    {attemptResult.wrongCount}
                  </div>
                </div>
                <div className="bg-amber-50/60 border border-amber-200/80 rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-center col-span-2 sm:col-span-1">
                  <div className="text-[11px] font-semibold text-amber-700">Chưa làm</div>
                  <div className="text-lg sm:text-xl font-bold text-amber-600 tabular-nums mt-0.5">
                    {attemptResult.unansweredCount}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setResultFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    resultFilter === 'all'
                      ? 'bg-[#2563eb] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Tất cả ({exam.questions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setResultFilter('correct')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    resultFilter === 'correct'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  Câu đúng ({attemptResult.correctCount})
                </button>
                <button
                  type="button"
                  onClick={() => setResultFilter('wrong')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    resultFilter === 'wrong'
                      ? 'bg-rose-600 text-white'
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  Câu sai ({attemptResult.wrongCount})
                </button>
                <button
                  type="button"
                  onClick={() => setResultFilter('unanswered')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    resultFilter === 'unanswered'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  Chưa làm ({attemptResult.unansweredCount})
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRetakeExam}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide bg-[#2563eb] hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Làm lại đề này</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Main 2-Column Exam Layout */}
        <div className="flex flex-col lg:flex-row items-start gap-6">
          {/* Left Column: Exam Card & Questions List */}
          <div className="w-full flex-1 bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-md shadow-slate-200/40 p-4 sm:p-8">
            <div className="pb-4 sm:pb-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-2xl font-extrabold text-[#1e293b] leading-snug">
                  {exam.title}
                </h2>
                <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-slate-500 mt-1.5">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#2563eb]" />
                    <span className="tabular-nums">{exam.questions.length} câu hỏi</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#2563eb]" />
                    <span className="tabular-nums">{exam.durationMinutes} phút</span>
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1.5 font-medium">
                    <GraduationCap className="w-4 h-4 text-[#2563eb]" />
                    <span>Trắc nghiệm · Đúng/Sai · Trả lời ngắn</span>
                  </span>
                </div>
              </div>

              <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200/60 text-slate-600 text-[10px] sm:text-[11px] font-bold tracking-wider uppercase">
                VERSION 4.16
              </span>
            </div>

            {/* Mobile Quick Practice Toggle Bar (visible right above questions on mobile) */}
            <div className="lg:hidden mt-3.5 rounded-xl border border-amber-200/80 bg-amber-50/50 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-800 truncate">
                  Hiện kết quả ngay sau khi trả lời
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  Chế độ luyện tập · Chấm điểm ngay
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={instantFeedback}
                onClick={() => setInstantFeedback(!instantFeedback)}
                className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                  instantFeedback ? 'bg-[#2563eb]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                    instantFeedback ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Mobile Shuffle Questions & Options Controls (directly below instant feedback bar on mobile) */}
            {!isSubmitted && (
              <div className="lg:hidden mt-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/40 px-3.5 py-2.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Xáo trộn câu hỏi
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shuffleQuestions}
                    aria-label="Xáo trộn câu hỏi (Mobile)"
                    onClick={() => requestShuffle(!shuffleQuestions, shuffleOptions)}
                    className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      shuffleQuestions ? 'bg-[#2563eb]' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                        shuffleQuestions ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Xáo trộn đáp án (A, B, C, D)
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shuffleOptions}
                    aria-label="Xáo trộn đáp án (A, B, C, D) (Mobile)"
                    onClick={() => requestShuffle(shuffleQuestions, !shuffleOptions)}
                    className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      shuffleOptions ? 'bg-[#2563eb]' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                        shuffleOptions ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* Questions List Grouped into Separate Sections (Phần I, Phần II, Phần III) */}
            <div className="mt-4 sm:mt-6 space-y-6 sm:space-y-8">
              {filteredQuestions.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Không có câu hỏi nào trong bộ lọc này.
                </div>
              ) : (
                groupQuestionsIntoSections(filteredQuestions)
                  .filter((sec) => sec.items.length > 0)
                  .map((section) => {
                    const sectionHeaderTheme =
                      section.type === 'single'
                        ? 'bg-blue-50/70 border-blue-200/80'
                        : section.type === 'multiple'
                        ? 'bg-indigo-50/70 border-indigo-200/80'
                        : 'bg-amber-50/70 border-amber-200/80';

                    const sectionBadgeTheme =
                      section.type === 'single'
                        ? 'bg-[#2563eb] text-white'
                        : section.type === 'multiple'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-amber-600 text-white';

                    const sectionBorderTheme =
                      section.type === 'single'
                        ? 'border-blue-200/70'
                        : section.type === 'multiple'
                        ? 'border-indigo-200/70'
                        : 'border-amber-200/70';

                    return (
                      <section
                        key={section.type}
                        aria-label={`${section.partLabel}. ${section.title}`}
                        className={`rounded-2xl border ${sectionBorderTheme} bg-white overflow-hidden shadow-2xs`}
                      >
                        {/* Dedicated Section Header Banner */}
                        <div
                          className={`px-4 sm:px-6 py-3.5 sm:py-4 border-b ${sectionHeaderTheme} flex flex-wrap items-center justify-between gap-2`}
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold tracking-wide uppercase ${sectionBadgeTheme}`}
                              >
                                {section.partLabel}
                              </span>
                              <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                                {section.title}
                              </h3>
                            </div>
                            <p className="text-xs text-slate-600">
                              {section.description}
                            </p>
                          </div>

                          <span className="px-3 py-1 rounded-xl bg-white/90 border border-slate-200/80 text-xs font-extrabold text-slate-700 tabular-nums shrink-0">
                            {section.items.length} câu hỏi
                          </span>
                        </div>

                        {/* Questions inside this Section */}
                        <div className="divide-y divide-slate-100 px-4 sm:px-6">
                          {section.items.map(({ question, sectionNumber }) => {
                            const qType: QuestionType = question.type || 'single';
                            const userAnswer = answers[question.id];
                            const hasAnswered = isQuestionAnswered(question, userAnswer);
                            const isCorrect = isQuestionCorrect(question, userAnswer);
                            const isConfirmed = Boolean(confirmedQuestions[question.id]);
                            const showAnswerFeedback = shouldShowInstantFeedback(
                              question,
                              userAnswer,
                              {
                                isSubmitted,
                                instantFeedback,
                                isConfirmed,
                              }
                            );

                            const cleanQuestionText = question.text.replace(
                              /^(?:Câu\s*\d+\s*[.:)\-]\s*)/i,
                              ''
                            );
                            const displayPrompt = `Câu ${question.number}. ${cleanQuestionText}`;

                            return (
                              <div
                                key={question.id}
                                id={`question-block-${question.number}`}
                                className="py-5 sm:py-6 scroll-mt-20"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200/70 text-[#2563eb] text-xs font-extrabold">
                                      Câu {question.number}
                                    </span>
                                    <span className="text-[11px] font-semibold text-slate-400">
                                      ({section.partLabel} · Câu {sectionNumber})
                                    </span>
                                    {qType === 'multiple' && (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200/60 text-xs font-semibold text-indigo-700">
                                        <CheckSquare className="w-3.5 h-3.5" />
                                        <span>Đúng / Sai</span>
                                      </span>
                                    )}
                                    {qType === 'short' && (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200/60 text-xs font-semibold text-amber-700">
                                        <Type className="w-3.5 h-3.5" />
                                        <span>Trả lời ngắn</span>
                                      </span>
                                    )}
                                  </div>

                        {showAnswerFeedback && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-bold ${
                              isCorrect
                                ? 'text-emerald-600'
                                : hasAnswered
                                ? 'text-rose-600'
                                : 'text-amber-600'
                            }`}
                          >
                            {isCorrect ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  Chính xác (Đáp án: {formatCorrectAnswerLabel(question)})
                                </span>
                              </>
                            ) : hasAnswered ? (
                              <>
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  Sai (Bạn chọn: {formatUserAnswerLabel(question, userAnswer)} · Đáp án đúng:{' '}
                                  {formatCorrectAnswerLabel(question)})
                                </span>
                              </>
                            ) : (
                              <>
                                <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  Chưa trả lời · Đáp án đúng: {formatCorrectAnswerLabel(question)}
                                </span>
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      <p className="text-[15px] sm:text-base text-slate-800 font-normal leading-[1.7] mb-3.5 whitespace-pre-line">
                        <strong className="font-bold text-slate-900">Câu {question.number}.</strong>{' '}
                        {cleanQuestionText}
                      </p>

                      {/* Question Image (if present) */}
                      {question.imageUrl && (
                        <div className="mb-4">
                          <div className="inline-block relative group rounded-2xl border border-slate-200 bg-slate-50/70 p-2 sm:p-2.5 max-w-full">
                            <img
                              src={question.imageUrl}
                              alt={`Hình minh hoạ câu ${question.number}`}
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              onClick={() => setZoomedImageUrl(question.imageUrl || null)}
                              className="max-h-60 sm:max-h-64 w-auto max-w-full rounded-xl object-contain cursor-zoom-in"
                            />
                            <button
                              type="button"
                              onClick={() => setZoomedImageUrl(question.imageUrl || null)}
                              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
                            >
                              <ZoomIn className="w-3 h-3" />
                              <span>Nhấn vào ảnh để phóng to</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Question Data Table (Bảng số liệu, if present) */}
                      {question.tableData && (
                        <div className="mb-4">
                          <QuestionDataTable tableData={question.tableData} />
                        </div>
                      )}

                      {/* Render by Question Type */}
                      {qType === 'single' && (
                        <div className="space-y-2.5" role="radiogroup" aria-label={`Câu ${question.number}`}>
                          {OPTION_KEYS.map((optKey) => {
                            const isSelected = userAnswer === optKey;
                            const isCorrectOption = question.correctAnswer === optKey;

                            let rowStyle =
                              'border border-slate-200/80 bg-slate-50/40 hover:bg-blue-50/30 hover:border-blue-300 text-slate-800 rounded-xl px-3.5 py-3 sm:py-2.5';
                            let circleStyle = 'border-slate-300 bg-white';

                            if (showAnswerFeedback) {
                              if (isCorrectOption) {
                                rowStyle =
                                  'bg-emerald-50/90 border border-emerald-200 rounded-xl px-3.5 py-3 sm:py-2.5 text-emerald-950 font-semibold';
                                circleStyle = 'border-emerald-600 bg-emerald-600';
                              } else if (isSelected && !isCorrectOption) {
                                rowStyle =
                                  'bg-rose-50/90 border border-rose-200 rounded-xl px-3.5 py-3 sm:py-2.5 text-rose-950 font-medium';
                                circleStyle = 'border-rose-600 bg-rose-600';
                              } else {
                                rowStyle =
                                  'border border-slate-100 bg-slate-50/30 rounded-xl px-3.5 py-3 sm:py-2.5 text-slate-400';
                              }
                            } else if (isSelected) {
                              rowStyle =
                                'bg-blue-50/70 border border-[#2563eb] rounded-xl px-3.5 py-3 sm:py-2.5 text-slate-900 font-semibold';
                              circleStyle = 'border-[#2563eb] bg-[#2563eb]';
                            }

                            return (
                              <label
                                key={optKey}
                                className={`flex items-start gap-3 text-[14.5px] sm:text-[15px] min-h-[44px] transition-colors select-none ${
                                  isSubmitted ? 'cursor-default' : 'cursor-pointer'
                                } ${rowStyle}`}
                              >
                                <input
                                  type="radio"
                                  name={`question-${question.id}`}
                                  value={optKey}
                                  checked={isSelected}
                                  disabled={isSubmitted}
                                  onChange={() => handleSelectSingleOption(question.id, optKey)}
                                  className="sr-only"
                                />
                                <span
                                  className={`w-4 h-4 mt-1 rounded-full border flex items-center justify-center shrink-0 transition-colors ${circleStyle}`}
                                  aria-hidden="true"
                                >
                                  {(isSelected || (showAnswerFeedback && isCorrectOption)) && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                  )}
                                </span>
                                <span className="leading-relaxed whitespace-pre-line">
                                  <strong className="font-bold">{optKey}.</strong> {question.options[optKey]}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {qType === 'multiple' && (
                        <div
                          className="space-y-2.5"
                          role="group"
                          aria-label={`Câu ${question.number} (Chọn Đúng hoặc Sai cho từng ý)`}
                        >
                          <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
                            <span>
                              Chọn <strong>Đúng</strong> hoặc <strong>Sai</strong> cho từng ý A, B, C, D:
                            </span>
                            <span className="text-[11px] font-semibold text-slate-400">
                              Đúng / Sai
                            </span>
                          </div>
                          {OPTION_KEYS.map((optKey) => {
                            const targetTrueKeys = getQuestionTrueKeys(question);
                            const isTrueStatement = targetTrueKeys.includes(optKey);

                            let userChoice: boolean | undefined;
                            if (isTrueFalseAnswerMap(userAnswer)) {
                              userChoice = userAnswer[optKey];
                            } else if (Array.isArray(userAnswer)) {
                              userChoice = userAnswer.includes(optKey);
                            }

                            const isStatementCorrect =
                              typeof userChoice === 'boolean' && userChoice === isTrueStatement;

                            let rowStyle =
                              'p-3 sm:px-3.5 sm:py-2.5 text-slate-800 border border-slate-200/80 bg-slate-50/40 rounded-xl';

                            if (showAnswerFeedback) {
                              if (isStatementCorrect) {
                                rowStyle =
                                  'bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 sm:px-3.5 sm:py-2.5 text-emerald-950';
                              } else {
                                rowStyle =
                                  'bg-rose-50/80 border border-rose-200 rounded-xl p-3 sm:px-3.5 sm:py-2.5 text-rose-950';
                              }
                            } else if (typeof userChoice === 'boolean') {
                              rowStyle =
                                'bg-blue-50/40 border border-blue-200/80 rounded-xl p-3 sm:px-3.5 sm:py-2.5 text-slate-900';
                            }

                            let trueBtnStyle =
                              'bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-[#2563eb]';
                            if (showAnswerFeedback) {
                              if (isTrueStatement) {
                                trueBtnStyle =
                                  'bg-emerald-600 border-emerald-600 text-white font-bold shadow-2xs';
                              } else if (userChoice === true) {
                                trueBtnStyle =
                                  'bg-rose-600 border-rose-600 text-white font-bold';
                              } else {
                                trueBtnStyle = 'bg-white/60 border-slate-200 text-slate-400';
                              }
                            } else if (userChoice === true) {
                              trueBtnStyle =
                                'bg-[#2563eb] border-[#2563eb] text-white font-bold shadow-2xs';
                            }

                            let falseBtnStyle =
                              'bg-white border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-700';
                            if (showAnswerFeedback) {
                              if (!isTrueStatement) {
                                falseBtnStyle =
                                  'bg-emerald-600 border-emerald-600 text-white font-bold shadow-2xs';
                              } else if (userChoice === false) {
                                falseBtnStyle =
                                  'bg-rose-600 border-rose-600 text-white font-bold';
                              } else {
                                falseBtnStyle = 'bg-white/60 border-slate-200 text-slate-400';
                              }
                            } else if (userChoice === false) {
                              falseBtnStyle =
                                'bg-rose-500 border-rose-600 text-white font-bold shadow-2xs';
                            }

                            return (
                              <div
                                key={optKey}
                                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 text-[14.5px] sm:text-[15px] transition-colors ${rowStyle}`}
                              >
                                <div className="flex items-start gap-2.5 flex-1">
                                  <span className="font-bold text-slate-700 shrink-0">
                                    {optKey}.
                                  </span>
                                  <span className="leading-relaxed whitespace-pre-line">
                                    {question.options[optKey]}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                                  <button
                                    type="button"
                                    disabled={isSubmitted}
                                    aria-label={`Chọn Đúng cho ý ${optKey} câu ${question.number}`}
                                    aria-pressed={userChoice === true}
                                    onClick={() =>
                                      handleSelectTrueFalseOption(question.id, optKey, true)
                                    }
                                    className={`flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 px-4 sm:px-3 py-1.5 sm:py-1 rounded-lg border text-xs font-bold transition-colors ${
                                      isSubmitted ? 'cursor-default' : 'cursor-pointer'
                                    } ${trueBtnStyle}`}
                                  >
                                    Đúng
                                  </button>

                                  <button
                                    type="button"
                                    disabled={isSubmitted}
                                    aria-label={`Chọn Sai cho ý ${optKey} câu ${question.number}`}
                                    aria-pressed={userChoice === false}
                                    onClick={() =>
                                      handleSelectTrueFalseOption(question.id, optKey, false)
                                    }
                                    className={`flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 px-4 sm:px-3 py-1.5 sm:py-1 rounded-lg border text-xs font-bold transition-colors ${
                                      isSubmitted ? 'cursor-default' : 'cursor-pointer'
                                    } ${falseBtnStyle}`}
                                  >
                                    Sai
                                  </button>

                                  {showAnswerFeedback && (
                                    <span
                                      className={`text-[11px] font-bold min-w-[54px] text-right ${
                                        isStatementCorrect ? 'text-emerald-700' : 'text-rose-600'
                                      }`}
                                    >
                                      {isStatementCorrect
                                        ? '✓ Đúng'
                                        : `Đ/A: ${isTrueStatement ? 'Đúng' : 'Sai'}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {/* Confirmation Button for Multiple-Choice (Đúng/Sai) */}
                          {!isSubmitted && (
                            <div className="pt-1.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                              <button
                                type="button"
                                aria-label={`Xác nhận câu ${question.number}`}
                                disabled={!hasAnswered || isConfirmed}
                                onClick={() => handleConfirmQuestion(question)}
                                className={`w-full sm:w-auto min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 sm:py-1.5 rounded-xl text-xs font-bold transition-colors ${
                                  isConfirmed
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                                    : hasAnswered
                                    ? 'bg-[#2563eb] hover:bg-blue-700 text-white shadow-xs cursor-pointer'
                                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>
                                  {isConfirmed ? 'Đã xác nhận câu trả lời' : 'Xác nhận'}
                                </span>
                              </button>

                              {!isConfirmed && (
                                <span className="text-[11px] text-slate-500">
                                  {hasAnswered
                                    ? 'Nhấn "Xác nhận" sau khi đã chọn xong Đúng/Sai cho các ý'
                                    : 'Chọn Đúng hoặc Sai cho từng ý rồi nhấn "Xác nhận"'}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {qType === 'short' && (
                        <div className="mt-2 max-w-lg space-y-2">
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              aria-label={`Điền đáp án câu ${question.number}`}
                              disabled={isSubmitted}
                              value={typeof userAnswer === 'string' ? userAnswer : ''}
                              onChange={(e) => handleChangeShortAnswer(question.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && hasAnswered && !isConfirmed) {
                                  e.preventDefault();
                                  handleConfirmQuestion(question);
                                }
                              }}
                              placeholder="Nhập câu trả lời ngắn / từ cần điền..."
                              className={`flex-1 min-h-[42px] rounded-xl border px-3.5 py-2 text-sm focus:outline-none focus:ring-2 ${
                                showAnswerFeedback
                                  ? isCorrect
                                    ? 'border-emerald-400 bg-emerald-50/60 text-emerald-900 font-semibold focus:ring-emerald-500'
                                    : 'border-rose-300 bg-rose-50/50 text-rose-900 focus:ring-rose-500'
                                  : 'border-slate-200 bg-slate-50/60 focus:bg-white text-slate-900 focus:ring-[#2563eb]'
                              }`}
                            />

                            {!isSubmitted && (
                              <button
                                type="button"
                                aria-label={`Xác nhận câu ${question.number}`}
                                disabled={!hasAnswered || isConfirmed}
                                onClick={() => handleConfirmQuestion(question)}
                                className={`min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shrink-0 transition-colors ${
                                  isConfirmed
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                                    : hasAnswered
                                    ? 'bg-[#2563eb] hover:bg-blue-700 text-white shadow-xs cursor-pointer'
                                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>{isConfirmed ? 'Đã xác nhận' : 'Xác nhận'}</span>
                              </button>
                            )}
                          </div>

                          {!isSubmitted && !isConfirmed && hasAnswered && (
                            <div className="text-[11px] text-slate-500">
                              Nhấn nút <strong>Xác nhận</strong> (hoặc phím <strong>Enter</strong>) để chốt câu trả lời
                            </div>
                          )}

                          {showAnswerFeedback && (
                            <div className="text-xs text-slate-600">
                              Đáp án chuẩn:{' '}
                              <strong className="text-emerald-700">{question.shortAnswer}</strong>
                            </div>
                          )}
                        </div>
                      )}

                      {showAnswerFeedback && question.explanation && (
                        <div className="mt-3.5 bg-blue-50/50 border border-blue-200/70 rounded-xl px-4 py-3 text-xs text-slate-700 leading-relaxed flex items-start gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-[#2563eb] shrink-0 mt-0.5" />
                          <div>
                            <strong className="text-slate-900">Giải thích: </strong>
                            {question.explanation}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  </div>

          {/* Right Sticky Sidebar: Question Palette & Controls (Homepage Card Style) */}
          <aside className="w-full lg:w-[340px] shrink-0 lg:sticky lg:top-20">
            <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-md shadow-slate-200/40 overflow-hidden">
              <div className="bg-slate-50/80 border-b border-slate-200/80 px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200/70 text-[#2563eb] flex items-center justify-center font-bold text-xs">
                    <LayoutGrid className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-extrabold text-[#1e293b]">
                    Bảng Câu Hỏi
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {isStarted && !isSubmitted && (
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-[#2563eb] text-xs font-extrabold tabular-nums">
                      {formatTimer(remainingSeconds)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    aria-label={sidebarCollapsed ? 'Mở rộng bảng câu hỏi' : 'Thu gọn bảng câu hỏi'}
                    className="text-slate-500 hover:text-slate-900 p-1 rounded-lg hover:bg-slate-200/60 cursor-pointer"
                  >
                    {sidebarCollapsed ? <Plus className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {!sidebarCollapsed && (
                <div className="p-5 space-y-4">
                  {/* Pastel Option Cards matching Homepage style */}
                  <div className="space-y-2.5">
                    <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-800">
                          Hiển thị kết quả ngay sau khi trả lời
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Chế độ luyện tập · Chấm & hiện giải ngay
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={instantFeedback}
                        aria-label="Hiển thị kết quả ngay sau khi trả lời"
                        onClick={() => setInstantFeedback(!instantFeedback)}
                        className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                          instantFeedback ? 'bg-[#2563eb]' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                            instantFeedback ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {!isSubmitted && (
                      <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700">
                            Xáo trộn câu hỏi
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={shuffleQuestions}
                            aria-label="Xáo trộn câu hỏi"
                            onClick={() =>
                              requestShuffle(!shuffleQuestions, shuffleOptions)
                            }
                            className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                              shuffleQuestions ? 'bg-[#2563eb]' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                                shuffleQuestions ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700">
                            Xáo trộn đáp án (A, B, C, D)
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={shuffleOptions}
                            aria-label="Xáo trộn đáp án"
                            onClick={() =>
                              requestShuffle(shuffleQuestions, !shuffleOptions)
                            }
                            className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                              shuffleOptions ? 'bg-[#2563eb]' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`block w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                                shuffleOptions ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => requestShuffle(true, true)}
                          className="w-full py-1.5 px-3 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 text-xs font-bold text-[#2563eb] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                          <span>Đảo câu hỏi & đáp án ngay</span>
                        </button>
                        <p className="text-[11px] text-slate-500 leading-snug">
                          Câu hỏi được đảo riêng trong từng phần (Trắc nghiệm, Đúng/Sai, Trả lời ngắn), không trộn lẫn các phần.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 5-Column Question Number Grid */}
                  {renderPaletteNumbers()}

                  {/* Pagination / Next Unanswered Row */}
                  <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                    <button
                      type="button"
                      disabled
                      className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 font-semibold cursor-not-allowed"
                    >
                      Quay lại
                    </button>
                    <span className="text-slate-500 font-semibold tabular-nums">Trang 1/1</span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextUnanswered = activeQuestions.find(
                          (q) => !isQuestionAnswered(q, answers[q.id])
                        );
                        if (nextUnanswered) {
                          scrollToQuestion(nextUnanswered.number);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#2563eb] font-bold transition-colors cursor-pointer"
                    >
                      Tiếp theo
                    </button>
                  </div>

                  {/* Primary Action Button */}
                  {!isStarted && !isSubmitted && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handleStartExam}
                        className="w-full py-3 px-4 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wide transition-colors cursor-pointer shadow-md shadow-blue-600/20"
                      >
                        Bắt đầu làm bài
                      </button>
                      {answeredCount > 0 && (
                        <button
                          type="button"
                          onClick={handleSubmitExam}
                          className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors cursor-pointer"
                        >
                          Nộp bài & Xem điểm ({answeredCount}/{exam.questions.length})
                        </button>
                      )}
                    </div>
                  )}

                  {isStarted && !isSubmitted && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
                        <span>Tiến độ làm bài:</span>
                        <strong className="text-slate-800 tabular-nums">
                          {answeredCount} / {exam.questions.length} câu
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={handleSubmitExam}
                        className="w-full py-3 px-4 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wide transition-colors cursor-pointer shadow-md shadow-blue-600/20"
                      >
                        Nộp bài & Xem kết quả ngay
                      </button>
                    </div>
                  )}

                  {isSubmitted && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handleRetakeExam}
                        className="w-full py-3 px-4 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wide transition-colors cursor-pointer shadow-md shadow-blue-600/20"
                      >
                        Làm lại bài thi
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* Fixed Mobile Bottom Action Bar (Thumb Zone for < lg screens) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 flex items-center justify-between gap-2 shadow-lg">
        <button
          type="button"
          onClick={() => setMobilePaletteOpen(true)}
          aria-label="Mở bảng câu hỏi"
          className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <LayoutGrid className="w-4 h-4 text-[#2563eb]" />
          <span className="tabular-nums">
            Câu hỏi ({answeredCount}/{exam.questions.length})
          </span>
        </button>

        {!isSubmitted ? (
          <>
            <button
              type="button"
              onClick={() => {
                const nextUnanswered = activeQuestions.find(
                  (q) => !isQuestionAnswered(q, answers[q.id])
                );
                if (nextUnanswered) {
                  scrollToQuestion(nextUnanswered.number);
                }
              }}
              className="min-h-[42px] px-3 py-2 rounded-xl border border-blue-200 bg-blue-50/70 text-[#2563eb] text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <span>Câu tiếp</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleSubmitExam}
              className="flex-1 min-h-[42px] px-3.5 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-bold uppercase tracking-wide shadow-sm cursor-pointer whitespace-nowrap"
            >
              NỘP BÀI
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleRetakeExam}
            className="flex-1 min-h-[42px] px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wide inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Làm lại đề này</span>
          </button>
        )}
      </div>
    </div>
  );
};
