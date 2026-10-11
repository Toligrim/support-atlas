# Russian IT vendors — deep verification batch 02

Date: 2026-10-10

## Goal

Deep-check a second group of Russian IT vendors for current, application-worthy remote roles around Technical Support / Product Support / L1-L2 / infrastructure operations, rather than merely expanding the company watchlist.

Hard filters stayed unchanged:
- fully remote and workable from Russia;
- no office/hybrid/onsite requirement;
- no night shift or day/night rotation;
- no mandatory after-hours/on-call duty;
- no phone-primary/call-center work;
- no sales-heavy duties.

## Scope

18 vendor/role rows were checked and recorded in `data/ru-it-vendor-deep-batch-2026-10-10-02.csv`.

Result:
- CONDITIONAL: 1
- REJECT: 8
- WATCH: 9
- unconditional PASS: 0

## Strongest new application lead

### Flant / Deckhouse — Младший инженер по проверке лабораторных работ — CONDITIONAL — fit 94

Official current vacancy:
https://job.flant.ru/vacancies/junior-laboratory-testing-engineer-2/

This is adjacent to support rather than classic customer L1, but it is unusually realistic for the target profile.

Confirmed from employer-original posting:
- fully remote inside Russia;
- junior-oriented role;
- required baseline is only basic Linux and Docker;
- Kubernetes and Python/Bash scripting are explicitly listed as advantages rather than mandatory requirements;
- duties include checking lab work, deploying and maintaining cloud lab environments, automating routine processes and consulting training participants;
- formal IT education is only an advantage, not a mandatory requirement.

Why not PASS yet:
- the posting does not publish exact daily hours;
- night/on-call duty is not stated, but absence of such duty is also not explicitly guaranteed;
- the role contains communication with training participants, although it is not phone/call-center support.

Decision: APPLY-WORTHY. This is the strongest genuinely new lead from this pass.

## Strong technical matches rejected by hard filters

### UserGate — Network Technical Support Engineer — REJECT — fit 96

Current role asks for TCP/IP, DNS, routing, DHCP, NAT, proxy/firewall concepts, AD, Linux, log analysis and virtualization. Experience requirement is 1–3 years. However, the current posting explicitly says office work in Moscow.

Evidence:
https://nesiditsa.ru/vacancy/128968686

### RED SOFT — Инженер технической поддержки РЕД ОС — REJECT — fit 97

One of the strongest stack matches in the batch: Linux product support plus networking and infrastructure fundamentals. Current role is office-based, therefore it fails the remote-only rule.

Evidence:
https://dreamjob.ru/employers/105279/vakansii/129957861

### Kontur — Специалист поддержки junior/middle — REJECT

Remote is available, but after training the published schedule includes night starts. Phone is also a substantial support channel.

Evidence:
https://kontur.ru/career/vacancies/1921?format=home

### Kontur.Logistics — Специалист технической поддержки клиентов — REJECT

Main schedule is daytime 5/2, but the employer explicitly states that there are duties outside normal working hours. Calls/conference calls are part of the workflow as well.

Evidence:
https://kontur.ru/career/vacancies/5859?format=home

### Naumen — Инженер технической поддержки — REJECT — fit 93

Excellent infrastructure/application support stack: Linux, logs, Docker, tcpdump/iperf/nmap, OSI/TCP-IP, JSON, REST/gRPC and monitoring/virtualization tools. Remote is supported. However, the role is Senior/3+ years and includes mandatory duty rotations, which violates the no-after-hours rule.

Evidence:
https://www.naumen.ru/career/vacancies/inzhener-tekhnicheskoy-podderzhki_MP/

### BI.ZONE — Дежурный инженер по администрированию СЗИ — REJECT

Technically relevant L2/security operations role, but the current posting is office-based.

Evidence:
https://nesiditsa.ru/vacancy/135737433

### Arenadata — Junior/Middle deployment role — REJECT

Strong Linux/Docker/Kubernetes/SQL adjacency, but the current role is hybrid rather than fully remote. Arenadata's support organization also operates 24/7, so any future support vacancy must be checked carefully for night rotations.

Evidence:
https://www.jobswave.ru/vakansii/specialist-po-razvertyvaniyu-programmnyh-resheniy-arenadata-60119

### Kryptonite — L1 Technical Support Engineer — REJECT

Good entry stack: LAN/TCP-IP/DHCP/DNS/Linux, Jira HelpDesk and L1→L2/L3 escalation. Current employer-original page is tied to Nizhny Novgorod and does not confirm fully remote work; phone is explicitly one of the support channels.

Evidence:
https://career.kryptonite.ru/vacancies/l1-support-engineer/

## High-priority vendor watchlist

### BaseALT

Very high technical fit for Linux/OS/virtualization support. Current official Careers page only exposes a Linux Kernel Maintainer role and no current technical-support opening.

Careers:
https://www.basealt.ru/vacancies

### Postgres Professional

Excellent future fit for Linux/PostgreSQL support. Current Careers scan did not expose a support vacancy. Critical support can include 24/7 coverage, so future role schedules require strict verification.

Careers:
https://career.postgrespro.ru/vacancies

### SberTech / Platform V

Vendor support itself is remote and an 8x5 service tier exists, but no current fully remote support vacancy matching the target profile was confirmed in this pass.

Support:
https://platformv.sbertech.ru/support

### Ideco

Very relevant NGFW/networking vendor. Current product support uses a portal, Telegram and phone and has a broad support-service window. No active support vacancy was confirmed, so the vendor remains WATCH rather than a current lead.

Support:
https://ideco.ru/customer-service/technical-support

### Dr.Web

Current Careers page did not show a matching support vacancy. The support service itself is 24/7, creating a likely schedule-risk that must be checked if a role appears.

Careers:
https://company.drweb.ru/careers/?lng=ru

### R7 Office / MyOffice / Directum

All remain useful product-vendor watch targets, but this pass did not find a current fully remote support opening that passes the hard filters.

- R7 Careers: https://www.r7-office.ru/about/career/
- MyOffice Careers: https://myoffice.ru/vacancies/
- Directum Support: https://www.directum.ru/services/support

### TrueConf

An archived beginner support role had an unusually good entry-level stack (Linux, networking, PostgreSQL, DNS, Wireshark), but it is no longer active, so the company stays WATCH only.

Archived evidence:
https://dreamjob.ru/employers/15997/vakansii/136227865

## Decision

The important result is not the raw vendor count but the filtering outcome: many Russian infrastructure/security/software vendors do have technically relevant support teams, but a large fraction of current openings fail specifically because of office/hybrid requirements or mandatory night/after-hours duty.

Current application priority after combining this batch with the earlier deep check:
1. Positive Technologies — Technical Support Engineer (NAD / Sandbox), pending schedule/on-call/phone clarification.
2. Flant / Deckhouse — Junior Laboratory Testing Engineer, new application-worthy adjacent role.
3. Netcraze — Support Engineer, daytime remote; clarify phone share.
4. VK Cloud — Customer Technical Support, only if 2/2 twelve-hour shifts are confirmed day-only and no night on-call exists.

High-value future recheck vendors: BaseALT, UserGate, RED SOFT, Postgres Professional, Ideco, Platform V, NGENIX, Dr.Web, R7 Office, MyOffice and Directum.
