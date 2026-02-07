const { PermissionsBitField, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
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
            const command = bot.slashCommands.get(interaction.commandName);
            if (command && typeof command.autocomplete === "function") {
                return command.autocomplete(interaction, bot, settings);
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

            if (process.env.CANARY === "true" && !settings.devs.includes(userId)) {
                if (!settings.testers || !settings.testers.includes(userId)) {
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel(t('events:interaction.apply_tester'))
                                .setStyle(ButtonStyle.Link)
                                .setURL("https://forms.gle/3Ai58Yr3vsJKs2dQ9")
                        );

                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('events:interaction.canary_restricted')}`,
                        components: [row],
                        flags: MessageFlags.Ephemeral
                    });
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
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel(t('events:interaction.apply_tester'))
                                .setStyle(ButtonStyle.Link)
                                .setURL("https://forms.gle/3Ai58Yr3vsJKs2dQ9")
                        );

                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('events:interaction.no_permission_command')}`,
                        components: [row],
                        flags: MessageFlags.Ephemeral
                    });
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

            await logger.runWithContext({
                guildId: interaction.guild?.id,
                userId: interaction.user.id,
                command: interaction.commandName,
                channelId: interaction.channel?.id
            }, async () => {
                try {
                    await command.execute(bot, interaction, funcs, settings, logger, t);
                    await interactionHandlers.handleNonCommandInteractions(bot, interaction, userId, users, alertCooldowns);
                } catch (error) {
                    logger.error(error);
                    const errorMsg = { content: `${e.pixel_warning} ${t('events:interaction.error_execution')}`, flags: MessageFlags.Ephemeral };
                    let handled = false;
                    if (interaction.deferred) {
                        try {
                            await interaction.editReply(errorMsg);
                            handled = true;
                        } catch (err) {
                            if (err?.code === 10062 || (err?.message && err.message.includes("Unknown interaction"))) {
                                try {
                                    await interaction.followUp(errorMsg);
                                    handled = true;
                                } catch (err2) {
                                    logger.debug("[interaction.js] followUp failed:", err2);
                                }
                            } else {
                                logger.debug("[interaction.js] editReply failed:", err);
                            }
                        }
                    }
                    if (!handled && interaction.replied) {
                        try {
                            await interaction.followUp(errorMsg);
                            handled = true;
                        } catch (err) {
                            if (err?.code === 10062 || (err?.message && err.message.includes("Unknown interaction"))) {
                                logger.warn("[interaction.js] followUp fallback to reply");
                                try {
                                    await interaction.reply(errorMsg);
                                    handled = true;
                                } catch (err2) {
                                    logger.debug("[interaction.js] reply failed:", err2);
                                }
                            } else {
                                logger.debug("[interaction.js] followUp failed:", err);
                            }
                        }
                    }
                    if (!handled) {
                        try {
                            await interaction.reply(errorMsg);
                        } catch (err) {
                            logger.error("[interaction.js] reply failed:", err);
                        }
                    }
                }
            });
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

        users.updateOne({ userID: userId }, { $set: { lastActive: new Date(), locale: interaction.locale } }).catch(err => logger.debug("[INTERACTION] lastActive/locale update failed:", err));
    }
};

// contributors: @relentiousdragon