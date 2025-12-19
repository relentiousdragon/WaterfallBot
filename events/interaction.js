const { PermissionsBitField, EmbedBuilder, MessageFlags } = require("discord.js");
const fs = require("fs");
const { settings } = require("../util/settingsModule.js");
const funcs = require("../util/functions.js");
const { Server } = require("../schemas/servers.js");
const users = require("../schemas/users.js");
const cooldowns = new Map();
const buttonCooldowns = new Map();
const alertCooldowns = new Map();
const interactionHandlers = require("../util/interactionHandlers.js");
const logger = require("../logger.js");
const e = require("../data/emoji.js");
const { i18n } = require("../util/i18n.js");
const analyticsWorker = require("../util/analyticsWorker.js");
//
module.exports = {
    name: "interactionCreate",
    execute: async (bot, interaction) => {
        const userId = interaction.user.id;
        if (interaction.isCommand()) {
            analyticsWorker.trackInteraction(interaction.commandName);
        } else {
            analyticsWorker.trackInteraction();
        }

        const t = i18n.getFixedT(interaction.locale);

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
            if (interaction.commandName === "automod") {
                const command = bot.slashCommands.get("automod");
                if (command && typeof command.autocomplete === "function") {
                    return command.autocomplete(interaction, bot, settings);
                }
            }
            if (interaction.commandName === "warn") {
                const command = bot.slashCommands.get("warn");
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
                    return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.no_permissions')}`, flags: MessageFlags.Ephemeral });
                }
            }

            if (!settings.devs.includes(userId)) {
                const userData = await users.findOne({ userID: userId }).lean();
                if (userData && userData.banned) {
                    return interaction.reply({ content: `${e.deny} ${t('events:interaction.user_banned')}`, flags: MessageFlags.Ephemeral });
                }

                if (interaction.guild) {
                    const serverData = await Server.findOne({ serverID: interaction.guild.id }).lean();
                    if (serverData && serverData.banned) {
                        return interaction.reply({ content: `${e.deny} ${t('events:interaction.server_banned')}`, flags: MessageFlags.Ephemeral });
                    }
                }
            }

            if (settings.event === "maintenance" && !settings.devs.includes(interaction.user.id)) {
                try {
                    return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.maintenance')}`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }
            if (!command) {
                return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.command_unavailable')}`, flags: MessageFlags.Ephemeral });
            }
            // dev commands
            if (command.dev && !settings.devs.includes(interaction.user.id)) return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.no_permission_command')}`, flags: MessageFlags.Ephemeral });

            // mod commands
            if (command.mod && !settings.devs.includes(interaction.user.id)) {
                if (!settings.moderators || !settings.moderators.includes(interaction.user.id)) {
                    return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.no_permission_command')}`, flags: MessageFlags.Ephemeral });
                }
            }

            // beta/tester commands
            if (command.beta && !settings.devs.includes(interaction.user.id)) {
                if (!settings.testers || !settings.testers.includes(interaction.user.id)) {
                    return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.no_permission_command')}`, flags: MessageFlags.Ephemeral });
                }
            }

            if (command.help) {
                const helpUserPerms = command.help.permissions || [];
                const helpBotPerms = command.help.botPermissions || [];

                if (interaction.guild && helpBotPerms.length > 0) {
                    const botMember = interaction.guild.members.me;
                    const missingBotPerms = [];
                    for (const perm of helpBotPerms) {
                        const flag = PermissionsBitField.Flags[perm];
                        if (flag) {
                            if (!botMember.permissions.has(flag)) {
                                missingBotPerms.push(perm);
                            }
                        }
                    }
                    if (missingBotPerms.length > 0) {
                        const permList = missingBotPerms.join(", ");
                        return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.bot_missing_permissions', { perms: permList })}`, flags: MessageFlags.Ephemeral });
                    }
                }

                if (helpUserPerms.length > 0) {
                    const missingUserPerms = [];
                    for (const perm of helpUserPerms) {
                        if (!perm) continue;
                        const p = perm.toString();
                        const lower = p.toLowerCase();

                        if (lower === 'developer') {
                            if (!(settings.devs && settings.devs.includes(userId))) {
                                missingUserPerms.push('Developer');
                            }
                            continue;
                        }
                        if (lower === 'moderator') {
                            if (!((settings.devs && settings.devs.includes(userId)) || (settings.moderators && settings.moderators.includes(userId)))) {
                                missingUserPerms.push('Moderator');
                            }
                            continue;
                        }
                        if (lower === 'tester') {
                            if (!((settings.devs && settings.devs.includes(userId)) || (settings.testers && settings.testers.includes(userId)))) {
                                missingUserPerms.push('Tester');
                            }
                            continue;
                        }

                        const flag = PermissionsBitField.Flags[p];
                        if (flag && !interaction.memberPermissions?.has(flag)) {
                            missingUserPerms.push(p);
                        }
                    }

                    if (missingUserPerms.length > 0) {
                        const permList = missingUserPerms.join(", ");
                        return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.user_missing_permissions', { perms: permList })}`, flags: MessageFlags.Ephemeral });
                    }
                }
            }
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId);
                if (Date.now() < expirationTime) {
                    return interaction.reply({ content: `${e.pixel_cross} ${t('events:interaction.cooldown')}`, flags: MessageFlags.Ephemeral });
                }
            }

            cooldowns.set(userId, Date.now() + 850);

            logger.setContext({
                guildId: interaction.guild?.id,
                userId: interaction.user.id,
                command: interaction.commandName,
                channelId: interaction.channel?.id
            });

            try {
                await command.execute(bot, interaction, funcs, settings, logger, t);
                await interactionHandlers.handleNonCommandInteractions(bot, interaction, userId, users, alertCooldowns);
            } catch (error) {
                logger.error(error);
                if (interaction.deferred) {
                    await interaction.editReply({ content: `${e.pixel_warning} ${t('events:interaction.error_execution')}`, flags: MessageFlags.Ephemeral });
                } else if (interaction.replied) {
                    await interaction.followUp({ content: `${e.pixel_warning} ${t('events:interaction.error_execution')}`, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: `${e.pixel_warning} ${t('events:interaction.error_execution')}`, flags: MessageFlags.Ephemeral });
                }
            } finally {
                logger.clearContext();
            }
        } else if (interaction.isButton()) {
            const btnExpiration = buttonCooldowns.get(userId);
            if (btnExpiration && Date.now() < btnExpiration) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('events:interaction.button_cooldown')}`,
                    flags: MessageFlags.Ephemeral
                });
            }
            buttonCooldowns.set(userId, Date.now() + 1000);

            await interactionHandlers.handleButtonInteraction(bot, interaction, users, settings, logger, t);
        } else if (interaction.isStringSelectMenu()) {
            await interactionHandlers.handleSelectMenuInteraction(bot, interaction, settings, logger, t);
        } else if (interaction.isModalSubmit()) {
            await interactionHandlers.handleModalInteraction(bot, interaction, settings, logger, t);
        }
    }
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}