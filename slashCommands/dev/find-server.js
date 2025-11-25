const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ComponentType, PermissionsBitField, MessageFlags } = require("discord.js");
const settings = require("../../util/settings.json");
const e = require("../../data/emoji.js");

async function getAllGuilds(bot) {
    if (!bot.shard) {
        return bot.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            icon: g.icon,
            createdTimestamp: g.createdTimestamp
        }));
    }
    const results = await bot.shard.broadcastEval(() =>
        this.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            icon: g.icon,
            createdTimestamp: g.createdTimestamp
        }))
    );
    return results.flat();
}

async function getGuildOnShard(bot, guildId) {
    if (!bot.shard) return bot.guilds.cache.get(guildId);
    const results = await bot.shard.broadcastEval(
        (id) => {
            const g = this.guilds.cache.get(id);
            if (!g) return null;
            return {
                id: g.id,
                name: g.name,
                memberCount: g.memberCount,
                icon: g.icon,
                createdTimestamp: g.createdTimestamp
            };
        },
        { context: guildId }
    );
    const found = results.find(g => g);
    if (!found) return null;
    if (bot.guilds.cache.has(guildId)) return bot.guilds.cache.get(guildId);
    return found;
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("find-server")
        .setDescription("Find and view info about servers the bot is in (DEV ONLY)")
        .addStringOption(option =>
            option.setName("server")
                .setDescription("Search by server name or ID")
                .setAutocomplete(true)
                .setRequired(false)
        ),
    dev: true,
    explicit: true,
    async autocomplete(interaction, bot) {
        if (!settings.devs.includes(interaction.user.id)) return interaction.respond([]);
        const focused = interaction.options.getFocused();
        const allGuilds = await getAllGuilds(bot);
        let choices = [];
        if (!focused) {
            choices = allGuilds.map(g => ({ name: `${g.name} (${g.id})`, value: g.id }));
        } else {
            const lower = focused.toLowerCase();
            choices = allGuilds.filter(g => g.name.toLowerCase().includes(lower) || g.id.includes(lower))
                .map(g => ({ name: `${g.name} (${g.id})`, value: g.id }));
        }
        return interaction.respond(choices.slice(0, 25));
    },
    async execute(bot, interaction, funcs, settings, logger) {
        await interaction.deferReply();
        if (!settings.devs.includes(interaction.user.id)) {
            return interaction.editReply({ content: `${e.deny} You don't have permission to use this command.` });
        }
        const serverId = interaction.options.getString("server");
        const allGuilds = await getAllGuilds(bot);

        async function buildGuildEmbed(guild) {
            let fullGuild = bot.guilds.cache.get(guild.id);
            let memberCount = guild.memberCount;
            let botCount = 0;
            let owner = null;
            if (fullGuild) {
                try {
                    memberCount = fullGuild.memberCount ?? (await fullGuild.fetch()).memberCount;
                    const members = await fullGuild.members.fetch({ withPresences: false, time: 5000 });
                    botCount = members.filter(m => m.user.bot).size;
                } catch {
                    botCount = 0;
                }
                try {
                    owner = await fullGuild.fetchOwner();
                } catch { }
            }
            return new EmbedBuilder()
                .setTitle(`${guild.name}`)
                .setThumbnail(fullGuild ? fullGuild.iconURL({ dynamic: true }) : (guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null))
                .setColor(0x5865F2)
                .addFields(
                    { name: "Server ID", value: guild.id, inline: false },
                    { name: "Owner", value: owner ? `<@${owner.id}> (${owner.id})` : "Unknown", inline: false },
                    { name: "Members", value: `${memberCount}`, inline: true },
                    { name: "Bots", value: `${botCount}`, inline: true },
                    { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: false }
                );
        }

        if (serverId) {
            let guild = bot.guilds.cache.get(serverId);
            if (!guild) {
                guild = allGuilds.find(g => g.id === serverId);
            }
            if (!guild) {
                if (!guild) {
                    return interaction.editReply({ content: `${e.deny} Server not found.` });
                }
            }
            const embed = await buildGuildEmbed(guild);
            let inviteBtn;
            if (bot.guilds.cache.has(guild.id)) {
                inviteBtn = new ButtonBuilder()
                    .setCustomId(`create_invite_${guild.id}`)
                    .setLabel("Create Invite")
                    .setStyle(ButtonStyle.Success);
            } else {
                inviteBtn = new ButtonBuilder()
                    .setCustomId("create_invite_disabled")
                    .setLabel("Create Invite (Not on this shard)")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);
            }
            const row = new ActionRowBuilder().addComponents(inviteBtn);

            await interaction.editReply({ embeds: [embed], components: [row] });

            if (bot.guilds.cache.has(guild.id)) {
                const msg = await interaction.fetchReply();
                const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

                collector.on("collect", async i => {
                    if (i.user.id !== interaction.user.id) {
                        return i.reply({ content: `${e.deny} You cannot use this button.`, flags: MessageFlags.Ephemeral });
                    }
                    if (!settings.devs.includes(i.user.id)) {
                        return i.reply({ content: `${e.deny} You are not allowed to interact with this.`, flags: MessageFlags.Ephemeral });
                    }
                    if (i.customId !== `create_invite_${guild.id}`) return;

                    await i.deferUpdate();
                    let fullGuild = bot.guilds.cache.get(guild.id);
                    let inviteChannel = fullGuild.channels.cache.find(
                        c => c.isTextBased && c.permissionsFor(fullGuild.members.me)?.has(PermissionsBitField.Flags.CreateInstantInvite)
                    );
                    if (!inviteChannel) {
                        try {
                            const channels = await fullGuild.channels.fetch();
                            inviteChannel = channels.find(
                                c => c.isTextBased && c.permissionsFor(fullGuild.members.me)?.has(PermissionsBitField.Flags.CreateInstantInvite)
                            );
                        } catch { }
                    }
                    if (!inviteChannel) {
                        return interaction.followUp({ content: `${e.pixel_cross} I don't have permission to create invites in this server.`, flags: MessageFlags.Ephemeral });
                    }
                    try {
                        const invite = await inviteChannel.createInvite({
                            maxUses: 1,
                            maxAge: 60 * 60 * 24 * 7,
                            unique: true,
                            reason: `Requested by ${interaction.user.tag} from DevSiege Studios`
                        });
                        await interaction.followUp({ content: `${e.chain} Invite created: ${invite.url}` });
                    } catch (err) {
                        await interaction.followUp({ content: `${e.pixel_cross} Failed to create invite. Missing permissions or an error occurred.`, flags: MessageFlags.Ephemeral });
                    }
                });

                collector.on("end", async () => {
                    try { await interaction.editReply({ components: [] }); } catch { }
                });
            }
            return;
        }

        const guildArray = allGuilds;
        if (guildArray.length === 0) {
            if (guildArray.length === 0) {
                return interaction.editReply({ content: "Bot is not in any servers." });
            }
        }
        let page = 0;
        const totalPages = guildArray.length;

        const getPageEmbed = async (pageIdx) => {
            const guild = guildArray[pageIdx];
            const embed = await buildGuildEmbed(guild);
            embed.setFooter({ text: `Server ${pageIdx + 1} of ${totalPages}` });
            return embed;
        };

        const getRow = (pageIdx) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("first")
                    .setEmoji("⏮️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageIdx === 0),
                new ButtonBuilder()
                    .setCustomId("prev")
                    .setEmoji(funcs.parseEmoji(e.arrow_bwd))
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pageIdx === 0),
                new ButtonBuilder()
                    .setCustomId("next")
                    .setEmoji(funcs.parseEmoji(e.arrow_fwd))
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pageIdx === totalPages - 1),
                new ButtonBuilder()
                    .setCustomId("last")
                    .setEmoji("⏭️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageIdx === totalPages - 1)
            );
        };

        const embed = await getPageEmbed(page);
        const row = getRow(page);

        await interaction.editReply({ embeds: [embed], components: [row] });
        const msg = await interaction.fetchReply();

        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

        collector.on("collect", async btn => {
            if (btn.user.id !== interaction.user.id) {
                return btn.reply({ content: `${e.deny} You cannot use these buttons.`, flags: MessageFlags.Ephemeral });
            }
            if (!settings.devs.includes(btn.user.id)) {
                return btn.reply({ content: `${e.deny} You are not a developer.`, flags: MessageFlags.Ephemeral });
            }

            await btn.deferUpdate();
            if (btn.customId === "first") page = 0;
            else if (btn.customId === "prev") page = Math.max(0, page - 1);
            else if (btn.customId === "next") page = Math.min(totalPages - 1, page + 1);
            else if (btn.customId === "last") page = totalPages - 1;
            const embed = await getPageEmbed(page);
            const row = getRow(page);
            await interaction.editReply({ embeds: [embed], components: [row] });
        });

        collector.on("end", async () => {
            try {
                await interaction.editReply({ components: [] });
            } catch { }
        });
    },
    help: {
        name: "find-server",
        description: "Find and view info about servers the bot is in",
        category: "Dev",
        permissions: [],
        botPermissions: []
    }
};
