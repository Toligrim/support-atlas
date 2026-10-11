"use strict";

// This transport implements the same read-only API as production/server.py.
// All dependencies and the database are served from the Pages project directory.
window.SupportAtlasData = (() => {
  let db, meta, sourceLinks;
  const ready = (async () => {
    const [info, bytes, SQL] = await Promise.all([
      fetch("./metadata.json").then((r) => { if (!r.ok) throw new Error("Не удалось загрузить описание базы"); return r.json(); }),
      fetch("./vacancies.sqlite").then((r) => { if (!r.ok) throw new Error("Не удалось загрузить SQLite"); return r.arrayBuffer(); }),
      initSqlJs({locateFile: (file) => `./vendor/${file}`}),
    ]);
    meta = info.meta;
    sourceLinks = info.source_links;
    const fold = (value) => Array.from(String(value || ""), (char) => info.casefold[char] ?? char.toLowerCase()).join("").replaceAll("ё", "е");
    db = new SQL.Database(new Uint8Array(bytes));
    db.create_function("fold", fold);
    db.run("PRAGMA query_only = ON");
    return {fold, fields: meta.columns.map((column) => column.field), searchFields: info.search_fields, numeric: new Set(info.numeric_columns)};
  })();
  // Surface failures through request() and the existing error banner.
  ready.catch(() => {});
  const select = (sql, values = []) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(values);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally { statement.free(); }
  };
  const integer = (params, name, fallback, low, high) => {
    const raw = (params.get(name) ?? String(fallback)).trim();
    if (!/^[+-]?\d+$/.test(raw)) throw new Error(`Некорректное число: ${name}`);
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < low || number > high) throw new Error(`${name}: допустимо ${low}–${high}`);
    return number;
  };
  function query(params, config) {
    const clauses = [], values = [];
    for (const field of ["status", "fully_remote", "record_type", "company", "category", "evidence_level", "review_required"]) {
      const selected = params.getAll(field).filter(Boolean);
      if (selected.length) {
        clauses.push(`"${field}" IN (${selected.map(() => "?").join(",")})`);
        values.push(...selected);
      }
    }
    const minimum = integer(params, "min_fit", 0, 0, 100);
    if (minimum) { clauses.push("fit >= ?"); values.push(minimum); }
    for (const [name, field] of [["skill", "skills_tags"], ["channel", "channels_tags"], ["source_file", "source_files"]]) {
      for (const value of params.getAll(name).filter(Boolean)) {
        clauses.push(`instr('; ' || COALESCE(${field}, '') || '; ', ?) > 0`);
        values.push(`; ${value}; `);
      }
    }
    const search = (params.get("q") || "").trim();
    if (Array.from(search).length > 500) throw new Error("Поисковый запрос слишком длинный");
    const text = config.searchFields.map((field) => `COALESCE(${field}, '')`).join(" || ' ' || ");
    for (const word of config.fold(search).split(/\s+/).filter(Boolean)) {
      clauses.push(`instr(fold(${text}), ?) > 0`); values.push(word);
    }
    const sort = params.get("sort") ?? "priority", direction = params.get("direction") ?? "desc";
    if (!["asc", "desc"].includes(direction)) throw new Error("Некорректное направление сортировки");
    let order;
    if (sort === "priority") order = "CASE status WHEN 'PASS' THEN 0 WHEN 'CONDITIONAL' THEN 1 WHEN 'UNVERIFIED' THEN 2 WHEN 'WATCH' THEN 3 WHEN 'REJECT' THEN 4 ELSE 5 END, fit DESC, fold(company) ASC, record_id ASC";
    else if (config.fields.includes(sort)) order = `"${sort}" IS NULL ASC, ${config.numeric.has(sort) ? `"${sort}"` : `fold("${sort}")`} ${direction.toUpperCase()}, record_id ASC`;
    else throw new Error("Неизвестный столбец сортировки");
    return {where: clauses.length ? " WHERE " + clauses.join(" AND ") : "", values, order};
  }
  async function request(path) {
    const config = await ready;
    const url = new URL(path, "https://catalogue.invalid"), params = url.searchParams;
    if ([...params].length > 100) throw new Error("Слишком много параметров");
    if (url.pathname === "/api/meta") return meta;
    if (url.pathname.startsWith("/api/vacancies/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/vacancies/".length));
      const record = select("SELECT * FROM vacancies WHERE record_id = ?", [id])[0];
      if (!record) throw new Error("Запись не найдена");
      return {record, observations: select("SELECT o.* FROM observations o JOIN record_observations r ON r.observation_id = o.observation_id WHERE r.record_id = ? ORDER BY o.is_main_latest DESC, o.main_change_index DESC, o.source_date DESC, o.observation_id", [id]), conflicts: select("SELECT * FROM conflicts WHERE record_id = ?", [id])};
    }
    const {where, values, order} = query(params, config);
    if (url.pathname === "/api/vacancies") {
      const size = integer(params, "page_size", 25, 1, 100), requested = integer(params, "page", 1, 1, 100000);
      const total = select("SELECT COUNT(*) AS total FROM vacancies" + where, values)[0].total;
      const pages = Math.max(1, Math.ceil(total / size)), page = Math.min(requested, pages);
      return {rows: select(`SELECT * FROM vacancies${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...values, size, (page - 1) * size]), total, page, pages, page_size: size};
    }
    if (url.pathname === "/api/export.csv") {
      const columns = params.has("columns") ? params.get("columns").split(",") : config.fields;
      if (!columns.length || columns.some((column) => !config.fields.includes(column)) || new Set(columns).size !== columns.length) throw new Error("Некорректный список столбцов");
      const labels = Object.fromEntries(meta.columns.map((column) => [column.field, column.label]));
      const csvCell = (value) => {
        let text = String(value ?? "");
        if (typeof value === "string" && /^[=+\-@]/.test(value.trimStart())) text = "'" + text;
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      };
      const rows = [columns.map((column) => labels[column]), ...select(`SELECT * FROM vacancies${where} ORDER BY ${order}`, values).map((row) => columns.map((column) => row[column]))];
      return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    }
    throw new Error("Страница не найдена");
  }
  function sourceLink(value) {
    try {
      const url = new URL(value), source = sourceLinks?.[url.origin + url.pathname];
      return source ? `./source.html?id=${source}${url.hash}` : value;
    } catch { return value; }
  }
  return {request, sourceLink};
})();
