/**
 * Branch lookup — from "الفروع اماكن ورخص وكود مكاني بالعناوين.xlsx".
 * `gln` is the real الكود المكاني, the file's note (خارجي / غير موجود), or "" if blank.
 */
export type Branch = {
  license: string;
  name: string;
  governorate: string;
  gln: string;
  /** العنوان حسب الرخصة. */
  address: string;
};

export const BRANCHES: Branch[] = [
  { license: "1620", name: "الدهشان", governorate: "الدقهليه", gln: "6221388567174", address: "المنصورة ش الجلاء بملك نبيل درويش" },
  { license: "2950", name: "اشرف عرفان", governorate: "الدقهليه", gln: "6221388568812", address: "برج المحافظة امام المحافظة" },
  { license: "12 - 13", name: "المركز الطبى لشركه الدلتا للاسمده والصناعات الكيماويه", governorate: "الدقهليه", gln: "غير موجود", address: "مستشفى السماد الطبي" },
  { license: "3316", name: "حسنى حامد", governorate: "الدقهليه", gln: "6221388159096", address: "24ش الجمهورية امام كلية الحقوق بجوار محل جولي للنظارات" },
  { license: "1039", name: "الخالد الطبيه", governorate: "الدقهليه", gln: "6221388589718", address: "17ش المستشفي العام(علي باشا ابراهيم سابقا)" },
  { license: "6769", name: "سليمان عبد الجليل سليمان الجديده", governorate: "الدقهليه", gln: "6221388161587", address: "تقسيم الضرائب 39 ش عبدالسلام عارف-دقهلية" },
  { license: "139", name: "محمد امين بالمنصوره", governorate: "الدقهليه", gln: "6221388486772", address: "133ش الجمهورية المنصورة ملك/احمد بيومي" },
  { license: "479", name: "الطرشوبى بورسعيد", governorate: "الدقهليه", gln: "", address: "ش بورسعيد تقاطع صبري عبدالقادر-المنصورة" },
  { license: "1554", name: "هشام الطرشوبى", governorate: "الدقهليه", gln: "6221388158044", address: "ش بنك مصر" },
  { license: "2767", name: "فاطمه رضوان", governorate: "الدقهليه", gln: "6221388602318", address: "ش الترعة وشارع رقم 3- ملك فاروق محمد رضوان" },
  { license: "7611", name: "صيدلية الدكتوره غاده محمد ابراهيم", governorate: "الدقهليه", gln: "6221388603636", address: "14تقسيم غنام-ش الجمهورية-برج الامراء-طلخا" },
  { license: "1209", name: "حال", governorate: "الدقهليه", gln: "6221388920603", address: "المنزلة دقهلية" },
  { license: "551", name: "عبد اللطيف الطرشوبى", governorate: "الدقهليه", gln: "6221388157092", address: "ش الثورة برج الرفاعي" },
  { license: "1439", name: "الفيروز", governorate: "الدقهليه", gln: "6221388523491", address: "ش احمد عرابي بملك الدكتور حسن زكي المعصراوي" },
  { license: "5251", name: "محمود بدوى الجديده", governorate: "الدقهليه", gln: "6221388160801", address: "ش الجيش بجوار بنك القاهرة-المنصورة" },
  { license: "5402", name: "نجلاء عيد", governorate: "الدقهليه", gln: "6221388160870", address: "تقاطع ش قناة السويس مع ش الزهزاي-المنصورة" },
  { license: "1131", name: "ال عبد اللطيف الطرشوبى الجامعه", governorate: "الدقهليه", gln: "6221388157702", address: "ش الجمهورية ناصية جيهان امام مستشفي الرمد" },
  { license: "559", name: "صيدلية حماد بالمنصورة", governorate: "الدقهليه", gln: "6221388602363", address: "ش جيهان السادات والدكتور كمال عبدالرازق-المنصورة" },
  { license: "2690", name: "محمد نصر", governorate: "الدقهليه", gln: "6221388602325", address: "تقاطع شارع الترعة مع ش المدينة المنورة" },
  { license: "2776", name: "البهى", governorate: "الدقهليه", gln: "6221388602257", address: "المنصورة 19ش الخلفاء الراشدين ملك/نهيم البهي السيد" },
  { license: "6992", name: "مصطفى السبع", governorate: "الدقهليه", gln: "6221388161709", address: "العقار رقم 46ش الجيش المنصورة دقهلية ملك/محمد مصطفي حلمي السبع" },
  { license: "277", name: "انجى ابو زيد", governorate: "مدينه بورسعيد", gln: "6221388370842", address: "ش 82 محمد علي تقسيم الجولف برج جوهرة الجولف" },
  { license: "623", name: "دينا ندا", governorate: "مدينه بورسعيد", gln: "6221388371047", address: "ش 23 يوليو وشارع جمصة الاحسان النبوية برج المأمون" },
  { license: "197", name: "بدوى", governorate: "كفر الشيخ", gln: "خارجي", address: "ش الخلفاء الراشدين كفرالشيخ" },
  { license: "1262", name: "احمد خالد العزب", governorate: "دمياط الجديده", gln: "خارجي", address: "دمياط الجديدة-المنطقة الخضراء-قطعة 201جنوبي المجاورة الخامسة-الحي الثامن" },
  { license: "1488", name: "عمرو حواتر", governorate: "دمياط", gln: "خارجي", address: "ميدان الساعة" },
  { license: "730", name: "الطرشوبى", governorate: "دمياط", gln: "خارجي", address: "دمياط ش كورنيش النيل ابراج الصفوة" },
  { license: "511", name: "السعدنى", governorate: "القاهره", gln: "خارجي", address: "طريق النصر عمارات رامو بجوار سيتي ستارز مدينه" },
  { license: "20", name: "محمد موافى", governorate: "القاهره", gln: "خارجي", address: "6ش الشهيد سيد زكريا-شيراتون المطار" },
  { license: "18", name: "مروه حسنى", governorate: "القاهره", gln: "خارجي", address: "محل رقم 400 بجوار مسجد بلال-المركز التجاري المرحلة الاولي-مدينة الرحاب-القاهرة الجديدة" },
  { license: "144", name: "نيفين عرفه", governorate: "القاهره", gln: "خارجي", address: "محل رقم ciib-مركز الخدمات الجنوبي-المنطقة الخدمية-مدينتي-القاهرة الجديدة" },
  { license: "01 - 81", name: "صيدلية دكتور فوده الجديده", governorate: "القاهره", gln: "خارجي", address: "محل رقم a6 المركز التجاري مبني السوق ارابيسك مول مدينتي" },
  { license: "522", name: "تيفولى", governorate: "القاهره", gln: "خارجي", address: "50ش الحرية محل رقم 2 مربع 416 قطعة 7" },
  { license: "8004", name: "محمد ايمن", governorate: "الشيخ زايد", gln: "خارجي", address: "الشيخ زايد-وحدة 415- AW قطعة 29-30-31 اركان مول محور كريزي وتر" },
  { license: "193", name: "مايكل مجدى", governorate: "السويس", gln: "خارجي", address: "18ش محمد يوسف كفر احمد عبده الجديدة السويس" },
  { license: "182", name: "منى يونس", governorate: "السويس", gln: "خارجي", address: "ناصية ش ماهر دابر الليثي كفر شارل الاربعين بالسويس" },
  { license: "1193", name: "فاضل", governorate: "الزقازيق", gln: "خارجي", address: "ش طلبة عويضة" },
  { license: "1396", name: "صيدلية يوسف بالزقازيق", governorate: "الزقازيق", gln: "خارجي", address: "ش الجلاء حي المنتزه" },
  { license: "1435", name: "رنا خليل الجديده", governorate: "الاسماعيليه", gln: "خارجي", address: "42ش الترعة -بجوار مدرسة الشاطئ-بجوار البنك الاهلي-اول الاسماعيلية-الاسماعيلية" },
  { license: "7413", name: "سناء صلاح", governorate: "الدقهليه", gln: "", address: "امتداد ش جيهان-برج الصفوة-المنصورة-دقهلية" },
  { license: "4431", name: "احمد محمود ابراهيم", governorate: "الدقهليه", gln: "6221388160078", address: "اول ش الدراسات متفرع من الجيش" },
  { license: "3485", name: "سامح يحيى الغزالى", governorate: "الدقهليه", gln: "6221388159201", address: "المنصورة كفرالبدماص-25ش الجنايني متفرع من ش الدراسات بملك الحاج/محمد الشبراوي" },
  { license: "41", name: "الطرشوبي للادوية", governorate: "الدقهليه", gln: "", address: "ش رشاد قاسم متفرع من ش الجمهورية امام حي شرق" },
];

