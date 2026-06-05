import"./modulepreload-polyfill-B5Qt9EMX.js";import{p as u,f as r}from"./api-iAbQVvnE.js";const b=document.querySelector("#settings-form"),i=document.querySelector("#save-settings"),L=document.querySelector("#add-folder"),d=document.querySelector("#media-folders"),C=document.querySelector("#settings-status"),q=document.querySelector("#cloud-status"),c=document.querySelector("#connect-cloud"),s=document.querySelector("#sync-cloud"),g=document.querySelector("#cloud-email"),p=document.querySelector("#cloud-password");let o=null;function n(e){C.textContent=e}function l(e){q.textContent=e}function v(e={}){return{id:e.id||`folder-${Date.now()}`,label:e.label||"",path:e.path||"",enabled:e.enabled!==!1,cloudPolicy:e.cloudPolicy||"derivatives"}}function S(){d.innerHTML="";for(const e of o.mediaFolders||[]){const t=document.createElement("div");t.className="folder-row",t.dataset.folderId=e.id,t.innerHTML=`
      <label>
        Label
        <input data-field="label" value="${y(e.label)}" />
      </label>
      <label>
        Folder Path
        <input data-field="path" value="${y(e.path)}" />
      </label>
      <label>
        Cloud Policy
        <select data-field="cloudPolicy">
          <option value="metadata-only">Metadata only</option>
          <option value="derivatives">Thumbnails/previews</option>
          <option value="selected-originals">Selected originals</option>
          <option value="all-originals">All originals</option>
        </select>
      </label>
      <label class="inline-check">
        <input data-field="enabled" type="checkbox" ${e.enabled!==!1?"checked":""} />
        Enabled
      </label>
      <button data-action="remove" type="button">Remove</button>
    `,t.querySelector('[data-field="cloudPolicy"]').value=e.cloudPolicy||"derivatives",d.appendChild(t)}}function y(e){return String(e||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function f(e){o=e;for(const t of b.elements)t.name&&(t.value=o[t.name]||"");S(),o.cloudSession?.email&&(g.value=o.cloudSession.email)}function h(){const e={...o};for(const t of b.elements)t.name&&(e[t.name]=t.value.trim());return e.mediaFolders=Array.from(d.querySelectorAll(".folder-row")).map(t=>{const a=o.mediaFolders.find(k=>k.id===t.dataset.folderId)||{};return v({...a,label:t.querySelector('[data-field="label"]').value.trim(),path:t.querySelector('[data-field="path"]').value.trim(),cloudPolicy:t.querySelector('[data-field="cloudPolicy"]').value,enabled:t.querySelector('[data-field="enabled"]').checked})}),e}async function w(){const[e,t]=await Promise.all([r("/api/desktop/sync-settings"),r("/api/desktop/cloud/status").catch(a=>({error:a.message}))]);f(e.settings),n("Settings loaded."),m(t)}function m(e){if(e?.error){l(e.error);return}if(!e?.configured){l("Book of Life Cloud is not configured for this desktop build.");return}if(!e?.signedIn){l("Sign in to connect this desktop to your Book of Life Cloud library.");return}const t=e.lastCloudSyncAt?` Last sync ${new Date(e.lastCloudSyncAt).toLocaleString()}.`:"";l(`Connected as ${e.email||e.userId}. Library ${e.libraryId||"pending"}. Device ${e.deviceId||"pending"}.${t}`)}i.addEventListener("click",async()=>{try{i.disabled=!0;const e=await u("/api/desktop/sync-settings",{settings:h()});f(e.settings),n(`Saved at ${new Date().toLocaleTimeString()}.`)}catch(e){n(e.message)}finally{i.disabled=!1}});L.addEventListener("click",()=>{o.mediaFolders=[...o.mediaFolders||[],v()],S()});d.addEventListener("click",e=>{const t=e.target.closest('[data-action="remove"]');if(!t)return;t.closest(".folder-row").remove()});c.addEventListener("click",async()=>{try{c.disabled=!0,l("Connecting desktop to Book of Life Cloud...");const e=await u("/api/desktop/cloud/connect",{settings:h(),email:g.value.trim(),password:p.value});p.value="",f(e.settings),m(e.status),n("Cloud connection saved.")}catch(e){l(e.message)}finally{c.disabled=!1}});s.addEventListener("click",async()=>{try{s.disabled=!0,l("Syncing entries with Book of Life Cloud...");const e=await u("/api/desktop/cloud/sync",{}),t=await r("/api/desktop/cloud/status");m(t),n(`Cloud sync complete. Pushed ${e.pushed}, pulled ${e.pulled}.`)}catch(e){l(e.message)}finally{s.disabled=!1}});w().catch(e=>n(e.message));
