"use strict";

// Storage-neutral journal schema and validation. The page supplies a store adapter;
// this file never writes application data to the research database or build output.
window.SupportAtlasTracker = (() => {
  const STATUS = Object.freeze({
    none: "Не откликался", planned: "Планирую", applied: "Откликнулся", replied: "Получил ответ",
    interview: "Собеседование", offer: "Оффер", rejected: "Отказ", withdrawn: "Снял кандидатуру",
  });
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_APPLICATION_BYTES = 20 * 1024 * 1024;
  const MAX_ATTACHMENTS = 10;
  const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
  const MAX_APPLICATIONS = 2000;
  const FORMAT = "support-atlas-applications";
  const VERSION = 1;
  const base64ChunkPattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  const rasterSignatures = [
    {type: "image/png", test: (b) => b.length >= 8 && [137,80,78,71,13,10,26,10].every((n, i) => b[i] === n)},
    {type: "image/jpeg", test: (b) => b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255},
    {type: "image/gif", test: (b) => b.length >= 6 && String.fromCharCode(...b.slice(0, 6)).match(/^GIF8[79]a$/)},
    {type: "image/webp", test: (b) => b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP"},
  ];
  const string = (value, max, name) => {
    if (typeof value !== "string" || value.length > max) throw new Error(`${name}: недопустимый текст или превышена длина`);
    return value;
  };
  const date = (value, name) => {
    if (value !== "") {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name}: нужна дата в формате ГГГГ-ММ-ДД`);
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${name}: такой даты не существует`);
    }
    return value;
  };
  function decodeBase64(value, expectedSize) {
    if (typeof value !== "string" || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8 || value.length % 4 !== 0) throw new Error("Файл в резервной копии повреждён или слишком велик");
    for (let offset = 0; offset < value.length; offset += 32768) {
      if (!base64ChunkPattern.test(value.slice(offset, Math.min(offset + 32768, value.length)))) throw new Error("Файл в резервной копии повреждён или слишком велик");
    }
    const binary = atob(value);
    if (binary.length !== expectedSize) throw new Error("Размер файла в резервной копии не совпадает с данными");
    return binary.length;
  }
  function rasterType(bytes) { return rasterSignatures.find((item) => item.test(bytes))?.type || null; }
  function validateApplication(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Запись журнала должна быть объектом");
    if (input.schema_version !== VERSION) throw new Error(`Версия записи не поддерживается: ${String(input.schema_version)}`);
    const record = {
      schema_version: VERSION,
      record_id: string(input.record_id, 200, "ID вакансии"),
      status: string(input.status, 20, "Этап"),
      application_date: date(input.application_date, "Дата отклика"),
      channel: string(input.channel, 120, "Канал"),
      contact: string(input.contact, 500, "Контакт"),
      resume_version: string(input.resume_version, 300, "Версия резюме"),
      notes: string(input.notes, 20000, "Заметки"),
      follow_up_date: date(input.follow_up_date, "Следующее действие"),
      proof_links: [], events: [], attachments: [], snapshot: {},
      revision: input.revision ?? null,
    };
    if (!Object.hasOwn(STATUS, record.status)) throw new Error(`Неизвестный этап: ${record.status}`);
    if (!record.record_id) throw new Error("У записи отсутствует ID вакансии");
    if (!Array.isArray(input.proof_links) || input.proof_links.length > 30) throw new Error("В записи слишком много ссылок");
    record.proof_links = input.proof_links.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error("Некорректная ссылка в журнале");
      const label = string(entry.label || "", 200, "Подпись ссылки").trim();
      const value = string(entry.url || "", 2048, "Ссылка").trim();
      let url;
      try { url = new URL(value); } catch { throw new Error(`Некорректная ссылка: ${value || "пусто"}`); }
      if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error("Поддерживаются только ссылки HTTP и HTTPS");
      return {label, url: url.href};
    });
    if (!Array.isArray(input.events) || input.events.length > 500) throw new Error("Некорректная история этапов");
    record.events = input.events.map((event) => {
      if (!event || typeof event !== "object" || !Object.hasOwn(STATUS, event.from) || !Object.hasOwn(STATUS, event.to)) throw new Error("Некорректная запись в истории этапов");
      return {at: string(event.at, 40, "Время изменения"), from: event.from, to: event.to};
    });
    if (!Array.isArray(input.attachments) || input.attachments.length > MAX_ATTACHMENTS) throw new Error(`Можно сохранить не более ${MAX_ATTACHMENTS} файлов на вакансию`);
    let attachmentBytes = 0;
    record.attachments = input.attachments.map((file) => {
      if (!file || typeof file !== "object") throw new Error("Некорректный файл в журнале");
      const name = string(file.name, 255, "Имя файла");
      const type = string(file.type || "application/octet-stream", 150, "Тип файла");
      const size = Number(file.size);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new Error(`Файл «${name}» превышает лимит 10 МБ`);
      const data = string(file.data || "", Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8, "Данные файла");
      decodeBase64(data, size);
      attachmentBytes += size;
      if (attachmentBytes > MAX_APPLICATION_BYTES) throw new Error("Файлы одной вакансии превышают суммарный лимит 20 МБ");
      const id = string(file.id, 100, "ID файла");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("ID файла имеет неверный формат");
      return {id, name, type, size, data};
    });
    if (new Set(record.attachments.map((file) => file.id)).size !== record.attachments.length) throw new Error("В записи повторяются ID файлов");
    if (!input.snapshot || typeof input.snapshot !== "object" || Array.isArray(input.snapshot)) throw new Error("Не хватает снимка вакансии");
    for (const key of ["company", "vacancy", "status", "fully_remote", "source_url"]) record.snapshot[key] = string(input.snapshot[key] ?? "", 2000, `Снимок: ${key}`);
    return record;
  }
  function parseBackup(text) {
    if (typeof text !== "string" || new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error("Размер резервной копии превышает 100 МБ");
    let backup;
    try { backup = JSON.parse(text); } catch { throw new Error("Не удалось прочитать JSON резервной копии"); }
    if (!backup || backup.format !== FORMAT || backup.version !== VERSION || !Array.isArray(backup.applications)) throw new Error("Формат или версия резервной копии не поддерживается");
    if (backup.applications.length > MAX_APPLICATIONS) throw new Error(`В копии больше ${MAX_APPLICATIONS} записей`);
    const ids = new Set();
    const applications = backup.applications.map(validateApplication);
    for (const record of applications) {
      if (ids.has(record.record_id)) throw new Error(`В копии повторяется вакансия ${record.record_id}`);
      ids.add(record.record_id);
    }
    return {format: FORMAT, version: VERSION, exported_at: string(backup.exported_at || "", 40, "Дата копии"), applications};
  }
  function backup(applications) { return {format: FORMAT, version: VERSION, exported_at: new Date().toISOString(), applications}; }
  function localDate(value = new Date()) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }
  function withinNextSevenDays(date, now = new Date()) {
    const today = localDate(now), end = new Date(now);
    end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 7);
    return date > today && date <= localDate(end);
  }
  function bytesFromBase64(value) {
    const binary = atob(value), bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 32768) {
      const end = Math.min(offset + 32768, binary.length);
      for (let i = offset; i < end; i++) bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return Object.freeze({STATUS, MAX_FILE_BYTES, MAX_APPLICATION_BYTES, MAX_ATTACHMENTS, MAX_BACKUP_BYTES, MAX_APPLICATIONS, FORMAT, VERSION, validateApplication, parseBackup, backup, bytesFromBase64, rasterType, localDate, withinNextSevenDays});
})();
