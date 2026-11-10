# Контент-завод (сервер)

Сайт с чатом, где работает Claude: монтаж рилсов, чек-лист, выкладка в ARA по слову «пости». Вкладки Монтаж, Дашборд и Постинг рядом.

## Запуск на Railway

1. **Ключ API.** console.anthropic.com → API Keys → Create Key. В Billing пополни баланс и поставь месячный лимит.
2. **Проект.** railway.com → войти через GitHub → New Project → Deploy from GitHub repo → `katrinivanova0616-sys/olua`.
3. **Папка.** В сервисе: Settings → Source → Root Directory = `server`.
4. **Диск.** Правой кнопкой по сервису → Attach Volume → путь `/data`.
5. **Переменные** (Variables):
   - `ANTHROPIC_API_KEY` — ключ из шага 1;
   - `APP_PASSWORD` — пароль для входа на сайт;
   - `ARA_MCP_URL` — адрес коннектора ARA (claude.ai → Настройки → Коннекторы → ARA);
   - `MONTHLY_BUDGET_USD` — необязательно, по умолчанию 50.
6. **Адрес.** Settings → Networking → Generate Domain. Открой его, войди по паролю.
7. **Настройки сайта** (шестерёнка): «Подключить ARA», загрузить скиллы `apple-reels-style.zip` и `montazh.zip`.

## Что где лежит

- `index.mjs` — сервер: вход, чат через Claude Agent SDK, загрузка файлов, подключение ARA по OAuth.
- `public/index.html` — сайт.
- `workspace-template/CLAUDE.md` — правила для Claude, копируются на диск при первом запуске; дальше правятся в настройках сайта.
- `bin/transcribe` — расшифровка речи (faster-whisper).

## Безопасность

- Без пароля сайт ничего не показывает и не тратит.
- Claude работает только с разрешёнными инструментами (файлы, команды, скиллы, ARA), без WebFetch и WebSearch.
- Подтверждения в ARA (публикация, платные генерации) сервер пропускает, только если последнее сообщение Кати начинается с «да».
- Месячный лимит трат: при достижении `MONTHLY_BUDGET_USD` чат перестаёт отвечать.
