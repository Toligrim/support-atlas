import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
const root=dirname(fileURLToPath(import.meta.url));
const read=(name)=>readFileSync(join(root,name),"utf8");
const output=read("worker.js")
  .replace("__EMBED_HTML__",JSON.stringify(read("index.html")))
  .replace("__EMBED_CSS__",JSON.stringify(read("style.css")))
  .replace("__EMBED_APP__",JSON.stringify(read("app.js")));
writeFileSync(join(root,"dist-worker.mjs"),output);
console.log("Built tech-radar/dist-worker.mjs ("+output.length+" chars)");
