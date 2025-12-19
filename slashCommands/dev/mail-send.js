const { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const users = require("../../schemas/users.js");
const globalMails = require("../../schemas/global_mails.js");
const settings = require('../../util/settings.json');
const ms = require("ms");
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
        .setName('mail-send')
        .setDescription('Send mail to a user or everyone (DEV ONLY)')
        .addStringOption(option =>
            option.setName('target')
                .setDescription('Target user ID or "everyone"')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Title for the mail')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message body (use \\n for newlines and §emojiName:ID§ for emojis)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('thumbnail')
                .setDescription('URL for the thumbnail')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('expire')
                .setDescription('Expiry duration (e.g., 1d, 2h)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Embed color (choose one)')
                .setRequired(false)
                .addChoices(
                    { name: 'orange', value: 'orange' },
                    { name: 'blue', value: 'blue' },
                    { name: 'red', value: 'red' },
                    { name: 'green', value: 'green' },
                    { name: 'yellow', value: 'yellow' },
                    { name: 'purple', value: 'purple' },
                    { name: 'pink', value: 'pink' },
                    { name: 'null', value: 'null' }
                ))
        .addStringOption(option =>
            option.setName('active')
                .setDescription('Active duration (e.g., 1d, 2h) for filtering recipients (ONLY FOR INDIVIDUAL MAILS)')
                .setRequired(false)),
    dev: true,
    explicit: process.env.CANARY === "true" ? false : true,
    async execute(bot, interaction, funcs) {
        try {
            if (!settings.devs.includes(interaction.user.id)) {
                return interaction.reply({ content: `${e.deny} You don't have permission to use this command.`, flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply();
            const target = interaction.options.getString('target');
            const title = interaction.options.getString('title');
            const messageText = interaction.options.getString('message');
            const thumbnail = interaction.options.getString('thumbnail');
            const expireText = interaction.options.getString('expire');
            const color = interaction.options.getString('color');
            const activeText = interaction.options.getString('active');

            const formattedMessageText = messageText
                .replace(/\\n/g, '\n')
                .replace(/§(.*?:\d+?)§/g, '<$1>');
            if (!formattedMessageText) {
                return interaction.editReply(`${e.deny} Message field is required.`);
            }

            const expiry = new Date();
            const expiryDuration = expireText ? ms(expireText) : ms("7d");
            if (!expiryDuration) {
                return interaction.editReply(`${e.deny} Invalid expiry format. Use formats like \`1d\`, \`2h\`, etc.`);
            }
            expiry.setTime(expiry.getTime() + expiryDuration);
            let embedColor = color ? (color.toLowerCase() === "null" ? 0x3498DB : parseColorToHex(color.toLowerCase())) : 0x3498DB;


            if (target.toLowerCase() === "everyone") {
                const newGlobalMail = new globalMails({
                    title,
                    message: formattedMessageText,
                    thumbnail,
                    expiry,
                    color: embedColor
                });
                await newGlobalMail.save();
                return interaction.editReply(`${e.status_online} Global mail has been sent to everyone!`);
            } else {
                const targetUser = await users.findOne({ userID: target });
                if (!targetUser) {
                    return interaction.editReply(`${e.deny} User not found.`);
                }

                if (activeText) {
                    const currentTime = new Date();
                    const activeDuration = ms(activeText);
                    if (!activeDuration) {
                        return interaction.editReply(`${e.deny} Invalid active format.`);
                    }
                    const activeCutoffTime = currentTime.getTime() - activeDuration;
                    if (targetUser.lastActive < activeCutoffTime) {
                        return interaction.editReply(`${e.deny} The specified user was not active within the last ${activeText}.`);
                    }
                }

                targetUser.mail.push({ title, message: formattedMessageText, thumbnail, expiry, read: false, color: embedColor });

                await targetUser.save();
                return interaction.editReply(`${e.checkmark_green} Mail has been sent to ${targetUser.name || "the specified user"}!`);
            }
        } catch (error) {
            logger.error(error);
            return interaction.editReply(`${e.pixel_warning} An error occurred while sending mail.`);
        }
    },
    help: {
        name: "mail-send",
        description: "Send mail to a user or everyone",
        category: "Dev",
        permissions: ["Developer"],
        botPermissions: [],
        created: 1764938508
    }
};
