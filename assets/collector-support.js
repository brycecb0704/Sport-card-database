/* Collector support and moderation UI; database permissions are enforced by RLS/RPC. */
(function () {
  "use strict";
  const safe = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const byId = id => document.getElementById(id);
  const notify = (message,type="info") => typeof showToast === "function" ? showToast(message,type) : alert(message);
  function signedIn() { return typeof currentUser !== "undefined" && !!currentUser?.id; }
  function admin() { return typeof currentProfile !== "undefined" && currentProfile?.role === "admin"; }
  function getCardId() {
    const card = typeof selectedCard === "undefined" ? null : selectedCard;
    if (!card) return null;
    const bridged = typeof getSupabaseCard === "function" ? getSupabaseCard(card.card_id) : null;
    return bridged?.id || (typeof card.id === "string" && /^[0-9a-f-]{36}$/i.test(card.id) ? card.id : null);
  }
  function mount() {
    if (byId("collectorHelpButton")) return;
    const header = document.querySelector(".header-actions");
    if (header) {
      const button = document.createElement("button");
      button.id = "collectorHelpButton";
      button.className = "btn collector-help-trigger";
      button.type = "button";
      button.textContent = "Help & feedback";
      button.addEventListener("click", () => openRequest());
      header.prepend(button);
    }
    const modal = document.createElement("div");
    modal.id = "collectorHelpModal";
    modal.className = "modal-backdrop hidden";
    modal.innerHTML = `<section class="modal collector-support-modal" role="dialog" aria-modal="true" aria-labelledby="collectorHelpTitle">
      <div class="modal-header"><h3 id="collectorHelpTitle">Help improve the collection</h3><button type="button" class="modal-close" id="collectorHelpClose" aria-label="Close">×</button></div>
      <div class="modal-body"><p class="collector-support-intro">Report a bug, request a card correction, or flag a price for review. Your request goes to the admin queue.</p>
      <form id="collectorHelpForm">
      <label for="collectorHelpCategory">Request type</label><select id="collectorHelpCategory" required>
      <option value="bug">Report a bug</option><option value="card_correction">Fix or update a card</option><option value="price_review">Review a card price</option><option value="feature_request">Suggest a feature</option><option value="other">Other feedback</option></select>
      <label for="collectorHelpSubject">Subject</label><input id="collectorHelpSubject" maxlength="160" minlength="3" required placeholder="Briefly describe the issue">
      <label for="collectorHelpDetails">Details</label><textarea id="collectorHelpDetails" maxlength="4000" minlength="3" rows="5" required placeholder="What happened, what should change, or what price evidence should we check?"></textarea>
      <p id="collectorHelpCard" class="muted"></p>
      <button type="submit" class="btn btn-primary" id="collectorHelpSubmit">Send to admin</button></form>
      <div id="collectorAdminQueue" hidden><h3>Admin review queue</h3><div id="collectorAdminItems"></div></div>
      </div></section>`;
    document.body.appendChild(modal);
    byId("collectorHelpClose").addEventListener("click", closeRequest);
    modal.addEventListener("click", event => { if(event.target === modal) closeRequest(); });
    byId("collectorHelpForm").addEventListener("submit", submitRequest);
    const cardFooter = document.querySelector("#cardDetailModal .modal-footer");
    if (cardFooter && !byId("collectorReportCard")) {
      const button = document.createElement("button");
      button.id = "collectorReportCard";
      button.type = "button";
      button.className = "btn";
      button.textContent = "Request card / price review";
      button.addEventListener("click", () => openRequest("card_correction",true));
      cardFooter.prepend(button);
    }
  }
  function openRequest(category="bug",cardContext=false) {
    mount();
    if(!signedIn()) { notify("Sign in to send feedback to the admin.","error"); return; }
    byId("collectorHelpCategory").value=category;
    const cardId=cardContext?getCardId():null;
    byId("collectorHelpModal").dataset.cardId=cardId||"";
    byId("collectorHelpCard").textContent=cardContext
      ? cardId ? "This request will be linked to the selected card." : "Card not linked yet; include its name and number in the details."
      : "";
    byId("collectorHelpModal").classList.remove("hidden");
    byId("collectorHelpModal").classList.add("modal-open");
    if(admin()) { byId("collectorAdminQueue").hidden=false; void loadQueue(); }
    else byId("collectorAdminQueue").hidden=true;
    byId("collectorHelpSubject").focus();
  }
  function closeRequest() { byId("collectorHelpModal")?.classList.add("hidden"); byId("collectorHelpModal")?.classList.remove("modal-open"); }
  async function submitRequest(event) {
    event.preventDefault();
    if(!signedIn()) return notify("Sign in first.","error");
    const button=byId("collectorHelpSubmit");
    button.disabled=true;
    try {
      const cardId=byId("collectorHelpModal").dataset.cardId||null;
      const payload={
        user_id:currentUser.id,
        card_id:cardId,
        category:byId("collectorHelpCategory").value,
        subject:byId("collectorHelpSubject").value.trim(),
        details:byId("collectorHelpDetails").value.trim()
      };
      const {error}=await supabaseClient.from("support_requests").insert(payload);
      if(error) throw error;
      notify("Request sent to admin for review.","success");
      byId("collectorHelpForm").reset();
      closeRequest();
      if(admin()) void loadQueue();
    } catch(error) {
      notify("Could not send request. The admin database migration may not be deployed yet.","error");
      console.error("Support request failed",error);
    } finally {button.disabled=false;}
  }
  async function loadQueue() {
    if(!admin())return;
    const target=byId("collectorAdminItems");
    if(!target)return;
    target.textContent="Loading requests…";
    const {data,error}=await supabaseClient.from("support_requests")
      .select("id,user_id,card_id,category,subject,details,status,admin_note,created_at")
      .order("created_at",{ascending:false}).limit(100);
    if(error){target.textContent="Admin queue unavailable. Check the database migration and permissions.";return;}
    target.innerHTML=(data||[]).map(item=>`<article class="collector-review-item">
      <div class="collector-review-top"><strong>${safe(item.subject)}</strong><span>${safe(item.status)}</span></div>
      <small>${safe(item.category)} · ${safe(new Date(item.created_at).toLocaleString())}</small>
      <p>${safe(item.details)}</p>
      ${item.card_id?`<small>Card UUID: ${safe(item.card_id)}</small>`:""}
      <label>Admin note<textarea data-note="${safe(item.id)}" rows="2">${safe(item.admin_note)}</textarea></label>
      <div class="collector-review-actions">
      <button class="btn" data-status="in_review" data-request="${safe(item.id)}">In review</button>
      <button class="btn" data-status="resolved" data-request="${safe(item.id)}">Resolve</button>
      <button class="btn" data-status="rejected" data-request="${safe(item.id)}">Reject</button>
      ${item.card_id?`<button class="btn" data-verify="${safe(item.card_id)}">Verify card</button><button class="btn" data-edit-card="${safe(item.card_id)}">Edit card</button>`:""}
      </div></article>`).join("") || "<p>No requests yet.</p>";
    target.querySelectorAll("[data-request]").forEach(button=>button.addEventListener("click",async()=>{
      const id=button.dataset.request;
      const note=Array.from(target.querySelectorAll("[data-note]")).find(el=>el.dataset.note===id)?.value||"";
      const {error}=await supabaseClient.from("support_requests").update({status:button.dataset.status,admin_note:note,reviewed_by:currentUser.id,updated_at:new Date().toISOString()}).eq("id",id);
      if(error)return notify(error.message,"error");
      notify("Request updated.","success");void loadQueue();
    }));
    target.querySelectorAll("[data-verify]").forEach(button=>button.addEventListener("click",async()=>{
      if(!confirm("Mark this shared card as admin verified?"))return;
      const {error}=await supabaseClient.rpc("admin_review_card",{p_card_id:button.dataset.verify,p_verified:true});
      if(error)return notify(error.message,"error");
      notify("Card verified. Badge will appear after catalog refresh.","success");
    }));
    target.querySelectorAll("[data-edit-card]").forEach(button=>button.addEventListener("click",async()=>{
      const id=button.dataset.editCard;
      const field=prompt("Which card field? name, card_number, parallel, card_brand, or card_series");
      const fields={name:"p_name",card_number:"p_card_number",parallel:"p_parallel",card_brand:"p_card_brand",card_series:"p_card_series"};
      if(!field||!fields[field])return;
      const value=prompt("New value (review carefully before saving)");
      if(value===null)return;
      const {error}=await supabaseClient.rpc("admin_review_card",{p_card_id:id,[fields[field]]:value});
      if(error)return notify(error.message,"error");
      notify("Shared card updated.","success");
    }));
  }
  window.openCollectorRequest=openRequest;
  window.openCollectorAdminQueue=()=>openRequest("bug",false);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);
  else mount();
})();
