import { NextResponse } from "next/server";

import {
  itemsOfSupplier,
  listSuppliers,
  loadWinterData,
  searchWinter,
  searchWinterFamilies,
  topOfSupplier,
  topWinter,
} from "@/lib/winter/data";

// GET /api/winter?q=<code or item name>[&family=1][&supplier=<company>]
// GET /api/winter?top=1[&family=1][&supplier=<company>]
// GET /api/winter?supplier=<company>[&family=1]   (no q, no top)
// GET /api/winter?suppliers=1
// Searches last winter's Oct–Dec sales (bundled JSON) by code or name, or
// (top=1) returns the 50 best-selling winter-related items. With family=1,
// every تشغيلات code of a product is merged into one row. supplier=… limits
// everything to one company; on its own it lists that company's best sellers.
// suppliers=1 returns every company name, biggest sellers first.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const data = await loadWinterData();

  if (params.get("suppliers") === "1") {
    return NextResponse.json({ suppliers: listSuppliers(data.items) });
  }

  const q = params.get("q") ?? "";
  const family = params.get("family") === "1";
  const supplier = params.get("supplier") ?? "";
  const items = itemsOfSupplier(data.items, supplier);
  const results =
    params.get("top") === "1"
      ? topWinter(items, family)
      : q.trim()
        ? family
          ? searchWinterFamilies(items, q)
          : searchWinter(items, q)
        : supplier
          ? topOfSupplier(items, family)
          : [];
  return NextResponse.json({ year: data.year, results });
}

export const runtime = "nodejs";
