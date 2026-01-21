const { Events, EmbedBuilder, WebhookClient, PermissionsBitField, ChannelType, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const path = require("path");
const { settings } = require('../util/settingsModule.js');
const e = require('../data/emoji.js');
const logger = require('../logger.js');
const { i18n } = require('../util/i18n.js')
require("dotenv").config();
//
module.exports = {
    name: Events.GuildCreate,
    async execute(bot, guild) {
        try {
            if (!settings.joinWebhook || settings.joinWebhook.length !== 2) return;

            const webhookClient = new WebhookClient({ id: settings.joinWebhook[0], token: settings.joinWebhook[1] });

            let owner = 'Unknown';
            try {
                const ownerUser = await guild.fetchOwner();
                owner = `${ownerUser.user.tag} (${ownerUser.id})`;
            } catch (err) {
                logger.warn(`Failed to fetch owner for guild ${guild.id}: ${err.message}`);
            }

            const { Server } = require('../schemas/servers.js');

            const localeMap = {
                'en-US': 'en', 'en-GB': 'en',
                'es-ES': 'es', 'es-419': 'es',
                'pt-BR': 'pt',
                'sv-SE': 'sv',
                'zh-CN': 'zh', 'zh-TW': 'zh'
            };

            const preferredLang = localeMap[guild.preferredLocale] || 'en';

            await Server.findOneAndUpdate(
                { serverID: guild.id },
                { language: preferredLang, $unset: { pendingDeletion: '' } },
                { upsert: true, new: true }
            );

            const { cancelPendingDeletion } = require('../util/dataCleanup.js');
            await cancelPendingDeletion(guild.id);

            const inviteTracker = require('../util/inviteTracker.js');
            await inviteTracker.cacheInvites(guild);

            const t = i18n.getFixedT('en');

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`<:i:1442933171099275377> ${t('events:guild_create.title')}${process.env.CANARY == "true" ? ' (CANARY)' : ''}`)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: t('events:guild_create.name'), value: `${guild.name}`, inline: true },
                    { name: t('events:guild_create.id'), value: `${guild.id}`, inline: true },
                    { name: t('events:guild_create.members'), value: `${guild.memberCount}`, inline: true },
                    { name: t('events:guild_create.owner'), value: owner, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: t('events:guild_create.preferred_language', { preferredLang: preferredLang }) });

            await webhookClient.send({ embeds: [embed] });

            const welcomeT = i18n.getFixedT(preferredLang);
            const channel = guild.systemChannel || guild.channels.cache.find(c =>
                c.type === ChannelType.GuildText &&
                guild.members.me.permissionsIn(c).has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel])
            );

            const serverData = await Server.findOne({ serverID: guild.id });
            const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
            const lastWelcome = serverData?.lastWelcomeMessage || 0;
            const shouldSendWelcome = Date.now() - lastWelcome >= THIRTY_DAYS;

            if (channel && shouldSendWelcome) {
                const welcomeSuccess = await module.exports.sendWelcomeMessages(bot, channel, preferredLang, serverData?.botProfile);

                if (welcomeSuccess) {
                    await Server.findOneAndUpdate(
                        { serverID: guild.id },
                        { lastWelcomeMessage: Date.now() },
                        { upsert: true }
                    );
                }
            }
        } catch (error) {
            logger.error(`Error in guildCreate event: ${error.message}`);
        }
    },
    async sendWelcomeMessages(bot, channel, preferredLang, currentProfile) {
        try {
            const welcomeT = i18n.getFixedT(preferredLang);

            const textDisplay = [
                new TextDisplayBuilder().setContent(`# 👋 ${welcomeT('events:welcome_message.title')}`),
                new TextDisplayBuilder().setContent(welcomeT('events:welcome_message.description')),
                new TextDisplayBuilder().setContent(`\n${welcomeT('events:welcome_message.help_desc')}`)
            ];

            if (preferredLang !== 'en') {
                const langNames = {
                    de: 'Deutsch',
                    fr: 'Français',
                    es: 'Español',
                    it: 'Italiano',
                    ja: '日本語',
                    nl: 'Nederlands',
                    pl: 'Polski',
                    ru: 'Русский',
                    tr: 'Türkçe'
                };
                const langName = langNames[preferredLang] || preferredLang;
                const enT = i18n.getFixedT('en');

                textDisplay.push(
                    new TextDisplayBuilder().setContent(`\n${welcomeT('events:welcome_message.locale_note', { locale: langName })}`),
                    new TextDisplayBuilder().setContent(`-# ${enT('events:welcome_message.locale_note', { locale: langName })}`)
                );
            }

            const assetsDir = path.join(__dirname, '../assets');
            const welcomeFiles = [
                new AttachmentBuilder(path.join(assetsDir, 'automod_setup.png'), { name: 'automod_setup.png' }),
                new AttachmentBuilder(path.join(assetsDir, 'rps.png'), { name: 'rps.png' }),
                new AttachmentBuilder(path.join(assetsDir, 'connect4.gif'), { name: 'connect4.gif' })
            ];

            const me = channel.guild?.members.me;
            const botThumbnail = me?.displayAvatarURL({ size: 2048 }) || bot.user.displayAvatarURL({ size: 2048 });

            const welcomeContainer = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(botThumbnail))
                        .addTextDisplayComponents(...textDisplay)
                )
                /*.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL('attachment://automod_setup.png'),
                        new MediaGalleryItemBuilder().setURL('attachment://rps.png'),
                        new MediaGalleryItemBuilder().setURL('attachment://connect4.gif')
                    )
                )*/
                .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel(welcomeT('events:welcome_message.support_btn'))
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://discord.gg/qD3yfKGk5g'),
                        //.setEmoji(parseEmoji(e.icon_discord)),
                        new ButtonBuilder()
                            .setLabel(welcomeT('events:welcome_message.github_btn'))
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://github.com/DevSeige-Studios/waterfall')
                        //.setEmoji(parseEmoji(e.icon_github))
                    )
                );

            const welcomeMessage = await channel.send({
                components: [welcomeContainer],
                //files: welcomeFiles,
                flags: MessageFlags.IsComponentsV2
            }).catch(err => {
                logger.error(`Failed to send welcome message in guild ${guild.id}: ${err.message}`);
                return null;
            });

            if (welcomeMessage) {
                const a = settings.a_emojis || {};
                const formatEmoji = (id) => id && id !== "?" ? `<:a:${id}>` : "";

                const styleList = ["default", "crimson", "azure", "amethyst", "seabreeze"];
                const profileNames = {
                    default: "Default",
                    crimson: "Crimson",
                    azure: "Azure",
                    amethyst: "Amethyst",
                    seabreeze: "Sea Breeze"
                };
                const styleDescriptions = {
                    default: "Classic",
                    crimson: "Neo: Fiery Red",
                    azure: "Neo: Blue",
                    amethyst: "Neo: Purple (Glow)",
                    seabreeze: "Neo: Teal"
                };

                const avatarContainer = new ContainerBuilder().setAccentColor(0x5865F2);
                avatarContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("# Choose your Waterfall!"),
                    new TextDisplayBuilder().setContent(`-# ${welcomeT('events:welcome_message.choose_waterfall_subtitle')}`)
                );
                avatarContainer.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

                const normalizedProfile = (currentProfile === 'amethyst_glow' ? 'amethyst' : currentProfile) || 'default';

                for (const style of styleList) {
                    const emojis12 = `${formatEmoji(a[`${style}_1`])}${formatEmoji(a[`${style}_2`])}`;
                    const emojis34 = `${formatEmoji(a[`${style}_3`])}${formatEmoji(a[`${style}_4`])}`;
                    const displayName = profileNames[style] || style;

                    const isCurrent = style === normalizedProfile;
                    const btnLabel = isCurrent ? welcomeT('events:welcome_message.current') : welcomeT('common:select');
                    const btnStyle = isCurrent ? ButtonStyle.Success : ButtonStyle.Primary;

                    avatarContainer.addSectionComponents(
                        new SectionBuilder()
                            .setButtonAccessory(
                                new ButtonBuilder()
                                    .setCustomId(`botprofile_select_${style}`)
                                    .setLabel(btnLabel)
                                    .setStyle(btnStyle)
                                    .setDisabled(isCurrent)
                            )
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    (emojis12 ? `${emojis12} ` : "") + `**${displayName}**\n` +
                                    (emojis34 ? `${emojis34}  ` : "") + styleDescriptions[style]
                                )
                            )
                    );
                }

                avatarContainer.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
                avatarContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# ${welcomeT('events:welcome_message.style_cooldown_note')}\n-# ${welcomeT('events:welcome_message.more_styles_note')}`)
                );

                await welcomeMessage.reply({
                    components: [avatarContainer],
                    flags: MessageFlags.IsComponentsV2
                }).catch(err => logger.error(`Failed to send avatar selection message in guild ${guild.id}: ${err.message}`));
            }
            return false;
        } catch (err) {
            logger.error(`Error sending welcome messages: ${err.message}`);
            return false;
        }
    }
};

// contributors: @relentiousdragon