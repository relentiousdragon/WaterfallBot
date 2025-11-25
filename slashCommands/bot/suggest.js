const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, WebhookClient } = require('discord.js');
const e = require('../../data/emoji.js');
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Suggest Commands or Functions for the Bot')
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
    async execute(bot, interaction, funcs, settings, logger) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const type = interaction.options.getString('type');
            const description = interaction.options.getString('description');

            const ask = new EmbedBuilder()
                .setColor(0xffff00)
                .setTitle(`${type.toUpperCase()} Suggestion`)
                .setDescription(`**Explanation:** ${description}\nThis is how your suggestion will be viewed to Developers.\n${e.warning} WARNING: If we consider your request meaningless or inappropriate we may block you from using the Waterfall Bot. If you are sure that you want to submit this request, press the "Confirm" button below otherwise press the "Cancel button."`);

            const cancel = new ButtonBuilder()
                .setCustomId('cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
                .setEmoji(funcs.parseEmoji(e.deny) || '⛔');

            const confirm = new ButtonBuilder()
                .setCustomId('confirm')
                .setLabel('Confirm')
                .setStyle(ButtonStyle.Success)
                .setEmoji(funcs.parseEmoji(e.checkmark_green) || '✅');

            const row = new ActionRowBuilder()
                .addComponents(cancel, confirm);

            const response = await interaction.editReply({ embeds: [ask], components: [row], flags: MessageFlags.Ephemeral });

            const collectorFilter = i => i.user.id === interaction.user.id;
            try {
                const confirmation = await response.awaitMessageComponent({ filter: collectorFilter, time: 60_000 });

                if (confirmation.customId === 'cancel') {
                    await confirmation.update({ content: `${e.deny} Request cancelled.`, flags: MessageFlags.Ephemeral, components: [], embeds: [] });
                } else if (confirmation.customId === 'confirm') {
                    const worked = new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle('Suggestion successfully sent!')
                        .setDescription(`${e.checkmark_green} Your suggestion has been successfully delivered to DevSiege Studios.\nWe won't contact you about your suggestion unless you open a Support Ticket in our Discord Server.`);

                    const sugg = new EmbedBuilder()
                        .setColor(0xffff00)
                        .setTitle(`${type.toUpperCase()} Suggestion`)
                        .setDescription(`**Explanation:** ${description}`)
                        .setFooter({ text: `Suggestion sent by ${interaction.user.username} | ${interaction.user.id}`, iconURL: `${interaction.user.displayAvatarURL({})}` });

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
                    await interaction.editReply({ content: 'Suggestion timed out.', components: [], embeds: [] });
                } else {
                    throw error;
                }
            }

        } catch (error) {
            logger.error("Error executing command:", error);
            return interaction.editReply({ content: `${e.pixel_cross} An error occurred while executing the command.`, flags: MessageFlags.Ephemeral, components: [], embeds: [] });
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
