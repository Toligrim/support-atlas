import assert from "node:assert/strict";
import {createHash, createHmac, randomBytes} from "node:crypto";
import {spawn, spawnSync} from "node:child_process";
import {createServer} from "node:net";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import worker from "../src/worker.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), "support-atlas-worker-test-"));
const persistence = join(temporary, "persist");
const varsPath = join(temporary, "worker-test.dev.vars");
const portServer = createServer();
await new Promise((resolveListen, reject) => portServer.listen(0, "127.0.0.1", resolveListen).once("error", reject));
const port = portServer.address().port;
await new Promise((resolveClose) => portServer.close(resolveClose));

const testPassword = randomBytes(32).toString("base64url");
const linkToken = randomBytes(32).toString("base64url");
const pepper = randomBytes(32);
const sessionSecret = randomBytes(32).toString("hex");
const passwordVerifier = createHmac("sha256", pepper).update(`support-atlas-journal-password-v1\0${testPassword}`, "utf8").digest("hex");
await writeFile(varsPath, [
  `JOURNAL_LINK_TOKEN=${linkToken}`,
  `JOURNAL_PASSWORD_PEPPER=${pepper.toString("hex")}`,
  `JOURNAL_PASSWORD_VERIFIER=${passwordVerifier}`,
  `SESSION_SECRET=${sessionSecret}`,
  "",
].join("\n"), {mode: 0o600});

