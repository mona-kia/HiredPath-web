const KEY = "hiredpath_apps_v1";

const rowsEl = document.getElementById("rows");
const modal = document.getElementById("modal");

const qEl = document.getElementById("q");
const statusFilterEl = document.getElementById("statusFilter");

const addBtn = document.getElementById("addBtn");
const exportBtn = document.getElementById("exportBtn");
const cancelBtn = document.getElementById("cancelBtn").addEventListener("click", () => modal.close())

const form = document.getElementById("form");
const modalTitle = document.getElementById("modalTitle");

const companyEl = document.getElementById("company");
const roleEl = document.getElementById("role");
const statusEl = document.getElementById("status");
const dateSubmittedEl = document.getElementById("dateSubmitted");
const jobLinkEl = document.getElementById("jobLink");
const notesEl = document.getElementById("notes");

let editingId = null;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
function save(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

function fmtDate(iso) {
  if (!iso) return "";
  return iso;
}

function matches(item, q, status) {
  const text = (item.company + " " + item.role).toLowerCase();
  const okQ = !q || text.includes(q.toLowerCase());
  const okS = !status || item.status === status;
  return okQ && okS;
}

function render() {
  const items = load();
  const q = qEl.value.trim();
  const st = statusFilterEl.value;

  const filtered = items
    .filter(it => matches(it, q, st))
    .sort((a,b) => (b.dateSubmitted || "").localeCompare(a.dateSubmitted || ""));

  rowsEl.innerHTML = filtered.map(it => `
    <tr>
      <td>${escapeHtml(it.company)}</td>
      <td>${escapeHtml(it.role)}</td>
      <td>${escapeHtml(it.status)}</td>
      <td>${escapeHtml(fmtDate(it.dateSubmitted))}</td>
      <td>${it.jobLink ? `<a href="${it.jobLink}" target="_blank" rel="noreferrer">Link</a>` : ""}</td>
      <td style="white-space:nowrap;">
        <button class="smallBtn" data-edit="${it.id}">Edit</button>
        <button class="smallBtn" data-del="${it.id}">Del</button>
      </td>
    </tr>
  `).join("");
}

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function openAdd() {
  editingId = null;
  modalTitle.textContent = "Add application";
  form.reset();
  statusEl.value = "Applied";
  modal.showModal();
}

function openEdit(id) {
  const items = load();
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
}

function delItem(id) {
  const items = load().filter(x => x.id !== id);
  save(items);
  render();
}

function normalizeUrl(input) {
  if (!input) return "";

  let url = input.trim();
  if (url === "https://") return "";

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

function upsertFromForm() {
  const company = companyEl.value.trim();
  const role = roleEl.value.trim();
  if (!company || !role) return;

  const items = load();
  const payload = {
    id: editingId || uid(),
    company,
    role,
    status: statusEl.value,
    dateSubmitted: dateSubmittedEl.value || "",
    jobLink: jobLinkEl.value.trim(),
    notes: notesEl.value.trim()
  };

  const idx = items.findIndex(x => x.id === payload.id);
  if (idx >= 0) items[idx] = payload;
  else items.push(payload);

  save(items);
  render();
}

function exportCsv() {
  const items = load();
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

function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// events
addBtn.addEventListener("click", openAdd);
exportBtn.addEventListener("click", exportCsv);
qEl.addEventListener("input", render);
statusFilterEl.addEventListener("change", render);

rowsEl.addEventListener("click", (e) => {
  const edit = e.target?.dataset?.edit;
  const del = e.target?.dataset?.del;
  if (edit) openEdit(edit);
  if (del) delItem(del);
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  upsertFromForm();
  modal.close();
});

render();
