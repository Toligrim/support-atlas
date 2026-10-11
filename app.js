"use strict";

const $ = (selector) => document.querySelector(selector);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const STATUS = {PASS: "Подходит", CONDITIONAL: "Уточнить", UNVERIFIED: "Не проверено", WATCH: "Мониторинг", REJECT: "Отклонено", OUT_OF_SCOPE: "Вне профиля", PIPELINE: "В работе"};
const REMOTE = {yes: "Удалённо", no: "Офис / гибрид", unknown: "Уточнить"};
const EVIDENCE = {employer_original_as_recorded: "Сайт работодателя", mixed_or_employer_channel: "Смешанный / канал работодателя", secondary: "Вторичный источник", secondary_archived: "Вторичный архивный", company_or_service_only: "Компания / сервис", unclassified: "Не классифицирован"};
const CHANNEL = {tickets: "Тикеты", email: "Email", chat: "Чат", phone_mentioned: "Телефон упомянут", no_calls_explicit: "Прямо без звонков", video: "Видеовстречи"};
const FLAGS = {PASS_WITHOUT_EMPLOYER_ORIGINAL: "PASS без первичного источника", REMOTE_NOT_CONFIRMED: "Удалёнка не подтверждена", NON_REMOTE_STATUS_CONFLICT: "Конфликт: офис / гибрид", STATUS_DISAGREEMENT_BETWEEN_FILES: "Источники расходятся в статусе", HISTORY_ONLY: "Только исторические данные", CHECK_DATE_INFERRED_FROM_COMMIT: "Дата взята из коммита", PASS_SCHEDULE_UNCONFIRMED: "График PASS не подтверждён"};
const TYPES = {vacancy_lead: "Конкретная роль", company_watchlist: "Мониторинг компании"};
const APPLICATION_FIELD = "my_application";
const state = {meta: null, columns: [], page: 1, pages: 1, total: 0, pageSize: 25, sort: "priority", direction: "desc", view: "all", controller: null, detailController: null, applications: new Map(), catalogueRows: new Map(), catalogueIds: null, filteredRows: [], applicationStore: null, pendingConnectionStore: null, connectionGeneration: 0, applicationStatus: "", followUp: "", onlyApplications: false, pendingBackup: null, importInProgress: false, pendingSaves: 0, objectUrls: new Set()};
const storageKey = "support-atlas.preferences.v1";
const journalConfigKey = "support-atlas.journal-connection.v1";
let timer;

async function request(path, signal) {
  let data;
  if (window.SupportAtlasData) data = await window.SupportAtlasData.request(path);
  else {
    const response = await fetch(path, {signal});
    data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить базу");
  }
  signal?.throwIfAborted();
  return data;
}

