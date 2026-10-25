// Standalone, read-only Cloudflare Worker. Frontend assets are embedded by the deploy step.
const HTML = __EMBED_HTML__;
const CSS = __EMBED_CSS__;
const APP = __EMBED_APP__;
const jsonHeaders = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
function answer(value,status=200){return new Response(JSON.stringify(value),{status,headers:jsonHeaders});}
function page(value,type){return new Response(value,{headers:{"content-type":type,"cache-control":"public, max-age=300","x-content-type-options":"nosniff","content-security-policy":type.startsWith("text/html")?"default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'":undefined}});}
function safeInt(raw,def,max){const n=Number(raw);return Number.isInteger(n)&&n>=0?Math.min(n,max):def;}
export default {
 async fetch(request,env){
  if(request.method!=="GET"&&request.method!=="HEAD")return answer({error:"Method not allowed"},405);
  const url=new URL(request.url),p=url.pathname;
  if(p==="/")return page(HTML,"text/html; charset=utf-8");
  if(p==="/style.css")return page(CSS,"text/css; charset=utf-8");
  if(p==="/app.js")return page(APP,"application/javascript; charset=utf-8");
  if(!p.startsWith("/api/"))return answer({error:"Not found"},404);
  if(!env.DB)return answer({error:"Database is not configured"},503);
  try{
    if(p==="/api/health"){const row=await env.DB.prepare("SELECT COUNT(*) AS total FROM jobs").first();return answer({ok:true,total:row.total,source:"HH snapshot 2026-10-20"});}
    if(p==="/api/stats"){
      const [counts,levels,all]=await Promise.all([
       env.DB.prepare("SELECT kind, COUNT(*) AS n FROM jobs GROUP BY kind").all(),
       env.DB.prepare("SELECT experience, COUNT(*) AS n FROM jobs GROUP BY experience").all(),
       env.DB.prepare("SELECT COUNT(*) AS total,COUNT(CASE WHEN salary_from IS NOT NULL OR salary_to IS NOT NULL THEN 1 END) AS salary_visible, COUNT(CASE WHEN possible_calls=1 THEN 1 END) AS possible_calls FROM jobs").first()
      ]);
      return answer({snapshot:"2026-10-20",total:all.total,salary_visible:all.salary_visible,calls_mentioned:all.possible_calls,kinds:counts.results,experience:levels.results});
    }
    if(p==="/api/jobs"){
      const pageNum=safeInt(url.searchParams.get("page"),0,10000),limit=30;
      const kind=url.searchParams.get("kind")||"technical";
      const q=(url.searchParams.get("q")||"").trim().slice(0,100);
      const exp=url.searchParams.get("experience")||"all";
      const group=url.searchParams.get("group")||"all";
      const conditions=[],params=[];
      if(["technical","adjacent","review","client"].includes(kind)){conditions.push("kind=?");params.push(kind);}
      if(["noExperience","between1And3","between3And6","moreThan6"].includes(exp)){conditions.push("experience=?");params.push(exp);}
      if(q){conditions.push("(title LIKE ? OR company LIKE ? OR requirement LIKE ? OR responsibility LIKE ?)");for(let i=0;i<4;i++)params.push("%"+q+"%");}
      if(group!=="all"&&/^[a-z_]{1,40}$/.test(group)){conditions.push("search_groups LIKE ?");params.push("%"+group+"%");}
      const where=conditions.length?" WHERE "+conditions.join(" AND "):"";
      const [count,rows]=await Promise.all([
       env.DB.prepare("SELECT COUNT(*) AS n FROM jobs"+where).bind(...params).first(),
       env.DB.prepare("SELECT id,title,company,area,url,published_at,salary_from,salary_to,currency,gross,experience,schedule,night_shifts,possible_calls,requirement,responsibility,search_groups,kind,score FROM jobs"+where+" ORDER BY score DESC, published_at DESC LIMIT ? OFFSET ?").bind(...params,limit,pageNum*limit).all()
      ]);
      return answer({page:pageNum,limit,total:count.n,items:rows.results});
    }
    return answer({error:"Not found"},404);
  }catch(e){return answer({error:"Database request failed"},503);}
 }
};