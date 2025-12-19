const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const e = require("../../data/emoji.js");
const funcs = require("../../util/functions.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();

const rpsAI = require("../../util/rps_ai.js");

const playerPatterns = new Map();

const activePvPGames = new Map();

const PATTERN_EXPIRY_MS = 30 * 60 * 60 * 1000;
const PVP_TIMEOUT_MS = 10 * 60 * 1000;
const MOVES = rpsAI.MOVES;
const MOVE_NAMES = { r: 'rock', p: 'paper', s: 'scissors' };
const MOVE_EMOJIS = { r: '🪨', p: '📄', s: '✂️' };
const WINS = rpsAI.WINS;

setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of playerPatterns.entries()) {
        if (now - data.lastPlayed > PATTERN_EXPIRY_MS) {
            playerPatterns.delete(userId);
        }
    }
    for (const [gameId, game] of activePvPGames.entries()) {
        if (now - game.createdAt > PVP_TIMEOUT_MS) {
            activePvPGames.delete(gameId);
        }
    }
}, 60000);

function determineWinner(move1, move2) {
    if (move1 === move2) return 0;
    if (WINS[move1] === move2) return 1;
    return 2;
}

function buildResultContainer(playerMove, opponentMove, opponentName, result, t, isWF = true, userId = null) {
    const playerMoveDisplay = `${MOVE_EMOJIS[playerMove]} ${t(`commands:rps.${MOVE_NAMES[playerMove]}`)}`;
    const opponentMoveDisplay = `${MOVE_EMOJIS[opponentMove]} ${t(`commands:rps.${MOVE_NAMES[opponentMove]}`)}`;

    let resultText, accentColor;
    if (result === 1) {
        resultText = t('common:games.you_win');
        accentColor = 0x57F287;
    } else if (result === 2) {
        resultText = t('common:games.you_lose');
        accentColor = 0xED4245;
    } else {
        resultText = t('common:games.tie');
        accentColor = 0xFEE75C;
    }

    const opponentLabel = isWF
        ? t('commands:rps.ai_chose', { move: opponentMoveDisplay })
        : t('commands:rps.opponent_chose', { user: opponentName, move: opponentMoveDisplay });

    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.title')}`),
            new TextDisplayBuilder().setContent(
                isWF
                    ? (userId ? `<@${userId}> ${t('commands:rps.vs')} Waterfall` : 'You vs Waterfall')
                    : t('commands:rps.vs_player', { user: opponentName })
            )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${t('commands:rps.you_chose', { move: playerMoveDisplay })}\n${opponentLabel}`)
        );

    if (isWF) {
        const stats = rpsAI.getGlobalStats();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall: ${funcs.abbr(stats.waterfallWins)} | Humans: ${funcs.abbr(stats.humanWins)}\n`)
        );
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('\n'));
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );


    if (isWF && userId) {
        container.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`\n## ${resultText}`)
            )
            .setButtonAccessory(new ButtonBuilder()
                .setCustomId(`rps_playagain_${userId}`)
                .setLabel(t('commands:rps.play_again'))
                .setStyle(ButtonStyle.Primary)
                .setEmoji(funcs.parseEmoji(e.reload2))
            )
        )
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`\n## ${resultText}`)
        )
    }

    return container;
}

