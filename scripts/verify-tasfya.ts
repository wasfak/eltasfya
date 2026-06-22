import { readFileSync } from "fs";
import { DOMParser } from "linkedom";
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;

import { parseHtmlTable } from "../lib/tasfya/parseTable";
import { parseOrder } from "../lib/tasfya/order";
import { parsePurchases } from "../lib/tasfya/purchases";
import { parseStock } from "../lib/tasfya/stock";
import { computeReport } from "../lib/tasfya/report";

const orderFile = process.argv[2] ?? "G:/tasfet_osama/bio.html";
const stockFile = process.argv[3] ?? "C:/SSB9/bio_stock.html";
const purchasesFile = process.argv[4] ?? "G:/tasfet_osama/1.html";

const order = parseOrder(parseHtmlTable(readFileSync(orderFile, "utf-8")));
const stock = parseStock(parseHtmlTable(readFileSync(stockFile, "utf-8")));
const purchases = parsePurchases(parseHtmlTable(readFileSync(purchasesFile, "utf-8")));
const result = computeReport(order, purchases, stock);

console.log("STOCK:", stockFile);
console.log("  items:", stock.items.length, "| distinct codes:", stock.codes.size, "| supplier:", JSON.stringify(stock.supplier));
console.log("  sample:", JSON.stringify(stock.items[0]));
console.log("ORDER #", order.orderNumber, "| items", order.items.length, "| ref", order.referenceDate.toISOString().slice(0,10));
console.log("\nRESULT supplier:", JSON.stringify(result.supplierCompany));
console.log("report rows:", result.report.length, "| received>0:", result.report.filter(r=>r.received>0).length);
console.log("EXTRA items (in stock, purchased, not in order):", result.extraItems.length);
for (const e of result.extraItems.slice(0,12)) {
  console.log("  ", e.code, "| recv", e.received, "| اساسي", e.basicPct, "| بونص", e.bonus, "|", e.name.slice(0,34));
}

console.log("\n--- اسم المورد per item (received>0) ---");
for (const r of result.report.filter(r=>r.received>0).slice(0,8)) {
  console.log("  ", r.code, "| recv", r.received, "| مورد:", r.supplier, "|", r.name.slice(0,24));
}
console.log("\nextra items suppliers:");
for (const e of result.extraItems) console.log("  ", e.code, "| مورد:", e.supplier, "|", e.name.slice(0,24));
