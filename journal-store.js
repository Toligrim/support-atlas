"use strict";

window.SupportAtlasJournalStore = class SupportAtlasJournalStore {
  async request(path, method = "GET", body = undefined) {
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body === undefined ? {} : {"Content-Type": "application/json"},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
    } catch {
      throw new Error("Нет связи с сервером журнала. Проверьте сеть и повторите запрос.");
    }
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* Keep the generic transport error. */ }
    if (response.status === 401 && path !== "/api/auth/login") window.dispatchEvent(new CustomEvent("support-atlas-session-expired"));
    if (!response.ok) throw new Error(data.error || `Сервер журнала ответил ${response.status}.`);
    return data;
  }
  async session() { return this.request("/api/auth/session"); }
  async login(password) { return this.request("/api/auth/login", "POST", {password}); }
  async logout() { return this.request("/api/auth/logout", "POST", {}); }
  async list() { return (await this.request("/api/applications")).applications; }
  async get(recordId) {
    const {application} = await this.request(`/api/applications/${encodeURIComponent(recordId)}`);
    return application;
  }
  async save(application, expectedRevision = null) {
    const {application: saved} = await this.request(`/api/applications/${encodeURIComponent(application.record_id)}`, "PUT", {application, expected_revision: expectedRevision});
    return saved;
  }
  async delete(recordId, expectedRevision) {
    return this.request(`/api/applications/${encodeURIComponent(recordId)}`, "DELETE", {expected_revision: expectedRevision});
  }
  async import(applications, {replace = false, expectedRevisions = {}} = {}) {
    if (applications.some((record) => (record.attachments || []).length)) {
      throw new Error("Бинарные вложения из резервной копии не поддерживаются. Удалите их из копии и добавьте ссылки на внешние файлы в поле подтверждений.");
    }
    return this.request("/api/applications/import", "POST", {applications, replace, expected_revisions: expectedRevisions});
  }
  async refresh() { return this.list(); }
  disconnect() { /* Authentication is a server cookie; logout revokes it remotely. */ }
};
