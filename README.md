# Support Atlas

Публичный каталог вакансий: GitHub Pages пока остаётся доступен по адресу https://toligrim.github.io/support-atlas/. Cloudflare Worker публикует тот же каталог и обслуживает приватный журнал откликов.

## Архитектура

- `npm run build` создаёт `dist/` по явному allowlist: frontend, SQLite, sql.js и файлы источников, используемые просмотрщиком. Код Worker, миграции, конфигурация и документация не попадают в static assets.
- Workers Static Assets обслуживает публичный каталог. `src/worker.js` закрывает `/journal` и `/api/`; записи журнала хранятся в D1.
- Вложения не загружаются. Добавляйте ссылки на внешние документы в поле подтверждений.
- Секреты передаются только через Wrangler Worker Secrets. `scripts/setup-secrets.mjs` принимает пароль без отображения и сохраняет секретную ссылку в `~/.config/support-atlas/journal-url.txt` с правами владельца.
- Парольный verifier — HMAC-SHA-256 с отдельным случайным Worker Secret pepper. Cloudflare Workers Free ограничивает CPU на запрос и итерации PBKDF2; для журнала требуется парольная фраза не короче 20 символов.

This deployment is designed for Cloudflare Free without enabling billing or adding a payment method.

## Разработка и тесты

```sh
npm ci
npm run build
npm run dev
npm test
```

Локальная разработка и тесты используют Wrangler, временную D1 и тестовые secrets; файлы состояния остаются вне Git. `npm test` запускает локальный Worker и проверяет auth, сессии, CRUD, импорт, публичные assets и отсутствие тестовых данных в `dist/`.

## D1 и deployment

1. Установите локальную версию Wrangler командой `npm ci` и проверьте доступ: `npx wrangler whoami`.
2. Создайте D1: `npx wrangler d1 create support-atlas-journal`. Запишите возвращённый ID в `wrangler.jsonc` вместо локального нулевого placeholder.
3. Примените миграции локально и удалённо: `npm run db:migrate:local`, затем `npm run db:migrate:remote`.
4. Разверните приложение: `npm run deploy`. Worker закрывает журнал, пока не настроены secrets.
5. Создайте secrets и пароль: `npm run secrets:setup -- https://<worker>.<account-subdomain>.workers.dev`. Пароль вводится скрыто. Секретная ссылка сохраняется вне репозитория в `~/.config/support-atlas/journal-url.txt`.

Worker Secrets: `JOURNAL_LINK_TOKEN`, `JOURNAL_PASSWORD_PEPPER`, `JOURNAL_PASSWORD_VERIFIER`, `SESSION_SECRET`. Не сохраняйте их значения, `.dev.vars` или credentials в Git. GitHub Actions и R2 не используются.

## Резервное копирование и возврат

Используйте кнопки «Резервная копия» и «Импорт копии» в журнале. Старая приватная GitHub-копия остаётся нетронутой и пригодна для отката. После первоначального переноса сравните число записей и сохраните новую резервную копию.

GitHub Pages не отключается в рамках этого переноса. Для возврата каталога используйте https://toligrim.github.io/support-atlas/. Для отката версии Worker выполните `npx wrangler rollback <VERSION_ID>`; ID версии берите из вывода deploy или Cloudflare Deployments.