function buildMoveButtons(gameId, t) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`rps_move_${gameId}_r`)
            .setLabel(t('commands:rps.rock'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🪨'),
        new ButtonBuilder()
            .setCustomId(`rps_move_${gameId}_p`)
            .setLabel(t('commands:rps.paper'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📄'),
        new ButtonBuilder()
            .setCustomId(`rps_move_${gameId}_s`)
            .setLabel(t('commands:rps.scissors'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✂️')
    );
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Play Rock Paper Scissors against Waterfall or another player')
        .setDescriptionLocalizations(commandMeta.rps?.description || {})
        .addUserOption(opt =>
            opt.setName('opponent')
                .setDescription('Challenge another player (optional)')
                .setDescriptionLocalizations(commandMeta.rps?.option_opponent || {})
                .setRequired(false)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    activePvPGames,
    playerPatterns,
    getAIMove: rpsAI.getAIMove,
    recordMove: rpsAI.recordResult,
    determineWinner,
    buildResultContainer,
    buildMoveButtons,
    MOVES,
    MOVE_NAMES,
    MOVE_EMOJIS,
    PVP_TIMEOUT_MS,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            const opponent = interaction.options.getUser('opponent');
            const userId = interaction.user.id;

            if (opponent) {
                if (opponent.id === userId) {
                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('common:games.cant_play_self')}`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                if (opponent.bot) {
                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('common:games.cant_play_bot')}`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                const gameId = `${userId}_${opponent.id}_${Date.now()}`;

                const challengeContainer = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.challenge_title')}`),
                        new TextDisplayBuilder().setContent(
                            t('commands:rps.challenge_desc', {
                                challenger: `<@${userId}>`,
                                opponent: `<@${opponent.id}>`
                            })
                        )
                    )
                    .addSeparatorComponents(
                        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`-# ${t('commands:rps.challenge_timeout')}`)
                    )
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`rps_accept_${gameId}`)
                                .setLabel(t('common:games.accept'))
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`rps_decline_${gameId}`)
                                .setLabel(t('common:games.decline'))
                                .setStyle(ButtonStyle.Danger)
                        )
                    );

                const reply = await interaction.reply({
                    components: [
                        new TextDisplayBuilder().setContent(`<@${opponent.id}>`),
                        challengeContainer
                    ],
                    flags: MessageFlags.IsComponentsV2
                });

                activePvPGames.set(gameId, {
                    challengerId: userId,
                    challengedId: opponent.id,
                    challengerMove: null,
                    challengedMove: null,
                    messageId: reply.id,
                    channelId: interaction.channelId,
                    createdAt: Date.now(),
                    accepted: false
                });

                setTimeout(async () => {
                    const game = activePvPGames.get(gameId);
                    if (game && !game.accepted) {
                        activePvPGames.delete(gameId);
                        try {
                            const expiredContainer = new ContainerBuilder()
                                .setAccentColor(0x99AAB5)
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.title')}\n\n${e.pixel_cross} ${t('common:games.challenge_expired')}`)
                                );
                            await interaction.editReply({
                                components: [expiredContainer],
                                flags: MessageFlags.IsComponentsV2
                            });
                        } catch (err) {
                            logger.debug('[RPS] Could not edit expired challenge:', err.message);
                        }
                    }
                }, PVP_TIMEOUT_MS);

                return;
            }

            const gameId = `ai_${userId}_${Date.now()}`;

            const aiGameContainer = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.title')}`),
                    new TextDisplayBuilder().setContent(`<@${userId}> ${t('commands:rps.vs')} Waterfall`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(t('commands:rps.your_move'))
                )
                .addActionRowComponents(buildMoveButtons(gameId, t));

            activePvPGames.set(gameId, {
                challengerId: userId,
                isWF: true,
                createdAt: Date.now()
            });

            await interaction.reply({
                components: [aiGameContainer],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            logger.error("[/RPS] Error executing command:", error);
            return interaction.reply({
                content: `${e.pixel_cross} ${t('common:error')}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },

    async handleButton(bot, interaction, t, logger) {
        const customId = interaction.customId;
        const userId = interaction.user.id;

        const parts = customId.split('_');
        const action = parts[1];

        if (action === 'playagain') {
            return this.handlePlayAgain(bot, interaction, t, logger);
        }

        let gameId;
        if (action === 'move') {
            gameId = parts.slice(2, -1).join('_');
        } else {
            gameId = parts.slice(2).join('_');
        }

        const game = activePvPGames.get(gameId);

        if (!game) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('common:games.game_expired')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (game.isWF) {
            const move = parts[parts.length - 1];

            if (userId !== game.challengerId) {
                return interaction.reply({
                    content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!['r', 'p', 's'].includes(move)) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('common:error')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const aiMove = rpsAI.getAIMove(userId);

            rpsAI.recordResult(userId, move, aiMove);

            const result = determineWinner(move, aiMove);
            const resultContainer = buildResultContainer(move, aiMove, 'AI', result, t, true, userId);

            activePvPGames.delete(gameId);

            return interaction.update({
                components: [resultContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (action === 'accept') {
            if (userId === game.challengerId) {
                return interaction.reply({
                    content: `${e.deny} ${t('commands:rps.cant_accept_own')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (userId !== game.challengedId) {
                return interaction.reply({
                    content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            game.accepted = true;

            const pvpGameContainer = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.title')}`),
                    new TextDisplayBuilder().setContent(`<@${game.challengerId}> ${t('commands:rps.vs')} <@${game.challengedId}>`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(t('commands:rps.your_move'))
                )
                .addActionRowComponents(buildMoveButtons(gameId, t));

            return interaction.update({
                components: [
                    new TextDisplayBuilder().setContent(`<@${game.challengerId}> <@${game.challengedId}>`),
                    pvpGameContainer
                ],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (action === 'decline') {
            if (userId !== game.challengedId && userId !== game.challengerId) {
                return interaction.reply({
                    content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            activePvPGames.delete(gameId);

            const declinedContainer = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `${t('common:games.declined', { user: `<@${userId}>` })}`
                    )
                );

            return interaction.update({
                components: [declinedContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (action === 'move') {
            const move = parts[parts.length - 1];

            if (userId !== game.challengerId && userId !== game.challengedId) {
                return interaction.reply({
                    content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!['r', 'p', 's'].includes(move)) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('common:error')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (userId === game.challengerId) {
                if (game.challengerMove) {
                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('commands:rps.already_chose')}`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                game.challengerMove = move;
            } else {
                if (game.challengedMove) {
                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('commands:rps.already_chose')}`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                game.challengedMove = move;
            }

            if (game.challengerMove && game.challengedMove) {
                await funcs.sleep(100);
                const result = determineWinner(game.challengerMove, game.challengedMove);

                let resultText, accentColor;
                if (result === 0) {
                    resultText = t('common:games.tie');
                    accentColor = 0xFEE75C;
                } else if (result === 1) {
                    resultText = t('common:games.winner', { user: `<@${game.challengerId}>` });
                    accentColor = 0x57F287;
                } else {
                    resultText = t('common:games.winner', { user: `<@${game.challengedId}>` });
                    accentColor = 0x57F287;
                }

                const challengerMoveDisplay = `${MOVE_EMOJIS[game.challengerMove]} ${t(`commands:rps.${MOVE_NAMES[game.challengerMove]}`)}`;
                const challengedMoveDisplay = `${MOVE_EMOJIS[game.challengedMove]} ${t(`commands:rps.${MOVE_NAMES[game.challengedMove]}`)}`;

                const resultContainer = new ContainerBuilder()
                    .setAccentColor(accentColor)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.title')}`)
                    )
                    .addSeparatorComponents(
                        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `<@${game.challengerId}>: ${challengerMoveDisplay}\n<@${game.challengedId}>: ${challengedMoveDisplay}\n\n## ${resultText}`
                        )
                    );

                activePvPGames.delete(gameId);

                return interaction.update({
                    components: [resultContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const waitingContainer = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.title')}`),
                    new TextDisplayBuilder().setContent(`<@${game.challengerId}> ${t('commands:rps.vs')} <@${game.challengedId}>`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `${e.pixel_check} <@${userId}> ${t('commands:rps.has_chosen')}\n${e.loading} ${t('commands:rps.waiting_opponent', { user: `<@${userId === game.challengerId ? game.challengedId : game.challengerId}>` })}`
                    )
                )
                .addActionRowComponents(buildMoveButtons(gameId, t));

            return interaction.update({
                components: [waitingContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }
    },

    async handlePlayAgain(bot, interaction, t, logger) {
        const userId = interaction.user.id;
        const customIdParts = interaction.customId.split('_');
        const targetUserId = customIdParts[customIdParts.length - 1];

        if (userId !== targetUserId) {
            return interaction.reply({
                content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const gameId = `ai_${userId}_${Date.now()}`;

        const aiGameContainer = new ContainerBuilder()
            .setAccentColor(0x5865F2)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:rps.title')}`),
                new TextDisplayBuilder().setContent(`<@${userId}> ${t('commands:rps.vs')} Waterfall`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(t('commands:rps.your_move'))
            )
            .addActionRowComponents(buildMoveButtons(gameId, t));

        activePvPGames.set(gameId, {
            challengerId: userId,
            isWF: true,
            createdAt: Date.now()
        });

        await interaction.reply({
            components: [aiGameContainer],
            flags: MessageFlags.IsComponentsV2
        });
    },

    help: {
        name: "rps",
        description: "Play Rock Paper Scissors against Waterfall or another player",
        category: "Games",
        permissions: [],
        botPermissions: [],
        created: 1765999110
    }
};
