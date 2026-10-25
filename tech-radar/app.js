const $=id=>document.getElementById(id);
const el=(name,className,text)=>{const n=document.createElement(name);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n};
let page=0,total=0,loading=false,generation=0;
const labels={technical:"Техническая поддержка",adjacent:"Смежная IT-роль",review:"Нужна проверка",client:"Клиентская поддержка"};
const levels={noExperience:"Без опыта",between1And3:"1–3 года",between3And6:"3–6 лет",moreThan6:"Более 6 лет"};
const shifts={FIVE_ON_TWO_OFF:"5/2",TWO_ON_TWO_OFF:"2/2",THREE_ON_THREE_OFF:"3/3",ONE_ON_THREE_OFF:"1/3",FLEXIBLE:"Гибкий",OTHER:"Другой"};
const safe=(value)=>String(value||"");
const salary=(r)=>{if(r.salary_from==null&&r.salary_to==null)return"Не указана";const currency={RUR:"₽",USD:"$",EUR:"€"}[r.currency]||safe(r.currency);const fmt=n=>Number(n).toLocaleString("ru-RU");if(r.salary_from!=null&&r.salary_to!=null)return fmt(r.salary_from)+"–"+fmt(r.salary_to)+" "+currency;if(r.salary_from!=null)return"от "+fmt(r.salary_from)+" "+currency;return"до "+fmt(r.salary_to)+" "+currency;};
function createJob(r){
 const card=el("article","job"),left=el("div"),top=el("div","jobtop");
 const tag=el("span","tag"+(r.kind==="client"?" alert":r.kind==="review"?" neutral":""),labels[r.kind]||"Не проверено");
 top.append(tag,el("span","tag neutral","Рейтинг "+r.score+"/100"),el("span","tag neutral","Удалённо"));
 left.append(top,el("h3","jobtitle",r.title||"Без названия"),el("div","company",r.company||"Работодатель не указан"));
 const details=el("div","details");
 [r.area||"Россия",levels[r.experience]||"Опыт не указан",safe(r.schedule).split(",").map(x=>shifts[x]||x).join(", "),r.published_at?"Опубликовано "+r.published_at.slice(0,10).split("-").reverse().join("."):"",r.possible_calls?"В описании упомянуты звонки":""].filter(Boolean).forEach(v=>details.append(el("span",null,v)));
 left.append(details);
 const excerpt=safe(r.responsibility||r.requirement).trim();if(excerpt)left.append(el("p","excerpt",excerpt.slice(0,300)));
 const actions=el("div","jobactions");const price=el("div","salary",salary(r));
 price.append(el("small",null,r.salary_from==null&&r.salary_to==null?"Зарплата скрыта":r.gross?"До вычета налогов":"На руки"));
 const link=el("a","hhlink","Открыть на HH");
 if(/^https:\/\/(?:[a-z]+\.)?hh\.ru\/vacancy\/\d+$/.test(safe(r.url))){link.href=r.url;link.target="_blank";link.rel="noopener noreferrer"}else{link.removeAttribute("href");link.textContent="Ссылка недоступна";}
 actions.append(price,link);card.append(left,actions);return card;
}
function filters(){return new URLSearchParams({page:String(page),q:$("search").value,kind:$("kind").value,experience:$("experience").value,group:$("group").value});}
async function load(reset=false){
 if(reset){page=0;generation++;$("items").replaceChildren();total=0;}
 if(loading&&!reset)return;
 const current=generation;loading=true;$("more").hidden=true;$("counter").textContent="Загрузка…";
 try{
  const response=await fetch("/api/jobs?"+filters());if(!response.ok)throw Error("HTTP "+response.status);
  const data=await response.json();if(current!==generation)return;
  total=data.total;data.items.forEach(x=>$("items").append(createJob(x)));
  $("counter").textContent=total.toLocaleString("ru-RU")+" вакансий";
  if(!data.items.length&&page===0)$("items").append(el("div","empty","По этим фильтрам ничего не найдено. Попробуй расширить поиск."));
  $("more").hidden=(page+1)*data.limit>=total;
 }catch(err){if(current===generation){$("counter").textContent="Ошибка загрузки";$("items").append(el("div","empty","Не удалось прочитать базу. Попробуй обновить страницу."));}}finally{if(current===generation)loading=false;}
}
async function stats(){
 try{
  const response=await fetch("/api/stats");if(!response.ok)throw Error("Stats unavailable");
  const s=await response.json(),counts=Object.fromEntries(s.kinds.map(x=>[x.kind,x.n]));
  $("total").textContent=s.total.toLocaleString("ru-RU");
  $("technical").textContent=(counts.technical||0).toLocaleString("ru-RU");
  $("adjacent").textContent=(counts.adjacent||0).toLocaleString("ru-RU");
  $("salaries").textContent=s.salary_visible.toLocaleString("ru-RU");
 }catch(err){for(const id of ["total","technical","adjacent","salaries"])$(id).textContent="—";}
}
for(const id of ["kind","experience","group"])$(id).addEventListener("change",()=>load(true));
let timer;
$("search").addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),250);});
$("reset").addEventListener("click",()=>{$("search").value="";$("kind").value="technical";$("experience").value="all";$("group").value="all";load(true);});
$("more").addEventListener("click",()=>{if(loading)return;page++;load();});
stats();load(true);