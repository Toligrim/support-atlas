import assert from "node:assert/strict";
import {test} from "node:test";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {classify} from "./classifier.mjs";
test("finds genuine technical tasks independent of L1/L2 title",()=>{
 const a=classify({title:"Специалист технической поддержки",responsibility_excerpt:"Разбор ошибок Linux серверов, SQL, API, мониторинг и диагностика инцидентов.",search_groups:["linux_support"]});
 assert.equal(a.kind,"technical");assert.ok(a.score>60);
});
test("marks generic support without technical evidence for manual review",()=>{
 const a=classify({title:"Специалист технической поддержки",responsibility_excerpt:"Помощь пользователям с продуктом"});
 assert.equal(a.kind,"review");
});
test("separates nontechnical voice service from infrastructure tasks",()=>{
 const a=classify({title:"Консультант технической поддержки (звонки)",responsibility_excerpt:"Консультация по тарифам",search_groups:[]});
 assert.equal(a.kind,"client");
});
test("standalone bundle compiles and embeds frontend",()=>{
 execFileSync(process.execPath,["tech-radar/build.mjs"]);
 const bundle=readFileSync("tech-radar/dist-worker.mjs","utf8");
 assert.doesNotMatch(bundle,/__EMBED_/);
 execFileSync(process.execPath,["--check","tech-radar/dist-worker.mjs"]);
 assert.match(bundle,/\/api\/stats/);
});
