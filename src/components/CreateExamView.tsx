import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FileUp,
  SquarePen,
  FileText,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Save,
  Play,
  ImagePlus,
  X,
  Shuffle,
  Box,
  ArrowLeft,
} from 'lucide-react';
import {
  Exam,
  ExamCategory,
  LIBRARY_SUBJECTS,
  OPTION_KEYS,
  OptionKey,
  Question,
  QuestionType,
  SiteBranding,
  DEFAULT_SITE_BRANDING,
} from '../types/exam';
import {
  getQuestionTrueKeys,
  groupQuestionsIntoSections,
  organizeQuestionsBySection,
  parseExamText,
} from '../utils/examParser';
import { extractTextFromDocxBuffer } from '../utils/docxHelper';

interface AutoResizeTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({
  value,
  className = '',
  onChange,
  ...rest
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(36, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    window.addEventListener('resize', adjustHeight);
    return () => window.removeEventListener('resize', adjustHeight);
  }, [adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        adjustHeight();
      }}
      className={`overflow-hidden resize-none leading-relaxed ${className}`}
      {...rest}
    />
  );
};

interface CreateExamViewProps {
  branding?: SiteBranding;
  editingExam?: Exam | null;
  onSaveExam: (exam: Exam, startImmediately: boolean) => void;
  onCancel: () => void;
}

type DigitizerTab = 'docx' | 'pdf' | 'ocr' | 'text';

function inferSubjectFromText(input: string): ExamCategory | null {
  const s = input.toLowerCase();
  if (/(?:\blịch\s*sử\b|\bsử\b)/.test(s)) return 'Lịch sử';
  if (/(?:\bvật\s*l[ýí]\b|\bl[ýí]\s*1[012]\b)/.test(s)) return 'Vật lí';
  if (/(?:\bhó[aá]\s*học\b|\bhó[aá]\s*1[012]\b)/.test(s)) return 'Hóa học';
  if (/(?:\bsinh\s*học\b|\bsinh\s*1[012]\b)/.test(s)) return 'Sinh học';
  if (/(?:\btoán\b)/.test(s)) return 'Toán';
  if (/(?:\bđịa\s*l[ýí]\b|\bđịa\s*1[012]\b)/.test(s)) return 'Địa lí';
  if (/(?:\btiếng\s*anh\b|\banh\s*văn\b|\benglish\b)/.test(s)) return 'Tiếng Anh';
  if (/(?:\bgdkt|\bkinh\s*tế\s*pháp\s*luật\b|\bgdcd\b)/.test(s)) return 'GDKT & PL';
  if (/(?:\btin\s*học\b|\btin\s*1[012]\b)/.test(s)) return 'Tin học';
  if (/(?:\bcông\s*nghệ\s*nn\b|\bnông\s*nghiệp\b)/.test(s)) return 'Công nghệ NN';
  if (/(?:\bcông\s*nghệ\b)/.test(s)) return 'Công nghệ CN';
  return null;
}

