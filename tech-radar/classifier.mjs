// Heuristic classification of HH search snippets. NOT an expert review.
export function classify(job) {
  const title = String(job.title || "").toLowerCase();
  const body = [job.responsibility_excerpt, job.requirement_excerpt].filter(Boolean).join(" ").toLowerCase();
  const full = title + " " + body;
  const groups = job.search_groups || [];
  const support = /техническ.{0,22}поддерж|техподдерж|technical support|support engineer|application support|support specialist|l1\b|l2\b|service.?desk|help.?desk|noc|сопровождени.{0,35}(?:систем|по|прилож)|дежурн.{0,20}инженер|инженер поддержки|системн.{0,20}поддерж|поддержк.{0,32}(?:по|сервис|инфраструкт|сервер|систем)/i.test(title);
  const adjacent = /системн.{0,20}администратор|сетев.{0,15}инженер|network engineer|devops|site reliability|\bsre\b|администратор баз данных|инженер эксплуатации|cloud engineer|it administrator|network security/i.test(title);
  const client = /голосов.{0,15}поддерж|звонки|колл.?центр|call.?center|контакт.?центр|поддержк.{0,20}(?:продаж|интернет.?магазин)|оператор поддержк|консультант|консультац.{0,15}клиент|модератор|переписк.{0,15}клиент|продаж|работа с обращениями по оплате/i.test(title);
  const irrelevant = /технический писатель|бизнес.?аналитик|разработчик|developer|программист|руководитель|менеджер по продажам|инженер.{0,10}presale|инженер по внедрению|project manager|аналитик маркетинга/i.test(title);
  const tech = [/linux|unix|ubuntu|debian/,/vpn|openvpn|wireguard|ipsec/,/dns|tcp\/ip|udp|маршрутиз|сетев.{0,15}протокол|network/,/api|rest\b|http|webhook/,/\bsql\b|postgres|mysql|баз.{0,5}данн/,/лог|журнал|troubleshoot|диагност|инцидент/,/мониторинг|zabbix|grafana|prometheus/,/сервер|виртуализац|docker|kubernetes|cloud|облак/,/ssh|nginx|bash|python|скрипт/,/1с|windows server|active directory|voip|sip\b/];
  const hits = tech.reduce((n,re)=>n+Number(re.test(full)),0);
  let score = 16 + Math.min(55, hits*9) + (support?22:0) + (adjacent?8:0) + (groups.some(x=>["linux_support","vpn","noc","hosting","level1_level2","network_support","api_saas","cloud"].includes(x))?7:0);
  if(client)score-=39;
  if(irrelevant)score-=24;
  score=Math.max(0,Math.min(100,score));
  let kind;
  if(client && !/инженер/.test(title) && hits<4) kind="client";
  else if(irrelevant && !support) kind=adjacent?"adjacent":"review";
  else if(support && (hits>=2 || /l1\b|l2\b|2.{0,4}лини|втор.{0,5}лини|noc|инженер технической/.test(title))) kind="technical";
  else if(adjacent)kind="adjacent";
  else if(support)kind="review";
  else kind=hits>=4?"adjacent":"review";
  return {kind,score,hits};
}
