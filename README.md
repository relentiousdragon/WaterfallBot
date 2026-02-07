<div align="center">

[Terms of Service](./Terms.md) | [Privacy Policy](./Privacy.md)<br><br>
[![Invite Waterfall](https://img.shields.io/badge/Invite%20Waterfall-5865F2?logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=1435231722714169435)  
[![Support Server](https://img.shields.io/discord/1431000295265140751?color=5865F2&label=DevSiege%20Studios&logo=discord&logoColor=white)](https://discord.gg/qD3yfKGk5g)  
![License](https://img.shields.io/badge/License-GPL--3.0-blue)  
![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen)  
![Version](https://img.shields.io/badge/Waterfall-1.3.3-00bfff)  
[![Crowdin](https://badges.crowdin.net/waterfall/localized.svg)](https://crowdin.com/project/waterfall)

</div>

---

Waterfall is a **modular, slash-command–driven, scalable Discord bot** designed for clarity, maintainability, and performance.
<br><br>**Note:** *Sharding in still a work in progress, so it is not recommended to use sharding for now. You may need to modify the sharding system for it to work as desired.*
<br>
- [Slash Commands](./commands.md)
- Clean, consistent UX  
- Stable long-running behavior  
- Strong moderation suite  
- AI & search utilities  
- Admin & management tools  
- utility features  
- Webhook-based logging  
- Developer-friendly architecture  
- ComponentsV2 embeds
- localization (i18n)  

---

## Features:

### 🛡️ Moderation
- Automod system  
- Anti-spam / anti-mention  
- Kick / ban 
- Warnings with mod-logs  
- Bot detection
- History tracking  
- Tiered escalation  

### ⚙️ Server Utility
- Member info, server info  
- Message utilities  
- Channel utilities 
- Role helpers  
- Server statistics

### 🌐 AI & Research
- Gemini AI  
- WolframAlpha  
- Lookup utilities  
- Dictionary stuff  

### 💻 Developer Features
- Hot reload commands  
- Hot reload events  
- Shard management  
- GitHub integration  
- Debug tools  
- Centralized logging system
- Analytics system with 30 day history
- Shards status

---

## 🔗 Invite Waterfall

Use this link to invite the bot:

**https://discord.com/oauth2/authorize?client_id=1435231722714169435**

---

## 🛠 Self-Hosting

### 1. Requirements
- Node.js **22+**  
- MongoDB instance  
- Discord bot token  
- Optional: Gemini / SerpAPI / OMDb / WolframAlpha / Other API keys 

---

### 2. Install

```bash
git clone https://github.com/DevSiege-Studios/waterfall.git
cd waterfall
npm install
```

---

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Now fill in the `.env` file:

```
token=YOUR_DISCORD_BOT_TOKEN
CLIENT_ID=YOUR_CLIENT_ID
MONGO_URI=YOUR_MONGO_URI

# shard config (Default: 0)
SHARD_ID=0
GOOGLE_API_KEY=your_google_api_key
GOOGLE_CSE_ID=your_google_cse_id
SERPAPI_KEY=your_serpapi_key
OMDB_API_KEY=your_omdb_api_key
WOLFRAM_APP_ID=your_wolfram_app_id
GEMINI_API_KEY=your_gemini_api_key
```

---

### 4. Configure Settings

Copy the example settings file and configure it:

```bash
cp util/settings.json.example util/settings.json
```

Edit `util/settings.json` with your configuration:

```json
{
    "logWebhook": ["CHANNEL_ID", "TOKEN"],        // Primary logging webhook
    "logWebhook2": ["CHANNEL_ID", "TOKEN"],       // Secondary logging webhook
    "reportWebhook": ["CHANNEL_ID", "TOKEN"],     // User reports webhook
    "suggestWebhook": ["CHANNEL_ID", "TOKEN"],    // Suggestions webhook
    "joinWebhook": ["CHANNEL_ID", "TOKEN"],       // Bot guild join events
    "leaveWebhook": ["CHANNEL_ID", "TOKEN"],      // Bot guild leave events
    "devs": ["USER_ID"],                          // Developer user IDs
    "testers": ["USER_ID"],                       // Beta tester user IDs
    "moderators": ["USER_ID"],                    // Bot moderator user IDs
    "event": "none",                              // Special event mode
    "debug": "false",                             // Debug mode (true/false)
    "prefix": ">",                                // Legacy prefix (if needed)
    "version": "1.1.0"                            // Bot version
}
```

**Webhook URLs:** To get webhook URLs, create a webhook in Discord and use the format:
- Channel ID: The number after `/webhooks/` in the webhook URL
- Token: The string after the channel ID

Example: `https://discord.com/api/webhooks/123456789/abcdefghijklmnop`
- Channel ID: `123456789`
- Token: `abcdefghijklmnop`

---

### 5. Start the Bot

```bash
npm run start
```

---

### 6. Deploy Commands

```bash
npm run deploy
```

---

## 📁 Project Structure

```
waterfall/
 ├─ commands/
 │   └─ prefix commands... # Disabled, can be enabled from /events/message.js
 ├─ slashCommands/
 │   ├─ gen/
 │   ├─ mod/
 │   ├─ dev/
 │   ├─ utility/
 │   └─ bot/
 ├─ events/
 ├─ schemas/
 ├─ scripts/
 ├─ util/
 │   ├─ i18n.js
 │   ├─ settingsModule.js
 │   ├─ settings.json
 │   └─ ...
 ├─ bot.js
 ├─ shardManager.js
 ├─ generateCommands.js
 ├─ deploy-commands.js
 ├─ logger.js
 ├─ package.json
 ├─ hourlyWorker.js
 ├─ dailyWorker.js
 ├─ crowdin.yml
 └─ README.md
```

---

# 🌍 Translation (Crowdin)

We support community translations through Crowdin:

> https://crowdin.com/project/waterfall/

If you'd like to contribute, join the project and help translate Waterfall into more languages!

---

# 🤝 Contributing

Contributions are welcome!  
If you'd like to help:

1. Fork the repo  
2. Create a feature branch  
3. Submit a pull request  

For larger changes, open an issue or chat with us in the support server:

> https://discord.gg/qD3yfKGk5g

---

# ❤️ Credits

Waterfall is developed and maintained by **DevSiege Studios**.

Special thanks to:

- Community translators  
- Contributors who helped shape the codebase  
- Testers & early adopters  
- Our Discord community  

---

# 📜 License

Waterfall is licensed under the **GPL-3.0** license.  
This means:

- You may use, modify, and distribute Waterfall  
- You **must** disclose source if redistributed  
- You **must** keep the same license  

Full license text is available in `LICENSE`.

---

# 💬 Support & Community

Need help or want to discuss Waterfall?

Join our support server:

> https://discord.gg/qD3yfKGk5g

---

# 🏁 Final Notes

Thank you for using or contributing to Waterfall!  
If you enjoy the bot, consider starring the repository and sharing it with others.
- DevSiege Studios

