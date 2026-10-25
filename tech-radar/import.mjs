import {readFileSync,writeFileSync} from "node:fs";
import {classify} from "./classifier.mjs";

const [input, output] = process.argv.slice(2);
if(!input || !output){
 console.error("Usage: node tech-radar/import.mjs input.jsonl output.sql");
 process.exit(2);
}
const rows=readFileSync(input,"utf8").split(/\r?\n/).filter(Boolean).map((line,index)=>{
 try{return JSON.parse(line)}catch{throw Error("Invalid JSONL at line "+(index+1))}
});
const ids=new Set(),q=v=>v==null?"NULL":typeof v==="number"?String(v):"'"+String(v).replaceAll("\0","").replaceAll("'","''")+"'";
const tuple=x=>{
 const {kind,score}=classify(x),s=x.salary||{};
 return "(" + [x.id,x.title,x.company,x.area,x.published_at,x.url,s.from,s.to,s.currency,s.gross==null?null:Number(s.gross),x.experience,(x.schedule||[]).join(","),x.night_shifts==null?null:Number(x.night_shifts),x.possible_calls==null?null:Number(x.possible_calls),x.requirement_excerpt,x.responsibility_excerpt,(x.search_groups||[]).join(","),kind,score,"HH snapshot 2026-10-20"].map(q).join(",")+")";
};
const unique=rows.filter(row=>{if(!row.id||ids.has(String(row.id)))return false;ids.add(String(row.id));return true});
const sql=[];
for(let i=0;i<unique.length;i+=70){
 sql.push("INSERT OR REPLACE INTO jobs (id,title,company,area,published_at,url,salary_from,salary_to,currency,gross,experience,schedule,night_shifts,possible_calls,requirement,responsibility,search_groups,kind,score,source) VALUES "+unique.slice(i,i+70).map(tuple).join(",")+";");
}
writeFileSync(output,sql.join("\n")+"\n","utf8");
console.log("Input rows:",rows.length,"unique vacancy IDs:",unique.length,"SQL batches:",sql.length);
