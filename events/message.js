const { PermissionsBitField, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const { settings } = require("../index.js");
const funcs = require("../util/functions.js");
const { Server } = require("../schemas/servers.js");
const users = require("../schemas/users.js");
const cooldowns = new Map();
const alertCooldowns = new Map();
const adminCommands = ["prefix", "p"];
const serverCache = new Map();

async function getServerData(guildId) {
    const cacheData = serverCache.get(guildId);

    if (cacheData && (Date.now() - cacheData.timestamp < 60 * 60 * 1000)) {
        return cacheData.data;
    }

    const serverData = await Server.findOne({ serverID: guildId });

    serverCache.set(guildId, { data: serverData, timestamp: Date.now() });

    return serverData;
}

function updateServerCache(guildId, updatedData) {
    serverCache.set(guildId, { data: updatedData, timestamp: Date.now() });
}

module.exports = {
    name: "messageCreate",
    execute: async (bot, message) => {
        if (message.author.bot) return;
        if (message.mentions.everyone) return;
        const isBotMentionedd = message.content.trim() === `<@${bot.user.id}>`;
        if (!isBotMentionedd) return;
        if (isBotMentionedd) {
            try {
                return message.reply("👋 Hi There, i'm Waterfall. You can use </help:1442513505755463895> to see a list of commands.");
            } catch {
                return;
            }
        }
        return;
        const serverData = await getServerData(message.guild.id);
        const prefix = serverData ? serverData.prefix : settings.prefix;

        // settings = getSettings(); 

        const isBotMentioned = message.content === `<@${bot.user.id}>`;
        if (!message.content.startsWith(prefix) && !isBotMentioned) return;

        const args = message.content.substring(prefix.length).trim().split(/ +/g);
        const commandName = args.shift().toLowerCase();
        const command = bot.commands.get(commandName) || bot.commands.find(cmd => cmd.help.aliases && cmd.help.aliases.includes(commandName));


        /* if (serverData && serverData.disabledChannels.includes(message.channel.id) && 
            !adminCommands.includes(commandName) && 
            !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return;
        } */

        if (settings.event === "maintenance" && !settings.devs.includes(message.author.id)) {
            try {
                return message.reply("🔧 The bot is currently under maintenance. We'll be back soon.");
            } catch {
                return;
            }
        }

        if (isBotMentioned) {
            try {
                return message.reply(`👋 Hi There, The prefix for this server is \`${prefix}\`. You can use **\`${prefix}help\`** for more information.`);
            } catch {
                return;
            }
        }

        if (!message.channel.permissionsFor(bot.user).has(PermissionsBitField.Flags.SendMessages)) {
            logger.warn("NO PERMISSION TO SEND MESSAGES");
            return;
        }

        if (!command) {
            return;
        }

        if (command.help.dev && !settings.devs.includes(message.author.id)) return;

        const userId = message.author.id;
        if (cooldowns.has(userId)) {
            const expirationTime = cooldowns.get(userId);
            if (Date.now() < expirationTime) {
                return;
            }
        }

        cooldowns.set(userId, Date.now() + 850);

        try {
            await command.run(bot, message, args, funcs, prefix);

            if (adminCommands.includes(commandName)) {
                const updatedServerData = await Server.findOne({ serverID: message.guild.id });
                updateServerCache(message.guild.id, updatedServerData);
            }
        } catch (err) {
            logger.error("Error executing command: ", err);
            message.reply("<:Warning:1298554229438550088> An error occured while trying to execute that command!");
        }
        if (adminCommands.includes(commandName)) {
            return;
        } else {
            if (alertCooldowns.has(userId)) {
                const expirationTime2 = alertCooldowns.get(userId);
                if (Date.now() < expirationTime2) {
                    return;
                }
            }

            alertCooldowns.set(userId, Date.now() + 3600000);
            const userMail = await users.findOne({ "mail.read": false, userID: userId });
            if (userMail && userMail.mail && userMail.mail.some(mail => mail.read !== true)) {
                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle("You have unread mail!")
                    .setDescription(`Hey <@${userId}>, check your mail using \`${prefix}mail\`.`)
                    .setThumbnail("https://media.discordapp.net/attachments/1005773484028350506/1301842300044972052/jPip3Me.gif?ex=6725f29f&is=6724a11f&hm=928b062b8e393d663fea1252daacf995c071cae852e3b9d1e7be82fcc8fe4341&=&width=472&height=472")
                    .setTimestamp();

                await message.channel.send({ embeds: [embed] });
            }
        }
    }
};

// DISABLED
/* function getSettings() {
    return JSON.parse(fs.readFileSync('./util/settings.json', 'utf8'));
} */
