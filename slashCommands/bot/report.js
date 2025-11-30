const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, WebhookClient } = require('discord.js');
const e = require('../../data/emoji.js');
const commandMeta = require("../../util/i18n.js").getCommandMetadata;
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Report a user or a bot issue/bug')
        .setNameLocalizations(commandMeta.report.name)
        .setDescriptionLocalizations(commandMeta.report.description)
        .addStringOption(option => option.setName('type').setDescription('What are you reporting? choose an option').setRequired(true).addChoices(
            { name: 'Discord User', value: 'user' },
            { name: 'Bot Issue/Bug', value: 'bot' },
        ))
        .setNameLocalizations(commandMeta.report.name)
        .setDescriptionLocalizations(commandMeta.report.description)
        .addStringOption(option => option.setName('description').setDescription('Informations about your report').setRequired(true))
        .addAttachmentOption(option => option.setName('proof').setDescription('Proof about your report'))
        .setDMPermission(false),
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

            let report = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle(t('commands:report.title', { type: type.toUpperCase() }))
                .setDescription(t('commands:report.info', { text: text }))
                .setFooter({ text: t('commands:report.footer', { user: interaction.user.username, id: interaction.user.id }), iconURL: `${interaction.user.displayAvatarURL({})}` });

            let confirmation = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle(t('commands:report.title', { type: type.toUpperCase() }))
                .setDescription(`${t('commands:report.description_text', { text: text })}\n${e.warning} ${t('commands:report.warning')}`);

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

            const row = new ActionRowBuilder()
                .addComponents(no, yes);

            const message = await interaction.editReply({ embeds: [confirmation], components: [row], flags: MessageFlags.Ephemeral });

            const collectorFilter = i => i.user.id === interaction.user.id;
            try {
                const confirmer = await message.awaitMessageComponent({ filter: collectorFilter, time: 60000 });

                if (confirmer.customId === 'cancelled') {
                    confirmation.setColor(0xff0000).setTitle(t('commands:report.system_title')).setDescription(t('commands:report.cancelled'));
                    return confirmer.update({ embeds: [confirmation], components: [] });
                } else if (confirmer.customId === 'confirmed') {
                    await confirmer.update({ content: t('commands:report.sending'), components: [] });

                    if (settings.reportWebhook && settings.reportWebhook.length === 2) {
                        const webhookClient = new WebhookClient({ id: settings.reportWebhook[0], token: settings.reportWebhook[1] });

                        if (proof) {
                            report.setImage(`attachment://${proof.name}`);
                            await webhookClient.send({ embeds: [report], files: [proof] });
                        } else {
                            await webhookClient.send({ embeds: [report] });
                        }
                    } else {
                        logger.error('Report webhook not configured correctly.');
                        return interaction.editReply({ content: 'Report webhook configuration error.', embeds: [], components: [] });
                    }

                    confirmation.setColor(0x00ff00).setTitle(t('commands:report.system_title')).setDescription(t('commands:report.registered'));
                    return interaction.editReply({ content: '', embeds: [confirmation], components: [], flags: MessageFlags.Ephemeral });
                }
            } catch (error) {
                if (error.code === 'InteractionCollectorError') {
                    await interaction.editReply({ content: t('commands:report.timeout'), components: [], embeds: [] });
                } else {
                    throw error;
                }
            }

        } catch (error) {
            logger.error("Error executing command:", error);
            return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:report.error_generic')}`, embeds: [], components: [] });
        }
    },
    help: {
        name: "report",
        description: "Report a user or a bot issue/bug",
        category: "Bot",
        permissions: [],
        botPermissions: []
    }
};
