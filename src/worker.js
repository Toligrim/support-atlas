const encoder = new TextEncoder();
const applicationStatuses = new Set(["none", "planned", "applied", "replied", "interview", "offer", "rejected", "withdrawn"]);
const sessionLifetimeSeconds = 90 * 24 * 60 * 60;
const maxApplicationBytes = 512 * 1024;
const maxImportBytes = 20 * 1024 * 1024;
const maxApplications = 2000;
const gateCookie = "__Host-support_atlas_gate";
const sessionCookie = "__Host-support_atlas_session";
const headersForPrivateResponse = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
let lastSessionCleanup = 0;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function hexToBytes(value) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/i.test(value)) throw new HttpError(503, "Личный журнал пока не настроен.");
  return Uint8Array.from(value.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

function bytesToHex(value) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(value) {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function digestHex(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", hexToBytes(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function verifySecretToken(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  const [candidateHash, expectedHash] = await Promise.all([digestHex(candidate), digestHex(expected)]);
  return constantTimeEqual(hexToBytes(candidateHash), hexToBytes(expectedHash));
}

async function verifyPassword(password, env) {
  if (typeof password !== "string" || password.length > 1024 || !env.JOURNAL_PASSWORD_PEPPER || !env.JOURNAL_PASSWORD_VERIFIER) return false;
  const candidate = await hmacHex(env.JOURNAL_PASSWORD_PEPPER, `support-atlas-journal-password-v1\0${password}`);
  let expected;
  try { expected = hexToBytes(env.JOURNAL_PASSWORD_VERIFIER); } catch { return false; }
  return constantTimeEqual(hexToBytes(candidate), expected);
}

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const entry of cookies.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return "";
}

async function expectedGateCookie(env) {
  if (!env.SESSION_SECRET) throw new HttpError(503, "Личный журнал пока не настроен.");
  return bytesToBase64Url(hexToBytes(await hmacHex(env.SESSION_SECRET, "support-atlas-journal-gate-v1")));
}

async function hasGate(request, env) {
  let candidate;
  try { candidate = base64UrlToBytes(cookieValue(request, gateCookie)); } catch { return false; }
  let expected;
  try { expected = base64UrlToBytes(await expectedGateCookie(env)); } catch { return false; }
  return constantTimeEqual(candidate, expected);
}

function privateHeaders(extra = {}) { return new Headers({...headersForPrivateResponse, ...extra}); }

function jsonResponse(body, status = 200, extraHeaders = {}) {
  const headers = privateHeaders({"Content-Type": "application/json; charset=utf-8", ...extraHeaders});
  return new Response(body === null ? null : JSON.stringify(body), {status, headers});
}

function textResponse(text, status, extraHeaders = {}) {
  return new Response(text, {status, headers: privateHeaders({"Content-Type": "text/plain; charset=utf-8", ...extraHeaders})});
}

function notFound() { return textResponse("Not Found", 404); }

function ensureOrigin(request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new HttpError(403, "Запрос отклонён.");
}

async function readJson(request, maxBytes) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new HttpError(415, "Ожидается JSON.");
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maxBytes) throw new HttpError(413, "Запрос слишком велик.");
  if (!request.body) throw new HttpError(400, "Некорректный JSON.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Запрос слишком велик.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text;
  try { text = new TextDecoder("utf-8", {fatal: true}).decode(bytes); }
  catch { throw new HttpError(400, "Некорректный JSON."); }
  try { return JSON.parse(text); }
  catch { throw new HttpError(400, "Некорректный JSON."); }
}

function validateText(value, maximum, field, {trim = false} = {}) {
  if (typeof value !== "string" || value.length > maximum) throw new HttpError(400, `Поле «${field}» имеет недопустимое значение.`);
  return trim ? value.trim() : value;
}

