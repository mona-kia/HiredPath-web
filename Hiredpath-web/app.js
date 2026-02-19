// app.js
// HiredPath — Local-first job application tracker with optional cloud mode
//
// Features:
// - Local multi-profile support (multiple users on same device, no backend)
// - Two storage modes:
//     • Local mode: jobs in localStorage, files in IndexedDB (device-only)
//     • Cloud mode: jobs synced via /api/jobs (serverless placeholder)
// - Application Snapshot per job (Local mode):
//     • Resume / Cover / Portfolio attachments
//     • Upload, download, replace, remove
// - Table UX:
//     • “Files” dropdown per row to download attachments without opening Edit
// - Profiles:
//     • Create local profiles
//     • Delete local profiles (also removes their stored jobs + local files)
// - Export:
//     • CSV export
//     • PDF export via browser print
//     • ZIP export (Local mode): folders per application + job.json + attachments
//
// Notes:
// - Local mode keeps all data on the user’s device.
// - Cloud mode needs you to implement /api/jobs endpoints (and cloud file storage later).

import {
  putFile,
  getFile,
  listFilesForJob,
  deleteFile,
  deleteFilesForJob,
  deleteFilesForUser
} from "./idb.js";

/** ---------- small helpers ---------- */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}. Check your index.html IDs.`);
  return el;
}
function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}
function fmtDate(iso) { return iso || ""; }
function matches(item, q, status) {
  const text = `${item.company || ""} ${item.role || ""}`.toLowerCase();
  const okQ = !q || text.includes(q.toLowerCase());
  const okS = !status || item.status === status;
  return okQ && okS;
}
function normalizeUrl(input) {
  if (!input) return "";
  let url = input.trim();
  if (!url) return "";
  if (url === "https://" || url === "http://") return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\s+/g, "");
}
function safeFolderName(name) {
  return (name || "application")
    .replace(/[\/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** ---------- constants ---------- */
const APP_KEY_PREFIX = "hp_apps_v1";
const USERS_KEY = "hp_users_v1";

/** ---------- DOM ---------- */
const rowsEl = $("rows");
const modal = $("modal");

const qEl = $("q");
const statusFilterEl = $("statusFilter");

const addBtn = $("addBtn");
const exportCsvBtn = $("exportCsvBtn");
const exportPdfBtn = $("exportPdfBtn");
const exportZipBtn = $("exportZipBtn");

const form = $("form");
const modalTitle = $("modalTitle");

const companyEl = $("company");
const roleEl = $("role");
const statusEl = $("status");
const dateSubmittedEl = $("dateSubmitted");
const jobLinkEl = $("jobLink");
const notesEl = $("notes");

const cancelBtn = $("cancelBtn");

const profileSelect = $("profileSelect");
const newProfileBtn = $("newProfileBtn");
const deleteProfileBtn = $("deleteProfileBtn");
const modeSelect = $("modeSelect");

// file UI (inside modal)
const resumeFile = $("resumeFile");
const coverFile = $("coverFile");
const portfolioFile = $("portfolioFile");

const resumeInfo = $("resumeInfo");
const coverInfo = $("coverInfo");
const portfolioInfo = $("portfolioInfo");

const resumeDownload = $("resumeDownload");
const coverDownload = $("coverDownload");
const portfolioDownload = $("portfolioDownload");

const resumeRemove = $("resumeRemove");
const coverRemove = $("coverRemove");
const portfolioRemove = $("portfolioRemove");

/** ---------- state ---------- */
let editingId = null;

/** ---------- Store adapters (jobs) ---------- */
function storageKeyForUser(userId) {
  return `${APP_KEY_PREFIX}_${userId}`;
}

const localStore = {
  load(userId) {
    try {
      return JSON.parse(localStorage.getItem(storageKeyForUser(userId)) || "[]");
    } catch {
      return [];
    }
  },
  save(userId, items) {
    localStorage.setItem(storageKeyForUser(userId), JSON.stringify(items));
  }
};

const cloudStore = {
  async load(userId) {
    const res = await fetch(`/api/jobs?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`Cloud load failed: ${res.status}`);
    return res.json();
  },
  async save(userId, items) {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, items })
    });
    if (!res.ok) throw new Error(`Cloud save failed: ${res.status}`);
  }
};

function currentUserId() {
  return profileSelect.value || "default";
}
function currentMode() {
  return modeSelect.value || "local";
}
function getStore() {
  return currentMode() === "cloud" ? cloudStore : localStore;
}

async function loadItems() {
  const store = getStore();
  const userId = currentUserId();
  const items = await Promise.resolve(store.load(userId));
  return Array.isArray(items) ? items : [];
}
async function saveItems(items) {
  const store = getStore();
  const userId = currentUserId();
  await Promise.resolve(store.save(userId, items));
}

