const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require("discord.js");
const users = require("../../schemas/users.js");
const { Server } = require("../../schemas/servers.js");
const e = require("../../data/emoji.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("_ban")
        .setDescription("Ban a user or server from using the bot (DEV ONLY)")
        .addSubcommand(subcommand =>
            subcommand
                .setName("user")
                .setDescription("Ban or unban a user")
                .addStringOption(option => option.setName("user_id").setDescription("The ID of the user to ban/unban").setRequired(true))
                .addBooleanOption(option => option.setName("state").setDescription("True to ban, False to unban").setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("server")
                .setDescription("Ban or unban a server")
                .addStringOption(option => option.setName("server_id").setDescription("The ID of the server to ban/unban").setRequired(true))
                .addBooleanOption(option => option.setName("state").setDescription("True to ban, False to unban").setRequired(true))),
    mod: true,
    explicit: process.env.CANARY === "true" ? false : true,
    async execute(bot, interaction, funcs, settings, logger) {
        try {
            const isModerator = settings.moderators && settings.moderators.includes(interaction.user.id);
            const isDev = settings.devs.includes(interaction.user.id);

            if (!isDev && !isModerator) {
                return interaction.reply({ content: `${e.deny} You don't have permission to use this command.`, flags: MessageFlags.Ephemeral });
            }

            const subcommand = interaction.options.getSubcommand();
            const state = interaction.options.getBoolean("state");

            if (subcommand === "user") {
                const userId = interaction.options.getString("user_id");

                if (state && settings.devs.includes(userId)) {
                    return interaction.reply({ content: `${e.deny} You cannot ban a developer.`, flags: MessageFlags.Ephemeral });
                }

                if (state && !isDev && settings.moderators && settings.moderators.includes(userId)) {
                    return interaction.reply({ content: `${e.deny} You cannot ban a moderator.`, flags: MessageFlags.Ephemeral });
                }

                const userData = await users.findOne({ userID: userId });
                if (userData && userData.banned === state) {
                    return interaction.reply({ content: `${e.deny} User ${userId} is ${state ? "already banned" : "not banned"}.`, flags: MessageFlags.Ephemeral });
                }
                if (!userData && !state) {
                    return interaction.reply({ content: `${e.deny} User ${userId} is not banned or the database has no user with this ID.`, flags: MessageFlags.Ephemeral });
                }

                let targetUser;
                try {
                    targetUser = await bot.users.fetch(userId);
                } catch (err) {
                    targetUser = null;
                }

                await users.findOneAndUpdate(
                    { userID: userId },
                    { banned: state },
                    { upsert: true, new: true }
                );

                const userDisplay = targetUser ? `${targetUser.tag} (${userId})` : userId;

                const logEmbed = new EmbedBuilder()
                    .setColor(state ? 0xff0000 : 0x00ff00)
                    .setTitle(`${state ? "<:ban:1442932975544307732> User Banned" : "<:add:1442938199524769902> User Unbanned"}`)
                    .setDescription(`**User:** ${userDisplay}\n**Moderator:** ${interaction.user.tag} (${interaction.user.id})`)
                    .setTimestamp();

                if (bot.logWebhook) bot.logWebhook.send({ embeds: [logEmbed] });

                return interaction.reply({
                    content: `${state ? e.ban_hammer_red : e.add_green} User ${userDisplay} has been ${state ? "BANNED" : "UNBANNED"}.`
                });

            } else if (subcommand === "server") {
                const serverId = interaction.options.getString("server_id");

                if (state && serverId === "1440117235401363508") {
                    return interaction.reply({ content: `${e.deny} You cannot ban this server.`, flags: MessageFlags.Ephemeral });
                }

                const serverData = await Server.findOne({ serverID: serverId });
                if (serverData && serverData.banned === state) {
                    return interaction.reply({ content: `${e.deny} Server ${serverId} is ${state ? "already banned" : "not banned"}.`, flags: MessageFlags.Ephemeral });
                }
                if (!serverData && !state) {
                    return interaction.reply({ content: `${e.deny} Server ${serverId} is not banned or the database has no server with this ID.`, flags: MessageFlags.Ephemeral });
                }

                await Server.findOneAndUpdate(
                    { serverID: serverId },
                    { banned: state },
                    { upsert: true, new: true }
                );

                let baldino = "";
                if (state) {
                    const guild = bot.guilds.cache.get(serverId);
                    if (guild) {
                        try {
                            await guild.leave();
                            baldino = " I have left the server.";
                        } catch (err) {
                            baldino = ` Failed to leave server: ${err.message}`;
                        }
                    } else {
                        baldino = " I am not in that server.";
                    }
                }

                const logEmbed = new EmbedBuilder()
                    .setColor(state ? 0xff0000 : 0x00ff00)
                    .setTitle(`${state ? "<:ban:1442932975544307732> Server Banned" : "<:add:1442938199524769902> Server Unbanned"}`)
                    .setDescription(`**Server ID:** ${serverId}\n**Moderator:** ${interaction.user.tag} (${interaction.user.id})`)
                    .setTimestamp();

                if (bot.logWebhook) bot.logWebhook.send({ embeds: [logEmbed] });

                return interaction.reply({
                    content: `${state ? e.ban_hammer_red : e.add_green} Server ${serverId} has been ${state ? "BANNED" : "UNBANNED"}.${baldino}`
                });
            }

        } catch (error) {
            logger.error("Error executing ban command:", error);
            return interaction.reply({ content: `${e.pixel_cross} An error occurred while executing the command.`, flags: MessageFlags.Ephemeral });
        }
    },
    help: {
        name: "_ban",
        description: "Ban management",
        category: "Dev",
        permissions: ["moderator/dev"],
        botPermissions: []
    }
};