function savePreferences() {
  try { localStorage.setItem(storageKey, JSON.stringify({columns: state.columns, pageSize: state.pageSize, sort: state.sort, direction: state.direction})); } catch { /* Storage can be disabled by the browser. */ }
}
function safeLink(value, label, className = "cell-link") {
  if (!value) return make("span", "missing", "—");
  try {
    const url = new URL(window.SupportAtlasData?.sourceLink(value) || value, location.href);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
    const link = make("a", className, label || url.hostname.replace(/^www\./, ""));
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = value;
    return link;
  } catch { return make("span", "cell-text", value); }
}
function badge(status) { return make("span", `status-badge ${String(status).toLowerCase()}`, STATUS[status] || status); }
function applicationLabel(status) { return window.SupportAtlasTracker?.STATUS[status] || status || "Не откликался"; }
function localDate(value = new Date()) { return window.SupportAtlasTracker.localDate(value); }
function today() { return localDate(); }
function showApplicationMessage(message, error = false) {
  const note = $("#application-storage-note");
  note.textContent = message;
  note.classList.toggle("warning", error);
  note.classList.toggle("success", !error);
}
function applicationSnapshot(row) {
  return {company: String(row.company || "Неизвестная компания"), vacancy: String(row.vacancy || "Роль удалена из каталога"), status: String(row.status || ""), fully_remote: String(row.fully_remote || ""), source_url: String(row.source_url || "")};
}
function blankApplication(row, status = "planned") {
  return {schema_version: 1, record_id: row.record_id, status, application_date: status === "applied" ? today() : "", channel: "", contact: "", resume_version: "", notes: "", follow_up_date: "", proof_links: [], events: [{at: new Date().toISOString(), from: "none", to: status}], attachments: [], snapshot: applicationSnapshot(row), revision: null};
}
function appButton(row, label, className, action) {
  const button = make("button", className, label);
  button.type = "button";
  button.addEventListener("click", (event) => { event.stopPropagation(); action(); });
  return button;
}
function applicationControl(row) {
  const application = state.applications.get(row.record_id);
  if (!application || application.status === "none") {
    return appButton(row, "＋ Отметить отклик", "application-action", () => quickApply(row));
  }
  const group = make("span", "application-control");
  group.append(appButton(row, applicationLabel(application.status), "application-stage", () => openDetail(row.record_id)));
  if (application.follow_up_date) group.append(make("small", application.follow_up_date < today() ? "follow-up overdue" : "follow-up", `Действие: ${application.follow_up_date}`));
  return group;
}
function applicationCell(row) {
  const td = make("td", "application-cell");
  td.dataset.field = APPLICATION_FIELD;
  td.append(applicationControl(row));
  return td;
}
function translated(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "fully_remote") return REMOTE[value] || value;
  if (field === "record_type") return TYPES[value] || value;
  if (field === "evidence_level") return EVIDENCE[value] || value;
  if (field === "review_required") return Number(value) === 1 ? "Нужна проверка" : "Без флага";
  if (field === "date_basis") return value === "explicit_last_checked" ? "Указана в источнике" : "Дата коммита";
  if (field === "review_flags") return value.split("; ").map((item) => FLAGS[item] || item).join("; ");
  return String(value);
}
function params() {
  const result = new URLSearchParams();
  for (const [key, value] of new FormData($("#filters"))) if (value && !(key === "min_fit" && value === "0")) result.append(key, value);
  if ($("#search").value.trim()) result.set("q", $("#search").value.trim());
  result.set("sort", state.sort);
  result.set("direction", state.direction);
  result.set("page_size", state.pageSize);
  result.set("page", state.page);
  return result;
}
function syncUrl(query) {
  history.replaceState(null, "", `${location.pathname}?${query}`);
}
function labels() { return {...Object.fromEntries(state.meta.columns.map((column) => [column.field, column.label])), [APPLICATION_FIELD]: "Мой отклик"}; }
function tableFields() {
  const fields = [...state.columns];
  const vacancy = fields.indexOf("vacancy");
  fields.splice(vacancy >= 0 ? vacancy + 1 : Math.min(1, fields.length), 0, APPLICATION_FIELD);
  return fields;
}
function updateViews() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  const titles = {all: "Все записи", shortlist: "Для отклика", vacancies: "Конкретные роли", watch: "Мониторинг компаний", applications: "Мои отклики"};
  $("#table-title").firstChild.textContent = `${titles[state.view]} `;
}
function renderFilters() {
  const container = $("#active-filters");
  container.replaceChildren();
  const names = {q: "Поиск", status: "Статус", fully_remote: "Формат", min_fit: "Fit от", company: "Компания", skill: "Навык", channel: "Канал", record_type: "Тип", category: "Категория", evidence_level: "Источник", source_file: "Файл", review_required: "Проверка"};
  for (const [key, value] of params()) {
    if (!names[key]) continue;
    const display = key === "status" ? STATUS[value] || value : key === "channel" ? CHANNEL[value] || value : translated(key, value);
    const chip = make("button", "filter-chip", `${names[key]}: ${display} ×`);
    chip.type = "button";
    chip.title = `Убрать фильтр: ${names[key]}`;
    chip.addEventListener("click", () => {
      if (key === "q") $("#search").value = "";
      else if (key === "status") document.querySelectorAll('input[name="status"]').forEach((input) => { if (input.value === value) input.checked = false; });
      else $("#filters").elements.namedItem(key).value = key === "min_fit" ? "0" : "";
      $("#fit-value").value = $("#fit-filter").value;
      state.view = "all";
      refresh();
    });
    container.append(chip);
  }
  for (const [active, name, clear] of [[state.applicationStatus, "Этап отклика", () => { state.applicationStatus = ""; $("#application-status-filter").value = ""; }], [state.followUp, "Следующее действие", () => { state.followUp = ""; $("#application-follow-up-filter").value = ""; }], [state.onlyApplications ? "1" : "", "Только мои отклики", () => { state.onlyApplications = false; $("#application-only-filter").checked = false; }]]) {
    if (!active) continue;
    const value = active === "1" ? "Да" : name === "Этап отклика" ? applicationLabel(active) : active;
    const chip = make("button", "filter-chip", `${name}: ${value} ×`);
    chip.type = "button"; chip.addEventListener("click", () => { clear(); refresh(); }); container.append(chip);
  }
}
function renderHead() {
  const row = make("tr");
  for (const field of tableFields()) {
    const th = make("th");
    th.scope = "col";
    th.dataset.field = field;
    if (field === APPLICATION_FIELD) th.append(make("span", "application-column-title", labels()[field]));
    else {
      if (field === state.sort) th.setAttribute("aria-sort", state.direction === "asc" ? "ascending" : "descending");
      const button = make("button", "", labels()[field]);
      button.type = "button";
      button.append(make("span", "sort-icon", state.sort === field ? (state.direction === "asc" ? "↑" : "↓") : "↕"));
      button.addEventListener("click", () => {
        state.direction = state.sort === field && state.direction === "desc" ? "asc" : "desc";
        state.sort = field;
        savePreferences();
        refresh();
      });
      th.append(button);
    }
    row.append(th);
  }
  $("#table-head").replaceChildren(row);
  $("#visible-count").textContent = state.columns.length + 1;
}
function cell(row, field) {
  if (field === APPLICATION_FIELD) return applicationCell(row);
  const td = make("td");
  td.dataset.field = field;
  const value = row[field];
  td.title = translated(field, value);
  if (field === "company") {
    const content = make("div", "company-cell");
    const company = String(row.company || "Неизвестная компания");
    content.append(make("span", "company-icon", company.slice(0, 2).toUpperCase()), make("span", "", company));
    td.append(content);
  } else if (field === "vacancy") {
    const button = make("button", "role-button", row.vacancy || "Роль удалена из каталога");
    button.type = "button";
    button.addEventListener("click", () => openDetail(row.record_id));
    const subtext = row.review_required ? "△ Есть замечания к данным" : TYPES[row.record_type];
    const mobileAction = make("div", "mobile-application-action");
    mobileAction.append(applicationControl(row));
    td.append(button, make("div", `role-meta${row.review_required ? " warning" : ""}`, subtext), mobileAction);
  } else if (field === "status") td.append(badge(value));
  else if (field === "fit") td.append(make("span", "fit-cell", value ?? "—"));
  else if (field === "fully_remote") td.append(make("span", `remote-value ${value}`, translated(field, value)));
  else if (["source_url", "careers_url", "selected_source_url"].includes(field)) td.append(safeLink(value));
  else if (field === "all_evidence_urls") {
    for (const url of (value || "").split("; ").filter(Boolean)) { td.append(safeLink(url), make("br")); }
    if (!value) td.append(make("span", "missing", "—"));
  } else if (["skills_tags", "channels_tags"].includes(field)) {
    for (const tag of (value || "").split("; ").filter(Boolean)) td.append(make("span", "tag", CHANNEL[tag] || tag));
    if (!value) td.append(make("span", "missing", "—"));
  } else td.append(make("span", value === null ? "missing" : "cell-text", translated(field, value)));
  return td;
}
function applicationMatches(row) {
  const application = state.applications.get(row.record_id);
  const active = application && application.status !== "none";
  if ((state.view === "applications" || state.onlyApplications) && !active) return false;
  if (state.applicationStatus && (application?.status || "none") !== state.applicationStatus) return false;
  if (state.followUp) {
    if (!active) return false;
    const date = active ? application.follow_up_date : "";
    const todayDate = today();
    if (state.followUp === "overdue" && !(date && date < todayDate)) return false;
    if (state.followUp === "today" && date !== todayDate) return false;
    if (state.followUp === "upcoming" && !window.SupportAtlasTracker.withinNextSevenDays(date)) return false;
    if (state.followUp === "scheduled" && !date) return false;
    if (state.followUp === "none" && date) return false;
  }
  return true;
}
function rowForApplication(application) {
  const snapshot = application.snapshot || {};
  return {record_id: application.record_id, company: snapshot.company || "Неизвестная компания", vacancy: snapshot.vacancy || "Роль удалена из каталога", status: snapshot.status || "", fully_remote: snapshot.fully_remote || "", source_url: snapshot.source_url || "", record_type: "vacancy_lead", review_required: 0, fit: null};
}
async function reloadApplications() {
  const store = state.applicationStore;
  const generation = state.connectionGeneration || 0;
  if (!store) return;
  try {
    const records = await store.list();
    if (state.applicationStore !== store || (state.connectionGeneration || 0) !== generation) return;
    state.applications = new Map(records.map((record) => [record.record_id, record]));
    $("#count-applications").textContent = records.filter((record) => record.status !== "none").length;
  } catch (error) {
    if (state.applicationStore === store && (state.connectionGeneration || 0) === generation) showApplicationMessage(`Личный журнал недоступен: ${error.message}. Каталог исследования продолжает работать.`, true);
  }
}
function renderRows(rows, serverPage = null) {
  state.filteredRows = serverPage ? rows : rows.filter(applicationMatches);
  if (state.view === "applications" || state.onlyApplications) {
    const included = new Set(state.filteredRows.map((row) => row.record_id));
    for (const application of state.applications.values()) {
      if (included.has(application.record_id) || state.catalogueIds?.has(application.record_id) || application.status === "none") continue;
      const orphan = rowForApplication(application);
      if (!serverPage && applicationMatches(orphan)) state.filteredRows.push(orphan);
    }
  }
  if (serverPage) { state.total = serverPage.total; state.pages = serverPage.pages; state.page = serverPage.page; }
  else { state.total = state.filteredRows.length; state.pages = Math.max(1, Math.ceil(state.total / state.pageSize)); state.page = Math.min(state.page, state.pages); }
  const pageRows = serverPage ? state.filteredRows : state.filteredRows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  renderHead();
  const fragment = document.createDocumentFragment();
  for (const row of pageRows) {
    const company = String(row.company || "Неизвестная компания"), vacancy = String(row.vacancy || "Роль удалена из каталога");
    const tr = make("tr");
    tr.dataset.recordId = row.record_id;
    tr.tabIndex = 0;
    tr.setAttribute("aria-label", `${company}: ${vacancy}. Открыть карточку`);
    tr.addEventListener("click", (event) => { if (!event.target.closest("button, a")) openDetail(row.record_id); });
    tr.addEventListener("keydown", (event) => { if (event.target === tr && ["Enter", " "].includes(event.key)) { event.preventDefault(); openDetail(row.record_id); } });
    for (const field of tableFields()) tr.append(cell(row, field));
    fragment.append(tr);
  }
  $("#table-body").replaceChildren(fragment);
  $("#empty").hidden = Boolean(state.total);
  $("#table-wrap").hidden = !state.total;
  $("#result-total").textContent = state.total;
  $("#range-info").textContent = state.total ? `${(state.page - 1) * state.pageSize + 1}–${Math.min(state.page * state.pageSize, state.total)} из ${state.total} записей` : "0 записей";
  $("#page-info").textContent = `${state.page} / ${state.pages}`;
  $("#prev-page").disabled = state.page <= 1;
  $("#next-page").disabled = state.page >= state.pages;
  $("#export-button").disabled = false;
  $("#table-wrap").dataset.revision = Number($("#table-wrap").dataset.revision || 0) + 1;
}
async function allResearchRows(query, signal) {
  const allQuery = new URLSearchParams(query);
  allQuery.set("page_size", "100"); allQuery.set("page", "1");
  const first = await request(`/api/vacancies?${allQuery}`, signal);
  if (first.pages < 2) return {rows: first.rows, first};
  const remaining = await Promise.all(Array.from({length: first.pages - 1}, (_, i) => {
    const pageQuery = new URLSearchParams(allQuery); pageQuery.set("page", String(i + 2));
    return request(`/api/vacancies?${pageQuery}`, signal);
  }));
  return {rows: first.rows.concat(...remaining.map((page) => page.rows)), first};
}
async function loadCatalogueIds(signal) {
  if (state.catalogueIds) return state.catalogueIds;
  const {rows} = await allResearchRows(new URLSearchParams(), signal);
  state.catalogueIds = new Set(rows.map((row) => row.record_id));
  return state.catalogueIds;
}
function requireApplicationStore() {
  if (!state.applicationStore) throw new Error("Хранилище личного журнала не подключено в этой сессии");
  return state.applicationStore;
}
async function quickApply(row) {
  let store;
  state.pendingSaves++;
  updateConnectionControls();
  try {
    store = requireApplicationStore();
    const generation = state.connectionGeneration || 0;
    const current = await store.get(row.record_id);
    if (store !== state.applicationStore || generation !== (state.connectionGeneration || 0)) return;
    const application = current || blankApplication(row, "applied");
    if (current && current.status !== "applied") application.events = [...(application.events || []), {at: new Date().toISOString(), from: application.status || "none", to: "applied"}];
    application.status = "applied";
    application.application_date ||= today();
    application.snapshot ||= applicationSnapshot(row);
    const saved = await store.save(application, current?.revision ?? null);
    if (store !== state.applicationStore || generation !== (state.connectionGeneration || 0)) return;
    state.applications.set(row.record_id, saved || application);
    await reloadApplications();
    if (store !== state.applicationStore || generation !== (state.connectionGeneration || 0)) return;
    await load();
    if (store !== state.applicationStore || generation !== (state.connectionGeneration || 0)) return;
    await openDetail(row.record_id);
  } catch (error) { if (!store || store === state.applicationStore) showApplicationMessage(`Отклик не сохранён: ${error.message}`, true); }
  finally { state.pendingSaves--; updateConnectionControls(); }
}
function formField(labelText, name, type, value = "", options = {}) {
  const label = make("label", "application-field");
  label.append(make("span", "", labelText));
  const control = type === "textarea" ? make("textarea") : type === "select" ? make("select") : make("input");
  control.name = name;
  if (type === "textarea") control.value = value || "";
  else if (type === "select") {
    for (const [optionValue, text] of options.choices || []) { const option = make("option", "", text); option.value = optionValue; control.append(option); }
    control.value = value || "";
  } else { control.type = type; control.value = value || ""; }
  if (options.required) control.required = true;
  if (options.maxLength) control.maxLength = options.maxLength;
  label.append(control);
  return label;
}
function randomId() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function fileBase64(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32768, bytes.length)));
    return btoa(binary);
  });
}
function trackedObjectUrl(blob) { const url = URL.createObjectURL(blob); state.objectUrls.add(url); return url; }
function clearObjectUrls() { for (const url of state.objectUrls) URL.revokeObjectURL(url); state.objectUrls.clear(); }
function downloadAttachment(file) {
  const blob = new Blob([window.SupportAtlasTracker.bytesFromBase64(file.data)], {type: file.type || "application/octet-stream"});
  const link = make("a"); link.href = trackedObjectUrl(blob); link.download = file.name || "attachment"; document.body.append(link); link.click(); link.remove();
}
function appendProofRow(container, proof = {}, onRemove = () => {}) {
  const row = make("div", "proof-row");
  const label = make("input"); label.type = "text"; label.maxLength = 200; label.placeholder = "Подпись"; label.value = proof.label || ""; label.setAttribute("aria-label", "Подпись ссылки");
  const url = make("input"); url.type = "url"; url.maxLength = 2048; url.placeholder = "https://…"; url.value = proof.url || ""; url.setAttribute("aria-label", "Ссылка на подтверждение");
  const remove = make("button", "button icon-button", "×"); remove.type = "button"; remove.setAttribute("aria-label", "Удалить ссылку"); remove.addEventListener("click", () => { row.remove(); onRemove(); });
  row.append(label, url, remove); container.append(row); return row;
}
function attachmentList(container, files, onRemove) {
  container.replaceChildren();
  for (const file of files) {
    const row = make("div", "attachment-row");
    const description = make("span", "attachment-name", `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} МБ`);
    const controls = make("div", "attachment-actions");
    const rasterBytes = window.SupportAtlasTracker.bytesFromBase64(file.data);
    const rasterType = window.SupportAtlasTracker.rasterType(rasterBytes);
    if (rasterType) {
      const preview = make("button", "text-button", "Предпросмотр"); preview.type = "button";
      preview.addEventListener("click", () => {
        let image = row.querySelector("img");
        if (image) { image.remove(); preview.textContent = "Предпросмотр"; return; }
        image = make("img", "attachment-preview"); image.alt = `Предпросмотр: ${file.name}`;
        image.src = trackedObjectUrl(new Blob([rasterBytes], {type: rasterType})); row.append(image); preview.textContent = "Скрыть";
      });
      controls.append(preview);
    }
    const download = make("button", "text-button", "Скачать"); download.type = "button"; download.addEventListener("click", () => downloadAttachment(file));
    const remove = make("button", "text-button danger-text", "Удалить"); remove.type = "button"; remove.addEventListener("click", () => onRemove(file.id));
    controls.append(download, remove); row.append(description, controls); container.append(row);
  }
}
function insertApplicationEditor(container, section) {
  const title = container.querySelector(".detail-title");
  if (title) title.insertAdjacentElement("afterend", section);
  else container.prepend(section);
}
async function renderApplicationEditor(container, row, sourceRecord = null) {
  const section = make("section", "application-editor");
  section.append(make("h3", "", "Мой отклик"));
  const store = state.applicationStore;
  const generation = state.connectionGeneration || 0;
  if (!store) {
    section.append(make("p", "muted", "Личный журнал сейчас недоступен: хранилище не подключено. Сохранение требует активного личного хранилища."));
    insertApplicationEditor(container, section); return;
  }
  let baseline = sourceRecord;
  try { baseline = await store.get(row.record_id) || baseline; }
  catch (error) { section.append(make("p", "error-banner", `Не удалось открыть личную запись: ${error.message}`)); insertApplicationEditor(container, section); return; }
  if (state.applicationStore !== store || generation !== (state.connectionGeneration || 0) || !$("#detail-dialog").open) return;
  const application = baseline || blankApplication(row, "planned");
  const baseRevision = baseline?.revision ?? null;
  const files = (application.attachments || []).map((item) => ({...item}));
  const form = make("form", "application-form"); form.id = "application-editor-form";
  form.append(formField("Этап", "status", "select", application.status || "none", {choices: Object.entries(window.SupportAtlasTracker.STATUS).map(([value, label]) => [value, label])}));
  const fields = make("div", "application-fields");
  fields.append(formField("Дата отклика", "application_date", "date", application.application_date), formField("Канал", "channel", "text", application.channel, {maxLength: 120}), formField("Контакт", "contact", "text", application.contact, {maxLength: 500}), formField("Версия резюме", "resume_version", "text", application.resume_version, {maxLength: 300}), formField("Следующее действие", "follow_up_date", "date", application.follow_up_date));
  form.append(fields, formField("Заметки", "notes", "textarea", application.notes, {maxLength: 20000}));
  const proofs = make("div", "proof-list");
  for (const proof of application.proof_links || []) appendProofRow(proofs, proof, () => { form.dataset.dirty = "1"; });
  const addProof = make("button", "button", "＋ Добавить ссылку"); addProof.type = "button"; addProof.addEventListener("click", () => { appendProofRow(proofs, {}, () => { form.dataset.dirty = "1"; }); form.dataset.dirty = "1"; });
  const proofSection = make("section", "application-subsection"); proofSection.append(make("h4", "", "Ссылки на подтверждения"), proofs, addProof); form.append(proofSection);
  const fileSection = make("section", "application-subsection");
  fileSection.append(make("h4", "", "Файлы и скриншоты"), make("p", "muted", "До 10 МБ на файл, максимум 10 файлов и 20 МБ на вакансию. Файлы остаются в личном хранилище."));
  const fileInput = make("input"); fileInput.type = "file"; fileInput.multiple = true; fileInput.setAttribute("aria-label", "Добавить файлы к отклику");
  const fileList = make("div", "attachment-list");
  const updateFiles = () => attachmentList(fileList, files, (id) => { const i = files.findIndex((file) => file.id === id); if (i >= 0) files.splice(i, 1); form.dataset.dirty = "1"; updateDirty(); updateFiles(); });
  fileInput.addEventListener("change", async () => {
    try {
      const selected = [...fileInput.files];
      if (files.length + selected.length > window.SupportAtlasTracker.MAX_ATTACHMENTS) throw new Error("Можно прикрепить не более 10 файлов");
      let total = files.reduce((sum, file) => sum + file.size, 0);
      for (const file of selected) {
        if (file.size > window.SupportAtlasTracker.MAX_FILE_BYTES) throw new Error(`Файл «${file.name}» больше 10 МБ`);
        total += file.size;
        if (total > window.SupportAtlasTracker.MAX_APPLICATION_BYTES) throw new Error("Суммарный размер файлов превышает 20 МБ");
      }
      form.dataset.pending = "1"; updateDirty();
      const staged = await Promise.all(selected.map(async (file) => ({id: randomId(), name: file.name, type: file.type || "application/octet-stream", size: file.size, data: await fileBase64(file)})));
      files.push(...staged);
      form.dataset.dirty = "1"; updateDirty(); updateFiles();
    } catch (error) { message.textContent = error.message; message.className = "application-message error-banner"; }
    finally { form.dataset.pending = ""; updateDirty(); }
    fileInput.value = "";
  });
  fileSection.append(fileInput, fileList); form.append(fileSection); updateFiles();
  const history = make("details", "application-history");
  history.append(make("summary", "", `История этапов (${(application.events || []).length})`));
  const historyList = make("ol", "application-events");
  for (const event of application.events || []) historyList.append(make("li", "", `${new Date(event.at).toLocaleString("ru-RU")} · ${applicationLabel(event.from)} → ${applicationLabel(event.to)}`));
  history.append(historyList); form.append(history);
  const message = make("p", "application-message"); message.setAttribute("role", "status");
  const actions = make("div", "application-form-actions");
  const save = make("button", "button primary", "Сохранить отклик"); save.type = "submit";
  const reset = make("button", "button", "Закрыть"); reset.type = "button"; reset.addEventListener("click", requestCloseDetail);
  actions.append(save, reset); form.append(message, actions);
  const updateDirty = () => {
    const saving = form.dataset.saving === "1", pending = form.dataset.pending === "1";
    for (const control of form.elements) control.disabled = saving;
    fileInput.disabled = saving || pending;
    save.disabled = saving || pending;
    $("#close-detail").disabled = saving;
    updateConnectionControls();
  };
  form.addEventListener("input", () => { form.dataset.dirty = "1"; updateDirty(); });
  form.addEventListener("change", () => { form.dataset.dirty = "1"; updateDirty(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.applicationStore !== store || generation !== (state.connectionGeneration || 0)) { message.textContent = "Журнал отключён или переключён. Подключите его снова перед сохранением."; message.className = "application-message error-banner"; return; }
    if (form.dataset.pending === "1") { message.textContent = "Дождитесь подготовки выбранных файлов."; return; }
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    try {
      const oldStatus = application.status || "none", newStatus = String(values.get("status"));
      const proofLinks = [...proofs.querySelectorAll(".proof-row")].map((item) => ({label: item.querySelector('input[aria-label="Подпись ссылки"]').value.trim(), url: item.querySelector('input[aria-label="Ссылка на подтверждение"]').value.trim()})).filter((item) => item.label || item.url);
      const changed = {...application, status: newStatus, application_date: String(values.get("application_date")), channel: String(values.get("channel")).trim(), contact: String(values.get("contact")).trim(), resume_version: String(values.get("resume_version")).trim(), notes: String(values.get("notes")), follow_up_date: String(values.get("follow_up_date")), proof_links: proofLinks, attachments: files, snapshot: application.snapshot || applicationSnapshot(row)};
      if (oldStatus !== newStatus) changed.events = [...(application.events || []), {at: new Date().toISOString(), from: oldStatus, to: newStatus}];
      window.SupportAtlasTracker.validateApplication(changed);
      form.dataset.saving = "1"; updateDirty(); save.disabled = true; message.textContent = "Сохраняю личную запись…"; message.className = "application-message";
      const stored = await store.save(changed, baseRevision);
      if (state.applicationStore !== store || generation !== (state.connectionGeneration || 0)) return;
      state.applications.set(row.record_id, stored || changed);
      form.dataset.dirty = ""; showApplicationMessage("Личный отклик сохранён.");
      message.textContent = "Сохранено."; message.className = "application-message success";
      await reloadApplications(); await load();
      container.replaceChildren();
      await openDetail(row.record_id);
    } catch (error) {
      message.textContent = `Изменения не сохранены: ${error.message}. Если запись изменилась в другой вкладке, закройте карточку и загрузите её снова.`;
      message.className = "application-message error-banner"; form.dataset.saving = ""; updateDirty();
    }
  });
  insertApplicationEditor(container, section);
  section.append(form);
  updateDirty();
}
async function load() {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const query = params();
  syncUrl(query);
  renderFilters();
  updateViews();
  $("#table-wrap").classList.add("loading");
  $("#error").hidden = true;
  $("#export-button").disabled = true;
  $("#prev-page").disabled = true;
  $("#next-page").disabled = true;
  try {
    await reloadApplications();
    const needsAllRows = state.view === "applications" || state.onlyApplications || Boolean(state.applicationStatus || state.followUp);
    if (needsAllRows) {
      const {rows} = await allResearchRows(query, controller.signal);
      await loadCatalogueIds(controller.signal);
      state.catalogueRows = new Map(rows.map((row) => [row.record_id, row]));
      renderRows(rows);
    } else {
      const data = await request(`/api/vacancies?${query}`, controller.signal);
      state.catalogueRows = new Map(data.rows.map((row) => [row.record_id, row]));
      renderRows(data.rows, data);
    }
    syncUrl(params());
  } catch (error) {
    if (error.name !== "AbortError") {
      $("#error").textContent = `${error.message}. Повторите запрос или обновите страницу.`;
      $("#error").hidden = false;
      $("#table-body").replaceChildren();
      $("#range-info").textContent = "Ошибка загрузки";
    }
  } finally { if (state.controller === controller) $("#table-wrap").classList.remove("loading"); }
}
function refresh() { clearTimeout(timer); state.page = 1; return load(); }
function reset() {
  $("#filters").reset();
  $("#fit-value").value = "0";
  $("#search").value = "";
  state.applicationStatus = ""; state.followUp = ""; state.onlyApplications = false;
  $("#application-status-filter").value = ""; $("#application-follow-up-filter").value = ""; $("#application-only-filter").checked = false;
  state.view = "all";
  return refresh();
}
function renderColumnOptions() {
  const search = $("#column-search").value.toLocaleLowerCase("ru");
  $("#column-options").replaceChildren();
  for (const column of state.meta.columns) {
    if (!`${column.label} ${column.field}`.toLocaleLowerCase("ru").includes(search)) continue;
    const label = make("label", "column-option");
    label.title = column.description;
    const input = make("input");
    input.type = "checkbox";
    input.value = column.field;
    input.checked = state.columns.includes(column.field);
    input.disabled = input.checked && state.columns.length === 1;
    input.addEventListener("change", () => {
      const selected = new Set(state.columns);
      if (input.checked) selected.add(column.field); else selected.delete(column.field);
      state.columns = state.meta.columns.map((item) => item.field).filter((field) => selected.has(field));
      savePreferences();
      renderColumnOptions();
      load();
    });
    label.append(input, make("span", "", column.label));
    $("#column-options").append(label);
  }
  $("#column-selection-count").textContent = `${state.columns.length} из ${state.meta.columns.length} столбцов`;
}
function addTextSection(container, title, text) {
  if (!text) return;
  const section = make("section", "detail-section");
  section.append(make("h3", "", title), make("div", "detail-text", text));
  container.append(section);
}
async function openDetail(id) {
  if ($("#detail-dialog").open && state.openRecordId !== id && !requestCloseDetail()) return;
  state.openRecordId = id;
  state.detailController?.abort();
  const controller = new AbortController();
  state.detailController = controller;
  const container = $("#detail-content");
  container.replaceChildren(make("p", "muted", "Загрузка условий и истории…"));
  if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
  try {
    const data = await request(`/api/vacancies/${encodeURIComponent(id)}`, controller.signal);
    if (state.detailController !== controller) return;
    const record = data.record;
    container.replaceChildren(make("p", "detail-company", record.company), make("h2", "detail-title", record.vacancy));
    const badges = make("div", "detail-badges");
    badges.append(badge(record.status), make("span", "tag", `Fit ${record.fit ?? "—"}`), make("span", "tag", TYPES[record.record_type]));
    container.append(badges);
    if (record.review_flags) addTextSection(container, "Замечания к данным", translated("review_flags", record.review_flags));
    const links = make("div", "detail-links");
    for (const [field, title] of [["source_url", "Источник вакансии ↗"], ["careers_url", "Карьера компании ↗"], ["selected_source_url", "Исходная строка ↗"]]) if (record[field]) links.append(safeLink(record[field], title, "button"));
    container.append(links);
    const grid = make("dl", "detail-grid");
    for (const field of ["fully_remote", "remote_raw", "location", "work_from_russia", "experience", "schedule", "channels", "hard_blocker", "night_risk", "skills_tags", "salary_mentions", "evidence_level", "last_checked", "date_basis"]) {
      const item = make("div");
      item.append(make("dt", "", labels()[field]), make("dd", "", translated(field, record[field])));
      grid.append(item);
    }
    container.append(grid);
    addTextSection(container, "Комментарии исследования · включая предыдущие версии", record.notes);
    addTextSection(container, "Подробности из отчётов", record.research_notes);
    if (record.all_evidence_urls) {
      const section = make("section", "detail-section");
      section.append(make("h3", "", "Все ссылки на подтверждение"));
      for (const url of record.all_evidence_urls.split("; ")) { section.append(safeLink(url, url), make("br")); }
      container.append(section);
    }
    if (data.conflicts.length) {
      const section = make("details", "detail-section");
      section.append(make("summary", "", `Расхождения источников (${data.conflicts.length})`));
      for (const conflict of data.conflicts) {
        let values = conflict.values;
        try { values = JSON.parse(values).join(" ↔ "); } catch { /* Keep original text. */ }
        section.append(make("div", "conflict-item", `${labels()[conflict.field] || conflict.field}\nВыбрано: ${conflict.selected_value}\nВсе варианты: ${values}`));
      }
      container.append(section);
    }
    const historySection = make("details", "detail-section");
    historySection.append(make("summary", "", `Исходные наблюдения (${data.observations.length})`));
    for (const observation of data.observations) {
      const item = make("article", "history-item");
      item.append(make("h4", "", `${observation.source_file}:${observation.source_row}`), badge(observation.status), make("small", "", ` · ${observation.source_date || observation.last_checked} · ${observation.is_main_latest ? "Актуальный файл main" : "Предыдущая версия"}`));
      item.append(make("p", "", `${observation.vacancy}\nFit: ${observation.fit ?? "—"}\nУдалёнка: ${observation.remote_raw || "Не указана"}\nГрафик: ${observation.schedule || "Не указан"}\nКаналы: ${observation.channels || "Не указаны"}\n${observation.hard_blocker || ""}\n${observation.notes || ""}`));
      item.append(safeLink(observation.github_url, "Исходная строка ↗"));
      const original = make("details");
      original.append(make("summary", "", "Все исходные поля"), make("div", "detail-text", observation.raw_fields));
      item.append(original);
      historySection.append(item);
    }
    container.append(historySection);
    const allFields = make("details", "detail-section");
    allFields.append(make("summary", "", "Все 40 полей записи"));
    const fieldsGrid = make("dl", "detail-grid");
    for (const column of state.meta.columns) {
      const item = make("div");
      item.append(make("dt", "", column.label), make("dd", "", translated(column.field, record[column.field])));
      fieldsGrid.append(item);
    }
    allFields.append(fieldsGrid);
    container.append(allFields);
    await renderApplicationEditor(container, record, state.applications.get(id));
  } catch (error) {
    if (error.name === "AbortError") return;
    let application = state.applications.get(id);
    try { application = await state.applicationStore?.get(id) || application; } catch { /* Show the original catalogue error below. */ }
    if (application && /Запись не найдена/i.test(error.message)) {
      const row = rowForApplication(application);
      container.replaceChildren(make("p", "muted", "Эта вакансия больше не входит в текущий каталог. Личная запись и снимок роли сохранены."), make("p", "detail-company", row.company), make("h2", "detail-title", row.vacancy));
      await renderApplicationEditor(container, row, application);
    } else container.replaceChildren(make("p", "error-banner", `${error.message}${application ? " Личная запись не изменена." : ""}`));
  }
}
function hasUnsavedApplicationEdit() { return $("#application-editor-form")?.dataset.dirty === "1"; }
function hasPendingApplicationWork() {
  const form = $("#application-editor-form");
  return Boolean(form && (form.dataset.dirty === "1" || form.dataset.pending === "1" || form.dataset.saving === "1")) || Boolean(state.pendingBackup || state.importInProgress || state.pendingSaves);
}
function requestCloseDetail() {
  const form = $("#application-editor-form");
  if (form?.dataset.saving === "1" || form?.dataset.pending === "1") { form.querySelector(".application-message").textContent = form.dataset.saving === "1" ? "Сохранение выполняется. Дождитесь ответа GitHub." : "Файлы ещё подготавливаются. Дождитесь завершения."; return false; }
  if (hasUnsavedApplicationEdit() && !window.confirm("Закрыть карточку и потерять несохранённые изменения?")) return false;
  if (form) form.dataset.dirty = "";
  $("#detail-dialog").close();
  return true;
}
function updateConnectionControls() {
  const connected = Boolean(state.applicationStore);
  const form = $("#application-editor-form");
  const busy = Boolean(state.importInProgress || state.pendingBackup || state.pendingSaves || form?.dataset.saving === "1");
  $("#connect-button").textContent = connected ? "Настройки журнала" : "Подключить журнал";
  $("#connect-button").disabled = busy;
  $("#refresh-journal-button").hidden = !connected;
  $("#disconnect-button").hidden = !connected;
  $("#disconnect-button").disabled = busy || form?.dataset.pending === "1";
  $("#backup-export-button").disabled = !connected;
  $("#backup-import-button").disabled = !connected;
  const config = state.applicationStore;
  if (config) showApplicationMessage(`Подключено к приватному GitHub-репозиторию ${config.owner}/${config.repository}, ветка ${config.branch}. Токен хранится только в памяти этой вкладки.`);
}
function cancelConnection() {
  state.connectionGeneration = (state.connectionGeneration || 0) + 1;
  state.pendingConnectionStore?.disconnect();
  state.pendingConnectionStore = null;
  $("#github-token").value = "";
  $("#connection-form button[type=submit]").disabled = false;
  $("#connection-dialog").close();
}
function rememberJournalConfig(config) {
  try { localStorage.setItem(journalConfigKey, JSON.stringify(config)); } catch { /* Remembering the address is optional and never includes the token. */ }
}
function restoreJournalConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(journalConfigKey) || "{}");
    if (typeof config.owner === "string") $("#github-owner").value = config.owner;
    if (typeof config.repository === "string") $("#github-repository").value = config.repository;
    if (typeof config.branch === "string") $("#github-branch").value = config.branch;
  } catch { /* Use the documented private-repository defaults. */ }
}
async function connectJournal(event) {
  event.preventDefault();
  if (state.importInProgress) return;
  const generation = (state.connectionGeneration || 0) + 1;
  state.connectionGeneration = generation;
  const message = $("#connection-message"), button = $("#connection-form button[type=submit]");
  const config = {owner: $("#github-owner").value.trim(), repository: $("#github-repository").value.trim(), branch: $("#github-branch").value.trim()};
  const tokenInput = $("#github-token"), token = tokenInput.value;
  let store = null;
  button.disabled = true; message.className = "application-message"; message.textContent = "Проверяю доступ и приватность репозитория…";
  try {
    store = new window.SupportAtlasGitHubStore(config, token);
    state.pendingConnectionStore = store;
    await store.connect();
    if (generation !== state.connectionGeneration) { store.disconnect(); return; }
    state.pendingConnectionStore = null;
    state.applicationStore?.disconnect(); state.applicationStore = store; state.applications.clear();
    state.controller?.abort(); state.detailController?.abort(); state.catalogueRows.clear(); state.catalogueIds = null;
    if ($("#detail-dialog").open) $("#detail-dialog").close();
    $("#detail-content").replaceChildren(); $("#table-body").replaceChildren(); state.filteredRows = [];
    rememberJournalConfig(config);
    await reloadApplications(); updateConnectionControls();
    $("#connection-dialog").close();
    await refresh();
  } catch (error) {
    if (generation !== state.connectionGeneration) return;
    if (state.pendingConnectionStore === store) state.pendingConnectionStore = null;
    store?.disconnect();
    message.className = "application-message error-banner"; message.textContent = error.message;
  } finally {
    if (generation === state.connectionGeneration) { tokenInput.value = ""; button.disabled = false; }
  }
}
async function refreshJournal() {
  const store = state.applicationStore, generation = state.connectionGeneration || 0;
  if (!store) return;
  try {
    await store.refresh();
    if (state.applicationStore !== store || generation !== (state.connectionGeneration || 0)) return;
    await reloadApplications();
    if (state.applicationStore !== store || generation !== (state.connectionGeneration || 0)) return;
    showApplicationMessage("Личный журнал обновлён из приватного репозитория."); await refresh();
  } catch (error) {
    if (state.applicationStore === store && generation === (state.connectionGeneration || 0)) showApplicationMessage(`Не удалось обновить журнал: ${error.message}`, true);
  }
}
function disconnectJournal() {
  if (state.pendingSaves) { showApplicationMessage("Дождитесь завершения сохранения.", true); return; }
  if (state.importInProgress || state.pendingBackup) { showApplicationMessage("Завершите или отмените импорт перед отключением журнала.", true); return; }
  const form = $("#application-editor-form");
  if (form?.dataset.saving === "1" || form?.dataset.pending === "1" || (hasUnsavedApplicationEdit() && !requestCloseDetail())) return;
  if (!window.confirm("Отключить приватный журнал в этой вкладке? На GitHub записи останутся без изменений.")) return;
  state.connectionGeneration = (state.connectionGeneration || 0) + 1;
  state.controller?.abort(); state.detailController?.abort();
  state.applicationStore?.disconnect(); state.applicationStore = null; state.applications.clear(); clearObjectUrls();
  if ($("#detail-dialog").open) $("#detail-dialog").close();
  $("#detail-content").replaceChildren(); $("#connection-message").textContent = "";
  $("#table-body").replaceChildren(); state.filteredRows = []; $("#count-applications").textContent = "0";
  updateConnectionControls(); showApplicationMessage("Журнал отключён. Личные данные удалены из памяти страницы."); refresh();
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
async function exportCsv() {
  const query = params();
  const {rows} = await allResearchRows(query);
  const visibleFields = tableFields();
  const headings = visibleFields.map((field) => labels()[field]);
  const selectedRows = rows.filter(applicationMatches);
  const outputRows = selectedRows.map((row) => visibleFields.map((field) => {
    if (field !== APPLICATION_FIELD) return row[field];
    const application = state.applications.get(row.record_id);
    if (!application || application.status === "none") return applicationLabel("none");
    return [applicationLabel(application.status), application.application_date && `от ${application.application_date}`, application.follow_up_date && `следующий шаг ${application.follow_up_date}`].filter(Boolean).join(" · ");
  }));
  if (state.view === "applications" || state.onlyApplications) {
    const included = new Set(rows.map((row) => row.record_id));
    for (const application of state.applications.values()) {
      if (included.has(application.record_id) || state.catalogueIds?.has(application.record_id) || application.status === "none") continue;
      const row = rowForApplication(application);
      if (applicationMatches(row)) outputRows.push(visibleFields.map((field) => field === APPLICATION_FIELD ? applicationLabel(application.status) : row[field] ?? ""));
    }
  }
  const csv = "\ufeff" + [headings, ...outputRows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const link = make("a"); link.href = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"})); link.download = "support-atlas-filtered.csv"; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
async function exportBackup() {
  try {
    const store = requireApplicationStore();
    const generation = state.connectionGeneration || 0;
    const lightweight = await store.list();
    const records = await Promise.all(lightweight.map((record) => store.get(record.record_id)));
    if (store !== state.applicationStore || generation !== (state.connectionGeneration || 0)) return;
    const content = JSON.stringify(window.SupportAtlasTracker.backup(records), null, 2);
    if (new Blob([content]).size > window.SupportAtlasTracker.MAX_BACKUP_BYTES) throw new Error("Резервная копия превышает лимит 100 МБ");
    const link = make("a"); link.href = URL.createObjectURL(new Blob([content], {type: "application/json;charset=utf-8"})); link.download = `support-atlas-applications-${today()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    showApplicationMessage(`Резервная копия скачана: ${records.length} записей, включая содержимое файлов.`);
  } catch (error) { showApplicationMessage(`Не удалось создать резервную копию: ${error.message}`, true); }
}
async function previewBackup(file) {
  try {
    if (file.size > window.SupportAtlasTracker.MAX_BACKUP_BYTES) throw new Error("Размер резервной копии превышает 100 МБ");
    const parsed = window.SupportAtlasTracker.parseBackup(await file.text());
    const store = requireApplicationStore(), generation = state.connectionGeneration || 0;
    const existing = await store.list();
    if (store !== state.applicationStore || generation !== (state.connectionGeneration || 0)) return;
    const byId = new Map(existing.map((record) => [record.record_id, record]));
    const conflicts = parsed.applications.filter((record) => byId.has(record.record_id));
    state.pendingBackup = {applications: parsed.applications, expectedRevisions: Object.fromEntries(parsed.applications.map((record) => [record.record_id, byId.get(record.record_id)?.revision ?? null]))};
    $("#backup-summary").textContent = `Файл содержит ${parsed.applications.length} записей и ${parsed.applications.reduce((sum, app) => sum + app.attachments.length, 0)} файловых вложений. ${conflicts.length} совпадают с текущими записями; ${parsed.applications.length - conflicts.length} будут добавлены. Проверка завершена до записи.`;
    $("#backup-replace-conflicts").checked = false;
    $("#confirm-backup").disabled = false;
    updateConnectionControls();
    $("#backup-dialog").showModal();
  } catch (error) { showApplicationMessage(`Резервная копия не импортирована: ${error.message}`, true); }
  finally { $("#backup-import-file").value = ""; }
}
async function importBackup() {
  if (!state.pendingBackup) return;
  const button = $("#confirm-backup"); button.disabled = true;
  const store = state.applicationStore, generation = state.connectionGeneration || 0;
  state.importInProgress = true; updateConnectionControls();
  try {
    const result = await store.import(state.pendingBackup.applications, {replace: $("#backup-replace-conflicts").checked, expectedRevisions: state.pendingBackup.expectedRevisions});
    if (store !== state.applicationStore || generation !== (state.connectionGeneration || 0)) return;
    state.pendingBackup = null; $("#backup-dialog").close();
    await reloadApplications(); await refresh();
    showApplicationMessage(`Импорт завершён: добавлено ${result.added}, заменено ${result.replaced}, оставлено без изменений ${result.skipped}.`);
  } catch (error) { showApplicationMessage(`Импорт не выполнен: ${error.message}`, true); }
  finally { state.importInProgress = false; button.disabled = false; updateConnectionControls(); }
}
function restoreUrl() {
  const query = new URLSearchParams(location.search);
  for (const [key, value] of query) {
    const control = $("#filters").elements.namedItem(key);
    if (key === "status") document.querySelectorAll('input[name="status"]').forEach((input) => { if (input.value === value) input.checked = true; });
    else if (control && control.tagName === "SELECT") control.value = value;
    else if (key === "min_fit" && /^\d+$/.test(value)) $("#fit-filter").value = Math.max(0, Math.min(100, Number(value)));
  }
  $("#search").value = query.get("q") || "";
  $("#fit-value").value = $("#fit-filter").value;
  if (state.meta.columns.some((column) => column.field === query.get("sort")) || query.get("sort") === "priority") state.sort = query.get("sort");
  if (["asc", "desc"].includes(query.get("direction"))) state.direction = query.get("direction");
  if (["25", "50", "100"].includes(query.get("page_size"))) state.pageSize = Number(query.get("page_size"));
  if (/^[1-9]\d{0,4}$/.test(query.get("page") || "")) state.page = Number(query.get("page"));
  $("#page-size").value = state.pageSize;
}
async function init() {
  try {
    state.meta = await request("/api/meta");
    const meta = state.meta;
    let preferences = {};
    try { preferences = JSON.parse(localStorage.getItem(storageKey) || "{}") || {}; } catch { /* Use defaults. */ }
    const valid = new Set(meta.columns.map((column) => column.field));
    state.columns = Array.isArray(preferences.columns) ? [...new Set(preferences.columns.filter((field) => valid.has(field)))] : [];
    if (!state.columns.length) state.columns = [...meta.default_columns];
    if ([25, 50, 100].includes(preferences.pageSize)) state.pageSize = preferences.pageSize;
    if (valid.has(preferences.sort) || preferences.sort === "priority") state.sort = preferences.sort;
    if (["asc", "desc"].includes(preferences.direction)) state.direction = preferences.direction;
    restoreJournalConfig(); updateConnectionControls();
    $("#count-all").textContent = $("#stat-total").textContent = meta.total;
    $("#count-shortlist").textContent = (meta.status_counts.PASS || 0) + (meta.status_counts.CONDITIONAL || 0);
    $("#count-vacancies").textContent = meta.type_counts.vacancy_lead || 0;
    $("#count-watch").textContent = meta.type_counts.company_watchlist || 0;
    $("#stat-pass").textContent = meta.status_counts.PASS || 0;
    $("#stat-conditional").textContent = meta.status_counts.CONDITIONAL || 0;
    $("#stat-companies").textContent = `${meta.companies} компаний`;
    $("#stat-observations").textContent = meta.observations;
    $("#stat-files").textContent = `${meta.csv_files} CSV · ${meta.current_csv_rows} текущих строк`;
    $("#snapshot").textContent = `Снимок исследования · ${meta.last_checked.split("-").reverse().join(".")}`;
    if (!meta.source_current) {
      $("#data-note").classList.add("warning");
      $("#data-note").textContent = "CSV изменились после сборки базы. Пересоберите consolidated/vacancies.sqlite, чтобы увидеть новые результаты. Статусы отражают сохранённое исследование.";
    }
    for (const [status, count] of Object.entries(meta.status_counts)) {
      const label = make("label", "status-option");
      const input = make("input");
      input.type = "checkbox";
      input.name = "status";
      input.value = status;
      label.append(input, make("span", `status-dot ${status.toLowerCase()}`), make("span", "", STATUS[status] || status), make("span", "status-count", count));
      $("#status-options").append(label);
    }
    for (const [id, name] of [["company-filter", "company"], ["skill-filter", "skill"], ["channel-filter", "channel"], ["category-filter", "category"], ["evidence-filter", "evidence_level"], ["source-filter", "source_file"]]) {
      for (const value of meta.facets[name]) {
        const option = make("option", "", name === "channel" ? CHANNEL[value] || value : translated(name, value));
        option.value = value;
        $(`#${id}`).append(option);
      }
    }
    restoreUrl();
    $("#filters").addEventListener("submit", (event) => event.preventDefault());
    $("#filters").addEventListener("change", () => { state.view = "all"; refresh(); });
    $("#fit-filter").addEventListener("input", () => { $("#fit-value").value = $("#fit-filter").value; });
    $("#search").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 220); });
    $("#reset").addEventListener("click", reset);
    $("#empty-reset").addEventListener("click", reset);
    $("#application-status-filter").addEventListener("change", () => { state.applicationStatus = $("#application-status-filter").value; refresh(); });
    $("#application-follow-up-filter").addEventListener("change", () => { state.followUp = $("#application-follow-up-filter").value; refresh(); });
    $("#application-only-filter").addEventListener("change", () => { state.onlyApplications = $("#application-only-filter").checked; refresh(); });
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      $("#filters").reset();
      $("#fit-value").value = "0";
      $("#search").value = "";
      state.view = button.dataset.view;
      if (state.view === "shortlist") document.querySelectorAll('input[name="status"]').forEach((input) => { input.checked = ["PASS", "CONDITIONAL"].includes(input.value); });
      if (state.view === "vacancies" || state.view === "watch") $("#type-filter").value = state.view === "vacancies" ? "vacancy_lead" : "company_watchlist";
      refresh();
    }));
    $("#prev-page").addEventListener("click", () => { state.page--; load(); $("#table-wrap").scrollTop = 0; });
    $("#next-page").addEventListener("click", () => { state.page++; load(); $("#table-wrap").scrollTop = 0; });
    $("#page-size").addEventListener("change", () => { state.pageSize = Number($("#page-size").value); savePreferences(); refresh(); });
    $("#columns-button").addEventListener("click", () => { renderColumnOptions(); $("#columns-dialog").showModal(); });
    $("#close-columns").addEventListener("click", () => $("#columns-dialog").close());
    $("#done-columns").addEventListener("click", () => $("#columns-dialog").close());
    $("#column-search").addEventListener("input", renderColumnOptions);
    document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
      state.columns = button.dataset.preset === "all" ? meta.columns.map((column) => column.field) : button.dataset.preset === "conditions" ? ["company", "vacancy", "status", "fit", "fully_remote", "work_from_russia", "experience", "schedule", "channels", "hard_blocker", "review_flags"] : [...meta.default_columns];
      savePreferences(); renderColumnOptions(); load();
    }));
    $("#close-detail").addEventListener("click", requestCloseDetail);
    $("#detail-dialog").addEventListener("cancel", (event) => { if (hasUnsavedApplicationEdit() || $("#application-editor-form")?.dataset.saving === "1") { event.preventDefault(); requestCloseDetail(); } });
    $("#detail-dialog").addEventListener("close", () => { state.detailController?.abort(); state.openRecordId = null; clearObjectUrls(); });
    $("#export-button").addEventListener("click", async () => { try { await exportCsv(); } catch (error) { $("#error").hidden = false; $("#error").textContent = error.message; } });
    $("#backup-export-button").addEventListener("click", exportBackup);
    $("#backup-import-button").addEventListener("click", () => $("#backup-import-file").click());
    $("#backup-import-file").addEventListener("change", () => { const file = $("#backup-import-file").files[0]; if (file) previewBackup(file); });
    $("#confirm-backup").addEventListener("click", importBackup);
    $("#cancel-backup").addEventListener("click", () => { state.pendingBackup = null; $("#backup-dialog").close(); });
    $("#close-backup").addEventListener("click", () => { state.pendingBackup = null; $("#backup-dialog").close(); });
    $("#backup-dialog").addEventListener("cancel", (event) => {
      if (state.importInProgress) { event.preventDefault(); return; }
      state.pendingBackup = null; updateConnectionControls();
    });
    $("#connect-button").addEventListener("click", () => $("#connection-dialog").showModal());
    $("#close-connection").addEventListener("click", cancelConnection);
    $("#cancel-connection").addEventListener("click", cancelConnection);
    $("#connection-dialog").addEventListener("cancel", (event) => { event.preventDefault(); cancelConnection(); });
    $("#connection-form").addEventListener("submit", connectJournal);
    $("#refresh-journal-button").addEventListener("click", refreshJournal);
    $("#disconnect-button").addEventListener("click", disconnectJournal);
    window.addEventListener("beforeunload", (event) => { if (hasPendingApplicationWork()) { event.preventDefault(); event.returnValue = ""; } });
    document.addEventListener("keydown", (event) => { if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !$("dialog[open]")) { event.preventDefault(); $("#search").focus(); } });
    await load();
  } catch (error) {
    $("#error").hidden = false;
    $("#error").textContent = `${error.message}. Попробуйте обновить страницу.`;
    $("#range-info").textContent = "База недоступна";
  }
}
init();
