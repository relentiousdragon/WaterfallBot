const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, WebhookClient, ContainerBuilder, SectionBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const e = require('../../data/emoji.js');
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Suggest Commands or Functions for the Bot')
        .setNameLocalizations(commandMeta.suggestion.name)
        .setDescriptionLocalizations(commandMeta.suggestion.description)
        .addStringOption(option => option.setName('type').setDescription('Suggestion Type')
            .setNameLocalizations(commandMeta.suggestion.option_type_name)
            .setDescriptionLocalizations(commandMeta.suggestion.option_type_description)
            .setRequired(true).addChoices(
                { name: 'Add Command', value: 'addCmd' },
                { name: 'Update Command', value: 'updateCmd' },
                { name: 'Add Function', value: 'addFunc' },
                { name: 'Update Function', value: 'UpdateFunc' },
            ))
        .addStringOption(option => option.setName('description').setDescription('Describe in detail what you want to add/change')
            .setNameLocalizations(commandMeta.suggestion.option_description_name)
            .setDescriptionLocalizations(commandMeta.suggestion.option_description_description)
            .setRequired(true))
        .addAttachmentOption(option => option.setName('image').setDescription('Image about your suggestion')
            .setNameLocalizations(commandMeta.suggestion.option_image_name)
            .setDescriptionLocalizations(commandMeta.suggestion.option_image_description)),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const type = interaction.options.getString('type');
            const description = interaction.options.getString('description');
            const image = interaction.options.getAttachment('image');

            const askContainer = new ContainerBuilder()
                .setAccentColor(0xffff00)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.add_green} ${t('commands:suggestion.title', { type: type.toUpperCase() })}`),
                    new TextDisplayBuilder().setContent(`${t('commands:suggestion.explanation', { description: description })}\n\n${t('commands:suggestion.preview_note')}\n\n ${e.warning} ${t('commands:suggestion.warning')}`)
                );

            if (image) {
                askContainer.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder()
                            .setURL(`attachment://${image.name}`)
                            .setDescription(description)
                    )
                );
            }

            const cancel = new ButtonBuilder()
                .setCustomId('cancel')
                .setLabel(t('commands:suggestion.cancel'))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(funcs.parseEmoji(e.deny) || '⛔');

            const confirm = new ButtonBuilder()
                .setCustomId('confirm')
                .setLabel(t('commands:suggestion.confirm'))
                .setStyle(ButtonStyle.Success)
                .setEmoji(funcs.parseEmoji(e.checkmark_green) || '✅');

            const row = new ActionRowBuilder().addComponents(cancel, confirm);

            const response = await interaction.editReply({
                components: [askContainer, row],
                files: image ? [image] : [],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
            });

            const collectorFilter = i => i.user.id === interaction.user.id;
            try {
                const confirmation = await response.awaitMessageComponent({ filter: collectorFilter, time: 60_000 });

                if (confirmation.customId === 'cancel') {
                    const cancelledContainer = new ContainerBuilder()
                        .setAccentColor(0xffff00)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${e.deny} ${t('commands:suggestion.cancelled')}`)
                        );
                    await confirmation.update({
                        components: [cancelledContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                } else if (confirmation.customId === 'confirm') {
                    const sendingContainer = new ContainerBuilder()
                        .setAccentColor(0xffff00)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${e.loading} ${t('commands:report.sending')}`)
                        );

                    await confirmation.update({
                        components: [sendingContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    const successContainer = new ContainerBuilder()
                        .setAccentColor(0x00ff00)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${t('commands:suggestion.success_title')}\n${e.checkmark_green} ${t('commands:suggestion.success_description')}`)
                        );

                    const suggestionWebhookEmbed = new EmbedBuilder()
                        .setColor(0xffff00)
                        .setTitle(t('commands:suggestion.title', { type: type.toUpperCase() }))
                        .setDescription(t('commands:suggestion.explanation', { description: description }))
                        .setFooter({ text: t('commands:suggestion.footer', { user: interaction.user.username, id: interaction.user.id }) });

                    if (image) {
                        suggestionWebhookEmbed.setImage(`attachment://${image.name}`);
                    }

                    await interaction.editReply({
                        components: [successContainer],
                        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
                    });

                    if (settings.suggestWebhook && settings.suggestWebhook.length === 2) {
                        const webhookClient = new WebhookClient({ id: settings.suggestWebhook[0], token: settings.suggestWebhook[1] });
                        await webhookClient.send({
                            embeds: [suggestionWebhookEmbed],
                            files: image ? [new AttachmentBuilder(image.url, { name: image.name })] : []
                        });
                    } else {
                        logger.error('Suggest webhook not configured correctly.');
                        const errorContainer = new ContainerBuilder()
                            .setAccentColor(0xffff00)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`${e.pixel_cross} Suggestion webhook configuration error.`)
                            );
                        return interaction.editReply({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }
                }
            } catch (error) {
                if (error.code === 'InteractionCollectorError') {
                    const timeoutContainer = new ContainerBuilder()
                        .setAccentColor(0xffff00)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${e.pixel_warning} ${t('commands:suggestion.timeout')}`)
                        );
                    await interaction.editReply({
                        components: [timeoutContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                } else {
                    throw error;
                }
            }

        } catch (error) {
            logger.error("Error executing command:", error);
            const genericErrorContainer = new ContainerBuilder()
                .setAccentColor(0xffff00)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('common:error')}`)
                );
            return interaction.editReply({
                components: [genericErrorContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }
    },
    help: {
        name: "suggestion",
        description: "Suggest Commands or Functions for the Bot",
        category: "Bot",
        permissions: [],
        botPermissions: [],
        created: 1764938508
    }
};
