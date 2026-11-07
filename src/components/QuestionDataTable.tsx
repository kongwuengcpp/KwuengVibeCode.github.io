import React, { useState } from 'react';
import {
  Table2,
  Plus,
  Trash2,
  ArrowLeftRight,
  ClipboardPaste,
  Sparkles,
  X,
} from 'lucide-react';
import { QuestionTableData } from '../types/exam';
import {
  formatTableToMarkdown,
  parseRawTableText,
  transposeTableData,
} from '../utils/examParser';

interface QuestionDataTableProps {
  tableData?: QuestionTableData;
  className?: string;
}

function isNumericLookingCell(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  return /^-?\d+(?:[.,]\d+)?(?:\s*%|\s*nghìn|\s*triệu|\s*tỉ)?$/i.test(trimmed);
}

/**
 * Renders a formatted Bảng số liệu (Data Table) for students taking or reviewing an exam.
 */
export const QuestionDataTable: React.FC<QuestionDataTableProps> = ({
  tableData,
  className = '',
}) => {
  if (
    !tableData ||
    (!tableData.headers?.length && !tableData.rows?.length)
  ) {
    return null;
  }

  const headers = Array.isArray(tableData.headers) ? tableData.headers : [];
  const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
  const colCount = Math.max(
    headers.length,
    ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
    1
  );

  return (
    <div
      className={`my-3 rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden ${className}`}
    >
      {(tableData.title || tableData.unit) && (
        <div className="px-4 py-2.5 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
          {tableData.title ? (
            <div className="text-xs sm:text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <Table2 className="w-4 h-4 text-[#2563eb] shrink-0" />
              <span>{tableData.title}</span>
            </div>
          ) : (
            <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
              <Table2 className="w-3.5 h-3.5 text-[#2563eb] shrink-0" />
              <span>Bảng số liệu</span>
            </div>
          )}

          {tableData.unit && (
            <span className="text-[11px] sm:text-xs font-semibold italic text-slate-600 bg-white px-2.5 py-0.5 rounded-md border border-slate-200/80">
              {tableData.unit}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs sm:text-sm">
          {headers.length > 0 && (
            <thead>
              <tr className="bg-blue-50/70 text-slate-800 border-b border-slate-200">
                {Array.from({ length: colCount }, (_, cIdx) => {
                  const cellText = headers[cIdx] ?? '';
                  return (
                    <th
                      key={cIdx}
                      className={`py-2.5 px-3.5 font-extrabold border-r last:border-r-0 border-slate-200/80 ${
                        cIdx === 0 ? 'text-left' : 'text-center'
                      }`}
                    >
                      {cellText || `Cột ${cIdx + 1}`}
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-slate-200/80">
            {rows.map((row, rIdx) => {
              const safeRow = Array.isArray(row) ? row : [];
              return (
                <tr
                  key={rIdx}
                  className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}
                >
                  {Array.from({ length: colCount }, (_, cIdx) => {
                    const val = safeRow[cIdx] ?? '';
                    const isNum = cIdx > 0 && isNumericLookingCell(val);
                    return (
                      <td
                        key={cIdx}
                        className={`py-2 px-3.5 border-r last:border-r-0 border-slate-200/70 text-slate-800 ${
                          cIdx === 0
                            ? 'font-semibold text-left bg-slate-50/30'
                            : isNum
                            ? 'text-center tabular-nums font-medium'
                            : 'text-center'
                        }`}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {tableData.sourceNote && (
        <div className="px-4 py-1.5 bg-slate-50/70 border-t border-slate-200/70 text-[11px] italic text-slate-500 text-right">
          ({tableData.sourceNote})
        </div>
      )}
    </div>
  );
};

interface QuestionTableEditorProps {
  tableData?: QuestionTableData;
  onChange: (nextTable: QuestionTableData | undefined) => void;
}

/**
 * Interactive editor for creating, pasting (from Excel/Word/Markdown), transposing, and editing Bảng số liệu.
 */
export const QuestionTableEditor: React.FC<QuestionTableEditorProps> = ({
  tableData,
  onChange,
}) => {
  const [pasteBoxOpen, setPasteBoxOpen] = useState<boolean>(false);
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [pasteFeedback, setPasteFeedback] = useState<string>('');

  const handleInitDefaultTable = () => {
    onChange({
      title: 'Bảng số liệu: Tốc độ tăng trưởng GDP giai đoạn 2020 - 2023',
      unit: 'Đơn vị: %',
      headers: ['Năm', '2020', '2021', '2022', '2023'],
      rows: [
        ['Khu vực Nông, lâm, thuỷ sản', '2,68', '3,27', '3,36', '3,83'],
        ['Khu vực Công nghiệp - Xây dựng', '3,98', '3,58', '7,78', '3,74'],
      ],
      sourceNote: 'Nguồn: Niên giám thống kê',
    });
  };

  if (!tableData) {
    return (
      <button
        type="button"
        onClick={handleInitDefaultTable}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50/60 hover:bg-blue-100/70 text-[#2563eb] text-xs font-semibold transition-colors cursor-pointer"
      >
        <Table2 className="w-3.5 h-3.5" />
        <span>Thêm bảng số liệu</span>
      </button>
    );
  }

  const headers =
    Array.isArray(tableData.headers) && tableData.headers.length > 0
      ? tableData.headers
      : ['Tiêu chí', 'Cột 1', 'Cột 2'];
  const rows =
    Array.isArray(tableData.rows) && tableData.rows.length > 0
      ? tableData.rows
      : [['Dòng 1', '', '']];
  const colCount = headers.length;

  const updateHeaderCell = (colIdx: number, val: string) => {
    const nextHeaders = headers.map((h, i) => (i === colIdx ? val : h));
    onChange({
      ...tableData,
      headers: nextHeaders,
      rows,
    });
  };

  const updateRowCell = (rowIdx: number, colIdx: number, val: string) => {
    const nextRows = rows.map((r, rI) => {
      if (rI !== rowIdx) return r;
      const padded = Array.from({ length: colCount }, (_, cI) => r[cI] ?? '');
      padded[colIdx] = val;
      return padded;
    });
    onChange({
      ...tableData,
      headers,
      rows: nextRows,
    });
  };

  const handleAddColumn = () => {
    const nextHeaders = [...headers, `Cột ${colCount + 1}`];
    const nextRows = rows.map((r) => [
      ...Array.from({ length: colCount }, (_, cI) => r[cI] ?? ''),
      '',
    ]);
    onChange({
      ...tableData,
      headers: nextHeaders,
      rows: nextRows,
    });
  };

  const handleRemoveColumn = (colIdx: number) => {
    if (colCount <= 2) return;
    const nextHeaders = headers.filter((_, i) => i !== colIdx);
    const nextRows = rows.map((r) => r.filter((_, i) => i !== colIdx));
    onChange({
      ...tableData,
      headers: nextHeaders,
      rows: nextRows,
    });
  };

  const handleAddRow = () => {
    const emptyRow = Array.from({ length: colCount }, (_, idx) =>
      idx === 0 ? `Chỉ tiêu ${rows.length + 1}` : ''
    );
    onChange({
      ...tableData,
      headers,
      rows: [...rows, emptyRow],
    });
  };

  const handleRemoveRow = (rowIdx: number) => {
    if (rows.length <= 1) return;
    onChange({
      ...tableData,
      headers,
      rows: rows.filter((_, i) => i !== rowIdx),
    });
  };

  const handleTranspose = () => {
    onChange(transposeTableData({ ...tableData, headers, rows }));
  };

  const handleApplyPastedTable = () => {
    const parsed = parseRawTableText(rawPasteText, {
      title: tableData.title,
      unit: tableData.unit,
      sourceNote: tableData.sourceNote,
    });
    if (!parsed) {
      setPasteFeedback(
        'Không nhận diện được bảng. Hãy dán bảng từ Excel/Word (cách nhau bằng Tab) hoặc bảng có dấu | Cột 1 | Cột 2 |.'
      );
      return;
    }
    onChange(parsed);
    setPasteFeedback('');
    setPasteBoxOpen(false);
  };

  return (
    <div className="mt-3 rounded-2xl border border-blue-200/90 bg-blue-50/30 p-3.5 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[#2563eb] uppercase tracking-wide">
          <Table2 className="w-4 h-4" />
          <span>Bảng Số Liệu Đính Kèm Câu Hỏi ({rows.length} dòng × {colCount} cột)</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setRawPasteText(formatTableToMarkdown({ ...tableData, headers, rows }));
              setPasteFeedback('');
              setPasteBoxOpen((prev) => !prev);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 border border-blue-200 text-[#2563eb] text-xs font-bold transition-colors cursor-pointer"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Dán nhanh từ Excel / Word / AI</span>
          </button>

          <button
            type="button"
            onClick={handleTranspose}
            title="Đảo hàng thành cột và ngược lại"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Đảo hàng ↔ cột</span>
          </button>

          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 text-xs font-bold transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xoá bảng</span>
          </button>
        </div>
      </div>

      {pasteBoxOpen && (
        <div className="bg-white rounded-xl border border-blue-200 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#2563eb]" />
              <span>
                Copy bảng từ Excel, Word hoặc kết quả AI (`| Cột 1 | Cột 2 |`) rồi dán vào đây:
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPasteBoxOpen(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            rows={5}
            value={rawPasteText}
            onChange={(e) => setRawPasteText(e.target.value)}
            placeholder={`Bảng số liệu: Diện tích và dân số năm 2024\n(Đơn vị: triệu người)\n| Quốc gia | 2021 | 2022 | 2023 |\n| Việt Nam | 98,5 | 99,5 | 100,3 |\n| Thái Lan | 71,6 | 71,7 | 71,8 |`}
            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
          {pasteFeedback && (
            <p className="text-xs text-rose-600 font-semibold">{pasteFeedback}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPasteBoxOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleApplyPastedTable}
              className="px-3.5 py-1.5 rounded-lg bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
            >
              Áp dụng vào bảng số liệu
            </button>
          </div>
        </div>
      )}

      {/* Metadata fields: Title, Unit, Source */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">
            Tên bảng số liệu (tuỳ chọn)
          </label>
          <input
            type="text"
            value={tableData.title || ''}
            onChange={(e) =>
              onChange({ ...tableData, headers, rows, title: e.target.value })
            }
            placeholder="VD: Bảng 1. Sản lượng lúa giai đoạn 2020-2023"
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">
            Đơn vị tính (tuỳ chọn)
          </label>
          <input
            type="text"
            value={tableData.unit || ''}
            onChange={(e) =>
              onChange({ ...tableData, headers, rows, unit: e.target.value })
            }
            placeholder="VD: Đơn vị: triệu tấn / %"
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">
            Nguồn trích dẫn (tuỳ chọn)
          </label>
          <input
            type="text"
            value={tableData.sourceNote || ''}
            onChange={(e) =>
              onChange({
                ...tableData,
                headers,
                rows,
                sourceNote: e.target.value,
              })
            }
            placeholder="VD: Nguồn: Niên giám thống kê 2024"
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
      </div>

      {/* Editable Grid */}
      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              {headers.map((hText, cIdx) => (
                <th
                  key={cIdx}
                  className="p-1.5 border-r last:border-r-0 border-slate-200 min-w-[110px]"
                >
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={hText}
                      onChange={(e) => updateHeaderCell(cIdx, e.target.value)}
                      placeholder={`Tiêu đề cột ${cIdx + 1}`}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                    />
                    {colCount > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(cIdx)}
                        title={`Xoá cột ${cIdx + 1}`}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-10 p-1 text-center text-slate-400 font-semibold">
                Xoá
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-slate-50/70">
                {Array.from({ length: colCount }, (_, cIdx) => (
                  <td
                    key={cIdx}
                    className="p-1.5 border-r border-slate-200 min-w-[110px]"
                  >
                    <input
                      type="text"
                      value={row[cIdx] ?? ''}
                      onChange={(e) =>
                        updateRowCell(rIdx, cIdx, e.target.value)
                      }
                      placeholder={
                        cIdx === 0 ? `Chỉ tiêu ${rIdx + 1}` : 'Số liệu...'
                      }
                      className={`w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb] ${
                        cIdx === 0 ? 'font-semibold' : 'text-center tabular-nums'
                      }`}
                    />
                  </td>
                ))}
                <td className="p-1 text-center">
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(rIdx)}
                    disabled={rows.length <= 1}
                    title="Xoá dòng này"
                    className="p-1 rounded text-slate-400 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Row / Add Column Footer */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleAddRow}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#2563eb]" />
          <span>Thêm dòng số liệu</span>
        </button>

        <button
          type="button"
          onClick={handleAddColumn}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#2563eb]" />
          <span>Thêm cột</span>
        </button>
      </div>
    </div>
  );
};