/**
 * PDF جهة التعامل → branch license. Learned from past reports by joining
 * their invoice numbers back to the PDFs.
 */
export const PARTY_ALIASES: Record<string, string> = {
  "Hokok -صيدلية حسني حامد": "3316",
  "Khulfaa -محمد نصر السيد": "2690",
  "Kolytadab -فاطمة فاروق رضوان": "2767",
  "derasat 2 - سامح الغزالي": "3485",
  "gish - محمود بدوي": "5251",
  "madenty -صيدلية نيفين عرفه": "144",
  "semad -شركة الدلتا للأسمدة": "12 - 13",
  "أرابيسك-صيدلية ابراهيم فودة": "01 - 81",
  "أول الخلفاء-صيدلية البهي": "2776",
  "اركان-صيدلية محمد ايمن": "8004",
  "الاسماعيليه-رانا علي خليل": "1435",
  "الجامعه-آل عبد اللطيف": "1131",
  "الجلاء-صيدلية الدهشان": "1620",
  "الجمهورية-صيدلية محمد امين": "139",
  "الرحاب-صيدليه مروة حسني": "18",
  "الزعفران-صيدلية سناء صلاح": "7413",
  "السويس-مني يونس فرحات": "182",
  "القوميه-فاضل بالزقازيق": "1193",
  "المحافظه-صيدلية اشرف عرفان": "2950",
  "المستشفى العام-الخالد الطبيه": "1039",
  "المنتزه-صيدلية يوسف": "1396",
  "المنزله-صيدلية حال": "1209",
  "اول مارس-صيدلية عمرو حواتر": "1488",
  "تيفولي-صيدلية تيفولي": "522",
  "دمياط الجديدة-احمد خالد العزب": "1262",
  "دمياط-صيدلية الطرشوبي": "730",
  "رفعت شعبان-صيدلية حماد": "559",
  "شيراتون-محمد موافي": "20",
  "طلخا-غاده محمد ابراهيم": "7611",
  "عبد السلام عارف-سليمان": "6769",
  "فرع الإستاد-مصطفي السبع": "6992",
  "فرع السكة-عبد اللطيف الطرشوبي": "551",
  "فرع بنك مصر-هشام الطرشوبي": "1554",
  "فرع بورسعيد-الطرشوبي بورسعيد": "479",
  "قناة السويس-نجلاء عيد": "5402",
  "كفر الشيخ- صيدلية بدوي": "197",
  "مايكل ماجدى - nasser elnady": "193",
  "مدينة نصر-صيدلية السعدني": "511",
  "مصر للطيران-احمد محمود ابراهيم": "4431",
  "ميت غمر-صيدلية الفيروز": "1439",
  "الجولف-انجي محمد ابو زيد": "277",
  "port said -صيدلية دينا ندا": "623",
};

/**
 * Loose key for comparing names: folds hamza/alef, ta marbuta, alef maksura,
 * and spacing around "-", so small spelling drift still matches.
 */
export function nameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Branches left out of the reports entirely: no rows, no copy, no totals. */
export const EXCLUDED_LICENSES = new Set(["18"]); // الرحاب - مروه حسنى

const byLicense = new Map(BRANCHES.map((b) => [b.license, b]));
const aliasByKey = new Map(
  Object.entries(PARTY_ALIASES).map(([party, lic]) => [nameKey(party), lic]),
);
const byNameKey = new Map(
  BRANCHES.map((b) => [nameKey(b.name.replace(/^صيدلي[هة]\s+/, "")), b]),
);

/** Finds the lookup branch for a PDF جهة التعامل; undefined = unknown. */
export function matchBranch(party: string, partyName: string): Branch | undefined {
  const lic = aliasByKey.get(nameKey(party));
  if (lic) return byLicense.get(lic);
  return byNameKey.get(nameKey(partyName.replace(/^صيدلي[هة]\s+/, "")));
}
