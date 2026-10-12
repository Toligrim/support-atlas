"use strict";
(async () => {
  const checked = async (url, json = false) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Исходный файл недоступен");
    return json ? response.json() : response.text();
  };
  const sources = await checked("/sources.json", true);
  const id = new URLSearchParams(location.search).get("id"), source = sources[id];
  if (!source) throw new Error("Неизвестный исходный файл");
  const text = await checked(`/sources/${source.file}`);
  document.querySelector("#title").textContent = source.name;
  document.querySelector("#description").textContent = `Снимок исследования от ${source.date}. Git blob: ${source.blob_sha}`;
  document.title = `${source.name} — Support Atlas`;
  const fragment = document.createDocumentFragment();
  text.replace(/^\ufeff/, "").split(/\r?\n/).forEach((line, index) => {
    const row = document.createElement("div"), number = document.createElement("a"), content = document.createElement("span");
    row.className = "source-line"; row.id = `L${index + 1}`;
    number.href = `#${row.id}`; number.textContent = index + 1;
    content.textContent = line;
    row.append(number, content); fragment.append(row);
  });
  document.querySelector("#source").append(fragment);
  const highlight = () => {
    document.querySelectorAll(".highlighted").forEach((row) => row.classList.remove("highlighted"));
    const match = location.hash.match(/^#L(\d+)(?:-L(\d+))?$/);
    if (!match) return;
    const start = Number(match[1]), end = Math.min(Number(match[2] || start), document.querySelector("#source").childElementCount);
    for (let line = start; line <= end; line++) document.getElementById(`L${line}`)?.classList.add("highlighted");
    document.getElementById(`L${start}`)?.scrollIntoView();
  };
  window.addEventListener("hashchange", highlight);
  highlight();
})().catch((error) => { document.querySelector("#description").textContent = error.message; });