/** ---------- Profiles ---------- */
function loadUsers() {
  try {
    const u = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    if (Array.isArray(u) && u.length) return u;
  } catch {}
  const initial = [{ id: "default", name: "Default" }];
  localStorage.setItem(USERS_KEY, JSON.stringify(initial));
  return initial;
}
function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
function populateProfileSelect() {
  const users = loadUsers();
  profileSelect.innerHTML = users
    .map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`)
    .join("");
  if (!profileSelect.value) profileSelect.value = users[0]?.id || "default";
}

async function createProfile() {
  const name = prompt("New profile name (local-only):");
  if (!name) return;

  const users = loadUsers();
  const id = `u_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
  users.push({ id, name: name.trim().slice(0, 40) });
  saveUsers(users);

  populateProfileSelect();
  profileSelect.value = id;

  await render();
}

async function deleteCurrentProfile() {
  const userId = currentUserId();
  if (userId === "default") {
    alert("You can’t delete the Default profile.");
    return;
  }

  const users = loadUsers();
  const u = users.find(x => x.id === userId);
  const ok = confirm(`Delete profile "${u?.name || userId}"?\n\nThis removes local jobs + local files for this profile.`);
  if (!ok) return;

  // remove jobs
  localStorage.removeItem(storageKeyForUser(userId));

  // remove files from IndexedDB (best effort)
  try {
    await deleteFilesForUser({ userId });
  } catch (e) {
    console.warn("Could not delete IndexedDB files for user:", e);
  }

  // remove from user list
  const nextUsers = users.filter(x => x.id !== userId);
  saveUsers(nextUsers);

  populateProfileSelect();
  profileSelect.value = nextUsers[0]?.id || "default";
  await render();
}

/** ---------- Modal controls ---------- */
function closeModal() {
  try { modal.close(); } catch {}
  editingId = null;
}

cancelBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

jobLinkEl.addEventListener("focus", () => {
  if (!jobLinkEl.value) jobLinkEl.value = "https://";
});
jobLinkEl.addEventListener("blur", () => {
  if (jobLinkEl.value.trim() === "https://") jobLinkEl.value = "";
});

/** ---------- Files (IndexedDB) ---------- */
function setFileInfo(el, record) {
  if (!record) {
    el.textContent = "None uploaded";
    return;
  }
  const d = new Date(record.uploadedAt);
  el.textContent = `${record.filename} • ${d.toLocaleDateString()}`;
}

function downloadRecord(record) {
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = record.filename || "file";
  a.click();
  URL.revokeObjectURL(url);
}

async function refreshFilePanel(jobId) {
  const userId = currentUserId();
  const [r, c, p] = await Promise.all([
    getFile({ userId, jobId, type: "resume" }),
    getFile({ userId, jobId, type: "cover" }),
    getFile({ userId, jobId, type: "portfolio" })
  ]);

  setFileInfo(resumeInfo, r);
  setFileInfo(coverInfo, c);
  setFileInfo(portfolioInfo, p);

  resumeDownload.disabled = !r;
  coverDownload.disabled = !c;
  portfolioDownload.disabled = !p;

  resumeRemove.disabled = !r;
  coverRemove.disabled = !c;
  portfolioRemove.disabled = !p;
}

async function handleUpload(type, file) {
  if (!file || !editingId) return;
  if (currentMode() !== "local") {
    alert("File uploads are local-only for now. Switch to Local mode.");
    return;
  }
  await putFile({ userId: currentUserId(), jobId: editingId, type, file });
  await refreshFilePanel(editingId);
}

resumeFile.addEventListener("change", (e) => handleUpload("resume", e.target.files?.[0]));
coverFile.addEventListener("change", (e) => handleUpload("cover", e.target.files?.[0]));
portfolioFile.addEventListener("change", (e) => handleUpload("portfolio", e.target.files?.[0]));

resumeDownload.addEventListener("click", async () => {
  const rec = await getFile({ userId: currentUserId(), jobId: editingId, type: "resume" });
  if (rec) downloadRecord(rec);
});
coverDownload.addEventListener("click", async () => {
  const rec = await getFile({ userId: currentUserId(), jobId: editingId, type: "cover" });
  if (rec) downloadRecord(rec);
});
portfolioDownload.addEventListener("click", async () => {
  const rec = await getFile({ userId: currentUserId(), jobId: editingId, type: "portfolio" });
  if (rec) downloadRecord(rec);
});

resumeRemove.addEventListener("click", async () => {
  await deleteFile({ userId: currentUserId(), jobId: editingId, type: "resume" });
  await refreshFilePanel(editingId);
});
coverRemove.addEventListener("click", async () => {
  await deleteFile({ userId: currentUserId(), jobId: editingId, type: "cover" });
  await refreshFilePanel(editingId);
});
portfolioRemove.addEventListener("click", async () => {
  await deleteFile({ userId: currentUserId(), jobId: editingId, type: "portfolio" });
  await refreshFilePanel(editingId);
});

