// Regression tests for the shipped AI shared-card set-identity predicate.
// Evaluate the actual filter expression from the Edge Function rather than
// copying business logic into this test.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("supabase/functions/create-identified-card/index.ts", "utf8");
const start = source.indexOf("const matchingSetIds=new Set(");
const end = source.indexOf("\n    const candidates=", start);
assert(start >= 0 && end > start, "Exact set predicate missing");
const predicate = source.slice(start, end)
  .replace("const matchingSetIds=", "globalThis.matchingSetIds=")
  .replace(/\(row:Record<string,unknown>\)/g, "(row)");
const norm = value => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const set = "Topps Series 1", year = 2020, brand = "Topps", series = "Series 1", sportId = "baseball";
const matchingSets = [
  {id:"correct",name:set,year,brand,series,sport_id:sportId},
  {id:"wrong-brand",name:set,year,brand:"Panini",series,sport_id:sportId},
  {id:"wrong-series",name:set,year,brand,series:"Chrome",sport_id:sportId},
  {id:"wrong-sport",name:set,year,brand,series,sport_id:"football"},
  {id:"wrong-name",name:"Topps Update",year,brand,series,sport_id:sportId}
];
const context = {matchingSets,norm,set,brand,series,sportId};
vm.createContext(context);
vm.runInContext(predicate,context);
assert.deepEqual(Array.from(context.matchingSetIds),["correct"]);
console.log("AI shared-card set identity regression tests passed");
