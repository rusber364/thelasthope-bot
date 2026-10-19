# Бот на сервере 24/7

Пока бот запущен на домашнем компьютере, он работает, только когда компьютер включён. В это время не открываются реги в полночь, не приходят напоминания и «Сбор!», а админка доступна только тебе. На своём сервере (VPS) бот работает круглосуточно, и офицеры заходят в админку по адресу вроде `https://admin.твой-домен`.

Что понадобится:

- **VPS** на Ubuntu 24.04 или новее (хватит самого простого: 1 ядро, 1 ГБ памяти — бот занимает около 100 МБ). Подойдёт любой хостинг: Hetzner, DigitalOcean, Aeza и т. п. Бесплатно — Oracle Cloud, см. [раздел ниже](#бесплатный-сервер-в-oracle-cloud).
- **Домен** или поддомен для админки, например `admin.thelasthope.ru`. Бесплатно — [DuckDNS](https://www.duckdns.org): адрес вида `имя.duckdns.org`, в поле current ip — IP сервера.
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

pnpm (с Node 25 он больше не входит в Node через corepack) — версию возьми из `packageManager` в `package.json`:

```bash
sudo npm install -g pnpm@12.11.2
```

На сервере с 1 ГБ памяти добавь файл подкачки на 2 ГБ — с ним спокойно собирается админка:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
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

Собери админку — без этого бот работает, но вместо админки показывает подсказку «выполни `pnpm build`»:

```bash
cd /opt/thelasthope-bot && sudo -u tlh pnpm build
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

   На **Oracle Cloud** ufw не используй — там свои правила iptables; порты открываются по-другому, см. [раздел про Oracle](#бесплатный-сервер-в-oracle-cloud).

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
cd /opt/thelasthope-bot && sudo -u tlh git pull && sudo -u tlh pnpm install --frozen-lockfile && sudo -u tlh pnpm build
```

```bash
sudo systemctl restart thelasthope-bot
```

Если в обновлении менялись команды (новые параметры у `/raid` и т. п.), обнови их в Discord:

```bash
cd /opt/thelasthope-bot && sudo -u tlh pnpm deploy
```

## Бесплатный сервер в Oracle Cloud

Так бот работает с 19.10.2026: Oracle Cloud Always Free, Франкфурт, AMD `VM.Standard.E2.1.Micro` (1 ГБ памяти + файл подкачки), Ubuntu 26.04, адрес админки — поддомен DuckDNS.

1. **Регистрация** — [signup.cloud.oracle.com](https://signup.cloud.oracle.com), «Sign Up for Free Cloud Tier». Страна — та, где выпущена карта. **Home Region** выбирается один раз: бери Европу (например, Germany Central (Frankfurt)) — там работает Gemini для Светы. Карта нужна только для проверки: временно блокируется 1 $, платы нет, пока не нажмёшь **Upgrade** (не нажимай; для него нужна блокировка 100 $). Виртуальные и предоплаченные карты Oracle не принимает.
2. **Сервер** — ☰ → Compute → Instances → **Create instance**:
   - Image: **Canonical Ubuntu** 24.04 или 26.04 (не Minimal).
   - Shape: `VM.Standard.A1.Flex` (Ampere, 1 OCPU, 6 GB) или `VM.Standard.E2.1.Micro` (AMD, 1 GB) — только с пометкой **Always Free-eligible**. Micro создаётся не во всех Availability Domain — консоль подсказывает, в каком.
   - Networking: **Create new virtual cloud network** + **Create new public subnet**. Переключатель публичного IP при новой сети может быть серым — тогда создавай без него и добавь IP после (шаг 3).
   - SSH keys: **Paste public key** — открытый ключ с компьютера, откуда будешь подключаться (`ssh-keygen -t ed25519 -f ~/.ssh/thelasthope_oracle`, вставить содержимое `.pub`). «Generate a key pair for me» не бери.
3. **Публичный IP**, если его нет: страница сервера → Networking → Attached VNICs → основной VNIC → **IP administration** → строка `10.0.0.x` → ⋯ → **Edit** → **Ephemeral public IP** → Update.
4. **Порты в облаке**: сеть (VCN) → Security → **Default Security List** → Security rules → **Add Ingress Rules** — два правила: Source CIDR `0.0.0.0/0`, TCP, Destination Port `80`, и такое же с `443`.
5. **Порты внутри сервера**: в образах Oracle iptables по умолчанию закрывает всё, кроме SSH. Вместо ufw:

   ```bash
   sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save
   ```

   Правила должны стоять **до** строки `REJECT` — проверь: `sudo iptables -S INPUT`.
6. **DuckDNS** — впиши IP сервера в current ip и нажми **update ip**. Caddy получит сертификат, когда домен уже указывает на сервер; если он пробовал раньше, перезапусти его: `sudo systemctl restart caddy`.
7. Дальше — разделы 1–5 этой инструкции (пользователь в образе Ubuntu — `ubuntu`: `ssh -i ~/.ssh/thelasthope_oracle ubuntu@IP`).

> Oracle может забрать бесплатный сервер, который долго почти не нагружен. Бот сам делает копии базы раз в сутки; если хочешь хранить их и у себя — раздел 5.

## Два бота на одном сервере (основной и тестовый)

Так сейчас: **основной** бот гильдии (приложение ГМа в Discord) и **тестовый** бот разработчика (своё приложение, тестовый сервер Discord) работают на одном VPS — памяти хватает, каждый занимает 100–150 МБ. Это две независимые копии: свой `.env`, своя база, своя админка. Одно приложение Discord = одна копия, иначе события обрабатываются дважды.

| | Основной | Тестовый |
|---|---|---|
| Папка | `/opt/thelasthope-bot` | `/opt/thelasthope-dev` |
| Служба | `thelasthope-bot` | `thelasthope-dev` |
| Порт админки (`ADMIN_PORT`) | 3000 | 3001 |
| Адрес админки (`ADMIN_URL`) | основной домен | второй домен (например, `имя-dev.duckdns.org`) |

Вторая копия:

```bash
sudo cp -a /opt/thelasthope-bot /opt/thelasthope-dev
```

В её `.env` — ключи второго приложения, `ADMIN_PORT=3001` и `ADMIN_URL=https://второй-домен`; старую базу из `data/` убери, если копия должна начаться с чистой. Служба — та же, с другой папкой:

```bash
sed 's#/opt/thelasthope-bot#/opt/thelasthope-dev#g' /opt/thelasthope-bot/deploy/thelasthope-bot.service | sudo tee /etc/systemd/system/thelasthope-dev.service && sudo systemctl daemon-reload && sudo systemctl enable --now thelasthope-dev
```

В `/etc/caddy/Caddyfile` — второй блок с портом 3001, затем `sudo systemctl reload caddy`:

```text
второй-домен {
	encode gzip
	reverse_proxy 127.0.0.1:3001
}
```

В Discord Developer Portal второго приложения → OAuth2 → Redirects — `https://второй-домен/auth/callback`. Команды регистрируются в каждой папке отдельно: `sudo -u tlh pnpm run deploy`.

**Обновление** — сначала тестовый, проверить, потом основной (раздел 6, в каждой папке и со своей службой).

**Перенести истории Светы о людях** из одной копии в другую — в админке «Света» → «Истории о людях»: «Скачать истории» в одной, «Загрузить истории» и «Сохранить» в другой.
