const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionsBitField, ApplicationCommandType, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const users = require("../schemas/users.js");
const globalMails = require("../schemas/global_mails.js");
const e = require("../data/emoji.js");
const { parseEmoji } = require("./functions.js");
const { i18n } = require("./i18n.js");
const logger = require('../logger.js');
//
async function handleNonCommandInteractions(bot, interaction, userId, users, alertCooldowns) {
    const t = i18n.getFixedT(interaction.locale);
    const commandName = interaction.commandName;
    const adminCommands = ["help", "botinfo", "status"];
    if (adminCommands.includes(commandName) || commandName == "mail") {
        return;
    } else {
        if (alertCooldowns.has(userId)) {
            const expirationTime2 = alertCooldowns.get(userId);
            if (Date.now() < expirationTime2) {
                return;
            }
        }

        alertCooldowns.set(userId, Date.now() + 3600000);

        const userDoc = await users.findOne({ userID: userId });
        let hasUnread = false;

        if (userDoc) {
            if (userDoc.mail && userDoc.mail.some(mail => mail.read !== true)) {
                hasUnread = true;
            }

            if (!hasUnread) {
                const currentTime = new Date();
                const activeGlobalMails = await globalMails.find({ expiry: { $gt: currentTime } });
                const readGlobalIds = userDoc.read_global_mails || [];
                const unreadGlobalMails = activeGlobalMails.filter(gm => !readGlobalIds.includes(gm._id.toString()));

                if (unreadGlobalMails.length > 0) {
                    hasUnread = true;
                }
            }
        }

        if (hasUnread) {
            const embed = new EmbedBuilder()
                .setColor(0x356ee8)
                .setTitle(t('events:handlers.unread_mail_title'))
                .setDescription(t('events:handlers.unread_mail_description', { user: `<@${userId}>` }))
                .setThumbnail("https://media.discordapp.net/attachments/1005773484028350506/1301842300044972052/jPip3Me.gif?ex=6725f29f&is=6724a11f&hm=928b062b8e393d663fea1252daacf995c071cae852e3b9d1e7be82fcc8fe4341&=&width=472&height=472")
                .setTimestamp();

            await delay(700);
            await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        if (userDoc && userDoc.preferences?.notifications?.vote === 'INTERACTION' && userDoc.voteReminderSent === false) {
            const lastVoteTime = userDoc.lastVote?.getTime() || 0;
            const twelveHours = 12 * 60 * 60 * 1000;

            if (Date.now() - lastVoteTime >= twelveHours) {
                await users.updateOne({ userID: userId }, { $set: { voteReminderSent: true } });

                const voteUrl = "https://top.gg/bot/1435231722714169435/vote";

                let msgContent = t('events:interaction.vote_reminder_interaction', { user: `<@${userId}>`, voteUrl: voteUrl });
                if (userDoc.preferences?.notifications?.voteNotice) {
                    msgContent += `\n-# ${t('events:interaction.vote_reminder_fallback_notice')}`;
                    await users.updateOne({ userID: userId }, { $set: { "preferences.notifications.voteNotice": false } });
                }

                const container = new ContainerBuilder()
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(msgContent)
                            )
                    );

                await delay(700);
                try {
                    await interaction.followUp({
                        components: [container],
                        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
                    });
                } catch (err) {
                    logger.debug("[Vote Reminder] ", err);
                }
            }
        }
    }
}

