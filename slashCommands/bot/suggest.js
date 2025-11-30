const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, WebhookClient } = require('discord.js');
const e = require('../../data/emoji.js');
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Suggest Commands or Functions for the Bot')
        .setNameLocalizations(commandMeta.suggestion.name)
        .setDescriptionLocalizations(commandMeta.suggestion.description)
        .addStringOption(option => option.setName('type').setDescription('Suggestion Type').setRequired(true).addChoices(
            { name: 'Add Command', value: 'addCmd' },
            { name: 'Update Command', value: 'updateCmd' },
            { name: 'Add Function', value: 'addFunc' },
            { name: 'Update Function', value: 'UpdateFunc' },
        ))
        .addStringOption(option => option.setName('description').setDescription('Describe in detail what you want to add/change').setRequired(true))
        .setDMPermission(false),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const type = interaction.options.getString('type');
            const description = interaction.options.getString('description');

            const ask = new EmbedBuilder()
                .setColor(0xffff00)
                .setTitle(t('commands:suggestion.title', { type: type.toUpperCase() }))
                .setDescription(`${t('commands:suggestion.explanation', { description: description })}\n${t('commands:suggestion.preview_note')}\n${e.warning} ${t('commands:suggestion.warning')}`);

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

            const row = new ActionRowBuilder()
                .addComponents(cancel, confirm);

            const response = await interaction.editReply({ embeds: [ask], components: [row], flags: MessageFlags.Ephemeral });

            const collectorFilter = i => i.user.id === interaction.user.id;
            try {
                const confirmation = await response.awaitMessageComponent({ filter: collectorFilter, time: 60_000 });

                if (confirmation.customId === 'cancel') {
                    await confirmation.update({ content: `${e.deny} ${t('commands:suggestion.cancelled')}`, flags: MessageFlags.Ephemeral, components: [], embeds: [] });
                } else if (confirmation.customId === 'confirm') {
                    const worked = new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle(t('commands:suggestion.success_title'))
                        .setDescription(`${e.checkmark_green} ${t('commands:suggestion.success_description')}`);

                    const sugg = new EmbedBuilder()
                        .setColor(0xffff00)
                        .setTitle(t('commands:suggestion.title', { type: type.toUpperCase() }))
                        .setDescription(t('commands:suggestion.explanation', { description: description }))
                        .setFooter({ text: t('commands:suggestion.footer', { user: interaction.user.username, id: interaction.user.id }), iconURL: `${interaction.user.displayAvatarURL({})}` });

                    await confirmation.update({ flags: MessageFlags.Ephemeral, embeds: [worked], components: [] });

                    if (settings.suggestWebhook && settings.suggestWebhook.length === 2) {
                        const webhookClient = new WebhookClient({ id: settings.suggestWebhook[0], token: settings.suggestWebhook[1] });
                        await webhookClient.send({ embeds: [sugg] });
                    } else {
                        logger.error('Suggest webhook not configured correctly.');
                    }
                }
            } catch (error) {
                if (error.code === 'InteractionCollectorError') {
                    await interaction.editReply({ content: t('commands:suggestion.timeout'), components: [], embeds: [] });
                } else {
                    throw error;
                }
            }

        } catch (error) {
            logger.error("Error executing command:", error);
            return interaction.editReply({ content: `${e.pixel_cross} ${t('common.error')}`, flags: MessageFlags.Ephemeral, components: [], embeds: [] });
        }
    },
    help: {
        name: "suggestion",
        description: "Suggest Commands or Functions for the Bot",
        category: "Bot",
        permissions: [],
        botPermissions: []
    }
};