export const CreateExamView: React.FC<CreateExamViewProps> = ({
  branding = DEFAULT_SITE_BRANDING,
  editingExam = null,
  onSaveExam,
  onCancel,
}) => {
  const [mode, setMode] = useState<'digitize' | 'manual'>(
    editingExam ? 'manual' : 'digitize'
  );
  const [activeTab, setActiveTab] = useState<DigitizerTab>('docx');

  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [rawExtractedText, setRawExtractedText] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [digitizeNotice, setDigitizeNotice] = useState<string>('');
  const [digitizeWarnings, setDigitizeWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState<string>(editingExam ? editingExam.title : '');
  const [category, setCategory] = useState<ExamCategory>(
    editingExam ? editingExam.category : 'Lịch sử'
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(
    editingExam ? editingExam.durationMinutes : 45
  );
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(
    editingExam ? Boolean(editingExam.shuffleQuestions) : false
  );
  const [shuffleOptions, setShuffleOptions] = useState<boolean>(
    editingExam ? Boolean(editingExam.shuffleOptions) : false
  );
  const [questions, setQuestions] = useState<Question[]>(
    editingExam
      ? organizeQuestionsBySection(editingExam.questions)
      : [
          {
            id: `q-init-1`,
            number: 1,
            type: 'single',
            text: '',
            options: {
              A: '',
              B: '',
              C: '',
              D: '',
            },
            correctAnswer: 'A',
            explanation: '',
          },
        ]
  );
  const [formError, setFormError] = useState<string>('');

  const handleTitleChangeWithAutoSubject = (nextTitle: string) => {
    setTitle(nextTitle);
    const inferred = inferSubjectFromText(nextTitle);
    if (inferred) {
      setCategory(inferred);
    }
  };

  const handleDocxFileSelect = async (file: File) => {
    setFormError('');
    setDigitizeWarnings([]);
    setIsExtracting(true);
    setSelectedFileName(file.name);

    const cleanName = file.name.replace(/\.(docx|pdf|txt)$/i, '').replace(/[_-]+/g, ' ');
    const inferredFromFile = inferSubjectFromText(cleanName);
    if (inferredFromFile) {
      setCategory(inferredFromFile);
    }

    try {
      if (file.name.toLowerCase().endsWith('.docx')) {
        const buffer = await file.arrayBuffer();
        const text = await extractTextFromDocxBuffer(buffer);
        setRawExtractedText(text);
        const previewParse = parseExamText(text);
        if (!title.trim()) {
          setTitle(cleanName);
        }
        setDigitizeNotice(
          `Đã đọc thành công file Word "${file.name}" (${previewParse.questions.length} câu hỏi: bao gồm Trắc nghiệm, Đúng/Sai nhiều lựa chọn, Điền từ & Hình ảnh). Nhấn "Số hoá ngay" để kiểm tra và lưu đề.`
        );
      } else {
        const text = await file.text();
        setRawExtractedText(text);
        const previewParse = parseExamText(text);
        if (!title.trim()) {
          setTitle(cleanName);
        }
        setDigitizeNotice(
          `Đã đọc tài liệu "${file.name}" (${previewParse.questions.length} câu hỏi). Nhấn "Số hoá ngay" để tiếp tục.`
        );
      }
    } catch {
      setFormError('Không thể đọc file Word (.docx) này. Vui lòng kiểm tra lại định dạng file.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleClearDigitizer = () => {
    setSelectedFileName('');
    setRawExtractedText('');
    setDigitizeNotice('');
    setDigitizeWarnings([]);
    setFormError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRunDigitize = () => {
    setFormError('');
    const sourceText = rawExtractedText.trim();
    if (!sourceText) {
      setFormError(
        activeTab === 'docx'
          ? 'Vui lòng chọn file Word (.docx) trước khi số hoá.'
          : 'Vui lòng nhập hoặc tải nội dung đề thi trước khi số hoá.'
      );
      return;
    }

    const result = parseExamText(sourceText);
    if (result.questions.length === 0) {
      setFormError(
        'Không tìm thấy câu hỏi nào. Hãy đảm bảo đề có định dạng "Câu 1: ...".'
      );
      return;
    }

    setQuestions(organizeQuestionsBySection(result.questions));
    setDigitizeWarnings(result.warnings);
    const nextTitle = title.trim()
      ? title.trim()
      : selectedFileName
      ? selectedFileName.replace(/\.(docx|pdf|txt)$/i, '').replace(/[_-]+/g, ' ')
      : `Đề thi số hoá (${result.questions.length} câu)`;
    setTitle(nextTitle);
    const inferred = inferSubjectFromText(nextTitle) || inferSubjectFromText(sourceText.slice(0, 300));
    if (inferred) {
      setCategory(inferred);
    }
    setMode('manual');
    setDigitizeNotice(
      `Đã trích xuất và phân tách thành công ${result.questions.length} câu hỏi vào từng phần (Trắc nghiệm, Đúng/Sai, Trả lời ngắn). Bạn có thể rà soát lại bên dưới và nhấn Lưu đề thi.`
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddQuestion = (qType: QuestionType = 'single') => {
    const nextNum = questions.length + 1;
    setQuestions((prev) =>
      organizeQuestionsBySection([
        ...prev,
        {
          id: `q-${Date.now()}-${nextNum}`,
          number: nextNum,
          type: qType,
          text: '',
          options: { A: '', B: '', C: '', D: '' },
          correctAnswer: 'A',
          correctAnswers: qType === 'multiple' ? ['A'] : undefined,
          shortAnswer: qType === 'short' ? '' : undefined,
          explanation: '',
        },
      ])
    );
  };

  const handleRemoveQuestion = (index: number) => {
    if (questions.length <= 1) return;
    const next = organizeQuestionsBySection(
      questions.filter((_, idx) => idx !== index)
    );
    setQuestions(next);
  };

  const handleUpdateQuestion = (
    index: number,
    updater: (q: Question) => Question
  ) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === index ? updater(q) : q))
    );
  };

  const handleImageFileUpload = (index: number, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleUpdateQuestion(index, (old) => ({
          ...old,
          imageUrl: reader.result as string,
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSetStatementTrueFalse = (
    index: number,
    key: OptionKey,
    isTrue: boolean
  ) => {
    handleUpdateQuestion(index, (old) => {
      const currentList = getQuestionTrueKeys(old);
      const nextList = isTrue
        ? (Array.from(new Set([...currentList, key])).sort() as OptionKey[])
        : currentList.filter((k) => k !== key);
      return {
        ...old,
        correctAnswer: nextList[0] || 'A',
        correctAnswers: nextList,
      };
    });
  };

  const handleShuffleQuestionsInEditor = (targetSection?: QuestionType) => {
    setQuestions((prev) =>
      organizeQuestionsBySection(prev, {
        shuffleQuestions: true,
        targetSectionToShuffle: targetSection,
      })
    );
    setDigitizeNotice(
      targetSection
        ? 'Đã đảo vị trí câu hỏi trong phần đã chọn (không trộn lẫn sang phần khác).'
        : 'Đã đảo vị trí câu hỏi riêng biệt trong từng phần (Trắc nghiệm, Đúng/Sai, Trả lời ngắn).'
    );
  };

  const handleShuffleOptionsInEditor = (targetSection?: QuestionType) => {
    setQuestions((prev) =>
      organizeQuestionsBySection(prev, {
        shuffleOptions: true,
        targetSectionToShuffle: targetSection,
      })
    );
    setDigitizeNotice(
      'Đã xáo trộn vị trí các đáp án A, B, C, D và tự động cập nhật đáp án đúng tương ứng.'
    );
  };

  const handleFinalSave = (startImmediately: boolean) => {
    setFormError('');
    if (!title.trim()) {
      setFormError('Vui lòng nhập tên đề thi.');
      return;
    }
    if (questions.length === 0) {
      setFormError('Đề thi phải có ít nhất 1 câu hỏi.');
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) {
        setFormError(`Câu ${i + 1} chưa có nội dung câu hỏi.`);
        return;
      }
      if (q.type === 'short' && !(q.shortAnswer || '').trim()) {
        setFormError(`Câu ${i + 1} (Điền từ) chưa có đáp án đúng.`);
        return;
      }
    }

    const now = new Date();
    const formattedDate = `${String(now.getDate()).padStart(2, '0')}/${String(
      now.getMonth() + 1
    ).padStart(2, '0')}/${now.getFullYear()}`;
    const formattedTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const organizedForSave = organizeQuestionsBySection(questions);
    const newExam: Exam = {
      id: editingExam ? editingExam.id : `exam-${Date.now()}`,
      examCode:
        editingExam?.examCode ||
        String(Math.floor(10000 + (Date.now() % 90000))),
      title: title.trim(),
      category,
      durationMinutes: Math.max(1, Number(durationMinutes) || 45),
      createdAt: editingExam ? editingExam.createdAt : formattedDate,
      uploadTime: editingExam?.uploadTime || formattedTime,
      isFavorite: editingExam ? editingExam.isFavorite : false,
      shuffleQuestions,
      shuffleOptions,
      sourceType: selectedFileName.endsWith('.docx') ? 'docx' : 'manual',
      fileName: selectedFileName || editingExam?.fileName,
      questions: organizedForSave.map((q, idx) => {
        const qType: QuestionType = q.type || 'single';
        return {
          ...q,
          number: idx + 1,
          type: qType,
          text: q.text.trim(),
          imageUrl: q.imageUrl?.trim() || undefined,
          options: {
            A: q.options.A.trim() || (qType === 'short' ? '' : 'Phương án A'),
            B: q.options.B.trim() || (qType === 'short' ? '' : 'Phương án B'),
            C: q.options.C.trim() || (qType === 'short' ? '' : 'Phương án C'),
            D: q.options.D.trim() || (qType === 'short' ? '' : 'Phương án D'),
          },
          correctAnswers:
            qType === 'multiple' ? getQuestionTrueKeys(q) : undefined,
          shortAnswer: qType === 'short' ? (q.shortAnswer || '').trim() : undefined,
        };
      }),
    };

    onSaveExam(newExam, startImmediately);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      {/* Top Bar matching Homepage & Thư Viện Đề Thi */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-6 py-2.5 sm:py-3.5 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 border border-blue-100 text-[#2563eb] flex items-center justify-center shrink-0">
              <Box className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-lg font-extrabold text-slate-900 tracking-tight truncate">
                  {editingExam ? 'Chỉnh Sửa Đề Thi' : 'Công Cụ Tạo Đề Thi'}
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-[#2563eb] border border-blue-200 text-[11px] font-bold shrink-0">
                  ADMIN
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium truncate">
                {branding.title} · {branding.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {mode === 'manual' && (
              <>
                <button
                  type="button"
                  onClick={() => handleFinalSave(false)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 text-slate-600" />
                  <span>Lưu đề thi</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFinalSave(true)}
                  className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Lưu & Làm bài ngay</span>
                  <span className="sm:hidden">Lưu đề</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>QUAY LẠI</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 flex-1">
        <div className="flex flex-col lg:flex-row items-start gap-4 sm:gap-6">
          {/* Left Sidebar Navigation */}
          <aside className="w-full lg:w-[290px] shrink-0 bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-4 sm:p-6 shadow-md shadow-slate-200/40 space-y-3.5 sm:space-y-5">
            <div className="hidden lg:block">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-5 bg-[#2563eb] rounded-full" aria-hidden="true" />
                <h2 className="text-base font-extrabold text-slate-900">Chế Độ Tạo Đề</h2>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Chọn phương thức nhập liệu hoặc chỉnh sửa câu hỏi
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 sm:gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setMode('digitize');
                  setFormError('');
                }}
                className={`w-full text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border transition-all flex items-center lg:items-start gap-2.5 sm:gap-3 cursor-pointer ${
                  mode === 'digitize'
                    ? 'bg-blue-50/80 border-blue-200 text-slate-900 shadow-2xs'
                    : 'bg-white border-slate-200/70 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span
                  className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    mode === 'digitize'
                      ? 'bg-[#2563eb] text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <FileUp className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div
                    className={`text-xs sm:text-sm font-bold truncate ${
                      mode === 'digitize' ? 'text-[#2563eb]' : 'text-slate-800'
                    }`}
                  >
                    Số hoá đề cũ
                  </div>
                  <div className="hidden sm:block text-xs text-slate-500 mt-0.5">
                    Trích xuất từ Word (.docx), PDF, văn bản
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('manual');
                  setFormError('');
                }}
                className={`w-full text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border transition-all flex items-center lg:items-start gap-2.5 sm:gap-3 cursor-pointer ${
                  mode === 'manual'
                    ? 'bg-blue-50/80 border-blue-200 text-slate-900 shadow-2xs'
                    : 'bg-white border-slate-200/70 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span
                  className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    mode === 'manual'
                      ? 'bg-[#2563eb] text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <SquarePen className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div
                    className={`text-xs sm:text-sm font-bold truncate ${
                      mode === 'manual' ? 'text-[#2563eb]' : 'text-slate-800'
                    }`}
                  >
                    Tạo thủ công ({questions.length} câu)
                  </div>
                  <div className="hidden sm:block text-xs text-slate-500 mt-0.5">
                    Trắc nghiệm, Đúng/Sai, Điền từ & Ảnh
                  </div>
                </div>
              </button>
            </div>
          </aside>

          {/* Right Main Content Area */}
          <section className="w-full flex-1 bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-md shadow-slate-200/40 p-4 sm:p-8">
            {mode === 'digitize' ? (
              <div>
                <div className="mb-6">
                  <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                    Số hoá đề cũ
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Hỗ trợ trích xuất câu hỏi Trắc nghiệm, Nhiều lựa chọn (Đúng/Sai), Điền từ (Trả lời ngắn) và Hình ảnh từ file Word (.docx)
                  </p>
                </div>

                <div className="border border-slate-200/80 rounded-2xl p-6 space-y-6 bg-slate-50/30">
                  <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 text-sm font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('docx');
                        setFormError('');
                      }}
                      className={`pb-3 border-b-2 transition-colors cursor-pointer ${
                        activeTab === 'docx'
                          ? 'border-[#2563eb] text-[#2563eb]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Word (.docx)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('pdf');
                        setFormError('');
                      }}
                      className={`pb-3 border-b-2 transition-colors cursor-pointer ${
                        activeTab === 'pdf'
                          ? 'border-[#2563eb] text-[#2563eb]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('ocr');
                        setFormError('');
                      }}
                      className={`pb-3 border-b-2 transition-colors cursor-pointer ${
                        activeTab === 'ocr'
                          ? 'border-[#2563eb] text-[#2563eb]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Ảnh OCR
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('text');
                        setFormError('');
                      }}
                      className={`pb-3 border-b-2 transition-colors cursor-pointer ${
                        activeTab === 'text'
                          ? 'border-[#2563eb] text-[#2563eb]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Văn bản
                    </button>
                  </div>

                  {formError && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {digitizeNotice && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#16a34a] shrink-0" />
                      <span>{digitizeNotice}</span>
                    </div>
                  )}

                  {/* Quick Metadata Bar inside Digitize Tab */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-slate-200/80">
                    <div className="md:col-span-2">
                      <label htmlFor="digitize-title-input" className="block text-xs font-bold text-slate-700 mb-1">
                        Tên đề thi (tuỳ chọn - tự động lấy theo tên file)
                      </label>
                      <input
                        id="digitize-title-input"
                        type="text"
                        value={title}
                        onChange={(e) => handleTitleChangeWithAutoSubject(e.target.value)}
                        placeholder="Ví dụ: Đề ôn tập Lịch sử 12 Giữa Kì 1"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      />
                    </div>
                    <div>
                      <label htmlFor="digitize-subject-select" className="block text-xs font-bold text-slate-700 mb-1">
                        Môn học
                      </label>
                      <select
                        id="digitize-subject-select"
                        aria-label="Môn học"
                        value={category}
                        onChange={(e) => setCategory(e.target.value as ExamCategory)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      >
                        {LIBRARY_SUBJECTS.map((subj) => (
                          <option key={subj} value={subj}>
                            {subj}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="digitize-duration-input" className="block text-xs font-bold text-slate-700 mb-1">
                        Thời gian (phút)
                      </label>
                      <input
                        id="digitize-duration-input"
                        type="number"
                        min={1}
                        max={300}
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      />
                    </div>
                  </div>

                  {activeTab === 'docx' && (
                    <div className="space-y-5">
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const dropped = e.dataTransfer.files?.[0];
                          if (dropped) {
                            handleDocxFileSelect(dropped);
                          }
                        }}
                        className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-2xl p-8 sm:p-10 text-center transition-colors bg-white"
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          aria-label="Chọn file Word (.docx)"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleDocxFileSelect(file);
                            }
                          }}
                          className="sr-only"
                        />

                        <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-[#2563eb] flex items-center justify-center mx-auto mb-4">
                          <FileText className="w-8 h-8" />
                        </div>

                        <h3 className="text-base font-bold text-slate-800">
                          Tải lên tài liệu Word (.docx) để số hoá đề thi
                        </h3>
                        <p className="text-xs text-slate-500 mt-1.5 max-w-lg mx-auto">
                          Hỗ trợ trích xuất: Trắc nghiệm 1 lựa chọn, Nhiều lựa chọn (Đúng/Sai - gạch chân/tô đỏ nhiều ý), Điền từ (`Đáp án: ...`) và Hình ảnh đính kèm trong file Word.
                        </p>

                        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isExtracting}
                            className="px-5 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            {isExtracting ? 'Đang đọc file .docx...' : 'Chọn file Word (.docx)'}
                          </button>
                        </div>

                        <p className="text-xs text-slate-400 mt-3">
                          {selectedFileName
                            ? `File đã nạp: ${selectedFileName}`
                            : 'Hoặc kéo và thả file .docx vào đây'}
                        </p>
                      </div>

                      {rawExtractedText && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor="docx-extracted-preview"
                              className="text-xs font-bold text-slate-700"
                            >
                              Nội dung trích xuất từ file Word (.docx):
                            </label>
                            <span className="text-xs text-[#2563eb] font-bold">
                              Phát hiện {parseExamText(rawExtractedText).questions.length} câu hỏi
                            </span>
                          </div>
                          <textarea
                            id="docx-extracted-preview"
                            rows={8}
                            value={rawExtractedText}
                            onChange={(e) => setRawExtractedText(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 p-3.5 text-xs font-mono text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'text' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label htmlFor="raw-exam-text" className="text-xs font-bold text-slate-700">
                          Dán nội dung đề thi (Trắc nghiệm, Đúng/Sai nhiều dấu *, Điền từ) vào bên dưới:
                        </label>
                      </div>
                      <textarea
                        id="raw-exam-text"
                        rows={12}
                        value={rawExtractedText}
                        onChange={(e) => setRawExtractedText(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white p-4 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      />
                    </div>
                  )}

                  {(activeTab === 'pdf' || activeTab === 'ocr') && (
                    <div className="border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center bg-white">
                      <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-[#2563eb] flex items-center justify-center mx-auto mb-4">
                        <FileText className="w-8 h-8" />
                      </div>
                      <h3 className="text-base font-bold text-slate-800">
                        {activeTab === 'pdf'
                          ? 'Tải lên tài liệu PDF để số hoá đề thi'
                          : 'Tải lên ảnh chụp đề thi (OCR) để số hoá'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Khuyên dùng tab <strong>Word (.docx)</strong> để trích xuất chính xác 100% câu hỏi, hình ảnh và đáp án gạch chân.
                      </p>
                      <div className="mt-5 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => setActiveTab('docx')}
                          className="px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
                        >
                          Chuyển sang nhập Word (.docx)
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleClearDigitizer}
                        className="px-4 py-2 rounded-xl border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Xoá
                      </button>
                      <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Quay lại
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleRunDigitize}
                      className="px-5 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      Số hoá ngay
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Manual / Post-Digitization Review & Edit Form */
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                      {editingExam ? 'Chỉnh sửa đề thi' : 'Kiểm tra & Soạn đề thi'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Hỗ trợ Trắc nghiệm 1 lựa chọn, Nhiều lựa chọn (Đúng/Sai), Điền từ (Trả lời ngắn) và câu hỏi có Hình ảnh
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleFinalSave(false)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Lưu đề thi</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFinalSave(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Lưu & Làm bài ngay</span>
                    </button>
                  </div>
                </div>

                {formError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {digitizeNotice && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#16a34a] shrink-0" />
                    <span>{digitizeNotice}</span>
                  </div>
                )}

                {digitizeWarnings.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-xs space-y-1">
                    <div className="font-bold">Lưu ý khi trích xuất:</div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {digitizeWarnings.slice(0, 5).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Exam Metadata & Shuffle Configuration */}
                <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200/80 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                      <label htmlFor="exam-title-input" className="block text-xs font-bold text-slate-700 mb-1">
                        Tên đề thi *
                      </label>
                      <input
                        id="exam-title-input"
                        type="text"
                        value={title}
                        onChange={(e) => handleTitleChangeWithAutoSubject(e.target.value)}
                        placeholder="Ví dụ: Ôn thi TN THPT Thành phố Huế - Đề số 8"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      />
                    </div>

                    <div>
                      <label htmlFor="exam-subject-select" className="block text-xs font-bold text-slate-700 mb-1">
                        Môn học
                      </label>
                      <select
                        id="exam-subject-select"
                        aria-label="Môn học"
                        value={category}
                        onChange={(e) => setCategory(e.target.value as ExamCategory)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      >
                        {LIBRARY_SUBJECTS.map((subj) => (
                          <option key={subj} value={subj}>
                            {subj}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="exam-duration-input" className="block text-xs font-bold text-slate-700 mb-1">
                        Thời gian (phút)
                      </label>
                      <input
                        id="exam-duration-input"
                        type="number"
                        min={1}
                        max={300}
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      />
                    </div>
                  </div>

                  {/* Shuffle Settings & Quick Shuffle Actions */}
                  <div className="pt-3 border-t border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-5">
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shuffleQuestions}
                          onChange={(e) => setShuffleQuestions(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 accent-[#2563eb]"
                        />
                        <span>Tự động xáo trộn câu hỏi khi thi</span>
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shuffleOptions}
                          onChange={(e) => setShuffleOptions(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 accent-[#2563eb]"
                        />
                        <span>Tự động xáo trộn đáp án (A, B, C, D) khi thi</span>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleShuffleQuestionsInEditor()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                      >
                        <Shuffle className="w-3.5 h-3.5 text-[#2563eb]" />
                        <span>Đảo vị trí câu hỏi ngay (theo từng phần)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleShuffleOptionsInEditor()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                      >
                        <Shuffle className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Đảo vị trí đáp án A-D ngay</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Questions Editor Grouped into 3 Separate Sections */}
                <div className="space-y-6">
                  {groupQuestionsIntoSections(questions).map((section) => {
                    const secHeaderStyle =
                      section.type === 'single'
                        ? 'bg-blue-50/70 border-blue-200/80'
                        : section.type === 'multiple'
                        ? 'bg-indigo-50/70 border-indigo-200/80'
                        : 'bg-amber-50/70 border-amber-200/80';

                    const secBadgeStyle =
                      section.type === 'single'
                        ? 'bg-[#2563eb] text-white'
                        : section.type === 'multiple'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-amber-600 text-white';

                    const secBorderStyle =
                      section.type === 'single'
                        ? 'border-blue-200/80'
                        : section.type === 'multiple'
                        ? 'border-indigo-200/80'
                        : 'border-amber-200/80';

                    const addBtnLabel =
                      section.type === 'single'
                        ? 'Thêm câu Trắc nghiệm'
                        : section.type === 'multiple'
                        ? 'Thêm câu Đúng/Sai'
                        : 'Thêm câu Trả lời ngắn';

                    return (
                      <div
                        key={section.type}
                        className={`rounded-2xl border ${secBorderStyle} bg-slate-50/30 overflow-hidden`}
                      >
                        {/* Section Header */}
                        <div
                          className={`px-4 sm:px-5 py-3.5 border-b ${secHeaderStyle} flex flex-wrap items-center justify-between gap-3`}
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold uppercase tracking-wide ${secBadgeStyle}`}
                              >
                                {section.partLabel}
                              </span>
                              <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                                {section.title}
                              </h3>
                              <span className="px-2.5 py-0.5 rounded-lg bg-white border border-slate-200/80 text-xs font-bold text-slate-700 tabular-nums">
                                {section.items.length} câu
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5">
                              {section.description}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {section.items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleShuffleQuestionsInEditor(section.type)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer transition-colors"
                              >
                                <Shuffle className="w-3.5 h-3.5 text-[#2563eb]" />
                                <span>Đảo câu phần này</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleAddQuestion(section.type)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-xs font-bold text-slate-800 cursor-pointer transition-colors shadow-2xs"
                            >
                              <Plus className="w-3.5 h-3.5 text-[#2563eb]" />
                              <span>{addBtnLabel}</span>
                            </button>
                          </div>
                        </div>

                        {/* Section Body */}
                        <div className="p-3.5 sm:p-5 space-y-4">
                          {section.items.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-6 px-4 text-center space-y-2">
                              <p className="text-xs text-slate-500">
                                Chưa có câu hỏi nào trong {section.partLabel} ({section.title}).
                              </p>
                              <button
                                type="button"
                                onClick={() => handleAddQuestion(section.type)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#2563eb] text-xs font-bold cursor-pointer transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>{addBtnLabel}</span>
                              </button>
                            </div>
                          ) : (
                            section.items.map(({ question: q, globalIndex: index, sectionNumber }) => {
                              const qType: QuestionType = q.type || 'single';
                              const multiCorrectList = getQuestionTrueKeys(q);

                              return (
                                <div
                                  key={q.id}
                                  className="rounded-2xl border border-slate-200/90 p-4 sm:p-5 space-y-3.5 bg-white hover:border-slate-300 transition-colors"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2.5">
                                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-extrabold">
                                        Câu {index + 1}
                                      </span>
                                      <span className="text-[11px] font-semibold text-slate-400">
                                        ({section.partLabel} · Câu {sectionNumber})
                                      </span>

                                      {/* Question Type Selector */}
                                      <select
                                        aria-label={`Loại câu hỏi ${index + 1}`}
                                        value={qType}
                                        onChange={(e) => {
                                          const nextType = e.target.value as QuestionType;
                                          setQuestions((prev) =>
                                            organizeQuestionsBySection(
                                              prev.map((item, idx) =>
                                                idx === index
                                                  ? {
                                                      ...item,
                                                      type: nextType,
                                                      correctAnswers:
                                                        nextType === 'multiple'
                                                          ? Array.isArray(item.correctAnswers)
                                                            ? item.correctAnswers
                                                            : [item.correctAnswer]
                                                          : undefined,
                                                      shortAnswer:
                                                        nextType === 'short'
                                                          ? item.shortAnswer || ''
                                                          : undefined,
                                                    }
                                                  : item
                                              )
                                            )
                                          );
                                        }}
                                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                                      >
                                        <option value="single">Trắc nghiệm (1 lựa chọn)</option>
                                        <option value="multiple">Nhiều lựa chọn (Câu hỏi Đúng/Sai)</option>
                                        <option value="short">Điền từ (Trả lời ngắn)</option>
                                      </select>

                            {/* Image Upload Trigger */}
                            <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer transition-colors">
                              <ImagePlus className="w-3.5 h-3.5 text-[#2563eb]" />
                              <span>{q.imageUrl ? 'Đổi ảnh' : 'Thêm ảnh'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                aria-label={`Tải ảnh cho câu ${index + 1}`}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    handleImageFileUpload(index, file);
                                  }
                                }}
                                className="sr-only"
                              />
                            </label>
                          </div>

                          <div className="flex items-center gap-3">
                            {qType === 'single' && (
                              <div className="flex items-center gap-1 text-xs">
                                <span className="text-slate-500 mr-1">Đáp án đúng:</span>
                                {OPTION_KEYS.map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    onClick={() =>
                                      handleUpdateQuestion(index, (old) => ({
                                        ...old,
                                        correctAnswer: k,
                                      }))
                                    }
                                    className={`w-6 h-6 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                                      q.correctAnswer === k
                                        ? 'bg-[#2563eb] text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    {k}
                                  </button>
                                ))}
                              </div>
                            )}

                            {qType === 'multiple' && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="text-slate-500 mr-0.5">Đặt nhanh:</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateQuestion(index, (old) => ({
                                      ...old,
                                      correctAnswer: 'A',
                                      correctAnswers: ['A', 'B', 'C', 'D'],
                                    }))
                                  }
                                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                                    multiCorrectList.length === 4
                                      ? 'bg-[#22c55e] text-white'
                                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                                  }`}
                                >
                                  Toàn Đúng
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateQuestion(index, (old) => ({
                                      ...old,
                                      correctAnswer: 'A',
                                      correctAnswers: [],
                                    }))
                                  }
                                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                                    multiCorrectList.length === 0
                                      ? 'bg-rose-500 text-white'
                                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                                  }`}
                                >
                                  Toàn Sai
                                </button>
                              </div>
                            )}

                            {questions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveQuestion(index)}
                                aria-label={`Xoá câu ${index + 1}`}
                                className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Auto-Expanding Question Prompt Input */}
                        <div>
                          <AutoResizeTextarea
                            aria-label={`Nội dung câu ${index + 1}`}
                            value={q.text}
                            onChange={(e) =>
                              handleUpdateQuestion(index, (old) => ({
                                ...old,
                                text: e.target.value,
                              }))
                            }
                            placeholder={`Nhập nội dung câu hỏi số ${index + 1} (tự động xuống dòng và mở rộng khi câu hỏi dài)...`}
                            className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                          />
                        </div>

                        {/* Image Preview & URL Editor (when image is attached) */}
                        {q.imageUrl && (
                          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-600">
                                Hình ảnh đính kèm câu {index + 1}:
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateQuestion(index, (old) => ({
                                    ...old,
                                    imageUrl: undefined,
                                  }))
                                }
                                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Xoá ảnh</span>
                              </button>
                            </div>
                            <img
                              src={q.imageUrl}
                              alt={`Ảnh câu ${index + 1}`}
                              referrerPolicy="no-referrer"
                              className="max-h-48 rounded-lg border border-slate-200 bg-white p-1 object-contain"
                            />
                          </div>
                        )}

                        {/* Auto-Expanding Options for Single-Choice */}
                        {qType === 'single' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {OPTION_KEYS.map((optKey) => {
                              const isMarkedCorrect = q.correctAnswer === optKey;

                              return (
                                <div key={optKey} className="flex items-start gap-2.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateQuestion(index, (old) => ({
                                        ...old,
                                        correctAnswer: optKey,
                                      }))
                                    }
                                    title={`Chọn ${optKey} làm đáp án đúng`}
                                    className={`w-6 h-6 mt-1.5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                                      isMarkedCorrect
                                        ? 'bg-[#2563eb] text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    {optKey}
                                  </button>
                                  <AutoResizeTextarea
                                    aria-label={`Phương án ${optKey} câu ${index + 1}`}
                                    value={q.options[optKey]}
                                    onChange={(e) =>
                                      handleUpdateQuestion(index, (old) => ({
                                        ...old,
                                        options: {
                                          ...old.options,
                                          [optKey]: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder={`Phương án ${optKey}...`}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Auto-Expanding Options with 2 boxes (Đúng / Sai) for Multiple-Choice (Đúng/Sai) */}
                        {qType === 'multiple' && (
                          <div className="space-y-2.5">
                            <div className="text-xs text-slate-500">
                              Thiết lập đáp án <strong>Đúng</strong> hoặc <strong>Sai</strong> cho từng ý A, B, C, D:
                            </div>
                            {OPTION_KEYS.map((optKey) => {
                              const isMarkedTrue = multiCorrectList.includes(optKey);

                              return (
                                <div
                                  key={optKey}
                                  className="flex flex-col sm:flex-row sm:items-start gap-2.5 p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/40"
                                >
                                  <div className="flex items-start gap-2.5 flex-1">
                                    <span
                                      className={`w-6 h-6 mt-1 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                                        isMarkedTrue
                                          ? 'bg-[#22c55e] text-white'
                                          : 'bg-rose-500 text-white'
                                      }`}
                                    >
                                      {optKey}
                                    </span>
                                    <AutoResizeTextarea
                                      aria-label={`Phương án ${optKey} câu ${index + 1}`}
                                      value={q.options[optKey]}
                                      onChange={(e) =>
                                        handleUpdateQuestion(index, (old) => ({
                                          ...old,
                                          options: {
                                            ...old.options,
                                            [optKey]: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder={`Phát biểu ${optKey} (Đáp án đang chọn: ${isMarkedTrue ? 'ĐÚNG' : 'SAI'})...`}
                                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                                    />
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                                    <button
                                      type="button"
                                      aria-label={`Đặt ý ${optKey} câu ${index + 1} là Đúng`}
                                      aria-pressed={isMarkedTrue}
                                      onClick={() =>
                                        handleSetStatementTrueFalse(index, optKey, true)
                                      }
                                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                        isMarkedTrue
                                          ? 'bg-[#22c55e] border-[#16a34a] text-white shadow-2xs'
                                          : 'bg-white border-slate-200 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'
                                      }`}
                                    >
                                      Đúng
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Đặt ý ${optKey} câu ${index + 1} là Sai`}
                                      aria-pressed={!isMarkedTrue}
                                      onClick={() =>
                                        handleSetStatementTrueFalse(index, optKey, false)
                                      }
                                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                        !isMarkedTrue
                                          ? 'bg-rose-500 border-rose-600 text-white shadow-2xs'
                                          : 'bg-white border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700'
                                      }`}
                                    >
                                      Sai
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {qType === 'short' && (
                          <div className="bg-amber-50/50 border border-amber-200/80 rounded-xl p-3 space-y-1.5">
                            <label className="block text-xs font-bold text-amber-900">
                              Đáp án điền từ / trả lời ngắn (Nếu có nhiều cách viết đúng, ngăn cách bằng dấu chấm phẩy `;`):
                            </label>
                            <AutoResizeTextarea
                              aria-label={`Đáp án điền từ câu ${index + 1}`}
                              value={q.shortAnswer || ''}
                              onChange={(e) =>
                                handleUpdateQuestion(index, (old) => ({
                                  ...old,
                                  shortAnswer: e.target.value,
                                }))
                              }
                              placeholder="Ví dụ: 1995 hoặc Lê-nin; Lênin; Lenin"
                              className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                            />
                          </div>
                        )}

                        {/* Auto-Expanding Explanation Input */}
                        <div>
                          <AutoResizeTextarea
                            aria-label={`Giải thích câu ${index + 1}`}
                            value={q.explanation || ''}
                            onChange={(e) =>
                              handleUpdateQuestion(index, (old) => ({
                                ...old,
                                explanation: e.target.value,
                              }))
                            }
                            placeholder="Lời giải chi tiết (hiển thị sau khi nộp bài - không bắt buộc)..."
                            className="w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddQuestion('single')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Thêm câu Trắc nghiệm</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddQuestion('multiple')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 text-xs font-bold text-indigo-800 transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Thêm câu Đúng/Sai (Nhiều lựa chọn)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddQuestion('short')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 text-xs font-bold text-amber-800 transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Thêm câu Điền từ (Trả lời ngắn)</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={onCancel}
                      className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Huỷ
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFinalSave(false)}
                      className="px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
                    >
                      Lưu đề thi
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFinalSave(true)}
                      className="px-5 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      Lưu & Làm bài ngay
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};