function validateDate(value, field) {
  if (value === "") return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `Поле «${field}» должно содержать дату ГГГГ-ММ-ДД.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HttpError(400, `Поле «${field}» содержит несуществующую дату.`);
  return value;
}

function validateApplication(input, expectedRecordId = null) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schema_version !== 1) throw new HttpError(400, "Запись отклика имеет неверный формат.");
  const recordId = validateText(input.record_id, 200, "ID вакансии", {trim: true});
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(recordId) || (expectedRecordId && recordId !== expectedRecordId)) throw new HttpError(400, "ID вакансии имеет неверный формат.");
  const status = validateText(input.status, 20, "этап");
  if (!applicationStatuses.has(status)) throw new HttpError(400, "Неизвестный этап отклика.");
  const proofLinks = input.proof_links;
  if (!Array.isArray(proofLinks) || proofLinks.length > 30) throw new HttpError(400, "В записи слишком много ссылок.");
  const safeProofLinks = proofLinks.map((proof) => {
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) throw new HttpError(400, "Ссылка на подтверждение имеет неверный формат.");
    const label = validateText(proof.label || "", 200, "подпись ссылки", {trim: true});
    const urlText = validateText(proof.url || "", 2048, "ссылка", {trim: true});
    let url;
    try { url = new URL(urlText); } catch { throw new HttpError(400, "Ссылка на подтверждение имеет неверный адрес."); }
    if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new HttpError(400, "Разрешены только ссылки HTTP и HTTPS.");
    return {label, url: url.href};
  });
  if (!Array.isArray(input.events) || input.events.length > 500) throw new HttpError(400, "История этапов имеет неверный формат.");
  const events = input.events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event) || !applicationStatuses.has(event.from) || !applicationStatuses.has(event.to)) throw new HttpError(400, "История этапов имеет неверный формат.");
    return {at: validateText(event.at, 40, "время события"), from: event.from, to: event.to};
  });
  if (!Array.isArray(input.attachments) || input.attachments.length) throw new HttpError(400, "Бинарные вложения временно не поддерживаются. Добавьте ссылку на внешний файл в список подтверждений.");
  if (!input.snapshot || typeof input.snapshot !== "object" || Array.isArray(input.snapshot)) throw new HttpError(400, "Снимок вакансии имеет неверный формат.");
  const snapshot = {};
  for (const field of ["company", "vacancy", "status", "fully_remote", "source_url"]) snapshot[field] = validateText(input.snapshot[field] ?? "", 2000, `снимок: ${field}`);
  return {
    schema_version: 1,
    record_id: recordId,
    status,
    application_date: validateDate(input.application_date, "дата отклика"),
    channel: validateText(input.channel, 120, "канал"),
    contact: validateText(input.contact, 500, "контакт"),
    resume_version: validateText(input.resume_version, 300, "версия резюме"),
    notes: validateText(input.notes, 20000, "заметки"),
    follow_up_date: validateDate(input.follow_up_date, "следующее действие"),
    proof_links: safeProofLinks,
    events,
    attachments: [],
    snapshot,
    revision: null,
  };
}

async function requireSession(request, env) {
  if (!(await hasGate(request, env))) throw new HttpError(404, "Not Found");
  const rawToken = cookieValue(request, sessionCookie);
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw new HttpError(401, "Войдите, чтобы открыть личный журнал.");
  const tokenHash = await digestHex(rawToken);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT expires_at, last_seen_at FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(tokenHash, now).first();
  if (!row) throw new HttpError(401, "Сессия завершилась. Войдите снова.");
  if (now - Number(row.last_seen_at) > 3600) await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  if (now - lastSessionCleanup > 21600) {
    lastSessionCleanup = now;
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  }
  return {tokenHash, expiresAt: Number(row.expires_at)};
}

function sessionCookieHeader(value, maxAge) {
  return `${sessionCookie}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
}

function gateCookieHeader(value) {
  return `${gateCookie}=${value}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict`;
}

