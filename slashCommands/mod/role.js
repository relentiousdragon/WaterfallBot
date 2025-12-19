const { SlashCommandBuilder, MessageFlags, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ContainerBuilder } = require("discord.js");
const axios = require("axios");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const e = require("../../data/emoji.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("role")
        .setNameLocalizations(commandMeta.role.name)
        .setDescription("Get Role Informations")
        .setDescriptionLocalizations(commandMeta.role.description)
        .addRoleOption(o =>
            o.setName("target")
                .setDescription("Target Role to check")
                .setDescriptionLocalizations(commandMeta.role.option_target)
                .setRequired(true)
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

        const role = interaction.options.getRole("target");
        const rolePos = interaction.guild.roles.cache.size - role.position;
        const hex = role.hexColor.replace("#", "");
        const colorRes = await axios.get(`https://api.alexflipnote.dev/color/${hex}`).catch(() => null);
        const color = colorRes ? colorRes.data : null;

        const perms = role.permissions.toArray();
        const permsOutput = perms.length > 0 ? perms.map(p => `- ${p}`).join("\n") : t('common:none');

        const gradientImage = color ? color.images.gradient : null;

        const fallbackThumb =
            role.iconURL({ size: 256 }) ||
            interaction.guild.iconURL({ size: 256 }) ||
            interaction.client.user.displayAvatarURL({ size: 256 });

        const main = new ContainerBuilder()
            .setAccentColor(role.color || 0x5865F2)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(
                        new ThumbnailBuilder().setURL(fallbackThumb)
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${role.name}`),
                        new TextDisplayBuilder().setContent(`-# <@&${role.id}> | \`${role.id}\``)
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**${t('common:created')}:** <t:${Math.floor(role.createdTimestamp / 1000)}:F>`),
                new TextDisplayBuilder().setContent(`**${t('common:hoisted')}:** ${role.hoist ? t('common:yes') : t('common:no')}`),
                new TextDisplayBuilder().setContent(`**${t('common:position')}:** ${rolePos}`),
                new TextDisplayBuilder().setContent(`**${t('common:color')}:** #${hex.toUpperCase()}${color?.name ? ` (${color.name})` : ""}`),
                new TextDisplayBuilder().setContent(`**${t('common:mentionable')}:** ${role.mentionable ? t('common:yes') : t('common:no')}`)
            );

        if (color) {
            main.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            );

            main.addMediaGalleryComponents(
                new MediaGalleryBuilder()
                    .addItems(
                        new MediaGalleryItemBuilder().setURL(gradientImage)
                    )
            );
        }

        if (permsOutput.length > 0 && permsOutput !== t('common:none')) {
            main.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            );


            main.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${t('common:permissions')}\n${permsOutput}`)
            );
        }
        main.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );

        main.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall`)
        );

        return interaction.editReply({
            content: null,
            components: [main],
            flags: MessageFlags.IsComponentsV2
        });
    },
    help: {
        name: "role",
        description: "Get Role Informations",
        category: "Moderation",
        permissions: ["ManageRoles"],
        botPermissions: [],
        created: 1765304321
    }
};
