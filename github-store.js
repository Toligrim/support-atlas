"use strict";

// Private GitHub repository adapter for the personal application journal.
// Credentials live only in this object in page memory; no token is persisted.
window.SupportAtlasGitHubStore = class SupportAtlasGitHubStore {
  constructor({owner, repository, branch}, token) {
    if (![owner, repository, branch].every((value) => typeof value === "string" && value.trim())) throw new Error("Укажите владельца, репозиторий и ветку");
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Некорректное имя GitHub-репозитория");
    if (typeof token !== "string" || token.trim().length < 20) throw new Error("Вставьте fine-grained GitHub token");
    this.owner = owner.trim(); this.repository = repository.trim(); this.branch = branch.trim();
    this.token = token.trim(); this.apiRoot = "https://api.github.com";
    this.manifestPath = ".support-atlas-journal/journal.json";
    this.filesRoot = ".support-atlas-journal/files";
    this.cache = new Map(); this.head = null; this.manifestSha = null; this.connected = false; this.generation = 0;
  }
  get repoPath() { return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repository)}`; }
  async api(path, method = "GET", body = undefined) {
    if (!this.token) throw new Error("GitHub token отключён. Подключите приватный репозиторий заново.");
    let response;
    try {
      response = await fetch(`${this.apiRoot}${path}`, {method, redirect: "error", headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : {"Content-Type": "application/json"}),
      }, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    } catch { throw new Error("Нет связи с GitHub API. Проверьте сеть и повторите запрос."); }
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* GitHub can return an empty error page during outages. */ }
    if (!response.ok) {
      if (response.status === 401) throw new Error("GitHub отклонил token. Проверьте срок действия и права Contents.");
      if (response.status === 403) throw new Error("GitHub запретил запрос. Проверьте Contents: Read and write и лимит API.");
      if (response.status === 404) throw new Error("Репозиторий, ветка или файл не найдены. Проверьте адрес и доступ token.");
      if (response.status === 409 || response.status === 422) throw new Error("Ветка изменилась в другом окне или на другом устройстве. Обновите журнал и повторите действие.");
      throw new Error(`GitHub API ответил ${response.status}${data.message ? `: ${String(data.message).slice(0, 240)}` : ""}`);
    }
    return data;
  }
  async connect() {
    const repository = await this.api(this.repoPath);
    if (repository.private !== true) throw new Error("Репозиторий должен быть приватным. Отключено; данные не загружались и не записывались.");
    await this.readState();
    this.connected = true;
    return this.list();
  }
  async readState() {
    const generation = this.generation;
    const ref = await this.api(`${this.repoPath}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const head = ref.object?.sha;
    if (!head) throw new Error("У ветки нет Git-коммита");
    const commit = await this.api(`${this.repoPath}/git/commits/${head}`);
    const tree = await this.api(`${this.repoPath}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error("Дерево репозитория слишком велико для безопасной проверки журнала");
    const entry = tree.tree.find((item) => item.path === this.manifestPath && item.type === "blob");
    let manifest = {format: window.SupportAtlasTracker.FORMAT, version: window.SupportAtlasTracker.VERSION, applications: []};
    if (entry) {
      const blob = await this.api(`${this.repoPath}/git/blobs/${entry.sha}`);
      if (!Number.isSafeInteger(blob.size) || blob.size > 1024 * 1024) throw new Error("Manifest журнала превышает лимит 1 МБ");
      let text;
      try { text = new TextDecoder("utf-8", {fatal: true}).decode(base64Bytes(String(blob.content || "").replace(/\s/g, ""))); }
      catch { throw new Error("Файл личного журнала в репозитории повреждён"); }
      try { manifest = JSON.parse(text); } catch { throw new Error("Файл личного журнала содержит неверный JSON"); }
      if (manifest.format !== window.SupportAtlasTracker.FORMAT || manifest.version !== window.SupportAtlasTracker.VERSION || !Array.isArray(manifest.applications)) throw new Error("Формат журнала в приватном репозитории не поддерживается");
    }
    if (manifest.applications.length > window.SupportAtlasTracker.MAX_APPLICATIONS) throw new Error(`В журнале больше ${window.SupportAtlasTracker.MAX_APPLICATIONS} записей`);
    const records = new Map();
    for (const raw of manifest.applications) {
      const record = validateManifestRecord(raw, this.filesRoot);
      if (records.has(record.record_id)) throw new Error(`В личном журнале повторяется ID ${record.record_id}`);
      records.set(record.record_id, record);
    }
    if (generation !== this.generation) throw new Error("Подключение к журналу закрыто до завершения загрузки");
    this.head = head; this.manifestSha = entry?.sha || null; this.treeSha = commit.tree.sha; this.cache = records;
    return {head, manifest, records, treeSha: commit.tree.sha, generation};
  }
  async refresh() { await this.readState(); return this.list(); }
  list() {
    if (!this.connected && !this.head) throw new Error("Сначала подключите приватный репозиторий");
    return [...this.cache.values()].map((record) => structuredClone(record));
  }
  async get(recordId) {
    if (!this.connected && !this.head) throw new Error("Сначала подключите приватный репозиторий");
    const record = this.cache.get(recordId);
    if (!record) return null;
    const generation = this.generation;
    const attachments = await Promise.all(record.attachments.map(async (file) => {
      const blob = await this.api(`${this.repoPath}/git/blobs/${file.sha}`);
      const data = String(blob.content || "").replace(/\s/g, "");
      const bytes = base64Bytes(data);
      if (bytes.byteLength !== file.size) throw new Error(`Файл «${file.name}» в репозитории повреждён`);
      return {...file, data};
    }));
    if (generation !== this.generation) throw new Error("Подключение к журналу закрыто до завершения загрузки");
    return {...structuredClone(record), attachments};
  }
  async save(application, expectedRevision = null) {
    const current = await this.readState();
    const old = current.records.get(application.record_id) || null;
    if ((old?.revision ?? null) !== (expectedRevision ?? null)) throw new Error("Запись изменилась в другом окне или на другом устройстве. Обновите журнал и перенесите правки вручную.");
    const prepared = await this.prepareRecord(application, old);
    const records = new Map(current.records); records.set(prepared.record.record_id, prepared.record);
    const updated = await this.commit(current, records, prepared.additions, prepared.deletions);
    return structuredClone(updated.get(application.record_id));
  }
  async import(applications, {replace = false, expectedRevisions = {}} = {}) {
    const current = await this.readState();
    for (const incoming of applications) {
      const actual = current.records.get(incoming.record_id)?.revision ?? null;
      if ((expectedRevisions[incoming.record_id] ?? null) !== actual) throw new Error("Журнал изменился после предпросмотра импорта. Загрузите копию и проверьте конфликты ещё раз.");
    }
    const records = new Map(current.records), additions = [], deletions = new Set();
    let added = 0, replaced = 0, skipped = 0;
    for (const incoming of applications) {
      const old = current.records.get(incoming.record_id) || null;
      if (old && !replace) { skipped++; continue; }
      const prepared = await this.prepareRecord(incoming, old, {backup: true});
      records.set(prepared.record.record_id, prepared.record);
      additions.push(...prepared.additions); prepared.deletions.forEach((path) => deletions.add(path));
      if (old) replaced++; else added++;
    }
    if (!added && !replaced) return {added, replaced, skipped};
    await this.commit(current, records, additions, deletions);
    return {added, replaced, skipped};
  }
  async prepareRecord(input, old, {backup = false} = {}) {
    const files = input.attachments || [];
    if (!Array.isArray(files) || files.length > window.SupportAtlasTracker.MAX_ATTACHMENTS) throw new Error("В записи больше 10 файлов");
    const ids = new Set();
    const paths = new Set();
    let totalBytes = 0;
    for (const file of files) {
      if (!file || typeof file.name !== "string" || file.name.length > 255 || typeof file.type !== "string" || file.type.length > 150 || !Number.isSafeInteger(Number(file.size)) || Number(file.size) < 0 || Number(file.size) > window.SupportAtlasTracker.MAX_FILE_BYTES) throw new Error("Метаданные вложения неверны или файл превышает 10 МБ");
      if (typeof file.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(file.id)) throw new Error("ID вложения имеет неверный формат");
      if (ids.has(file.id)) throw new Error("В записи повторяются ID вложений");
      ids.add(file.id);
      totalBytes += Number(file.size);
      if (totalBytes > window.SupportAtlasTracker.MAX_APPLICATION_BYTES) throw new Error("Вложения превышают суммарный лимит 20 МБ на вакансию");
    }
    const normalizedInput = {...input, attachments: []};
    const validated = window.SupportAtlasTracker.validateApplication(normalizedInput);
    const oldFiles = new Map((old?.attachments || []).map((file) => [file.id, file]));
    const additions = [], nextFiles = [];
    for (const file of files) {
      const prior = oldFiles.get(file.id);
      if (!backup && prior && prior.name === file.name && prior.size === Number(file.size) && prior.type === file.type && (!file.data || await gitBlobSha(file.data) === prior.sha)) {
        nextFiles.push({...prior}); oldFiles.delete(file.id); continue;
      }
      if (!file.data) throw new Error(`Не хватает содержимого файла «${file.name}»`);
      const bytes = base64Bytes(file.data);
      if (bytes.byteLength !== Number(file.size) || bytes.byteLength > window.SupportAtlasTracker.MAX_FILE_BYTES) throw new Error(`Файл «${file.name}» повреждён или больше лимита 10 МБ`);
      const recordKey = await sha256Hex(input.record_id);
      const path = prior?.path || `${this.filesRoot}/${recordKey}/${file.id}`;
      if (!path.startsWith(`${this.filesRoot}/`) || path.includes("..") || paths.has(path)) throw new Error("Некорректный или повторяющийся путь вложения");
      paths.add(path);
      const blob = await this.api(`${this.repoPath}/git/blobs`, "POST", {content: file.data, encoding: "base64"});
      const stored = {id: file.id, name: String(file.name), type: String(file.type || "application/octet-stream"), size: bytes.byteLength, path, sha: blob.sha};
      nextFiles.push(stored); additions.push({path, sha: blob.sha}); oldFiles.delete(file.id);
    }
    const deletions = [...oldFiles.values()].map((file) => file.path);
    const record = {...validated, attachments: nextFiles, revision: crypto.randomUUID()};
    return {record, additions, deletions};
  }
  async commit(current, records, additions, deletions) {
    const applications = [...records.values()].sort((a, b) => a.record_id.localeCompare(b.record_id));
    if (applications.length > window.SupportAtlasTracker.MAX_APPLICATIONS) throw new Error(`Журнал превышает ${window.SupportAtlasTracker.MAX_APPLICATIONS} записей`);
    const manifestText = JSON.stringify({format: window.SupportAtlasTracker.FORMAT, version: window.SupportAtlasTracker.VERSION, applications}, null, 2) + "\n";
    if (new Blob([manifestText]).size > 1024 * 1024) throw new Error("Журнал слишком велик для одной manifest-записи; экспортируйте резервную копию и сократите историю");
    const manifestBlob = await this.api(`${this.repoPath}/git/blobs`, "POST", {content: base64Text(manifestText), encoding: "base64"});
    const changed = new Map();
    for (const item of additions) changed.set(item.path, {path: item.path, mode: "100644", type: "blob", sha: item.sha});
    for (const path of deletions) if (![...records.values()].some((record) => record.attachments.some((file) => file.path === path))) changed.set(path, {path, mode: "100644", type: "blob", sha: null});
    changed.set(this.manifestPath, {path: this.manifestPath, mode: "100644", type: "blob", sha: manifestBlob.sha});
    const tree = await this.api(`${this.repoPath}/git/trees`, "POST", {base_tree: current.treeSha, tree: [...changed.values()]});
    const commit = await this.api(`${this.repoPath}/git/commits`, "POST", {message: "Update private application journal", tree: tree.sha, parents: [current.head]});
    try {
      const ref = await this.api(`${this.repoPath}/git/refs/heads/${encodeURIComponent(this.branch)}`, "PATCH", {sha: commit.sha, force: false});
      if (ref.object?.sha !== commit.sha) throw new Error("GitHub не подтвердил обновление ветки");
    } catch (error) {
      try {
        const latest = await this.api(`${this.repoPath}/git/ref/heads/${encodeURIComponent(this.branch)}`);
        if (latest.object?.sha !== commit.sha) throw error;
      } catch { throw new Error("Не удалось подтвердить, что GitHub сохранил запись. Нажмите «Обновить журнал» перед следующей правкой."); }
    }
    if (current.generation !== this.generation) throw new Error("Подключение к журналу закрыто до завершения сохранения");
    this.head = commit.sha; this.treeSha = tree.sha; this.manifestSha = manifestBlob.sha;
    this.cache = new Map(applications.map((record) => [record.record_id, structuredClone(record)]));
    return this.cache;
  }
  disconnect() {
    this.generation++; this.token = ""; this.cache.clear(); this.head = null; this.treeSha = null; this.manifestSha = null; this.connected = false;
  }
};

function base64Bytes(value) {
  const binary = atob(String(value).replace(/\s/g, "")), bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += 32768) {
    const end = Math.min(offset + 32768, binary.length);
    for (let i = offset; i < end; i++) bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function base64Text(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32768, bytes.length)));
  return btoa(binary);
}
async function digestHex(algorithm, bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(text) { return digestHex("SHA-256", new TextEncoder().encode(text)); }
async function gitBlobSha(base64) {
  const content = base64Bytes(base64);
  const header = new TextEncoder().encode(`blob ${content.length}\0`);
  const full = new Uint8Array(header.length + content.length); full.set(header); full.set(content, header.length);
  return digestHex("SHA-1", full);
}
function validateManifestRecord(raw, filesRoot) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.attachments)) throw new Error("Запись в приватном журнале имеет неверный формат");
  if (raw.attachments.length > window.SupportAtlasTracker.MAX_ATTACHMENTS) throw new Error("В записи больше 10 вложений");
  let totalBytes = 0;
  const descriptors = raw.attachments.map((file) => {
    if (!file || typeof file !== "object" || typeof file.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(file.id) || typeof file.path !== "string" || !file.path.startsWith(`${filesRoot}/`) || file.path.includes("..") || typeof file.sha !== "string" || !/^[a-f0-9]{40}$/.test(file.sha) || typeof file.name !== "string" || file.name.length > 255 || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > window.SupportAtlasTracker.MAX_FILE_BYTES) throw new Error("Файл в приватном журнале имеет неверные метаданные");
    if (typeof file.type !== "string" || file.type.length > 150) throw new Error("Тип вложения имеет неверный формат");
    totalBytes += file.size;
    if (totalBytes > window.SupportAtlasTracker.MAX_APPLICATION_BYTES) throw new Error("Вложения одной вакансии превышают суммарный лимит 20 МБ");
    return {id: file.id, path: file.path, sha: file.sha, name: file.name, type: file.type || "application/octet-stream", size: file.size};
  });
  if (new Set(descriptors.map((file) => file.id)).size !== descriptors.length) throw new Error("В записи повторяются ID вложений");
  if (new Set(descriptors.map((file) => file.path)).size !== descriptors.length) throw new Error("Повторяется путь вложения");
  const core = {...raw, attachments: []};
  const validated = window.SupportAtlasTracker.validateApplication(core);
  return {...validated, attachments: descriptors, revision: typeof raw.revision === "string" ? raw.revision : null};
}
