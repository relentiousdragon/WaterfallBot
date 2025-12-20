const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionsBitField, ApplicationCommandType } = require("discord.js");
const e = require("../../data/emoji.js");
const fs = require("fs");
const path = require("path");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const analyticsWorker = require("../../util/analyticsWorker.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("View all available commands")
        .setNameLocalizations(commandMeta.help.name)
        .setDescriptionLocalizations(commandMeta.help.description),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            const isDev = settings.devs.includes(interaction.user.id);
            const isModerator = new PermissionsBitField(interaction.member?.permissions).has(PermissionsBitField.Flags.ModerateMembers) || false;
            const isAdmin = new PermissionsBitField(interaction.member?.permissions).has(PermissionsBitField.Flags.Administrator) || false;

            const allCommands = Array.from(bot.slashCommands.values());
            const commands = allCommands
                .filter(cmd => cmd.data && cmd.help && (!cmd.dev || isDev) && (!cmd.data.type || cmd.data.type === ApplicationCommandType.ChatInput))
                .map(cmd => cmd.help);

            const categories = {};
            for (const cmd of commands) {
                const category = cmd.category || "Other";
                if (!categories[category]) {
                    categories[category] = [];
                }
                categories[category].push(cmd);
            }

            const filteredCategories = {};
            for (const [cat, cmds] of Object.entries(categories)) {
                if (cat === "Dev" && !isDev) continue;
                if (cat === "Moderation" && !isModerator && !isAdmin && !isDev) continue;
                filteredCategories[cat] = cmds;
            }

            const sortedCategories = Object.keys(filteredCategories).sort();

            if (sortedCategories.length === 0) {
                const section = new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.slash_command} ${t('commands:help.title')}`),
                    );

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(section)
                    .addSeparatorComponents(
                        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`-# ${t('commands:help.no_commands')}`)
                    );

                return interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`help_category_${interaction.user.id}`)
                .setPlaceholder(t('commands:help.placeholder'))
                .addOptions(
                    sortedCategories.map(cat => {
                        let emojiObj;
                        if (cat === "General") emojiObj = funcs.parseEmoji(e.compass_green);
                        else if (cat === "Dev") emojiObj = funcs.parseEmoji(e.config);
                        else if (cat === "Utility") emojiObj = funcs.parseEmoji(e.archive);
                        else if (cat === "Moderation") emojiObj = funcs.parseEmoji(e.blurple_mod);
                        else if (cat === "Bot") emojiObj = funcs.parseEmoji(e.blurple_bot);
                        else if (cat === "Games") emojiObj = funcs.parseEmoji(e.discord_orbs);
                        else emojiObj = funcs.parseEmoji(e.info);

                        return {
                            label: t(`common.categories.${cat}`, { defaultValue: cat }),
                            value: cat,
                            description: t('commands:help.view_category', { category: t(`common.categories.${cat}`, { defaultValue: cat }) }),
                            emoji: emojiObj
                        };
                    })
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            let visibleCommandCount = 0;
            for (const cmds of Object.values(filteredCategories)) {
                visibleCommandCount += cmds.length;
            }

            const section = new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.client.user.displayAvatarURL({ size: 2048 })))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.slash_command} ${t('commands:help.title')}`),
                    new TextDisplayBuilder().setContent(`${t('commands:help.select_category')}\n${t('commands:help.support_server')}`)
                );

            const topCommands = await analyticsWorker.getTopCommands();
            if (topCommands.length > 0) {
                const topCmdString = topCommands.map((cmd, i) => {
                    return `**/${cmd.name}** - ${funcs.abbr(cmd.count)}`;
                }).join("\n");

                section.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(t('commands:help.top_commands', { commands: topCmdString }))
                );
            }

            const container = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addSectionComponents(section);

            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# ${t('commands:help.available_commands', { count: visibleCommandCount })}`)
                )
                .addActionRowComponents(row);

            await interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            logger.error("Error executing help command:", error);

            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('common:error')}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    },
    help: {
        name: "help",
        description: "View all available commands",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1764938508
    }
};
