const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, WebhookClient, ContainerBuilder, SectionBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const e = require('../../data/emoji.js');
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Report a user or a bot issue/bug')
        .setNameLocalizations(commandMeta.report.name)
        .setDescriptionLocalizations(commandMeta.report.description)
        .addStringOption(option => option.setName('type').setDescription('What are you reporting? choose an option')
            .setNameLocalizations(commandMeta.report.option_type_name)
            .setDescriptionLocalizations(commandMeta.report.option_type_description)
            .setRequired(true).addChoices(
                { name: 'Discord User', value: 'user' },
                { name: 'Bot Issue/Bug', value: 'bot' },
            ))
        .addStringOption(option => option.setName('description').setDescription('Informations about your report')
            .setNameLocalizations(commandMeta.report.option_description_name)
            .setDescriptionLocalizations(commandMeta.report.option_description_description)
            .setRequired(true))
        .addAttachmentOption(option => option.setName('proof').setDescription('Proof about your report')
            .setNameLocalizations(commandMeta.report.option_proof_name)
            .setDescriptionLocalizations(commandMeta.report.option_proof_description)),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const type = interaction.options.getString('type');
            const text = interaction.options.getString('description');
            const proof = interaction.options.getAttachment('proof');

            const confirmationContainer = new ContainerBuilder()
                .setAccentColor(0xff0000)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.red_point} ${t('commands:report.title', { type: type.toUpperCase() })}`),
                    new TextDisplayBuilder().setContent(`${t('commands:report.description_text', { text: text })}\n\n ${e.warning} ${t('commands:report.warning')}`)
                );

            if (proof) {
                confirmationContainer.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder()
                            .setURL(`attachment://${proof.name}`)
                            .setDescription(text)
                    )
                );
            }

            const no = new ButtonBuilder()
                .setCustomId('cancelled')
                .setLabel(t('commands:report.cancel'))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(funcs.parseEmoji(e.deny) || '⛔');

            const yes = new ButtonBuilder()
                .setCustomId('confirmed')
                .setLabel(t('commands:report.confirm'))
                .setStyle(ButtonStyle.Success)
                .setEmoji(funcs.parseEmoji(e.checkmark_green) || '✅');

            const row = new ActionRowBuilder().addComponents(no, yes);

            const message = await interaction.editReply({
                components: [confirmationContainer, row],
                files: proof ? [proof] : [],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
            });

            const collectorFilter = i => i.user.id === interaction.user.id;
            try {
                const confirmer = await message.awaitMessageComponent({ filter: collectorFilter, time: 60000 });

                if (confirmer.customId === 'cancelled') {
                    const cancelledContainer = new ContainerBuilder()
                        .setAccentColor(0xff0000)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${t('commands:report.system_title')}\n${e.deny} ${t('commands:report.cancelled')}`)
                        );
                    return confirmer.update({
                        components: [cancelledContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                } else if (confirmer.customId === 'confirmed') {
                    const sendingContainer = new ContainerBuilder()
                        .setAccentColor(0xff0000)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${e.loading} ${t('commands:report.sending')}`)
                        );
                    await confirmer.update({
                        components: [sendingContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    const reportWebhookEmbed = new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle(t('commands:report.title', { type: type.toUpperCase() }))
                        .setDescription(t('commands:report.info', { text: text }))
                        .setFooter({ text: t('commands:report.footer', { user: interaction.user.username, id: interaction.user.id }) });

                    if (proof) {
                        reportWebhookEmbed.setImage(`attachment://${proof.name}`);
                    }

                    if (settings.reportWebhook && settings.reportWebhook.length === 2) {
                        const webhookClient = new WebhookClient({ id: settings.reportWebhook[0], token: settings.reportWebhook[1] });

                        await webhookClient.send({
                            embeds: [reportWebhookEmbed],
                            files: proof ? [new AttachmentBuilder(proof.url, { name: proof.name })] : []
                        });
                    } else {
                        logger.error('Report webhook not configured correctly.');
                        const errorContainer = new ContainerBuilder()
                            .setAccentColor(0xff0000)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`${e.pixel_cross} Report webhook configuration error.`)
                            );
                        return interaction.editReply({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }

                    const registeredContainer = new ContainerBuilder()
                        .setAccentColor(0x00ff00)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${t('commands:report.system_title')}\n${e.checkmark_green} ${t('commands:report.registered')}`)
                        );
                    return interaction.editReply({
                        components: [registeredContainer],
                        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
                    });
                }
            } catch (error) {
                if (error.code === 'InteractionCollectorError') {
                    const timeoutContainer = new ContainerBuilder()
                        .setAccentColor(0xff0000)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${e.pixel_warning} ${t('commands:report.timeout')}`)
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
                .setAccentColor(0xff0000)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('commands:report.error_generic')}`)
                );
            return interaction.editReply({
                components: [genericErrorContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }
    },
    help: {
        name: "report",
        description: "Report a user or a bot issue/bug",
        category: "Bot",
        permissions: [],
        botPermissions: [],
        created: 1764938508
    }
};
