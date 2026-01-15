# Waterfall Commands

*Last updated: Thu, 15 Jan 2026 06:48:34 GMT*

## Commands

- 🤖 **Bot** (8)
- 💻 **Dev** (13)
- 🎲 **Games** (3)
- 🧭 **General** (8)
- 🛡️ **Moderation** (8)
- ⚙️ **Utility** (6)

---

## 🤖 Bot

### `/botprofile`

The profile theme to apply

**Required Permissions:** Administrator

---

### `/botstats`

Display bot performance metrics.

---

### `/credits`

View the credits and contributors of Waterfall

---

### `/mail`

Check your mail

---

### `/preferences`

Manage your preferences related to the usage of Waterfall

**Subcommands:**

- `/preferences notifications` - Manage your notification settings

---

### `/report`

Report a user or a bot issue/bug

---

### `/suggestion`

Suggest Commands or Functions for the Bot

---

### `/vote`

Vote for the bot!

---

## 💻 Dev

### `/_ban`

`👮 Moderator Only`

Ban a user or server from using the bot (DEV ONLY)

**Required Permissions:** moderator

**Subcommands:**

- `/_ban user` - Ban or unban a user
- `/_ban server` - Ban or unban a server

---

### `/_leave`

`👮 Moderator Only`

Team Only

**Required Permissions:** moderator

---

### `/add-beta`

`🔧 Developer Only`

Add a user to the beta testers list (DEV ONLY)

**Required Permissions:** developer

---

### `/find-emoji`

`🔧 Developer Only`

Search for an emoji and get its value (DEV ONLY)

**Required Permissions:** moderator

---

### `/find-locale`

`🧪 Beta`

Get the value of a locale key

**Required Permissions:** tester

---

### `/find-server`

`🔧 Developer Only`

Find and view info about servers the bot is in (DEV ONLY)

**Required Permissions:** Developer

---

### `/git`

`🔧 Developer Only`

Github repository management (DEV ONLY)

**Required Permissions:** Developer

**Subcommands:**

- `/git pull` - Pull latest changes from GitHub
- `/git status` - Check GitHub repository status

---

### `/mail-send`

`🔧 Developer Only`

Send mail to a user or everyone (DEV ONLY)

**Required Permissions:** Developer

---

### `/progressbar`

`🧪 Beta`

Generate a progress bar.  (DEV ONLY)

---

### `/reload`

`🔧 Developer Only`

Reload commands, events, or deploy all slash commands

**Required Permissions:** Developer

**Subcommands:**

- `/reload command` - Reload a single slash command
- `/reload event` - Reload a single event
- `/reload all-events` - Reload all events
- `/reload all-commands` - Reload all slash commands
- `/reload deploy` - Re-deploy all slash commands via REST

---

### `/set-hangman`

`🔧 Developer Only`

Set the daily Hangman word

---

### `/status`

`🔧 Developer Only`

Show current performance metrics. (DEV ONLY)

**Required Permissions:** Developer

---

### `/worker`

`🔧 Developer Only`

Manually trigger hourly income or daily worker tasks (DEV ONLY)

**Required Permissions:** Developer

---

## 🎲 Games

### `/connect4`

Play Connect 4 against Waterfall or a friend

---

### `/hangman`

Play the daily Hangman word game

---

### `/rps`

Play Rock Paper Scissors against Waterfall or another player

---

## 🧭 General

### `/dictionary`

Look up the definition of an English word

---

### `/gemini`

Ask Google Gemini (AI) a question

---

### `/help`

View all available commands

---

### `/meme`

Get a random meme

---

### `/search`

Search the web

**Subcommands:**

- `/search duckduckgo` - Search DuckDuckGo
- `/search google` - Search Google
- `/search bing` - Search Bing
- `/search yahoo` - Search Yahoo
- `/search yandex` - Search Yandex
- `/search wikipedia` - Search Wikipedia
- `/search stackoverflow` - Search StackOverflow
- `/search news` - Search DuckDuckGo News
- `/search queries` - Get links to all search engines

---

### `/server`

