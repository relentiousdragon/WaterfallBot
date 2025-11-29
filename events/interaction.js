const { PermissionsBitField, EmbedBuilder, MessageFlags } = require("discord.js");
const fs = require("fs");
const { settings } = require("../index.js");
const funcs = require("../util/functions.js");
const { Server } = require("../schemas/servers.js");
const users = require("../schemas/users.js");
const cooldowns = new Map();
const buttonCooldowns = new Map();
const alertCooldowns = new Map();
const interactionHandlers = require("../util/interactionHandlers.js");
const logger = require("../logger.js");
const e = require("../data/emoji.js");

module.exports = {
    name: "interactionCreate",
    execute: async (bot, interaction) => {
        const userId = interaction.user.id;
        if (interaction.isAutocomplete()) {
            if (interaction.commandName === "preferences") {
                const command = bot.slashCommands.get("preferences");
                if (command && typeof command.autocomplete === "function") {
                    return command.autocomplete(interaction, bot, settings);
                }
            }
            if (interaction.commandName === "find-server") {
                const command = bot.slashCommands.get("find-server");
                if (command && typeof command.autocomplete === "function") {
                    return command.autocomplete(interaction, bot, settings);
                }
            }
        }
        if (interaction.isCommand()) {
            const command = bot.slashCommands.get(interaction.commandName);

            if (interaction.channel && interaction.guild) {
                const botPermissions = (interaction.channel.permissionsFor(interaction.guild.members.me) != null ? interaction.channel.permissionsFor(interaction.guild.members.me) : null);
                if (!botPermissions?.has(PermissionsBitField.Flags.ViewChannel) || !botPermissions.has(PermissionsBitField.Flags.SendMessages)) {
                    return interaction.reply({ content: `${e.pixel_cross} I don't have the necessary permissions to process slash commands in this channel.`, flags: MessageFlags.Ephemeral });
                }
            }

            if (!settings.devs.includes(userId)) {
                const userData = await users.findOne({ userID: userId }).lean();
                if (userData && userData.banned) {
                    return interaction.reply({ content: `${e.deny} You are banned from using this bot.`, flags: MessageFlags.Ephemeral });
                }

                if (interaction.guild) {
                    const serverData = await Server.findOne({ serverID: interaction.guild.id }).lean();
                    if (serverData && serverData.banned) {
                        return interaction.reply({ content: `${e.deny} This server is banned from using this bot.`, flags: MessageFlags.Ephemeral });
                    }
                }
            }

            if (settings.event === "maintenance" && !settings.devs.includes(interaction.user.id)) {
                try {
                    return interaction.reply({ content: `${e.pixel_cross} The bot is currently on maintenance. We'll be back soon.`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }
            if (!command) {
                return interaction.reply({ content: `${e.pixel_cross} This command is not available for this server yet.`, flags: MessageFlags.Ephemeral });
            }
            // dev commands
            if (command.dev && !settings.devs.includes(interaction.user.id)) return interaction.reply({ content: `${e.pixel_cross} You don't have permissions to use this command!`, flags: MessageFlags.Ephemeral });

            // mod commands
            if (command.mod && !settings.devs.includes(interaction.user.id)) {
                if (!settings.moderators || !settings.moderators.includes(interaction.user.id)) {
                    return interaction.reply({ content: `${e.pixel_cross} You don't have permissions to use this command!`, flags: MessageFlags.Ephemeral });
                }
            }

            // beta/tester commands
            if (command.beta && !settings.devs.includes(interaction.user.id)) {
                if (!settings.testers || !settings.testers.includes(interaction.user.id)) {
                    return interaction.reply({ content: `${e.pixel_cross} You don't have permissions to use this command!`, flags: MessageFlags.Ephemeral });
                }
            }
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId);
                if (Date.now() < expirationTime) {
                    return interaction.reply({ content: `${e.pixel_cross} Please Slow Down!`, flags: MessageFlags.Ephemeral });
                }
            }

            cooldowns.set(userId, Date.now() + 850);
            try {
                await command.execute(bot, interaction, funcs, settings, logger);
                await interactionHandlers.handleNonCommandInteractions(bot, interaction, userId, users, alertCooldowns);
            } catch (error) {
                logger.error(error);
                if (interaction.replied && interaction.deferred) {
                    await interaction.editReply({ content: `${e.pixel_warning} An error occured while executing this command.`, flags: MessageFlags.Ephemeral });
                } else if (interaction.replied) {
                    await interaction.followUp({ content: `${e.pixel_warning} An error occured while executing this command.`, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: `${e.pixel_warning} An error occured while executing this command.`, flags: MessageFlags.Ephemeral });
                }
            }
        } else if (interaction.isButton()) {
            const btnExpiration = buttonCooldowns.get(userId);
            if (btnExpiration && Date.now() < btnExpiration) {
                return interaction.reply({
                    content: `${e.pixel_cross} Hold your horses for a bit, You're clicking too fast!`,
                    flags: MessageFlags.Ephemeral
                });
            }
            buttonCooldowns.set(userId, Date.now() + 1000);

            await interactionHandlers.handleButtonInteraction(interaction, users, settings);
        } else if (interaction.isStringSelectMenu()) {
            await interactionHandlers.handleSelectMenuInteraction(bot, interaction, settings, logger);
        }
    }
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}