function noSessionCookieHeader() {
  return `${sessionCookie}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

async function serveJournal(request, env) {
  if (!(await hasGate(request, env))) return notFound();
  const asset = await env.ASSETS.fetch(new Request(new URL("/", request.url), {headers: {Accept: "text/html"}}));
  if (!asset.ok) return textResponse("Service unavailable", 503);
  const headers = new Headers(asset.headers);
  for (const [name, value] of Object.entries(headersForPrivateResponse)) headers.set(name, value);
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(asset.body, {status: 200, headers});
}

async function bootstrapJournal(request, env, candidate) {
  if (!env.JOURNAL_LINK_TOKEN || !env.SESSION_SECRET) return notFound();
  if (!(await verifySecretToken(candidate, env.JOURNAL_LINK_TOKEN))) return notFound();
  const gate = await expectedGateCookie(env);
  return new Response(null, {status: 303, headers: privateHeaders({Location: "/journal", "Set-Cookie": gateCookieHeader(gate)})});
}

async function login(request, env) {
  ensureOrigin(request);
  if (!(await hasGate(request, env))) throw new HttpError(404, "Not Found");
  const body = await readJson(request, 8192);
  if (typeof body?.password !== "string" || !(await verifyPassword(body.password, env))) throw new HttpError(401, "Неверный пароль.");
  const random = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = bytesToBase64Url(random);
  const tokenHash = await digestHex(rawToken);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + sessionLifetimeSeconds;
  await env.DB.prepare("INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)").bind(tokenHash, now, expiresAt, now).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  return jsonResponse({authenticated: true, expires_at: expiresAt}, 200, {"Set-Cookie": sessionCookieHeader(rawToken, sessionLifetimeSeconds)});
}

function applicationObject(row) {
  try {
    const parsed = JSON.parse(row.payload_json);
    return {...parsed, revision: row.revision};
  } catch { throw new HttpError(500, "Не удалось прочитать запись журнала."); }
}

async function saveApplication(env, record, expectedRevision) {
  const now = Math.floor(Date.now() / 1000);
  const revision = crypto.randomUUID();
  const payload = JSON.stringify({...record, revision});
  if (expectedRevision === null) {
    const result = await env.DB.prepare("INSERT INTO applications (record_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id) DO NOTHING").bind(record.record_id, payload, revision, now, now).run();
    if (Number(result.meta?.changes) !== 1) throw new HttpError(409, "Запись уже существует или изменилась. Обновите журнал.");
  } else {
    const result = await env.DB.prepare("UPDATE applications SET payload_json = ?, revision = ?, updated_at = ? WHERE record_id = ? AND revision = ?").bind(payload, revision, now, record.record_id, expectedRevision).run();
    if (Number(result.meta?.changes) !== 1) throw new HttpError(409, "Запись изменилась в другом окне или на другом устройстве. Обновите журнал и перенесите правки вручную.");
  }
  return {...record, revision};
}

async function applicationApi(request, env, pathname) {
  await requireSession(request, env);
  if (pathname === "/api/applications") {
    if (request.method !== "GET") throw new HttpError(405, "Метод не поддерживается.");
    const rows = await env.DB.prepare("SELECT payload_json, revision FROM applications ORDER BY updated_at DESC, record_id LIMIT ?").bind(maxApplications + 1).all();
    if (rows.results.length > maxApplications) throw new HttpError(413, `Журнал превышает лимит ${maxApplications} записей.`);
    return jsonResponse({applications: rows.results.map(applicationObject)});
  }
  if (pathname === "/api/applications/import") {
    if (request.method !== "POST") throw new HttpError(405, "Метод не поддерживается.");
    ensureOrigin(request);
    const body = await readJson(request, maxImportBytes);
    if (!Array.isArray(body?.applications) || body.applications.length > maxApplications || typeof body.replace !== "boolean" || !body.expected_revisions || typeof body.expected_revisions !== "object" || Array.isArray(body.expected_revisions)) throw new HttpError(400, "Параметры импорта имеют неверный формат.");
    const incoming = body.applications.map((item) => validateApplication(item));
    if (new Set(incoming.map((item) => item.record_id)).size !== incoming.length) throw new HttpError(400, "В копии повторяются ID вакансий.");
    const rows = await env.DB.prepare("SELECT record_id, revision FROM applications").all();
    const current = new Map(rows.results.map((row) => [row.record_id, row.revision]));
    for (const record of incoming) {
      const expected = Object.hasOwn(body.expected_revisions, record.record_id) ? body.expected_revisions[record.record_id] : null;
      if (expected !== null && (typeof expected !== "string" || expected.length > 100)) throw new HttpError(400, "Копия содержит неверные версии записей.");
      if ((current.get(record.record_id) ?? null) !== expected) throw new HttpError(409, "Журнал изменился после предпросмотра импорта. Загрузите копию ещё раз.");
    }
    const additions = [], guard = env.DB.prepare("INSERT INTO application_write_assertions (changed) VALUES (changes())");
    const insert = env.DB.prepare("INSERT INTO applications (record_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id) DO NOTHING");
    const update = env.DB.prepare("UPDATE applications SET payload_json = ?, revision = ?, updated_at = ? WHERE record_id = ? AND revision = ?");
    const statements = [];
    let added = 0, replaced = 0, skipped = 0;
    const now = Math.floor(Date.now() / 1000);
    for (const record of incoming) {
      const oldRevision = current.get(record.record_id) ?? null;
      if (oldRevision !== null && !body.replace) { skipped++; continue; }
      const revision = crypto.randomUUID();
      const serialized = JSON.stringify({...record, revision});
      if (oldRevision === null) {
        statements.push(insert.bind(record.record_id, serialized, revision, now, now));
        added++;
      } else {
        statements.push(update.bind(serialized, revision, now, record.record_id, oldRevision));
        replaced++;
      }
      statements.push(guard);
      statements.push(env.DB.prepare("DELETE FROM application_write_assertions"));
    }
    if (added + replaced) {
      try { await env.DB.batch(statements); }
      catch { throw new HttpError(409, "Журнал изменился во время импорта. Обновите журнал и повторите импорт."); }
    }
    return jsonResponse({added, replaced, skipped});
  }

  const match = pathname.match(/^\/api\/applications\/([^/]+)$/);
  if (!match) return notFound();
  let recordId;
  try { recordId = decodeURIComponent(match[1]); } catch { throw new HttpError(400, "ID вакансии имеет неверный формат."); }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(recordId)) throw new HttpError(400, "ID вакансии имеет неверный формат.");
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT payload_json, revision FROM applications WHERE record_id = ?").bind(recordId).first();
    return row ? jsonResponse({application: applicationObject(row)}) : jsonResponse({application: null});
  }
  if (request.method === "PUT") {
    ensureOrigin(request);
    const body = await readJson(request, maxApplicationBytes);
    if (!Object.hasOwn(body || {}, "expected_revision") || (body.expected_revision !== null && (typeof body.expected_revision !== "string" || body.expected_revision.length > 100))) throw new HttpError(400, "Не указана ожидаемая версия записи.");
    const record = validateApplication(body.application, recordId);
    return jsonResponse({application: await saveApplication(env, record, body.expected_revision)});
  }
  if (request.method === "DELETE") {
    ensureOrigin(request);
    const body = await readJson(request, 2048);
    if (typeof body?.expected_revision !== "string" || body.expected_revision.length > 100) throw new HttpError(400, "Не указана ожидаемая версия записи.");
    const result = await env.DB.prepare("DELETE FROM applications WHERE record_id = ? AND revision = ?").bind(recordId, body.expected_revision).run();
    if (Number(result.meta?.changes) !== 1) throw new HttpError(409, "Запись изменилась или уже удалена.");
    return jsonResponse({deleted: true});
  }
  throw new HttpError(405, "Метод не поддерживается.");
}

async function api(request, env, ctx) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/auth/login" && request.method === "POST") return login(request, env);
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    ensureOrigin(request);
    if (!(await hasGate(request, env))) throw new HttpError(404, "Not Found");
    const token = cookieValue(request, sessionCookie);
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digestHex(token)).run();
    return jsonResponse({authenticated: false}, 200, {"Set-Cookie": noSessionCookieHeader()});
  }
  if (pathname === "/api/auth/session" && request.method === "GET") {
    if (!(await hasGate(request, env))) throw new HttpError(404, "Not Found");
    try {
      const session = await requireSession(request, env);
      return jsonResponse({authenticated: true, expires_at: session.expiresAt});
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return jsonResponse({authenticated: false}, 200, {"Set-Cookie": noSessionCookieHeader()});
      throw error;
    }
  }
  if (pathname.startsWith("/api/applications")) {
    ensureOriginForMutation(request);
    return applicationApi(request, env, pathname);
  }
  return notFound();
}

function ensureOriginForMutation(request) {
  if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) ensureOrigin(request);
}

async function handle(request, env, ctx) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/journal" && request.method === "GET") return await serveJournal(request, env);
    const bootstrapMatch = url.pathname.match(/^\/journal\/([A-Za-z0-9_-]+)$/);
    if (bootstrapMatch && request.method === "GET") return await bootstrapJournal(request, env, bootstrapMatch[1]);
    if (url.pathname.startsWith("/api/")) return await api(request, env, ctx);
    return env.ASSETS.fetch(request);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) return notFound();
      return jsonResponse({error: error.message}, error.status, error.status === 401 ? {"Set-Cookie": noSessionCookieHeader()} : {});
    }
    return jsonResponse({error: "Не удалось выполнить запрос. Повторите попытку."}, 500);
  }
}

export default {fetch: handle};

export const workerInternals = Object.freeze({
  verifyPassword,
  verifySecretToken,
  validateApplication,
  digestHex,
  constantTimeEqual,
});
