// Secure, deduplicated shared-card creation from a reviewed AI identification.
// Unverified AI details are never represented as verified catalog facts.
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown,max=160)=>String(v??"").trim().replace(/\s+/g," ").slice(0,max);
const norm=(v:unknown)=>clean(v).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const key=(...parts:unknown[])=>parts.map(norm).join("|");
const uuid=()=>crypto.randomUUID();
Deno.serve(async request=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(request.method!=="POST")return json({error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token=request.headers.get("Authorization");
  if(!url||!service)return json({error:"Service configuration unavailable"},503);
  if(!token?.startsWith("Bearer "))return json({error:"Sign in required"},401);
  const adminHeaders={apikey:service,Authorization:"Bearer "+service,"Content-Type":"application/json"};
  const get=async(path:string)=>{const r=await fetch(url+"/rest/v1/"+path,{headers:adminHeaders});if(!r.ok)throw Error("Catalog read failed");return await r.json();};
  const post=async(path:string,body:unknown)=>{const r=await fetch(url+"/rest/v1/"+path,{method:"POST",headers:{...adminHeaders,Prefer:"return=representation"},body:JSON.stringify(body)});return {ok:r.ok,status:r.status,rows:r.ok?await r.json():[],detail:r.ok?"":await r.text()};};
  try{
    const auth=await fetch(url+"/auth/v1/user",{headers:{apikey:service,Authorization:token}});
    if(!auth.ok)return json({error:"Invalid session"},401);
    const user=await auth.json();
    const payload=await request.json();
    const card=payload?.card;
    if(!card||typeof card!=="object")return json({error:"Card details required"},400);
    const name=clean(card.name??card.player??card.player_name,120);
    const year=Number(card.year_made??card.year);
    const number=clean(card.card_number??card.number,36);
    const brand=clean(card.card_brand??card.brand,80);
    const set=clean(card.set_name??card.set??card.card_series??card.series,120);
    const series=clean(card.card_series??card.series??set,120);
    const parallel=clean(card.parallel??card.variant_type,80);
    const sport=clean(card.sport,50);
    if(!name||!Number.isInteger(year)||year<1880||year>new Date().getUTCFullYear()+2||!number||!brand||!set||!sport)
      return json({error:"Identification needs player, sport, year, brand, set and card number before a shared card can be created."},422);
    // Rate limit new shared records per account to protect the free database.
    const since=new Date(Date.now()-86400000).toISOString();
    const recent=await get("cards?created_by=eq."+encodeURIComponent(user.id)+"&created_at=gte."+encodeURIComponent(since)+"&select=id&limit=21");
    if(recent.length>=20)return json({error:"Daily new-card limit reached. Try again tomorrow."},429);
    const sports=await get("sports?name=ilike."+encodeURIComponent(sport)+"&select=id,name&limit=30");
    const sportId=sports.find((row:Record<string,unknown>)=>norm(row.name)===norm(sport))?.id??null;
    const existing=await get("cards?year_made=eq."+year+"&card_number=eq."+encodeURIComponent(number)+"&select=*&limit=200");
    const matchingSets=await get("card_sets?name=ilike."+encodeURIComponent(set)+"&select=id,name&limit=100");
    const matchingSetIds=new Set(matchingSets.filter((row:Record<string,unknown>)=>norm(row.name)===norm(set)).map((row:Record<string,unknown>)=>String(row.id)));
    const exact=existing.find((c:Record<string,unknown>)=>norm(c.name)===norm(name)&&norm(c.card_brand)===norm(brand)&&norm(c.card_series)===norm(series)&&norm(c.parallel)===norm(parallel)&&Boolean(c.card_set_id&&matchingSetIds.has(String(c.card_set_id))));
    if(exact)return json({success:true,created:false,card:exact});
    // Create or reuse shared set. Concurrent requests resolve via unique identity_key.
    const setKey=key(set,year,sport,brand,series);
    let sets=await get("card_sets?identity_key=eq."+encodeURIComponent(setKey)+"&select=id&limit=1");
    let setId=sets[0]?.id??null;
    if(!setId){
      const result=await post("card_sets",{name:set,year,brand,series,sport_id:sportId,identity_key:setKey,source:"AI identified (unverified)",verified:false,created_by:user.id});
      if(result.ok)setId=result.rows[0]?.id;
      else {
        sets=await get("card_sets?identity_key=eq."+encodeURIComponent(setKey)+"&select=id&limit=1");
        setId=sets[0]?.id??null;
      }
    }
    const identity=key("ai-card",name,year,brand,set,series,number,parallel,sport);
    const slug="ai-"+identity.replace(/[^a-z0-9]+/g,"-").slice(0,110)+"-"+uuid().slice(0,8);
    const record={card_id:slug,name,card_number:number,card_set_id:setId,sport_id:sportId,year_made:year,card_brand:brand,card_series:series,parallel:parallel||null,identity_key:identity,source:"AI identified (unverified)",verified:false,created_by:user.id};
    const inserted=await post("cards",record);
    if(inserted.ok)return json({success:true,created:true,card:inserted.rows[0]});
    // Identity-key uniqueness is the final concurrency guard.
    const conflict=await get("cards?identity_key=eq."+encodeURIComponent(identity)+"&select=*&limit=1");
    if(conflict[0])return json({success:true,created:false,card:conflict[0]});
    console.error("Card create failed",inserted.status,inserted.detail.slice(0,300));
    return json({error:"Could not save the new shared card. Please try again."},502);
  }catch(error){console.error("create-identified-card",error);return json({error:"Unable to process the identified card."},500);}
});
