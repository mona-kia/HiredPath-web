// app.js
// HiredPath - Local-first MVP with:
// - Local multi-profile support (no backend)
// - Optional "cloud" adapter (requires you to implement /api/jobs endpoints)
// - Cancel works + modal closes on backdrop click
// - URL normalization (accepts google.com, www.google.com, https://...)
// - Export CSV + Export PDF (browser print -> Save as PDF)

const APP_KEY_PREFIX = "hp_apps_v1";
const USERS_KEY = "hp_users_v1";

const rowsEl = document.getElementById("rows");
const modal = document.getElementById("modal");

const qEl = document.getElementById("q");
const statusFilterEl = document.getElementById("statusFilter");

const addBtn = document.getElementById("addBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");

const form = document.getElementById("form");
const modalTitle = document.getElementById("modalTitle");

const companyEl = document.getElementById("company");
const roleEl = document.getElementById("role");
const statusEl = document.getElementById("status");
const dateSubmittedEl = document.getElementById("dateSubmitted");
const jobLinkEl = document.getElementById("jobLink");
const notesEl = document.getElementById("notes");

const cancelBtn = document.getElementById("cancelBtn");

const profileSelect = document.getElementById("profileSelect");
const newProfileBtn = document.getElementById("newProfileBtn");
const modeSelect = document.getElementById("modeSelect");

let editingId = null;

// -----------------------------
// Store adapters
// -----------------------------
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

// NOTE: Cloud mode requires you to build endpoints.
// GET  /api/jobs?userId=xxx  -> returns JSON array
// POST /api/jobs            -> accepts { userId, items } (or {userId, data})
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

function getStore(mode) {
  return mode === "cloud" ? cloudStore : localStore;
}

// -----------------------------
// Profiles (local multi-user)
// -----------------------------
function loadUsers() {
  try {
    const u = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    if (Array.isArray(u) && u.length) return u;
  } catch {}
  // default
  const initial = [{ id: "default", name: "Default" }];
  localStorage.setItem(USERS_KEY, JSON.stringify(initial));
  return initial;
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function currentUserId() {
  return profileSelect.value || "default";
}

function currentMode() {
  return modeSelect.value || "local";
}

function populateProfileSelect() {
  const users = loadUsers();
  profileSelect.innerHTML = users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join("");
  if (!profileSelect.value) profileSelect.value = users[0]?.id || "default";
}

function createProfile() {
  const name = prompt("New profile name (local-only):");
  if (!name) return;

  const users = loadUsers();
  const id = `u_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
  users.push({ id, name: name.trim().slice(0, 40) });
  saveUsers(users);
  populateProfileSelect();
  profileSelect.value = id;
  render();
}

// -----------------------------
// Helpers
// -----------------------------
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function fmtDate(iso) {
  return iso || "";
}

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

  // If user left the "https://" hint in there
  if (url === "https://" || url === "http://") return "";

  // If they typed "www.example.com" or "example.com", add https://
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  // Basic cleanup: remove spaces
  url = url.replace(/\s+/g, "");

  return url;
}

function safeOpenUrl(url) {
  const u = normalizeUrl(url);
  if (!u) return "";
  return u;
}

// -----------------------------
// Modal controls
// -----------------------------
function openAdd() {
  editingId = null;
  modalTitle.textContent = "Add application";
  form.reset();
  statusEl.value = "Applied";
  modal.showModal();
  companyEl.focus();
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
}

function closeModal() {
  modal.close();
  editingId = null;
}

cancelBtn.addEventListener("click", closeModal);

// Close on backdrop click (optional UX)
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// Optional: prefill https:// on focus if empty
jobLinkEl.addEventListener("focus", () => {
  if (!jobLinkEl.value) jobLinkEl.value = "https://";
});
jobLinkEl.addEventListener("blur", () => {
  if (jobLinkEl.value.trim() === "https://") jobLinkEl.value = "";
});

// -----------------------------
// Data IO via store adapter
// -----------------------------
async function loadItems() {
  const store = getStore(currentMode());
  const userId = currentUserId();
  const items = store.load ? store.load(userId) : await store.load(userId);
  return Array.isArray(items) ? items : [];
}

async function saveItems(items) {
  const store = getStore(currentMode());
  const userId = currentUserId();
  if (store.save) return store.save(userId, items);
  return store.save(userId, items);
}

// -----------------------------
// Render
// -----------------------------
async function render() {
  let items = [];
  try {
    items = await loadItems();
  } catch (err) {
    // If cloud mode fails, fall back visually
    console.error(err);
    rowsEl.innerHTML = `<tr><td colspan="7">Cloud mode error. Switch back to Local-only or set up /api/jobs.</td></tr>`;
    return;
  }

  const q = qEl.value.trim();
  const st = statusFilterEl.value;

  const filtered = items
    .filter(it => matches(it, q, st))
    .sort((a,b) => (b.dateSubmitted || "").localeCompare(a.dateSubmitted || ""));

  rowsEl.innerHTML = filtered.map(it => {
    const url = safeOpenUrl(it.jobLink);
    return `
      <tr>
        <td>${escapeHtml(it.company)}</td>
        <td>${escapeHtml(it.role)}</td>
        <td>${escapeHtml(it.status)}</td>
        <td>${escapeHtml(fmtDate(it.dateSubmitted))}</td>
        <td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Link</a>` : ""}</td>
        <td>${escapeHtml(it.notes || "")}</td>
        <td class="actionsCell">
          <button class="smallBtn" data-edit="${escapeHtml(it.id)}">Edit</button>
          <button class="smallBtn" data-del="${escapeHtml(it.id)}">Del</button>
        </td>
      </tr>
    `;
  }).join("");

  if (!filtered.length) {
    rowsEl.innerHTML = `<tr><td colspan="7" class="muted">No results yet.</td></tr>`;
  }
}

// -----------------------------
// Mutations
// -----------------------------
async function delItem(id) {
  const items = await loadItems();
  const next = items.filter(x => x.id !== id);
  await saveItems(next);
  await render();
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

// -----------------------------
// Export
// -----------------------------
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
  // Uses print stylesheet (@media print). Browser lets user "Save as PDF".
  // Ensure current filters are reflected on screen before printing.
  await render();
  window.print();
}

// -----------------------------
// Events
// -----------------------------
addBtn.addEventListener("click", openAdd);
exportCsvBtn.addEventListener("click", exportCsv);
exportPdfBtn.addEventListener("click", exportPdf);

qEl.addEventListener("input", render);
statusFilterEl.addEventListener("change", render);

rowsEl.addEventListener("click", (e) => {
  const edit = e.target?.dataset?.edit;
  const del = e.target?.dataset?.del;
  if (edit) openEdit(edit);
  if (del) delItem(del);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await upsertFromForm();
  closeModal();
});

// Profiles + mode
newProfileBtn.addEventListener("click", createProfile);
profileSelect.addEventListener("change", render);
modeSelect.addEventListener("change", render);

// Init
populateProfileSelect();
render();
