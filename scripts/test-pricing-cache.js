// Test the cache decision code extracted from the deployed Edge Function source.
// This does not require paid APIs, Supabase secrets, or network access.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("supabase/functions/refresh-card-price/index.ts", "utf8");
const start = source.indexOf("const freshRows = cacheRows.filter(");
const end = source.indexOf("\n      // Prefer stronger evidence", start);
assert(start !== -1 && end > start, "Pricing cache filter not found");
const extracted = source.slice(start, end)
  .replace("const freshRows =", "globalThis.freshRows =")
  .replace(/\(row: Record<string, any>\)/g, "(row)");
const now = Date.now();
const recent = new Date(now - 60_000).toISOString();
const stale = new Date(now - 48 * 3600_000).toISOString();
const rows = [
  {source:"ebay_active_asking",estimated_value:null,fetched_at:recent},
  {source:"ebay_active_asking",estimated_value:0,fetched_at:recent},
  {source:"ebay_active_asking",estimated_value:"not a number",fetched_at:recent},
  {source:"ebay_active_asking",estimated_value:1.42,fetched_at:stale},
  {source:"unknown",estimated_value:1.42,fetched_at:recent},
  {source:"ebay_active_asking",estimated_value:1.42,fetched_at:recent},
  {source:"cardpricer_reference",estimated_value:2.50,fetched_at:recent}
];
const context = {cacheRows:rows,freshCutoff:now - 24 * 3600_000};
vm.createContext(context);
vm.runInContext(extracted,context);
assert.equal(context.freshRows.length,2,"Only recent, supported, positive valuations may be cached");
assert.equal(context.freshRows[0].estimated_value,1.42);
assert.equal(context.freshRows[1].source,"cardpricer_reference");
console.log("Pricing cache regression tests passed");
