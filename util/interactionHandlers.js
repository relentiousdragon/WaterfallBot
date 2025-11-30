const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");
const users = require("../schemas/users.js");
const globalMails = require("../schemas/global_mails.js");
const e = require("../data/emoji.js");
const { i18n } = require("./i18n.js");

const parseEmoji = (emojiString) => {
    if (!emojiString) return undefined;
    const match = emojiString.match(/<a?:(\w+):(\d+)>/);
    if (match) {
        return { id: match[2], name: match[1] };
    }
    return undefined;
};
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
    }
}

async function handleButtonInteraction(interaction, users, settings) {
    //
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

        const selectedCategory = interaction.values[0];

        const isDev = settings.devs.includes(interaction.user.id);
        const isModerator = new PermissionsBitField(interaction.member?.permissions).has(PermissionsBitField.Flags.ModerateMembers) || false;
        const isAdmin = new PermissionsBitField(interaction.member?.permissions).has(PermissionsBitField.Flags.Administrator) || false;

        if (selectedCategory === "Dev" && !isDev) {
            return interaction.reply({
                content: `${e.deny} ${t('events:handlers.no_permission_category')}`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (selectedCategory === "Moderation" && !isModerator && !isAdmin && !isDev) {
            return interaction.reply({
                content: `${e.deny} ${t('events:handlers.no_permission_category')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const commands = [];
        const commandFolders = fs.readdirSync(path.join(__dirname, "..", "slashCommands"));

        for (const folder of commandFolders) {
            const folderPath = path.join(__dirname, "..", "slashCommands", folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;

            const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith(".js"));
            for (const file of commandFiles) {
                try {
                    delete require.cache[require.resolve(path.join(folderPath, file))];
                    const command = require(path.join(folderPath, file));
                    if (command.data && command.help && command.help.category === selectedCategory) {
                        if (command.dev && !isDev) {
                            continue;
                        }
                        command.help.data = command.data;
                        command.help.beta = command.beta;
                        commands.push(command.help);
                    }
                } catch (err) {
                    logger.error(`Error loading command ${file}:`, err);
                }
            }
        }

        commands.sort((a, b) => a.name.localeCompare(b.name));

        let commandList = "";
        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            const emoji = i === commands.length - 1 ? e.reply : e.reply_cont;

            const betaBadge = cmd.beta ? `${e.badge_beta1}${e.badge_beta2} ` : "";

            let permText = "";
            if (cmd.permissions?.length > 0) {
                permText = `${e.reply_cont_cont}   ${e.member} **${t('events:handlers.user_perms')}** ${cmd.permissions.join(", ")}`;
            }

            let botPermText = "";
            if ((isAdmin || isModerator || isDev) && cmd.botPermissions?.length > 0) {
                botPermText = `${e.reply_cont_cont}   ${e.config} **${t('events:handlers.bot_perms')}** ${cmd.botPermissions.join(", ")}`;
            }

            const subcommands = cmd.data.options?.filter(opt =>
                opt.constructor?.name === "SlashCommandSubcommandBuilder" ||
                opt.toJSON()?.type === 1
            ) || [];

            if (subcommands.length > 0) {
                commandList += `${emoji} ${betaBadge}**/${cmd.name}** - ${t(`commands:${cmd.name}.description`, { defaultValue: cmd.description })}\n`;

                for (let j = 0; j < subcommands.length; j++) {
                    const sub = subcommands[j];
                    const subEmoji = j === subcommands.length - 1 ? e.reply : e.reply_cont;
                    const treePrefix = `${e.reply_cont_cont}   `;
                    commandList += `${treePrefix}${subEmoji} **${sub.name}** - ${sub.description}\n`;
                }

                if (permText) commandList += `${permText}\n`;
                if (botPermText) commandList += `${botPermText}\n`;
            } else {
                commandList += `${emoji} ${betaBadge}**/${cmd.name}** - ${t(`commands:${cmd.name}.description`, { defaultValue: cmd.description })}\n`;
                if (permText) commandList += `${permText}\n`;
                if (botPermText) commandList += `${botPermText}\n`;
            }
        }

        const categories = {};
        const commandFolders2 = fs.readdirSync(path.join(__dirname, "..", "slashCommands"));

        for (const folder of commandFolders2) {
            const folderPath = path.join(__dirname, "..", "slashCommands", folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;

            const commandFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".js"));
            for (const file of commandFiles) {
                try {
                    delete require.cache[require.resolve(path.join(folderPath, file))];
                    const cmd = require(path.join(folderPath, file));
                    if (cmd.data && cmd.help) {
                        const cat = cmd.help.category || "Other";
                        if (!categories[cat]) categories[cat] = [];
                        categories[cat].push(cmd.help);
                    }
                } catch (err) {
                    logger.error(`Error loading command ${file}:`, err);
                }
            }
        }

        const filteredCategories = {};
        for (const [cat, cmds] of Object.entries(categories)) {
            if (cat === "Dev" && !isDev) continue;
            if (cat === "Moderation" && !isModerator && !isAdmin && !isDev) continue;
            filteredCategories[cat] = cmds;
        }

        const sortedCategories = Object.keys(filteredCategories).sort();
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`help_category_${interaction.user.id}`)
            .setPlaceholder(t('events:handlers.select_category'))
            .addOptions(
                sortedCategories.map(cat => {
                    let emojiObj;
                    if (cat === "General") emojiObj = parseEmoji(e.compass_green);
                    else if (cat === "Dev") emojiObj = parseEmoji(e.config);
                    else if (cat === "Moderation") emojiObj = parseEmoji(e.bughunter);
                    else if (cat === "Bot") emojiObj = parseEmoji(e.blurple_bot);
                    else emojiObj = parseEmoji(e.info);

                    return {
                        label: t(`common.categories.${cat}`, { defaultValue: cat }),
                        value: cat,
                        description: t('events:handlers.view_category', { cat: t(`common.categories.${cat}`, { defaultValue: cat }) }),
                        emoji: emojiObj,
                        default: cat === selectedCategory
                    };
                })
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const section = new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.client.user.displayAvatarURL({ size: 2048 })))
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
            /*.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Requested by ${interaction.user.tag}`)
            )*/
            .addActionRowComponents(row);

        try {
            await interaction.update({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            logger.error("Error updating help select menu interaction:", error);
            throw error;
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    handleNonCommandInteractions,
    handleButtonInteraction,
    handleSelectMenuInteraction
};