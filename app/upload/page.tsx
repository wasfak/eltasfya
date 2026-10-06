"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileCode2,
  Loader2,
  Minus,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { matchBranch } from "@/lib/hayaa/branches";
import {
  itemToCard,
  parseMovementHtm,
  type HtmItem,
  type ParsedHtm,
} from "@/lib/hayaa/parseHtm";
import {
  buildReportWorkbook,
  reportRowValues,
  selectReportRows,
} from "@/lib/hayaa/report";
import {
  playChime,
  saveAllReports,
  saveViaBrowser,
  toTsv,
  type Report,
} from "@/lib/hayaa/saveFiles";
import {
  DownloadDoneBanner,
  ReportSettings,
  type ReportSettingsValue,
} from "@/components/hayaa/report-settings";

type State =
  | { status: "idle" }
  | { status: "loading"; file: File; progress: number }
  | { status: "done"; file: File; htm: ParsedHtm; ms: number }
  | { status: "error"; file: File; message: string };

/** How many items the list renders at once (the file can hold thousands). */
const LIST_LIMIT = 200;

function isHtm(file: File): boolean {
  return /\.html?$/i.test(file.name) || file.type === "text/html";
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ISO yyyy-mm-dd → d/m/yyyy. */
function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function itemQty(item: HtmItem): number {
  return item.lines.reduce((s, l) => s + l.qty, 0);
}

/** Item name without Arabic words, price tag or #..# markers. */
function displayName(item: HtmItem): string {
  return item.productName || item.itemName;
}

/** "<code> <product>.xlsx" without characters Windows forbids in names. */
function xlsxName(item: HtmItem): string {
  const name = `${item.code} ${displayName(item)}`;
  return `${name.replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim()}.xlsx`;
}

export default function UploadPage() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [showPicked, setShowPicked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Codes picked for export (in pick order) and the batch typed for each.
  const [picked, setPicked] = useState<string[]>([]);
  const [batches, setBatches] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<ReportSettingsValue>({
    style: null,
    manufacturer: "",
    maxPerDay: 10,
    dateFrom: "",
    dateTo: "",
  });
  const [downloading, setDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState<{
    count: number;
    folder: string | null;
  } | null>(null);
  const [copied, setCopied] = useState<"rows" | "totals" | null>(null);

  // While the banner is up, the tab title says so too (visible from other tabs).
  useEffect(() => {
    if (!downloadDone) return;
    const prev = document.title;
    document.title = `✅ تم التحميل (${downloadDone.count})`;
    return () => {
      document.title = prev;
    };
  }, [downloadDone]);

  async function load(file: File) {
    if (!isHtm(file)) {
      setState({ status: "error", file, message: "الملف ليس htm" });
      return;
    }
    setSelected(null);
    setQuery("");
    clearPicked();
    setDownloadDone(null);
    setState({ status: "loading", file, progress: 0 });
    const started = performance.now();
    try {
      const htm = await parseMovementHtm(file, (progress) =>
        setState({ status: "loading", file, progress }),
      );
      setState({ status: "done", file, htm, ms: performance.now() - started });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ status: "error", file, message });
    }
  }

  const htm = state.status === "done" ? state.htm : null;

  const items = useMemo(() => {
    if (!htm) return [];
    return [...htm.items.values()].sort((a, b) =>
      displayName(a).localeCompare(displayName(b)),
    );
  }, [htm]);

  const selectedItem = selected ? htm?.items.get(selected) ?? null : null;
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  // "Show picked only" switches itself off once nothing is picked.
  const pickedOnly = showPicked && picked.length > 0;

  const filtered = useMemo(() => {
    const base = pickedOnly ? items.filter((i) => pickedSet.has(i.code)) : items;
    const q = query.trim().toUpperCase();
    if (!q) return base;
    return base.filter(
      (i) => i.code.includes(q) || i.itemName.toUpperCase().includes(q),
    );
  }, [items, query, pickedOnly, pickedSet]);

  function clearPicked() {
    setPicked([]);
    setShowPicked(false);
  }

  function togglePick(code: string) {
    setPicked((p) =>
      p.includes(code) ? p.filter((c) => c !== code) : [...p, code],
    );
  }

  /** Each picked code as a hayaa card + the rows that go in its sheet. */
  const exports = useMemo(() => {
    if (!htm) return [];
    const { maxPerDay, dateFrom, dateTo } = settings;
    return picked.flatMap((code) => {
      const item = htm.items.get(code);
      if (!item) return [];
      const batch = batches[code]?.trim() ?? "";
      const card = itemToCard(htm, item, batch);
      const sel = selectReportRows(card, Math.max(1, maxPerDay), {
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      const qty = sel.rows.reduce((s, r) => s + r.movement.qtyOut, 0);
      return [{ item, card, sel, qty, batch }];
    });
  }, [htm, picked, batches, settings]);

  type Export = (typeof exports)[number];

  const downloadable = exports.filter((e) => e.sel.rows.length > 0).length;
  const grandQty = exports.reduce((s, e) => s + e.qty, 0);
  const missingBatch =
    settings.style === "gaptin" &&
    exports.some((e) => e.sel.rows.length > 0 && !e.batch);

  async function buildReport(e: Export): Promise<Report | null> {
    const { style, manufacturer } = settings;
    if (!style || !e.sel.rows.length) return null;
    const buffer = await buildReportWorkbook(e.card, e.sel.rows, {
      style,
      manufacturer,
    });
    return { name: xlsxName(e.item), buffer };
  }

  async function downloadOne(e: Export) {
    const report = await buildReport(e);
    if (report) saveViaBrowser(report.name, report.buffer);
  }

  async function downloadAll() {
    setDownloading(true);
    setDownloadDone(null);
    try {
      const done = await saveAllReports(exports.map((e) => () => buildReport(e)));
      if (done) {
        setDownloadDone(done);
        playChime();
      }
    } finally {
      setDownloading(false);
    }
  }

  async function copyText(text: string, what: "rows" | "totals") {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  }

  /** Every picked code's sheet rows stacked, without the م column. */
  function copyAllRows() {
    const { style, manufacturer } = settings;
    if (!style) return;
    const all = exports.flatMap((e) =>
      reportRowValues(e.card, e.sel.rows, { style, manufacturer }).map((row) =>
        row.slice(1),
      ),
    );
    copyText(toTsv(all), "rows");
  }

  function copyTotals() {
    copyText(
      toTsv(
        exports.map((e) => [
          e.item.code,
          displayName(e.item),
          e.qty,
        ]),
      ),
      "totals",
    );
  }

  const totalsOk =
    htm?.reportTotal != null &&
    Math.abs(htm.docsTotal - htm.reportTotal) < 0.05;

  return (
    <div dir="rtl" className="mx-auto w-full max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">رفع سجل الحركة</h1>
        {state.status !== "idle" && state.status !== "loading" && (
          <Button variant="outline" onClick={() => setState({ status: "idle" })}>
            <X />
            مسح
          </Button>
        )}
      </div>

      {/* Drop zone */}
      {state.status !== "loading" && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) load(file);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:bg-muted/40",
            dragging && "border-primary bg-muted/60",
          )}
        >
          <Upload className="size-8 text-muted-foreground" />
          <p className="font-medium">
            {htm ? "اختر ملف آخر" : "اسحب ملف htm هنا أو اضغط للاختيار"}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".htm,.html,text/html"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) load(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {state.status === "loading" && (
        <div
          role="status"
          className="flex flex-col items-center gap-4 rounded-xl border-2 border-primary/40 bg-muted/40 p-10 text-center"
        >
          <Loader2 className="size-12 animate-spin text-primary" />
          <div className="space-y-1">
            <p className="text-lg font-semibold">
              جاري قراءة الملف... برجاء الانتظار
            </p>
            <p dir="auto" className="text-sm text-muted-foreground">
              {state.file.name}
            </p>
          </div>
          <div className="h-3 w-full max-w-xl overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(state.progress * 100)}%` }}
            />
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {Math.round(state.progress * 100)}%
          </p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {formatSize(state.file.size * state.progress)} من{" "}
            {formatSize(state.file.size)}
          </p>
        </div>
      )}

      {state.status === "error" && (
        <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="size-4" />
          تعذرت قراءة {state.file.name}: {state.message}
        </p>
      )}

      {/* Summary */}
      {state.status === "done" && htm && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            <span dir="auto" className="font-semibold">
              {state.file.name}
            </span>
            <span className="text-sm text-muted-foreground">
              {formatSize(state.file.size)} · قُرئ في {fmt(state.ms / 1000, 1)} ث
            </span>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {[
              ["نوع الحركة", htm.movementType || "—"],
              ["الفترة", `${formatDate(htm.from)} → ${formatDate(htm.to)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {htm.unknownRows === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
              تمت قراءة كل صفوف الملف — لا يوجد صف غير مفهوم.
            </p>
          ) : (
            <div className="space-y-1 text-sm text-red-600 dark:text-red-400">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertCircle className="size-4" />
                {fmt(htm.unknownRows)} صف غير مفهوم — قد تكون بعض الحركات ناقصة.
              </p>
              {htm.unknownSamples.map((vals, i) => (
                <p key={i} dir="auto" className="text-xs">
                  {vals.join(" | ")}
                </p>
              ))}
            </div>
          )}
          {htm.reportTotal != null && (
            <p className="text-xs text-muted-foreground">
              إجمالي التقرير {fmt(htm.reportTotal, 2)}
              {totalsOk
                ? " — مطابق لمجموع المستندات."
                : ` — الفرق عن مجموع المستندات ${fmt(htm.reportTotal - htm.docsTotal, 2)} (من حسابات SofTech نفسها، لا يؤثر على الكميات).`}
            </p>
          )}
        </div>
      )}

      {/* Item picker + detail */}
      {htm && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="rounded-xl border border-border">
            <div className="border-b border-border p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث بالكود أو اسم الصنف"
                  className="h-9 w-full rounded-md border border-border bg-background ps-9 pe-3"
                />
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                {fmt(filtered.length)} صنف
                {filtered.length > LIST_LIMIT &&
                  ` — يظهر أول ${LIST_LIMIT}، اكتب للبحث`}
                {" · "}علّم ✓ على الأصناف المطلوبة في الشيت
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => setShowPicked((v) => !v)}
                  disabled={picked.length === 0}
                  title={
                    pickedOnly ? "عرض كل الأصناف" : "عرض الأصناف المختارة فقط"
                  }
                  className={cn(
                    "rounded-md px-2 py-0.5 transition-colors enabled:hover:bg-background disabled:opacity-60",
                    pickedOnly && "bg-primary text-primary-foreground enabled:hover:bg-primary/90",
                  )}
                >
                  المختار:{" "}
                  <span className="font-semibold tabular-nums">
                    {fmt(picked.length)}
                  </span>{" "}
                  صنف
                  {pickedOnly && " · عرض الكل"}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearPicked}
                  disabled={picked.length === 0}
                >
                  <X />
                  إلغاء تحديد الكل
                </Button>
              </div>
            </div>
            <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
              {filtered.slice(0, LIST_LIMIT).map((item) => (
                <li
                  key={item.code}
                  onClick={() => setSelected(item.code)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                    selected === item.code && "bg-muted/60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={pickedSet.has(item.code)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => togglePick(item.code)}
                    aria-label={`اختيار ${item.code} للتصدير`}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="w-16 shrink-0 tabular-nums font-medium">
                    {item.code}
                  </span>
                  <span dir="ltr" className="min-w-0 flex-1 truncate text-start">
                    {displayName(item)}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {item.lines.length} سطر · {fmt(itemQty(item), 2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border">
            {selectedItem ? (
              <ItemDetail
                item={selectedItem}
                picked={pickedSet.has(selectedItem.code)}
                onTogglePick={() => togglePick(selectedItem.code)}
              />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                اختر صنف لعرض حركاته.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Export of the picked codes */}
      {htm && picked.length > 0 && (
        <>
          <ReportSettings
            value={settings}
            onChange={(p) => setSettings((s) => ({ ...s, ...p }))}
          />

          <div className="rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="text-sm font-medium">
                الأصناف المختارة ({picked.length})
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={clearPicked}>
                  <X />
                  إلغاء الاختيار
                </Button>
                <Button size="sm" variant="outline" onClick={copyTotals}>
                  {copied === "totals" ? <Check /> : <ClipboardCopy />}
                  {copied === "totals" ? "تم النسخ" : "نسخ الإجماليات"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyAllRows}
                  disabled={!settings.style || downloadable === 0}
                  title={
                    !settings.style
                      ? "اختر شكل الشيت أولاً"
                      : "نسخ صفوف كل الأصناف (بدون العناوين) للصق في Google Sheets"
                  }
                >
                  {copied === "rows" ? <Check /> : <ClipboardCopy />}
                  {copied === "rows" ? "تم النسخ" : "نسخ الكل للشيت"}
                </Button>
                <Button
                  size="sm"
                  onClick={downloadAll}
                  disabled={!settings.style || downloadable === 0 || downloading}
                  title={!settings.style ? "اختر شكل الشيت أولاً" : undefined}
                >
                  {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                  {downloading
                    ? "جاري التحميل..."
                    : `تحميل الكل (${downloadable} ملف)`}
                </Button>
              </div>
            </div>
            {downloadDone && (
              <DownloadDoneBanner
                done={downloadDone}
                onClose={() => setDownloadDone(null)}
              />
            )}
            {missingBatch && (
              <p className="border-b border-border px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
                شيت GAPTIN فيه عمود Batch — اكتب الباتش للأصناف الفاضية.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {["م", "الكود", "الصنف", "الباتش", "صفوف في الشيت", "الكمية المباعة", ""].map(
                      (h, i) => (
                        <th
                          key={i}
                          className="whitespace-nowrap border-b border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {exports.map((e, idx) => (
                    <tr
                      key={e.item.code}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums font-medium">
                        {e.item.code}
                      </td>
                      <td className="px-3 py-2">
                        <span dir="ltr">{displayName(e.item)}</span>
                        {e.sel.unmatched.size > 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            غير موجود في ملف الفروع (لن يظهر في الشيت):{" "}
                            {[...e.sel.unmatched]
                              .map(([name, n]) => `${name} (${n})`)
                              .join("، ")}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          dir="ltr"
                          value={batches[e.item.code] ?? ""}
                          onChange={(ev) =>
                            setBatches((b) => ({
                              ...b,
                              [e.item.code]: ev.target.value,
                            }))
                          }
                          placeholder="Batch"
                          className={cn(
                            "h-8 w-32 rounded-md border border-border bg-background px-2 text-center tabular-nums",
                            settings.style === "gaptin" &&
                              !e.batch &&
                              "border-amber-500",
                          )}
                        />
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {e.sel.rows.length}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">
                        {fmt(e.qty, 2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!settings.style || !e.sel.rows.length}
                          onClick={() => downloadOne(e)}
                        >
                          <Download />
                          Excel
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => togglePick(e.item.code)}
                          aria-label={`إزالة ${e.item.code}`}
                        >
                          <X />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/50 font-bold">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-start">
                      الإجمالي
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {fmt(grandQty, 2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ItemDetail({
  item,
  picked,
  onTogglePick,
}: {
  item: HtmItem;
  picked: boolean;
  onTogglePick: () => void;
}) {
  const qty = itemQty(item);
  const unmatched = item.lines.filter(
    (l) => !matchBranch(l.doc.party, l.doc.partyName),
  ).length;

  return (
    <div>
      <div className="space-y-1 border-b border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold tabular-nums">{item.code}</span>
            <span dir="ltr" className="font-semibold">
              {displayName(item)}
            </span>
          </p>
          <Button
            size="sm"
            variant={picked ? "outline" : "default"}
            onClick={onTogglePick}
          >
            {picked ? <Minus /> : <Plus />}
            {picked ? "إزالة من التصدير" : "إضافة للتصدير"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {item.lines.length} حركة · الكمية {fmt(qty, 2)}
          {unmatched > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              · {unmatched} غير موجود في ملف الفروع
            </span>
          )}
        </p>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {["م", "التاريخ", "الوقت", "رقم المستند", "جهة التعامل", "الكمية", "المستخدم"].map(
                (h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border-b border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {item.lines.map((l, idx) => {
              const matched = matchBranch(l.doc.party, l.doc.partyName);
              return (
                <tr
                  key={`${l.doc.docNo}-${idx}`}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                    {idx + 1}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
                    {formatDate(l.doc.docDate)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{l.doc.time}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{l.doc.docNo}</td>
                  <td
                    dir="auto"
                    className={cn(
                      "whitespace-nowrap px-3 py-2",
                      !matched && "text-amber-600 dark:text-amber-400",
                    )}
                    title={matched ? undefined : "غير موجود في ملف الفروع"}
                  >
                    {l.doc.partyArea && (
                      <span className="text-muted-foreground">
                        {l.doc.partyArea} -{" "}
                      </span>
                    )}
                    {l.doc.partyName}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">
                    {fmt(l.qty, 2)}
                  </td>
                  <td dir="ltr" className="px-3 py-2 text-center text-xs text-muted-foreground">
                    {l.doc.user}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