/** ---------- Render (table + per-row files dropdown) ---------- */
let openFilesMenuJobId = null;

function renderFilesMenu(files, jobId) {
  if (!files.length) {
    return `<div class="filesMenu" data-menu="${escapeHtml(jobId)}">
      <div class="muted">No files uploaded</div>
    </div>`;
  }

  const rows = files.map(f => {
    const label = f.type === "resume" ? "Resume" : f.type === "cover" ? "Cover" : "Portfolio";
    return `
      <button type="button" class="smallBtn" data-file-dl="${escapeHtml(jobId)}|${escapeHtml(f.type)}">
        <span class="filesTag">${label}:</span> ${escapeHtml(f.filename)}
      </button>
    `;
  }).join("");

  return `<div class="filesMenu" data-menu="${escapeHtml(jobId)}">${rows}</div>`;
}

async function hydrateFilesDropdowns(items) {
  if (currentMode() !== "local") return;

  const userId = currentUserId();
  // For each row placeholder, fetch files and fill menu
  await Promise.all(items.map(async (it) => {
    const cell = document.querySelector(`[data-files-cell="${CSS.escape(it.id)}"]`);
    if (!cell) return;
    const files = await listFilesForJob({ userId, jobId: it.id });
    cell.dataset.filesCount = String(files.length);
    cell.querySelector(`[data-files-btn="${CSS.escape(it.id)}"]`)?.setAttribute(
      "aria-label",
      files.length ? `Files (${files.length})` : "Files (0)"
    );
    const menuWrap = cell.querySelector(`[data-files-menu-wrap="${CSS.escape(it.id)}"]`);
    if (menuWrap) {
      menuWrap.innerHTML = (openFilesMenuJobId === it.id) ? renderFilesMenu(files, it.id) : "";
    }
  }));
}

