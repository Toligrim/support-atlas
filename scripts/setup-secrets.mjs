import { createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerUrl = process.argv[2];
if (!process.stdin.isTTY) throw new Error("Run this command in an interactive terminal so the password can be entered without echo.");
if (!workerUrl) throw new Error("Pass the deployed Worker URL: npm run secrets:setup -- https://<worker>.workers.dev");

let origin;
try {
  const parsed = new URL(workerUrl);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error();
  origin = parsed.origin;
} catch { throw new Error("Worker URL must be an HTTPS origin without a path or query."); }

const secretDirectory = join(homedir(), ".config", "support-atlas");
const secretLinkPath = join(secretDirectory, "journal-url.txt");
if (await stat(secretLinkPath).then(() => true, () => false)) throw new Error(`A journal URL is already stored at ${secretLinkPath}; move it first if you intend to rotate the link.`);

const prompt = spawnSync("python3", ["-c", "import getpass,sys; sys.stdout.write(getpass.getpass('Choose a password (20+ characters): '))"], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "inherit"],
});
if (prompt.error || prompt.status !== 0) throw new Error("Password input did not complete.");
let password = prompt.stdout;
if (Array.from(password).length < 20 || password.length > 1024) throw new Error("Use a password between 20 and 1024 characters.");

const linkToken = randomBytes(32).toString("base64url");
const pepper = randomBytes(32);
const secrets = {
  JOURNAL_LINK_TOKEN: linkToken,
  JOURNAL_PASSWORD_PEPPER: pepper.toString("hex"),
  JOURNAL_PASSWORD_VERIFIER: createHmac("sha256", pepper).update(`support-atlas-journal-password-v1\0${password}`, "utf8").digest("hex"),
  SESSION_SECRET: randomBytes(32).toString("hex"),
};
password = "";

await mkdir(secretDirectory, {recursive: true, mode: 0o700});
await chmod(secretDirectory, 0o700);
await writeFile(secretLinkPath, `${origin}/journal/${linkToken}\n`, {encoding: "utf8", mode: 0o600, flag: "wx"});
try {
  const result = spawnSync("npx", ["wrangler", "secret", "bulk"], {
    cwd: root,
    input: JSON.stringify(secrets),
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.error || result.status !== 0) throw new Error("Wrangler could not upload the Worker secrets.");
} catch (error) {
  await unlink(secretLinkPath).catch(() => {});
  throw error;
}

console.log(`Worker secrets were uploaded. The private journal URL is stored at ${secretLinkPath} with owner-only permissions.`);