Get information about the current server

---

### `/serverstats`

`🧪 Beta`

View and manage server statistics

**Subcommands:**

- `/serverstats enable` - Enable server stats tracking (Admin only)
- `/serverstats disable` - Disable server stats tracking (Admin only)
- `/serverstats overview` - View server stats overview with message graph
- `/serverstats activity` - View peak hours and activity patterns
- `/serverstats voice` - View voice channel activity leaderboard
- `/serverstats invites` - View invite tracking leaderboard
- `/serverstats export` - Export server stats

---

### `/user`

Get information about a user

---

## 🛡️ Moderation

### `/automod`

Manage server auto-mod rules

**Required Permissions:** ManageGuild

**Bot Permissions:** ManageGuild

**Subcommands:**

- `/automod setup` - Interactive AutoMod setup with presets
- `/automod list` - List all AutoMod rules
- `/automod create` - Create a custom AutoMod rule
- `/automod advanced` - Create an advanced regex rule for a keyword
- `/automod delete` - Delete an AutoMod rule
- `/automod toggle` - Enable or disable an AutoMod rule

---

### `/bot-detection`

`🧪 Beta`

Configure automatic bot/spam detection

**Required Permissions:** ManageGuild

**Bot Permissions:** ModerateMembers, KickMembers

**Subcommands:**

- `/bot-detection setup` - Interactive bot detection setup
- `/bot-detection status` - View current bot detection settings

---

### `/language`

Set the server language

**Required Permissions:** ManageGuild

---

### `/logs`

Configure server logging

**Required Permissions:** ManageGuild

**Bot Permissions:** ManageWebhooks, ViewAuditLog

**Subcommands:**

- `/logs enable` - Enable a log type
- `/logs disable` - Disable a log type
- `/logs list` - Show current log configuration
- `/logs ignore-bots` - Toggle logging of bot messages

---

### `/purge`

Delete messages in bulk

**Required Permissions:** ManageMessages

**Bot Permissions:** ManageMessages

---

### `/role`

Get Role Informations

**Required Permissions:** ManageRoles

---

### `/timeout`

Timeout a user for a specific duration

**Required Permissions:** ModerateMembers

**Bot Permissions:** ModerateMembers

---

### `/warn`

Manage user warnings

**Required Permissions:** ModerateMembers

**Bot Permissions:** ModerateMembers

**Subcommands:**

- `/warn add` - Warn a user
- `/warn list` - View warnings for a user
- `/warn remove` - Remove a specific warning
- `/warn clear` - Clear all warnings for a user
- `/warn config` - Configure warning thresholds

---

## ⚙️ Utility

### `/color`

Get detailed information about a color

---

### `/convert`

Universal conversion tool

**Subcommands:**

- `/convert length` - Convert length / distance
- `/convert temperature` - Convert temperature
- `/convert mass` - Convert mass / weight
- `/convert data` - Convert data / file size
- `/convert currency` - Convert currencies
- `/convert time` - Convert time between timezones
- `/convert unix` - Convert dates to Unix timestamps and vice-versa
- `/convert area` - Convert area
- `/convert volume` - Convert volume
- `/convert power` - Convert power & energy
- `/convert speed` - Convert speed

---

### `/generate`

Generate things using Waterfall

**Bot Permissions:** EmbedLinks, AttachFiles

**Subcommands:**

- `/generate emoji` - Combine two emojis to create a new one!

---

### `/github`

Get information about GitHub users or repositories

**Subcommands:**

- `/github user` - Get information about a GitHub user
- `/github repo` - Get information about a GitHub repository

---

### `/minecraft`

Minecraft utilities

**Subcommands:**

- `/minecraft server` - Get the status of a Minecraft Server
- `/minecraft skin` - Get the skin of a Minecraft player

---

### `/wolframalpha`

Query Wolfram|Alpha for computational answers

**Bot Permissions:** EmbedLinks, AttachFiles

---

---

**Badges:**
🔧 Developer Only | 👮 Moderator Only | 🧪 Beta

Developer and Moderator roles are configured in `settings.json`.
