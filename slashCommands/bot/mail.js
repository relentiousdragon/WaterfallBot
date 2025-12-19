const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const users = require("../../schemas/users.js");
const globalMails = require("../../schemas/global_mails.js");
const ms = require("ms");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const e = require("../../data/emoji.js");
const logger = require("../../logger.js");

function parseColorToHex(color) {
    const colors = {
        orange: 0xFFA500,
        blue: 0x0000FF,
        red: 0xFF0000,
        green: 0x008000,
        yellow: 0xFFFF00,
        purple: 0x800080,
        pink: 0xFFC0CB,
    };
    return colors[color] || 0x3498DB;
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('mail')
        .setDescription('Check your mail')
        .setNameLocalizations(commandMeta.mail.name)
        .setDescriptionLocalizations(commandMeta.mail.description)
        .addBooleanOption(option => option.setName('private').setDescription('Show mail privately')),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            const isPrivate = interaction.options.getBoolean('private') ?? false;
            await interaction.deferReply({ flags: isPrivate ? MessageFlags.Ephemeral : 0 });
            const user = interaction.user;
            let data = await users.findOne({ userID: user.id });
            if (!data) {
                data = new users({
                    userID: user.id,
                    name: user.username
                });
                await data.save();
            }

            const currentTime = new Date();

            const expiredMails = data.mail.filter(mail => mail.expiry <= currentTime);
            const validPersonalMails = data.mail.filter(mail => mail.expiry > currentTime);
            if (expiredMails.length > 0) {
                data.mail = validPersonalMails;
                await data.save();
                if (isPrivate) {
                    await interaction.followUp({ content: t('commands:mail.expired_deleted'), flags: MessageFlags.Ephemeral });
                }
            }

            const activeGlobalMails = await globalMails.find({ expiry: { $gt: currentTime } });

            const readGlobalIds = data.read_global_mails || [];
            const globalMailsToShow = activeGlobalMails;

            const combinedMails = [
                ...validPersonalMails.map(m => ({ ...m.toObject(), type: 'personal', _id: m._id })),
                ...globalMailsToShow.map(m => ({ ...m.toObject(), type: 'global', _id: m._id }))
            ];

            if (combinedMails.length === 0) {
                return interaction.editReply(`${e.info} ${t('commands:mail.no_mail')}`);
            }

            combinedMails.reverse();

            const pages = combinedMails.map(mail => {
                const embed = new EmbedBuilder()
                    .setColor(mail.color || 0x3498DB)
                    .setTitle(mail.title || `${e.info} ${t('commands:mail.default_title')}`)
                    .setDescription(mail.message || t('commands:mail.no_content'));

                const timeRemaining = ms(new Date(mail.expiry) - currentTime, { long: true });
                if (timeRemaining) {
                    embed.setFooter({ text: t('commands:mail.expires_in', { time: timeRemaining }) });
                }

                if (mail.thumbnail) {
                    embed.setThumbnail(mail.thumbnail);
                }

                return { mail, embed };
            });

            let currentPage = 0;

            const getActionRows = (pages, currentPage) => {
                const navigationRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId("paginate_prev")
                            .setEmoji(funcs.parseEmoji(e.arrow_bwd) || "⬅️")
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId("paginate_next")
                            .setEmoji(funcs.parseEmoji(e.arrow_fwd) || "➡️")
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(currentPage === pages.length - 1)
                    );
                return [navigationRow];
            };

            const sentMessage = await interaction.editReply({
                embeds: [pages[currentPage].embed],
                components: getActionRows(pages, currentPage),
                flags: isPrivate ? MessageFlags.Ephemeral : 0
            });

            const markAsRead = async (index) => {
                const mail = pages[index].mail;
                if (mail.type === 'global') {
                    const freshData = await users.findOne({ userID: user.id });
                    if (!freshData.read_global_mails.includes(mail._id.toString())) {
                        freshData.read_global_mails.push(mail._id.toString());
                        await freshData.save();
                    }
                } else {
                    const freshData = await users.findOne({ userID: user.id });
                    const m = freshData.mail.id(mail._id);
                    if (m) {
                        m.read = true;
                        await freshData.save();
                    }
                }
            };

            await markAsRead(0);

            const filter = i => i.user.id === user.id;
            const collector = sentMessage.createMessageComponentCollector({ filter, time: 300000 });

            collector.on("collect", async i => {
                if (i.customId === "paginate_next") {
                    currentPage = Math.min(currentPage + 1, pages.length - 1);
                    await markAsRead(currentPage);
                    await i.update({ embeds: [pages[currentPage].embed], components: getActionRows(pages, currentPage) });
                } else if (i.customId === "paginate_prev") {
                    currentPage = Math.max(currentPage - 1, 0);
                    await markAsRead(currentPage);
                    await i.update({ embeds: [pages[currentPage].embed], components: getActionRows(pages, currentPage) });
                }
            });

            collector.on("end", async () => {
                try {
                    await sentMessage.edit({ components: [] });
                } catch (error) {
                    logger.error("Failed to edit message on collector end:", error);
                }
            });
        } catch (error) {
            logger.error(error);
            return interaction.editReply(`${e.pixel_warning} ${t('commands:mail.error_fetch')}`);
        }
    },
    help: {
        name: "mail",
        description: "Check your mail",
        category: "Bot",
        permissions: [],
        botPermissions: [],
        created: 1764938508
    }
};
