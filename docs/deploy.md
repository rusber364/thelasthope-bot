# Бот на сервере 24/7

Пока бот запущен на домашнем компьютере, он работает, только когда компьютер включён. В это время не открываются реги в полночь, не приходят напоминания и «Сбор!», а админка доступна только тебе. На своём сервере (VPS) бот работает круглосуточно, и офицеры заходят в админку по адресу вроде `https://admin.твой-домен`.

Что понадобится:

- **VPS** на Ubuntu 24.04 (хватит самого простого: 1 ядро, 1 ГБ памяти). Подойдёт любой хостинг: Hetzner, DigitalOcean, Aeza и т. п.
- **Домен** или поддомен для админки, например `admin.thelasthope.ru`.
- Доступ к серверу по SSH.

> ⚠️ **Бот должен работать в одном месте.** Если запустить его и дома, и на сервере, каждое событие обработается дважды: двойные приветствия и напоминания, две реги. Перед запуском на сервере останови бота дома.

---

## 1. Подготовить сервер

Подключись к серверу по SSH и выполни по очереди:

```bash
sudo apt update && sudo apt install -y git curl debian-keyring debian-archive-keyring apt-transport-https
```

Node.js 26 (бот запускает код без сборки, ему нужна версия не ниже 26):

```bash
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash - && sudo apt install -y nodejs
```

Если NodeSource ещё не выпустил пакет для 26-й версии, поставь Node.js 26 с [nodejs.org](https://nodejs.org/) (раздел Download → Linux) так, чтобы команда `node` была в `/usr/bin/node`, — этот путь записан в службе.

Проверь, что версия подходит (должно быть `v26…` или новее):

```bash
node -v
```

pnpm встроен в Node — его нужно только включить:

```bash
sudo corepack enable
```

Отдельный пользователь для бота: так у бота нет доступа к остальному серверу.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin tlh
```

## 2. Поставить бота

```bash
sudo git clone https://github.com/rusber364/thelasthope-bot.git /opt/thelasthope-bot
```

```bash
sudo chown -R tlh:tlh /opt/thelasthope-bot
```

```bash
cd /opt/thelasthope-bot && sudo -u tlh pnpm install --frozen-lockfile
```

Если репозиторий на GitHub приватный, для `git clone` понадобится [токен доступа](https://github.com/settings/tokens) (вводится вместо пароля) или SSH-ключ сервера, добавленный в GitHub.

Создай `.env`: скопируй его с домашнего компьютера или заполни по `.env.example`. Для сервера поменяй адрес админки на свой домен:

```bash
sudo -u tlh nano /opt/thelasthope-bot/.env
```

```text
ADMIN_URL=https://admin.твой-домен
```

В **Discord Developer Portal → OAuth2 → Redirects** добавь `https://admin.твой-домен/auth/callback`. Старый `http://localhost:3000/auth/callback` можно оставить для домашнего запуска.

### Перенести данные с домашнего компьютера

Чтобы на сервере остались настройки админки, реги, опросы и статистика, перенеси базу. Сначала **останови бота дома**, потом на домашнем компьютере выполни (подставь адрес сервера):

```bash
scp data/bot.db root@АДРЕС_СЕРВЕРА:/opt/thelasthope-bot/data/bot.db
```

И на сервере верни файлу владельца:

```bash
sudo chown -R tlh:tlh /opt/thelasthope-bot/data
```

## 3. Запустить как службу

Служба запускает бота при загрузке сервера и перезапускает его через 10 секунд, если он упал.

```bash
sudo cp /opt/thelasthope-bot/deploy/thelasthope-bot.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now thelasthope-bot
```

Проверить, что бот работает, и посмотреть его консоль:

```bash
sudo systemctl status thelasthope-bot
```

```bash
sudo journalctl -u thelasthope-bot -f
```

## 4. Админка по HTTPS

Админка слушает только сам сервер (`127.0.0.1:3000`). Наружу её выводит **Caddy**: он сам получает бесплатный HTTPS-сертификат и продлевает его.

1. У регистратора домена создай **A-запись**: `admin.твой-домен` → IP сервера. Подожди, пока она заработает (обычно несколько минут).
2. Поставь Caddy:

   ```bash
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   ```

   ```bash
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   ```

   ```bash
   sudo apt update && sudo apt install -y caddy
   ```

3. Скопируй настройку и замени в ней `admin.example.com` на свой домен:

   ```bash
   sudo cp /opt/thelasthope-bot/deploy/Caddyfile /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile
   ```

   ```bash
   sudo systemctl reload caddy
   ```

4. Открой порты для сайта (SSH оставь открытым, иначе потеряешь доступ к серверу):

   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
   ```

Теперь админка открывается по `https://admin.твой-домен`, вход — через Discord, как и раньше. Войти могут только те, у кого на сервере есть право «Управлять сервером».

## 5. Резервные копии базы

Бот сам раз в сутки копирует базу в `data/backups/` и хранит последние 14 копий. Бота при этом останавливать не нужно. Сделать копию вручную:

```bash
cd /opt/thelasthope-bot && sudo -u tlh pnpm backup
```

Копии лежат на том же сервере. Если хочешь хранить их ещё и у себя, иногда скачивай свежую (на домашнем компьютере):

```bash
scp "root@АДРЕС_СЕРВЕРА:/opt/thelasthope-bot/data/backups/*.db" .
```

**Восстановить из копии:** останови бота, подложи копию вместо базы и запусти снова.

```bash
sudo systemctl stop thelasthope-bot
```

```bash
cd /opt/thelasthope-bot/data && sudo -u tlh cp backups/bot-2026-10-16_05-00.db bot.db && sudo -u tlh rm -f bot.db-wal bot.db-shm
```

```bash
sudo systemctl start thelasthope-bot
```

## 6. Обновить бота

Когда в репозитории появилось новое:

```bash
cd /opt/thelasthope-bot && sudo -u tlh git pull && sudo -u tlh pnpm install --frozen-lockfile
```

```bash
sudo systemctl restart thelasthope-bot
```

Если в обновлении менялись команды (новые параметры у `/raid` и т. п.), обнови их в Discord:

```bash
cd /opt/thelasthope-bot && sudo -u tlh pnpm deploy
```