async function handleButtonInteraction(bot, interaction, users, settings, logger, t) {
    if (interaction.customId.startsWith('search_')) {
        const { handleSearchPagination } = require('../slashCommands/gen/search.js');
        await handleSearchPagination(interaction, t);
        return;
    }
    if (interaction.customId.startsWith('preferences_')) {
        const preferences = require('../slashCommands/bot/preferences.js');
        await preferences.handleButton(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId.startsWith('vote_enable_reminders_')) {
        const vote = require('../slashCommands/gen/vote.js');
        await vote.handleButton(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId.startsWith('dictionary_pronounce_')) {
        const dictionary = require('../slashCommands/gen/dictionary.js');
        await dictionary.handlePronunciationButton(interaction, settings, logger, t);
        return;
    }
    if (interaction.customId.startsWith('warn_remove')) {
        const warn = require('../slashCommands/mod/warn.js');
        await warn.handleRemoveWarn(bot, interaction, t, logger, interaction.customId.split('_')[2], interaction.customId.split('_')[3]);
        return;
    }
    if (interaction.customId.startsWith('c4_')) {
        const connect4 = require('../slashCommands/games/connect4.js');
        await connect4.handleButton(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId.startsWith('rps_playagain_')) {
        const rps = require('../slashCommands/games/rps.js');
        await rps.handlePlayAgain(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId.startsWith('rps_')) {
        const rps = require('../slashCommands/games/rps.js');
        await rps.handleButton(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId.startsWith('meme_')) {
        const meme = require('../slashCommands/gen/meme.js');
        await meme.handleButton(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId.startsWith('hm_')) {
        const hangman = require('../slashCommands/games/hangman.js');
        await hangman.handleButton(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId.startsWith('convert_raw_')) {
        const parts = interaction.customId.split('_');
        const allowedUserId = parts[2];
        const rawValue = parts[3];
        const unit = parts[4];

        if (interaction.user.id !== allowedUserId) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('common:pagination.not_for_you')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (rawValue === 'unreadable') {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:convert.result_too_large')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            content: `**Raw Value:** ${parseFloat(rawValue).toLocaleString(undefined, { maximumFractionDigits: 10 })} ${unit}`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (interaction.customId.startsWith('find_emoji_p_')) {
        const parts = interaction.customId.split('_');
        const emojiId = parts[3];
        const isAnimated = parts[4] === '1';

        const extension = isAnimated ? 'gif' : 'png';
        const url = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=4096`;

        const embed = new EmbedBuilder()
            .setImage(url)

        return interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }
    if (interaction.customId.startsWith('botprofile_select_')) {
        const botprofile = require('../slashCommands/bot/botprofile.js');
        await botprofile.handleButtonInteraction(bot, interaction, t, logger);
        return;
    }
    if (interaction.customId === 'bot_credits') {
        const credits = require('../slashCommands/bot/credits.js');
        const container = credits.buildCreditsContainer(bot, interaction, t);
        return interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
        });
    }
}

async function handleSelectMenuInteraction(bot, interaction, settings, logger) {
    const t = i18n.getFixedT(interaction.locale);
    if (interaction.customId.startsWith("help_category_")) {
        const allowedUserId = interaction.customId.split("_")[2];

        if (interaction.user.id !== allowedUserId) {
            return interaction.reply({
                content: `${e.deny} ${t('events:handlers.help_menu_not_yours')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await interaction.deferUpdate();
        } catch (err) {
            logger.error("Error deferring help menu interaction:", err);
            return;
        }

        const selectedCategory = interaction.values[0];
        const isDev = settings.devs.includes(interaction.user.id);
        const isModerator = new PermissionsBitField(interaction.member?.permissions).has(PermissionsBitField.Flags.ModerateMembers) || false;
        const isAdmin = new PermissionsBitField(interaction.member?.permissions).has(PermissionsBitField.Flags.Administrator) || false;

        const allCommands = Array.from(bot.slashCommands.values());
        const categories = {};

        for (const cmd of allCommands) {
            if (cmd.data && cmd.help) {
                const cat = cmd.help.category || "Other";

                if (cat === "Dev" && !isDev) continue;
                if (cat === "Moderation" && !isModerator && !isAdmin && !isDev) continue;
                if (cmd.dev && !isDev) continue;
                if (cmd.data.type && cmd.data.type !== ApplicationCommandType.ChatInput) continue;

                if (!categories[cat]) categories[cat] = [];
                categories[cat].push({
                    ...cmd.help,
                    data: cmd.data,
                    beta: cmd.beta
                });
            }
        }

        const sortedNames = Object.keys(categories).sort();
        const categoryCommands = categories[selectedCategory] || [];
        categoryCommands.sort((a, b) => a.name.localeCompare(b.name));

        let commandList = "";
        for (let i = 0; i < categoryCommands.length; i++) {
            const cmd = categoryCommands[i];
            const emoji = i === categoryCommands.length - 1 ? e.reply : e.reply_cont;
            const betaBadge = cmd.beta ? ` ${e.badge_beta1}${e.badge_beta2}` : "";
            const isNew = cmd.created && (Math.floor(Date.now() / 1000) - cmd.created) < 25 * 24 * 60 * 60;
            const newBadge = isNew ? ` ${e.badge_new1}${e.badge_new2}` : "";

            const subcommands = cmd.data.options?.filter(opt =>
                opt.constructor?.name === "SlashCommandSubcommandBuilder" ||
                opt.toJSON()?.type === 1
            ) || [];

            if (subcommands.length > 0) {
                commandList += `${emoji} **/${cmd.name}**${betaBadge}${newBadge} - ${t(`commands:${cmd.name}.description`, { defaultValue: cmd.description })}\n`;

                for (let j = 0; j < subcommands.length; j++) {
                    const sub = subcommands[j];
                    const subEmoji = j === subcommands.length - 1 ? e.reply : e.reply_cont;
                    const treePrefix = `${e.reply_cont_cont}   `;
                    commandList += `${treePrefix}${subEmoji} **${sub.name}** - ${sub.description}\n`;
                }
            } else {
                commandList += `${emoji} **/${cmd.name}**${betaBadge}${newBadge} - ${t(`commands:${cmd.name}.description`, { defaultValue: cmd.description })}\n`;
            }
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`help_category_${interaction.user.id}`)
            .setPlaceholder(t('events:handlers.select_category'))
            .addOptions(
                sortedNames.map(cat => {
                    let emojiObj;
                    if (cat === "General") emojiObj = parseEmoji(e.compass_green);
                    else if (cat === "Dev") emojiObj = parseEmoji(e.config);
                    else if (cat === "Utility") emojiObj = parseEmoji(e.archive);
                    else if (cat === "Moderation") emojiObj = parseEmoji(e.blurple_mod);
                    else if (cat === "Bot") emojiObj = parseEmoji(e.blurple_bot);
                    else if (cat === "Games") emojiObj = parseEmoji(e.discord_orbs);
                    else emojiObj = parseEmoji(e.info);

                    return {
                        label: t(`common:categories.${cat}`, { defaultValue: cat }),
                        value: cat,
                        description: t('events:handlers.view_category', { cat: t(`common:categories.${cat}`, { defaultValue: cat }) }),
                        emoji: emojiObj,
                        default: cat === selectedCategory
                    };
                })
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const me = interaction.guild?.members.me;
        const serverAvatar = me && me.avatar ? me.avatarURL({ size: 2048 }) : null;
        const botThumbnail = serverAvatar || interaction.client.user.displayAvatarURL({ size: 2048 });

        const section = new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(botThumbnail))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# ${e.slash_command} ${t('events:handlers.category_commands', { cat: selectedCategory })}`),
                new TextDisplayBuilder().setContent(commandList || t('events:handlers.no_commands'))
            );

        const container = new ContainerBuilder()
            .setAccentColor(0x5865F2)
            .addSectionComponents(section)
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addActionRowComponents(row);

        try {
            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            logger.error("Error updating help select menu interaction:", error);
        }
    }
}


async function handleModalInteraction(bot, interaction, settings, logger, t) {
    if (interaction.customId.startsWith('warn_modal_')) {
        const warnUser = require('../contextCommands/warnUser.js');
        await warnUser.handleModal(bot, interaction, t, logger);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//
module.exports = {
    handleNonCommandInteractions,
    handleButtonInteraction,
    handleSelectMenuInteraction,
    handleModalInteraction
};


// contributors: @relentiousdragon