function command(args) {
  const result = spawnSync("npx", ["wrangler", ...args], {cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`npx wrangler ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function check(name, condition) {
  assert.ok(condition, name);
  console.log(`PASS ${name}`);
}

const unconfiguredBootstrap = await worker.fetch(new Request("https://support-atlas.example/journal/not-a-valid-token"), {});
check("unconfigured secret link is a generic 404", unconfiguredBootstrap.status === 404);

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

let child;
let workerOutput = "";
try {
  command(["d1", "migrations", "apply", "support-atlas-journal", "--local", "--persist-to", persistence, "--env-file", varsPath]);
  child = spawn("npx", ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persistence, "--env-file", varsPath], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { workerOutput = (workerOutput + chunk.toString()).slice(-30000); });
  child.stderr.on("data", (chunk) => { workerOutput = (workerOutput + chunk.toString()).slice(-30000); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  const startDeadline = Date.now() + 45000;
  while (!ready && Date.now() < startDeadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited before startup:\n${workerOutput}`);
    try { ready = (await fetch(base)).status === 200; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 150)); }
  }
  if (!ready) throw new Error(`wrangler dev did not become ready:\n${workerOutput}`);

  const rootResponse = await fetch(base);
  check("public catalogue returns 200 without authentication", rootResponse.status === 200);
  const publicAssets = ["/styles.css", "/app.js", "/journal-store.js", "/catalogue.js", "/tracker.js", "/favicon.svg", "/metadata.json", "/vacancies.sqlite", "/vendor/sql-wasm.js", "/vendor/sql-wasm.wasm", "/source.html", "/source.css", "/source.js", "/sources.json", "/robots.txt"];
  for (const path of publicAssets) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `public asset ${path}`);
  }
  check("all required public assets return 200", true);

  const wrongLink = await fetch(`${base}/journal/not-a-valid-token`, {redirect: "manual"});
  check("wrong secret link is a generic 404", wrongLink.status === 404 && !(await wrongLink.text()).toLowerCase().includes("journal exists"));
  const wrongGate = await fetch(`${base}/api/auth/session`);
  check("auth API requires the secret-link gate", wrongGate.status === 404);
  const bootstrap = await fetch(`${base}/journal/${linkToken}`, {redirect: "manual"});
  const gateCookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
  check("valid secret link redirects to a clean URL and sets an HttpOnly gate", bootstrap.status === 303 && bootstrap.headers.get("location") === "/journal" && /HttpOnly/i.test(bootstrap.headers.get("set-cookie") || ""));
  const journalPage = await fetch(`${base}/journal`, {headers: {Cookie: gateCookie}});
  check("gated journal page shows the password screen", journalPage.status === 200 && /journal-login-form/.test(await journalPage.text()) && journalPage.headers.get("cache-control") === "no-store");
  const unauthenticatedList = await fetch(`${base}/api/applications`, {headers: {Cookie: gateCookie}});
  check("journal API rejects unauthenticated requests", unauthenticatedList.status === 401);

  const badPassword = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {Cookie: gateCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({password: "wrong password"}),
  });
  check("wrong password is rejected", badPassword.status === 401);
  const badOrigin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {Cookie: gateCookie, Origin: "https://attacker.invalid", "Content-Type": "application/json"},
    body: JSON.stringify({password: testPassword}),
  });
  check("login rejects a cross-origin request", badOrigin.status === 403);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {Cookie: gateCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({password: testPassword}),
  });
  const sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  const authenticatedCookie = `${gateCookie}; ${sessionCookie}`;
  check("correct password creates a persistent HttpOnly session", login.status === 200 && /HttpOnly/i.test(login.headers.get("set-cookie") || "") && /Max-Age=7776000/.test(login.headers.get("set-cookie") || ""));
  const session = await fetch(`${base}/api/auth/session`, {headers: {Cookie: authenticatedCookie}});
  check("session survives a page reload", session.status === 200 && (await session.json()).authenticated === true);
  const emptyList = await fetch(`${base}/api/applications`, {headers: {Cookie: authenticatedCookie}});
  check("authenticated journal list is readable", emptyList.status === 200 && (await emptyList.json()).applications.length === 0);

  const firstRecord = {
    schema_version: 1,
    record_id: "job_test_record_1",
    status: "planned",
    application_date: "",
    channel: "Email",
    contact: "Recruiter",
    resume_version: "CV 2026",
    notes: "PRIVATE_JOURNAL_SENTINEL",
    follow_up_date: "2026-10-20",
    proof_links: [{label: "Vacancy", url: "https://example.com/vacancy"}],
    events: [{at: new Date().toISOString(), from: "none", to: "planned"}],
    attachments: [],
    snapshot: {company: "Example", vacancy: "Support role", status: "PASS", fully_remote: "yes", source_url: "https://example.com/vacancy"},
    revision: null,
  };
  const create = await fetch(`${base}/api/applications/${firstRecord.record_id}`, {
    method: "PUT",
    headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({application: firstRecord, expected_revision: null}),
  });
  const created = (await create.json()).application;
  check("create application record", create.status === 200 && created.revision && created.notes === "PRIVATE_JOURNAL_SENTINEL");

  const updatedRecord = {...created, status: "applied", notes: "PRIVATE_JOURNAL_UPDATED", events: [...created.events, {at: new Date().toISOString(), from: "planned", to: "applied"}]};
  const update = await fetch(`${base}/api/applications/${firstRecord.record_id}`, {
    method: "PUT",
    headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({application: updatedRecord, expected_revision: created.revision}),
  });
  const updated = (await update.json()).application;
  check("update preserves status, notes, links, follow-up and history", update.status === 200 && updated.status === "applied" && updated.notes === "PRIVATE_JOURNAL_UPDATED" && updated.proof_links.length === 1 && updated.follow_up_date === "2026-10-20" && updated.events.length === 2);

  const stale = await fetch(`${base}/api/applications/${firstRecord.record_id}`, {
    method: "PUT",
    headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({application: updatedRecord, expected_revision: created.revision}),
  });
  check("stale revision is rejected", stale.status === 409);

  const importedRecord = {...firstRecord, record_id: "job_test_record_2", notes: "imported record"};
  const importResponse = await fetch(`${base}/api/applications/import`, {
    method: "POST",
    headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({applications: [importedRecord], replace: false, expected_revisions: {job_test_record_2: null}}),
  });
  const importResult = await importResponse.json();
  check("backup import writes through the authenticated API", importResponse.status === 200 && importResult.added === 1);
  const importedConflict = await fetch(`${base}/api/applications/import`, {
    method: "POST",
    headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({applications: [importedRecord], replace: true, expected_revisions: {job_test_record_2: null}}),
  });
  check("backup import rejects revision conflicts", importedConflict.status === 409);

  const attachmentRecord = {...firstRecord, record_id: "job_test_record_3", attachments: [{id: "file-1"}]};
  const attachmentResponse = await fetch(`${base}/api/applications/${attachmentRecord.record_id}`, {
    method: "PUT",
    headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({application: attachmentRecord, expected_revision: null}),
  });
  check("binary attachment uploads are explicitly rejected", attachmentResponse.status === 400 && (await attachmentResponse.text()).includes("вложения временно не поддерживаются"));

  const detail = await fetch(`${base}/api/applications/${firstRecord.record_id}`, {headers: {Cookie: authenticatedCookie}});
  check("read individual application record", detail.status === 200 && (await detail.json()).application.notes === "PRIVATE_JOURNAL_UPDATED");
  const listAfterWrites = await fetch(`${base}/api/applications`, {headers: {Cookie: authenticatedCookie}});
  check("list contains created and imported records", listAfterWrites.status === 200 && (await listAfterWrites.json()).applications.length === 2);

  const remove = await fetch(`${base}/api/applications/${firstRecord.record_id}`, {
    method: "DELETE",
    headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"},
    body: JSON.stringify({expected_revision: updated.revision}),
  });
  check("delete application record", remove.status === 200 && (await remove.json()).deleted === true);
  const missing = await fetch(`${base}/api/applications/${firstRecord.record_id}`, {headers: {Cookie: authenticatedCookie}});
  check("deleted record is no longer readable", missing.status === 200 && (await missing.json()).application === null);

  const expiredRawToken = randomBytes(32).toString("base64url");
  const expiredHash = createHash("sha256").update(expiredRawToken).digest("hex");
  command(["d1", "execute", "support-atlas-journal", "--local", "--persist-to", persistence, "--env-file", varsPath, "--command", `INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at) VALUES ('${expiredHash}', 1, 2, 1)`]);
  const expiredCookie = `${gateCookie}; __Host-support_atlas_session=${expiredRawToken}`;
  const expired = await fetch(`${base}/api/auth/session`, {headers: {Cookie: expiredCookie}});
  check("expired session is rejected and cookie cleared", expired.status === 200 && (await expired.json()).authenticated === false && /Max-Age=0/.test(expired.headers.get("set-cookie") || ""));

  const logout = await fetch(`${base}/api/auth/logout`, {method: "POST", headers: {Cookie: authenticatedCookie, Origin: base, "Content-Type": "application/json"}, body: "{}"});
  const afterLogout = await fetch(`${base}/api/applications`, {headers: {Cookie: authenticatedCookie}});
  check("logout revokes the D1 session and clears the cookie", logout.status === 200 && /Max-Age=0/.test(logout.headers.get("set-cookie") || "") && afterLogout.status === 401);

  const outputPaths = await listFiles(join(root, "dist"));
  check("static allowlist excludes Worker source and migrations", !outputPaths.some((path) => path === "worker.js" || path.startsWith("src/") || path.startsWith("migrations/") || path === "package.json" || path === "wrangler.jsonc"));
  const shipped = await Promise.all(outputPaths.map((path) => readFile(join(root, "dist", path))));
  const shippedText = Buffer.concat(shipped).toString("utf8");
  check("journal test data and test secrets are absent from static assets", !shippedText.includes("PRIVATE_JOURNAL_SENTINEL") && !shippedText.includes(linkToken) && !shippedText.includes(testPassword));
  check("GitHub token UI and API backend are absent from the deployed bundle", !shippedText.includes("github-token") && !shippedText.includes("api.github.com"));
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(temporary, {recursive: true, force: true});
}
