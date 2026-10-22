// Executable regression tests for the exact-match reconciliation in index.html.
// Extract the pure matcher from the shipped page rather than testing a copy.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const html = fs.readFileSync("index.html", "utf8");
const begin = html.indexOf("function findAIInCatalog(data) {");
const end = html.indexOf("\nfunction showAutomaticCatalogMatch(", begin);
assert(begin > 0 && end > begin, "AI matcher missing from page");
const source = html.slice(begin, end);
const cards = [
  {card_id:"base",name:"Aaron Civale",year_made:2020,card_number:"223",card_brand:"Topps",sport:"Baseball",card_series:"Topps Series 1",parallel:""},
  {card_id:"gold",name:"Aaron Civale",year_made:2020,card_number:"223",card_brand:"Topps",sport:"Baseball",card_series:"Topps Series 1",parallel:"Gold"},
  {card_id:"other-set",name:"Aaron Civale",year_made:2020,card_number:"223",card_brand:"Topps",sport:"Baseball",card_series:"Topps Chrome",parallel:""}
];
const context = {
  clean: v => String(v ?? "").trim(),
  firstCardValue: (data,...keys) => keys.map(k=>data[k]).find(v=>v!==undefined && v!==null && String(v).trim()!=="") ?? "",
  getSetName: card => card.card_series,
  getAddCardLibraryCards: () => cards,
};
vm.createContext(context);
vm.runInContext(source,context);
const base = {name:"Aaron Civale",year_made:"2020",card_number:"223",card_brand:"Topps",sport:"Baseball",set_name:"2020 Topps Series 1",parallel:""};
const match = data => context.findAIInCatalog(data);
assert.equal(match(base).exact.length,1);
assert.equal(match(base).exact[0].card_id,"base");
assert.equal(match({...base,parallel:"Gold"}).exact[0].card_id,"gold");
assert.equal(match({...base,set_name:"2020 Topps Chrome"}).exact[0].card_id,"other-set");
assert.equal(match({...base,card_number:"224"}).exact.length,0);
assert.equal(match({...base,card_brand:"Panini"}).exact.length,0);
assert.equal(match({...base,card_brand:""}).exact.length,0);
assert.equal(match({...base,parallel:"Silver"}).exact.length,0);
assert.equal(match({...base,parallel:"Silver"}).possible.length,3);
assert.equal(match({...base,year_made:"2021"}).exact.length,0);
console.log("AI catalog reconciliation tests passed");
