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
const state = {meta: null, columns: [], page: 1, pages: 1, total: 0, pageSize: 25, sort: "priority", direction: "desc", view: "all", controller: null, detailController: null};
const storageKey = "support-atlas.preferences.v1";
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
function syncUrl(query) { history.replaceState(null, "", `${location.pathname}?${query}`); }
function labels() { return Object.fromEntries(state.meta.columns.map((column) => [column.field, column.label])); }
function updateViews() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  const titles = {all: "Все записи", shortlist: "Для отклика", vacancies: "Конкретные роли", watch: "Мониторинг компаний"};
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
}
function renderHead() {
  const row = make("tr");
  for (const field of state.columns) {
    const th = make("th");
    th.scope = "col";
    th.dataset.field = field;
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
    row.append(th);
  }
  $("#table-head").replaceChildren(row);
  $("#visible-count").textContent = state.columns.length;
}
function cell(row, field) {
  const td = make("td");
  td.dataset.field = field;
  const value = row[field];
  td.title = translated(field, value);
  if (field === "company") {
    const content = make("div", "company-cell");
    content.append(make("span", "company-icon", row.company.slice(0, 2).toUpperCase()), make("span", "", row.company));
    td.append(content);
  } else if (field === "vacancy") {
    const button = make("button", "role-button", row.vacancy);
    button.type = "button";
    button.addEventListener("click", () => openDetail(row.record_id));
    const subtext = row.review_required ? "△ Есть замечания к данным" : TYPES[row.record_type];
    td.append(button, make("div", `role-meta${row.review_required ? " warning" : ""}`, subtext));
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
    const data = await request(`/api/vacancies?${query}`, controller.signal);
    state.page = data.page;
    state.pages = data.pages;
    state.total = data.total;
    syncUrl(params());
    renderHead();
    const fragment = document.createDocumentFragment();
    for (const row of data.rows) {
      const tr = make("tr");
      tr.tabIndex = 0;
      tr.setAttribute("aria-label", `${row.company}: ${row.vacancy}. Открыть карточку`);
      tr.addEventListener("click", (event) => { if (!event.target.closest("button, a")) openDetail(row.record_id); });
      tr.addEventListener("keydown", (event) => { if (event.target === tr && ["Enter", " "].includes(event.key)) { event.preventDefault(); openDetail(row.record_id); } });
      for (const field of state.columns) tr.append(cell(row, field));
      fragment.append(tr);
    }
    $("#table-body").replaceChildren(fragment);
    $("#empty").hidden = Boolean(data.total);
    $("#table-wrap").hidden = !data.total;
    $("#result-total").textContent = data.total;
    $("#range-info").textContent = data.total ? `${(data.page - 1) * data.page_size + 1}–${Math.min(data.page * data.page_size, data.total)} из ${data.total} записей` : "0 записей";
    $("#page-info").textContent = `${data.page} / ${data.pages}`;
    $("#prev-page").disabled = data.page <= 1;
    $("#next-page").disabled = data.page >= data.pages;
    $("#export-button").disabled = false;
    $("#table-wrap").dataset.revision = Number($("#table-wrap").dataset.revision || 0) + 1;
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
  } catch (error) { if (error.name !== "AbortError") container.replaceChildren(make("p", "error-banner", error.message)); }
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
    $("#close-detail").addEventListener("click", () => $("#detail-dialog").close());
    $("#detail-dialog").addEventListener("close", () => state.detailController?.abort());
    $("#export-button").addEventListener("click", async () => {
      const query = params(); query.set("columns", state.columns.join(","));
      try {
        const content = window.SupportAtlasData ? await request(`/api/export.csv?${query}`) : null;
        const url = content === null ? `/api/export.csv?${query}` : URL.createObjectURL(new Blob([content], {type: "text/csv;charset=utf-8"}));
        const link = make("a"); link.href = url; link.download = "vacancies.csv"; document.body.append(link); link.click(); link.remove();
        if (content !== null) setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (error) { $("#error").hidden = false; $("#error").textContent = error.message; }
    });
    document.addEventListener("keydown", (event) => { if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !$("dialog[open]")) { event.preventDefault(); $("#search").focus(); } });
    await load();
  } catch (error) {
    $("#error").hidden = false;
    $("#error").textContent = `${error.message}. Попробуйте обновить страницу.`;
    $("#range-info").textContent = "База недоступна";
  }
}
init();
