"use client";

import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReportStyle } from "@/lib/hayaa/report";

export type ReportSettingsValue = {
  style: ReportStyle | null;
  manufacturer: string;
  maxPerDay: number;
  dateFrom: string;
  dateTo: string;
};

const STYLES = [
  [
    "gaptin",
    "GAPTIN",
    "14 عمود · GLN المخزن · Batch · الرخصة · GLN الصيدلية · التاريخ 10/8/2026",
    "بيتم اضافة الكود المكانى لكل فرع",
  ],
  [
    "averozolid",
    "AVEROZOLID",
    "10 أعمدة · اسم الفرع المورد · بدون GLN · التاريخ 2026/08/14",
    null,
  ],
] as const;

/** Excel export settings shared by the hayaa pages. */
export function ReportSettings({
  value,
  onChange,
}: {
  value: ReportSettingsValue;
  onChange: (patch: Partial<ReportSettingsValue>) => void;
}) {
  const { style, manufacturer, maxPerDay, dateFrom, dateTo } = value;
  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <h2 className="font-semibold">تحميل Excel</h2>

      <div className="space-y-2">
        <p className="text-sm font-medium">1. اختر شكل الشيت</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {STYLES.map(([key, title, desc, note]) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ style: key })}
              className={cn(
                "rounded-lg border-2 border-border p-3 text-start transition-colors hover:bg-muted/40",
                style === key && "border-primary bg-muted/60",
              )}
            >
              <p dir="ltr" className="text-end font-semibold">
                {title}
              </p>
              <p className="text-xs text-muted-foreground">{desc}</p>
              {note && (
                <p className="mt-1.5 text-sm font-bold text-foreground">{note}</p>
              )}
            </button>
          ))}
        </div>
        {!style && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            اختر شكل الشيت قبل التحميل.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="font-medium">الشركة صاحبة المستحضر</span>
          <input
            value={manufacturer}
            onChange={(e) => onChange({ manufacturer: e.target.value })}
            disabled={!style}
            className="h-9 w-full rounded-md border border-border bg-background px-3 disabled:opacity-50"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">من تاريخ</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
            className="h-9 w-full rounded-md border border-border bg-background px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">إلى تاريخ</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
            className="h-9 w-full rounded-md border border-border bg-background px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">أقصى عدد فروع في اليوم</span>
          <input
            type="number"
            min={1}
            value={maxPerDay}
            onChange={(e) => onChange({ maxPerDay: Number(e.target.value) || 1 })}
            className="h-9 w-full rounded-md border border-border bg-background px-3"
          />
        </label>
        <div className="flex items-end text-xs text-muted-foreground sm:col-span-3">
          {dateFrom || dateTo ? (
            <button
              type="button"
              onClick={() => onChange({ dateFrom: "", dateTo: "" })}
              className="underline hover:text-foreground"
            >
              إلغاء الفترة (تحميل كل ما في الملف)
            </button>
          ) : (
            "بدون تحديد فترة = كل التواريخ الموجودة في الملف."
          )}
        </div>
      </div>
    </div>
  );
}

/** Big confirmation banner after a "download all". */
export function DownloadDoneBanner({
  done,
  onClose,
}: {
  done: { count: number; folder: string | null };
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b-2 border-emerald-500 bg-emerald-100 px-4 py-4 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
      <CheckCircle2 className="size-8 shrink-0" />
      <div className="flex-1">
        <p className="text-lg font-bold">
          تم الانتهاء من التحميل — {done.count} ملف
        </p>
        {done.folder && (
          <p className="text-sm">
            تم الحفظ في فولدر:{" "}
            <span dir="auto" className="font-semibold">
              {done.folder}
            </span>
          </p>
        )}
      </div>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
        <X />
      </Button>
    </div>
  );
}