async function render() {
  let items = [];
  try {
    items = await loadItems();
  } catch (err) {
    console.error(err);
    rowsEl.innerHTML = `<tr><td colspan="8">Cloud mode error. Switch to Local-only or set up /api/jobs.</td></tr>`;
    return;
  }

  const q = qEl.value.trim();
  const st = statusFilterEl.value;

  const filtered = items
    .filter(it => matches(it, q, st))
    .sort((a,b) => (b.dateSubmitted || "").localeCompare(a.dateSubmitted || ""));

  rowsEl.innerHTML = filtered.map(it => {
    const url = normalizeUrl(it.jobLink);
    return `
      <tr>
        <td>${escapeHtml(it.company)}</td>
        <td>${escapeHtml(it.role)}</td>
        <td>${escapeHtml(it.status)}</td>
        <td>${escapeHtml(fmtDate(it.dateSubmitted))}</td>
        <td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Link</a>` : ""}</td>
        <td>${escapeHtml(it.notes || "")}</td>

        <td class="filesCell" data-files-cell="${escapeHtml(it.id)}">
          <button type="button" class="filesBtn smallBtn" data-files-btn="${escapeHtml(it.id)}">📎 Files</button>
          <div data-files-menu-wrap="${escapeHtml(it.id)}"></div>
        </td>

        <td class="actionsCell" style="white-space:nowrap;">
          <button class="smallBtn" data-edit="${escapeHtml(it.id)}">Edit</button>
          <button class="smallBtn" data-del="${escapeHtml(it.id)}">Del</button>
        </td>
      </tr>
    `;
  }).join("");

  if (!filtered.length) {
    rowsEl.innerHTML = `<tr><td colspan="8" class="muted">No results yet.</td></tr>`;
    return;
  }

  await hydrateFilesDropdowns(filtered);
}

/** ---------- Mutations ---------- */
async function delItem(id) {
  const items = await loadItems();
  const next = items.filter(x => x.id !== id);
  await saveItems(next);

  if (currentMode() === "local") {
    try { await deleteFilesForJob({ userId: currentUserId(), jobId: id }); } catch {}
  }

  await render();
}

async function openAdd() {
  editingId = uid(); // create id now so file attachments can bind to it
  modalTitle.textContent = "Add application";
  form.reset();
  statusEl.value = "Applied";
  modal.showModal();
  companyEl.focus();
  await refreshFilePanel(editingId);
}

async function openEdit(id) {
  const items = await loadItems();
  const it = items.find(x => x.id === id);
  if (!it) return;

  editingId = id;
  modalTitle.textContent = "Edit application";
  companyEl.value = it.company || "";
  roleEl.value = it.role || "";
  statusEl.value = it.status || "Applied";
  dateSubmittedEl.value = it.dateSubmitted || "";
  jobLinkEl.value = it.jobLink || "";
  notesEl.value = it.notes || "";

  modal.showModal();
  companyEl.focus();
  await refreshFilePanel(editingId);
}

async function upsertFromForm() {
  const company = companyEl.value.trim();
  const role = roleEl.value.trim();
  if (!company || !role) return;

  const items = await loadItems();
  const payload = {
    id: editingId || uid(),
    company,
    role,
    status: statusEl.value,
    dateSubmitted: dateSubmittedEl.value || "",
    jobLink: normalizeUrl(jobLinkEl.value),
    notes: notesEl.value.trim()
  };

  const idx = items.findIndex(x => x.id === payload.id);
  if (idx >= 0) items[idx] = payload;
  else items.push(payload);

  await saveItems(items);
  await render();
}

/** ---------- Export ---------- */
function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportCsv() {
  const items = await loadItems();
  const headers = ["Company","Role","Status","DateSubmitted","JobLink","Notes"];
  const lines = [
    headers.join(","),
    ...items.map(it => [
      it.company, it.role, it.status, it.dateSubmitted, it.jobLink, it.notes
    ].map(csvCell).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hiredpath-applications.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function exportPdf() {
  await render();
  window.print();
}

async function exportProfileZip() {
  if (currentMode() !== "local") {
    alert("ZIP export currently works in Local mode (files are stored locally).");
    return;
  }
  if (!window.JSZip) {
    alert("JSZip not loaded. Make sure the JSZip <script> is included in index.html.");
    return;
  }

  const userId = currentUserId();
  const items = await loadItems();

  const zip = new JSZip();
  const profileFolder = zip.folder(`hiredpath-profile-${userId}`) || zip;

  // Summary CSV too
  const headers = ["Company","Role","Status","DateSubmitted","JobLink","Notes"];
  const lines = [
    headers.join(","),
    ...items.map(it => [
      it.company, it.role, it.status, it.dateSubmitted, it.jobLink, it.notes
    ].map(csvCell).join(","))
  ];
  profileFolder.file("applications.csv", lines.join("\n"));

  for (const it of items) {
    const folderName = safeFolderName(`${it.company || "Company"} — ${it.role || "Role"}`);
    const f = profileFolder.folder(folderName);

    f.file("job.json", JSON.stringify(it, null, 2));

    const files = await listFilesForJob({ userId, jobId: it.id });
    for (const rec of files) {
      // rec.blob is a Blob
      const label = rec.type === "resume" ? "resume" : rec.type === "cover" ? "cover-letter" : "portfolio";
      const ext = rec.filename?.split(".").pop();
      const outName = ext ? `${label}.${ext}` : rec.filename || label;
      f.file(outName, rec.blob);
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hiredpath-profile-${userId}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

/** ---------- Events ---------- */
addBtn.addEventListener("click", openAdd);
exportCsvBtn.addEventListener("click", exportCsv);
exportPdfBtn.addEventListener("click", exportPdf);
exportZipBtn.addEventListener("click", exportProfileZip);

qEl.addEventListener("input", render);
statusFilterEl.addEventListener("change", render);

rowsEl.addEventListener("click", async (e) => {
  const edit = e.target?.dataset?.edit;
  const del = e.target?.dataset?.del;
  const filesBtn = e.target?.dataset?.filesBtn;

  // Files dropdown button
  if (e.target?.dataset?.filesBtn) {
    const jobId = e.target.dataset.filesBtn;
    openFilesMenuJobId = (openFilesMenuJobId === jobId) ? null : jobId;
    await render();
    return;
  }

  // Download from files menu
  const dl = e.target?.dataset?.fileDl;
  if (dl) {
    const [jobId, type] = dl.split("|");
    const rec = await getFile({ userId: currentUserId(), jobId, type });
    if (rec) downloadRecord(rec);
    return;
  }

  if (edit) openEdit(edit);
  if (del) delItem(del);
});

document.addEventListener("click", (e) => {
  // close open files menu if click outside
  if (!openFilesMenuJobId) return;
  const inside = e.target.closest?.(`[data-files-cell="${CSS.escape(openFilesMenuJobId)}"]`);
  if (!inside) {
    openFilesMenuJobId = null;
    render();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await upsertFromForm();
  closeModal();
});

// Profiles + mode
newProfileBtn.addEventListener("click", createProfile);
deleteProfileBtn.addEventListener("click", deleteCurrentProfile);
profileSelect.addEventListener("change", render);
modeSelect.addEventListener("change", render);

/** ---------- Init ---------- */
(async function main() {
  try {
    populateProfileSelect();
    await render();
  } catch (err) {
    console.error(err);
    // Fail loud (so you don’t get “nothing works” silently)
    alert(`HiredPath failed to start: ${err.message}`);
  }
})();