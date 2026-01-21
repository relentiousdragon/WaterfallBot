const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const e = require("../../data/emoji.js");
const funcs = require("../../util/functions.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const connect4AI = require("../../util/connect4_ai.js");
const Canvas = require('canvas');
const GIFEncoder = require('gifencoder');
const workerPool = require('../../util/workerPool.js');
const logger = require('../../logger.js');

const activeGames = new Map();
const userToGame = new Map();
const GAME_TIMEOUT_MS = 15 * 60 * 1000;

const { EMPTY, HUMAN, AI, ROWS, COLS } = connect4AI;
const PLAYER_1 = HUMAN;
const PLAYER_2 = AI;

const CELL_SIZE = 72;
const PADDING = 8;
const COL_NUM_HEIGHT = 40;
const BOARD_INNER_WIDTH = COLS * CELL_SIZE + (COLS + 1) * PADDING;
const BOARD_INNER_HEIGHT = ROWS * CELL_SIZE + (ROWS + 1) * PADDING + COL_NUM_HEIGHT;
const SIGNATURE_WIDTH = 64;
const BOARD_WIDTH = BOARD_INNER_WIDTH + SIGNATURE_WIDTH;
const BOARD_HEIGHT = BOARD_INNER_HEIGHT;
const BOARD_OFFSET_X = 0;
const BOARD_OFFSET_Y = 0;
const BALL_RADIUS = (CELL_SIZE / 2) - 4;

const PLAYER_COLORS = [
    { name: 'Red', hex: '#ff3131', emoji: '🔴' },
    { name: 'Yellow', hex: '#ffde38', emoji: '🟡' },
    { name: 'Purple', hex: '#b537ff', emoji: '🟣' },
    { name: 'Green', hex: '#37ff4d', emoji: '🟢' },
    { name: 'Orange', hex: '#ff9337', emoji: '🟠' },
    { name: 'Cyan', hex: '#37ffff', emoji: '🔵' }
];

function getPlayerColors(isPVE = false) {
    let available = [...PLAYER_COLORS];
    let p1, p2;

    if (isPVE) {
        const prefs = available.filter(c => c.name === 'Red' || c.name === 'Purple');
        p2 = prefs[Math.floor(Math.random() * prefs.length)] || available[0];
        available = available.filter(c => c !== p2);
        p1 = available[Math.floor(Math.random() * available.length)];
    } else {
        p1 = available.splice(Math.floor(Math.random() * available.length), 1)[0];
        p2 = available[Math.floor(Math.random() * available.length)];
    }

    return { p1, p2 };
}

setInterval(() => {
    const now = Date.now();
    for (const [gameId, game] of activeGames.entries()) {
        if (now - game.lastInteraction > GAME_TIMEOUT_MS) {
            userToGame.delete(game.challengerId);
            if (game.opponentId) userToGame.delete(game.opponentId);
            activeGames.delete(gameId);
        }
    }
}, 60000);

function isUserInGame(userId) {
    const gameId = userToGame.get(userId);
    if (!gameId) return null;
    if (!activeGames.has(gameId)) {
        userToGame.delete(userId);
        return null;
    }
    return gameId;
}

function removeGame(gameId) {
    const game = activeGames.get(gameId);
    if (game) {
        userToGame.delete(game.challengerId);
        if (game.opponentId) userToGame.delete(game.opponentId);
    } else {
        const parts = gameId.split('_');
        if (parts[0] === 'ai') {
            userToGame.delete(parts[1]);
        } else {
            userToGame.delete(parts[0]);
            userToGame.delete(parts[1]);
        }
    }
    activeGames.delete(gameId);
}

async function renderBoardAsync(board, colors, lastMove = null, gameId = null) {
    try {
        const result = await workerPool.execute('connect4', {
            type: 'render',
            board,
            colors,
            lastMove,
            gameId
        });
        return Buffer.from(result);
    } catch (err) {
        logger.warn(`[Connect4] Worker render failed, using main thread: ${err.message}`);
        return renderBoardLocal(board, colors, lastMove, gameId);
    }
}

async function renderBoardLocal(board, colors, lastMove = null, gameId = null) {
    if (lastMove) {
        return renderAnimatedBoard(board, colors, lastMove, gameId);
    }

    const canvas = Canvas.createCanvas(BOARD_WIDTH, BOARD_HEIGHT);
    const ctx = canvas.getContext('2d');
    drawFullBoard(ctx, board, colors, [], gameId);
    return canvas.toBuffer();
}

function drawSideSignature(ctx, gameId) {
    if (!gameId) return;

    const startX = BOARD_INNER_WIDTH;
    const width = SIGNATURE_WIDTH;
    const height = BOARD_HEIGHT;

    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(startX, 0, 2, height);

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(startX + 2, 0, width - 2, height);

    let hash = 0;
    for (let i = 0; i < gameId.length; i++) {
        hash = ((hash << 5) - hash) + gameId.charCodeAt(i);
        hash |= 0;
    }

    const seededFunc = (s) => {
        let t = s += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };

    let rnd = hash;

    ctx.save();
    for (let i = 0; i < 20; i++) {
        const barY = seededFunc(rnd++) * height;
        const barH = 4 + seededFunc(rnd++) * 25;
        const barW = 2 + seededFunc(rnd++) * (width - 12);
        const opacity = 0.3 + seededFunc(rnd++) * 0.5;

        const palette = ['#ff9d00', '#00ffcc', '#ffffff', '#ff37ff', '#37ffff'];
        ctx.fillStyle = palette[Math.floor(seededFunc(rnd++) * palette.length)];
        ctx.globalAlpha = opacity;

        ctx.fillRect(startX + 6 + (width - 12 - barW) / 2, barY, barW, barH);

        if (seededFunc(rnd++) > 0.7) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillRect(startX + 4, barY, width - 8, 1);
        }
    }
    ctx.restore();
}

function drawFullBoard(ctx, board, colors, winningCoords = [], gameId = null) {
    drawBoardBackground(ctx);
    if (gameId) drawSideSignature(ctx, gameId);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = BOARD_OFFSET_X + PADDING + c * (CELL_SIZE + PADDING) + CELL_SIZE / 2;
            const y = BOARD_OFFSET_Y + COL_NUM_HEIGHT + PADDING + r * (CELL_SIZE + PADDING) + CELL_SIZE / 2;
            const cell = board[r][c];
            const isWinning = winningCoords.some(coord => coord.r === r && coord.c === c);

            if (cell === EMPTY) {
                drawHole(ctx, x, y);
            } else {
                drawPiece(ctx, x, y, cell === PLAYER_1 ? colors.p1.hex : colors.p2.hex, isWinning);
            }
        }
    }
}

function drawBoardBackground(ctx) {
    const boardGrad = ctx.createLinearGradient(0, 0, 0, BOARD_HEIGHT);
    boardGrad.addColorStop(0, '#0066cc');
    boardGrad.addColorStop(1, '#004488');
    ctx.fillStyle = boardGrad;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < COLS; c++) {
        const x = BOARD_OFFSET_X + PADDING + c * (CELL_SIZE + PADDING) + CELL_SIZE / 2;
        ctx.fillText(`${c + 1}`, x, BOARD_OFFSET_Y + COL_NUM_HEIGHT / 2);
    }
}

function drawHole(ctx, x, y) {
    const holeGrad = ctx.createRadialGradient(x, y, 0, x, y, BALL_RADIUS);
    holeGrad.addColorStop(0, '#111');
    holeGrad.addColorStop(0.8, '#222');
    holeGrad.addColorStop(1, '#000');
    ctx.fillStyle = holeGrad;
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawPiece(ctx, x, y, color, isWinning = false) {
    if (isWinning) {
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, BALL_RADIUS + 2, 0, Math.PI * 2);
        ctx.stroke();
    }

    const pieceGrad = ctx.createRadialGradient(x - BALL_RADIUS / 3, y - BALL_RADIUS / 3, BALL_RADIUS / 10, x, y, BALL_RADIUS);
    pieceGrad.addColorStop(0, color);
    pieceGrad.addColorStop(0.8, darkenColor(color, 20));
    pieceGrad.addColorStop(1, darkenColor(color, 40));

    ctx.fillStyle = pieceGrad;
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x - BALL_RADIUS / 4, y - BALL_RADIUS / 4, BALL_RADIUS / 2, 0, Math.PI * 2);
    const shineGrad = ctx.createLinearGradient(x - BALL_RADIUS, y - BALL_RADIUS, x, y);
    shineGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
    shineGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shineGrad;
    ctx.fill();

    ctx.shadowBlur = 0;
}

const darkenedColorCache = new Map();
function darkenColor(hex, percent) {
    const key = `${hex}_${percent}`;
    if (darkenedColorCache.has(key)) return darkenedColorCache.get(key);

    const num = parseInt(hex.replace('#', ''), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) - amt,
        G = (num >> 8 & 0x00FF) - amt,
        B = (num & 0x0000FF) - amt;
    const result = "#" + (0x1000000 + (R < 255 ? R < 0 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 0 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 0 ? 0 : B : 255)).toString(16).slice(1);
    darkenedColorCache.set(key, result);
    return result;
}

async function renderAnimatedBoard(board, colors, lastMove, gameId = null) {
    return new Promise((resolve, reject) => {
        const encoder = new GIFEncoder(BOARD_WIDTH, BOARD_HEIGHT);
        const stream = encoder.createReadStream();
        encoder.start();
        encoder.setRepeat(-1);
        encoder.setDelay(50);
        encoder.setQuality(19);

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => reject(err));

        const canvas = Canvas.createCanvas(BOARD_WIDTH, BOARD_HEIGHT);
        const ctx = canvas.getContext('2d');

        const staticCanvas = Canvas.createCanvas(BOARD_WIDTH, BOARD_HEIGHT);
        const staticCtx = staticCanvas.getContext('2d');
        const prevBoard = connect4AI.createBoard();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (r === lastMove.row && c === lastMove.col) prevBoard[r][c] = EMPTY;
                else prevBoard[r][c] = board[r][c];
            }
        }
        drawFullBoard(staticCtx, prevBoard, colors, [], gameId);

        const endY = BOARD_OFFSET_Y + COL_NUM_HEIGHT + PADDING + lastMove.row * (CELL_SIZE + PADDING) + CELL_SIZE / 2;
        const x = BOARD_OFFSET_X + PADDING + lastMove.col * (CELL_SIZE + PADDING) + CELL_SIZE / 2;
        let currentY = -BALL_RADIUS;
        const speed = 50;

        while (currentY < endY) {
            currentY += speed;
            if (currentY > endY) currentY = endY;

            ctx.drawImage(staticCanvas, 0, 0);
            drawPiece(ctx, x, currentY, lastMove.player === PLAYER_1 ? colors.p1.hex : colors.p2.hex);
            encoder.addFrame(ctx);
            if (currentY === endY) break;
        }

        const isWinMove = connect4AI.checkWin(board, lastMove.player);
        if (isWinMove) {
            const winningCoords = connect4AI.getWinningCoords(board, lastMove.player);
            for (let i = 0; i < 8; i++) {
                const shakeX = (Math.random() - 0.5) * 10;
                const shakeY = (Math.random() - 0.5) * 10;

                ctx.save();
                ctx.translate(shakeX, shakeY);
                drawFullBoard(ctx, board, colors, winningCoords, gameId);
                drawFlames(ctx, x, endY, i);
                encoder.addFrame(ctx);
                ctx.restore();
            }
            for (let i = 0; i < 5; i++) {
                drawFullBoard(ctx, board, colors, winningCoords, gameId);
                encoder.addFrame(ctx);
            }
        } else {
            drawFullBoard(ctx, board, colors, [], gameId);
            encoder.addFrame(ctx);
        }

        encoder.finish();
    });
}

function drawFlames(ctx, x, y, frame) {
    const flameCount = 12;
    for (let i = 0; i < flameCount; i++) {
        const angle = (i / flameCount) * Math.PI * 2;
        const distance = 10 + frame * 5;
        const fx = x + Math.cos(angle) * distance;
        const fy = y + Math.sin(angle) * distance;
        const size = Math.max(0, 15 - frame * 2);

        const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, size);
        grad.addColorStop(0, '#ffcc00');
        grad.addColorStop(0.5, '#ff6600');
        grad.addColorStop(1, 'rgba(255,0,0,0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(fx, fy, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function buildGameComponents(gameId, t, board, aiThinking = false, isGameOver = false) {
    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();

    const validMoves = connect4AI.getValidMoves(board);

    for (let c = 0; c < COLS; c++) {
        const btn = new ButtonBuilder()
            .setCustomId(`c4_move_${gameId}_${c}`)
            .setLabel(`${c + 1}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isGameOver || aiThinking || !validMoves.includes(c));

        if (c < 4) row1.addComponents(btn);
        else row2.addComponents(btn);
    }

    return [row1, row2];
}

function buildForfeitButton(gameId, t, disabled = false) {
    return new ButtonBuilder()
        .setCustomId(`c4_forfeit_${gameId}`)
        .setLabel(t('common:games.forfeit'))
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🏳️')
        .setDisabled(disabled);
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setNameLocalizations(commandMeta.connect4?.name || {})
        .setDescription('Play Connect 4 against Waterfall or a friend')
        .setDescriptionLocalizations(commandMeta.connect4?.description || {})
        .addUserOption(opt =>
            opt.setName('opponent')
                .setNameLocalizations(commandMeta.connect4?.option_opponent_name || {})
                .setDescription('Challenge another player (optional)')
                .setDescriptionLocalizations(commandMeta.connect4?.option_opponent_description || {})
                .setRequired(false)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    activeGames,
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            const opponent = interaction.options.getUser('opponent');
            const userId = interaction.user.id;

            const existingGameId = isUserInGame(userId);
            if (existingGameId) {
                const game = activeGames.get(existingGameId);
                let messageExists = false;

                if (game && game.interaction) {
                    try {
                        await game.interaction.fetchReply();
                        messageExists = true;
                    } catch (err) {
                        messageExists = false;
                    }
                }

                const container = new ContainerBuilder().setAccentColor(0xED4245);

                if (messageExists) {
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('common:games.already_in_game')}`));
                } else {
                    container.addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('common:games.already_in_game')}`))
                            .setButtonAccessory(
                                new ButtonBuilder()
                                    .setCustomId(`c4_forfeit_${existingGameId}`)
                                    .setLabel(t('common:games.forfeit'))
                                    .setStyle(ButtonStyle.Danger)
                                    .setEmoji('🏳️')
                            )
                    );
                }

                return interaction.reply({
                    components: [container],
                    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
                });
            }

            if (opponent) {
                if (opponent.id === userId) {
                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('common:games.cant_play_self')}`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                for (const [gId, g] of activeGames.entries()) {
                    if (!g.accepted && g.challengerId === userId) {
                        return interaction.reply({
                            content: `${e.pixel_cross} ${t('common:games.already_challenged')}`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
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
                        new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:connect4.title')}`),
                        new TextDisplayBuilder().setContent(
                            t('commands:connect4.challenge_desc', {
                                challenger: `<@${userId}>`,
                                opponent: `<@${opponent.id}>`
                            })
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`-# ${t('commands:connect4.challenge_timeout')}`)
                    )
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`c4_accept_${gameId}`).setLabel(t('common:games.accept')).setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`c4_decline_${gameId}`).setLabel(t('common:games.decline')).setStyle(ButtonStyle.Danger)
                        )
                    );

                const reply = await interaction.reply({ components: [new TextDisplayBuilder().setContent(`<@${opponent.id}>`), challengeContainer], flags: MessageFlags.IsComponentsV2 });

                const colors = getPlayerColors(false);
                activeGames.set(gameId, {
                    type: 'PVP',
                    challengerId: userId,
                    opponentId: opponent.id,
                    board: connect4AI.createBoard(),
                    turn: PLAYER_1,
                    lastInteraction: Date.now(),
                    accepted: false,
                    messageId: reply.id,
                    channelId: interaction.channelId,
                    interaction: interaction,
                    colors: colors
                });
                userToGame.set(userId, gameId);
                userToGame.set(opponent.id, gameId);

                setTimeout(async () => {
                    const g = activeGames.get(gameId);
                    if (g && !g.accepted) {
                        userToGame.delete(g.challengerId);
                        if (g.opponentId) userToGame.delete(g.opponentId);
                        activeGames.delete(gameId);
                        try {
                            const expiredContainer = new ContainerBuilder()
                                .setAccentColor(0x99AAB5)
                                .addTextDisplayComponents(new TextDisplayBuilder().setContent(t('common:games.challenge_expired')));
                            await interaction.editReply({ components: [expiredContainer], flags: MessageFlags.IsComponentsV2 });
                        } catch (e) { }
                    }
                }, 600000);

                return;
            }

            const gameId = `ai_${userId}_${Date.now()}`;
            const board = connect4AI.createBoard();

            await interaction.deferReply();

            const colors = getPlayerColors(true);
            const userStarts = Math.random() < 0.5;
            const userSide = PLAYER_1;
            let turn = userStarts ? PLAYER_1 : PLAYER_2;

            let lastMove = null;
            if (!userStarts) {
                const col = await connect4AI.getAIMoveAsync(board);
                const row = connect4AI.dropPiece(board, col, PLAYER_2);
                lastMove = { col, row, player: PLAYER_2 };
                turn = PLAYER_1;
            }

            const buffer = await renderBoardAsync(board, colors, lastMove, gameId);
            logger.debug(`[/Connect4] Generated initial board buffer, size: ${buffer.length} bytes`);
            const attachName = `connect4_${Date.now()}_${Math.random().toString(36).slice(2)}.${lastMove ? 'gif' : 'png'}`;
            const attachment = new AttachmentBuilder(buffer, { name: attachName });

            activeGames.set(gameId, {
                type: 'PVE',
                challengerId: userId,
                userSide: userSide,
                board,
                turn: turn,
                lastInteraction: Date.now(),
                accepted: true,
                interaction: interaction,
                lastInfo: { attachmentName: attachName },
                colors: colors
            });
            userToGame.set(userId, gameId);

            const game = activeGames.get(gameId);

            const container = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## ${e.discord_orbs} ${t('commands:connect4.title')}`),
                            new TextDisplayBuilder().setContent(t('commands:connect4.game_vs_ai', {
                                playerColor: game.colors.p1.emoji,
                                aiColor: game.colors.p2.emoji
                            }))
                        )
                        .setButtonAccessory(buildForfeitButton(gameId, t))
                )
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachName}`).setDescription(t('commands:connect4.title'))))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(t('common:games.turn_yours')))
                .addActionRowComponents(buildGameComponents(gameId, t, board));

            const reply = await interaction.editReply({
                components: [container],
                files: [attachment],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            logger.error("[/Connect4] Error:", error);
            if (interaction.deferred || interaction.replied) {
                interaction.editReply({ content: t('common:error') }).catch(() => { });
            } else {
                interaction.reply({ content: t('common:error'), flags: MessageFlags.Ephemeral });
            }
        }
    },
    async handleButton(bot, interaction, t, logger) {
        const customId = interaction.customId;
        const userId = interaction.user.id;
        const parts = customId.split('_');
        const action = parts[1];
        const gameId = parts.slice(2, parts.length - (action === 'move' ? 1 : 0)).join('_');

        const game = activeGames.get(gameId);
        if (!game) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:games.game_expired')}`, flags: MessageFlags.Ephemeral });
        }

        if (action === 'accept') {
            if (userId === game.challengerId) {
                return interaction.reply({ content: `${e.deny} ${t('commands:rps.cant_accept_own')}`, flags: MessageFlags.Ephemeral });
            }
            if (userId !== game.opponentId) {
                return interaction.reply({ content: `${e.deny} ${t('common:pagination.not_for_you')}`, flags: MessageFlags.Ephemeral });
            }
            const userCurrentGame = isUserInGame(userId);
            if (userCurrentGame && userCurrentGame !== gameId) {
                return interaction.reply({ content: `${e.pixel_cross} ${t('common:games.already_in_game')}`, flags: MessageFlags.Ephemeral });
            }
            const challengerCurrentGame = isUserInGame(game.challengerId);
            if (challengerCurrentGame && challengerCurrentGame !== gameId) {
                return interaction.reply({ content: `${e.pixel_cross} ${t('common:games.challenger_busy')}`, flags: MessageFlags.Ephemeral });
            }

            await interaction.deferUpdate();
            game.accepted = true;
            game.lastInteraction = Date.now();
            if (!game.lastInfo) game.lastInfo = {};

            const buffer = await renderBoardAsync(game.board, game.colors, null, gameId);
            logger.debug(`[Connect4] Generated accept board buffer, size: ${buffer.length} bytes`);
            const attachName = `connect4_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
            game.lastInfo.attachmentName = attachName;
            const attachment = new AttachmentBuilder(buffer, { name: attachName });

            const container = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## ${e.discord_orbs} ${t('commands:connect4.title')}`),
                            new TextDisplayBuilder().setContent(`-# ${game.colors.p1.emoji} <@${game.challengerId}> vs ${game.colors.p2.emoji} <@${game.opponentId}>`)
                        ).setButtonAccessory(buildForfeitButton(gameId, t))
                )
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachName}`).setDescription(t('commands:connect4.title'))))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(t('common:games.turn_user', { user: `<@${game.challengerId}>` })))
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                .addActionRowComponents(buildGameComponents(gameId, t, game.board));

            return interaction.editReply({
                components: [new TextDisplayBuilder().setContent(`<@${game.challengerId}> <@${game.opponentId}>`), container],
                files: [attachment],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (action === 'decline') {
            if (userId !== game.opponentId && userId !== game.challengerId) {
                return interaction.reply({ content: `${e.deny} ${t('common:pagination.not_for_you')}`, flags: MessageFlags.Ephemeral });
            }
            removeGame(gameId);

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(t('common:games.declined', { user: `<@${userId}>` })));

            return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'forfeit') {
            if (userId !== game.challengerId && userId !== game.opponentId) {
                return interaction.reply({ content: `${e.deny} ${t('common:pagination.not_for_you')}`, flags: MessageFlags.Ephemeral });
            }

            removeGame(gameId);

            const winnerId = userId === game.challengerId ? game.opponentId : game.challengerId;
            const winMsg = game.type === 'PVE'
                ? t('common:games.you_lose')
                : t('common:games.winner', { user: `<@${winnerId}>` });

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# 🏳️ ${t('common:games.forfeited', { user: `<@${userId}>` })}`),
                    new TextDisplayBuilder().setContent(winMsg)
                );

            return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'move') {
            const col = parseInt(parts[parts.length - 1]);
            const expectedUser = game.type === 'PVE' ? game.challengerId : (game.turn === PLAYER_1 ? game.challengerId : game.opponentId);
            const playerPiece = game.turn;

            if (userId !== expectedUser) {
                return interaction.reply({ content: t('common:games.not_your_turn'), flags: MessageFlags.Ephemeral });
            }

            if (!connect4AI.isValidMove(game.board, col)) {
                return interaction.reply({ content: t('commands:connect4.col_full'), flags: MessageFlags.Ephemeral });
            }

            const row = connect4AI.dropPiece(game.board, col, playerPiece);
            const lastMove = { col, row, player: playerPiece };

            let winner = null;
            if (connect4AI.checkWin(game.board, playerPiece)) {
                winner = playerPiece;
            } else if (connect4AI.getValidMoves(game.board).length === 0) {
                winner = 'tie';
            }

            if (winner) {
                removeGame(gameId);
                if (game.type === 'PVE') {
                    if (winner !== 'tie') {
                        const isAiWin = (winner !== game.userSide);
                        connect4AI.recordGameResult(isAiWin ? AI : HUMAN);
                    }
                }

                await interaction.deferUpdate();
                const buffer = await renderBoardAsync(game.board, game.colors, lastMove, gameId);
                logger.debug(`[Connect4] Generated win board buffer, size: ${buffer.length} bytes`);
                const attachName = `connect4_${Date.now()}_${Math.random().toString(36).slice(2)}.gif`;
                const attachment = new AttachmentBuilder(buffer, { name: attachName });

                let winMsg;
                if (winner === 'tie') winMsg = t('common:games.tie');
                else if (game.type === 'PVE') winMsg = (winner === game.userSide) ? t('common:games.you_win') : t('common:games.you_lose');
                else winMsg = t('common:games.winner', { user: `<@${userId}>` });

                const container = new ContainerBuilder()
                    .setAccentColor(winner === 'tie' ? 0xFEE75C : 0x57F287)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${winner === 'tie' ? '🤝' : '🏆'} ${winMsg}`))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachName}`).setDescription(t('commands:connect4.title'))))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(buildGameComponents(gameId, t, game.board, false, true));

                return interaction.editReply({
                    components: [container],
                    files: [attachment],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            game.turn = (game.turn === PLAYER_1) ? PLAYER_2 : PLAYER_1;

            if (game.type === 'PVE') {
                const thinkingContainer = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## ${e.discord_orbs} ${t('commands:connect4.title')}`),
                                new TextDisplayBuilder().setContent(`-# ${e.loading} ${t('commands:connect4.ai_thinking')}`)
                            ).setButtonAccessory(buildForfeitButton(gameId, t, true))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${game.lastInfo?.attachmentName}`).setDescription(t('commands:connect4.title'))))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(buildGameComponents(gameId, t, game.board, true));

                await interaction.update({
                    components: [thinkingContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                const buffer = await renderBoardAsync(game.board, game.colors, lastMove, gameId);
                logger.debug(`[Connect4] Generated move board buffer, size: ${buffer.length} bytes`);
                const attachName1 = `connect4_${Date.now()}_${Math.random().toString(36).slice(2)}.gif`;
                game.lastInfo.attachmentName = attachName1;
                const attachment = new AttachmentBuilder(buffer, { name: attachName1 });

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## ${e.discord_orbs} ${t('commands:connect4.title')}`),
                                new TextDisplayBuilder().setContent(`-# ${e.loading} ${t('commands:connect4.ai_thinking')}`)
                            ).setButtonAccessory(buildForfeitButton(gameId, t, true))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachName1}`).setDescription(t('commands:connect4.title'))))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(buildGameComponents(gameId, t, game.board, true));

                await interaction.editReply({
                    components: [container],
                    files: [attachment],
                    flags: MessageFlags.IsComponentsV2
                });

                await funcs.sleep(100);
                const aiCol = await connect4AI.getAIMoveAsync(game.board);
                const aiRow = connect4AI.dropPiece(game.board, aiCol, game.turn);
                const aiMove = { col: aiCol, row: aiRow, player: game.turn };

                let aiWinner = null;
                if (connect4AI.checkWin(game.board, game.turn)) {
                    aiWinner = game.turn;
                } else if (connect4AI.getValidMoves(game.board).length === 0) {
                    aiWinner = 'tie';
                }

                if (aiWinner) {
                    removeGame(gameId);
                    if (aiWinner !== 'tie') connect4AI.recordGameResult(AI);

                    const aiBuffer = await renderBoardAsync(game.board, game.colors, aiMove, gameId);
                    const attachName2 = `connect4_${Date.now()}_${Math.random().toString(36).slice(2)}.gif`;
                    const aiAttach = new AttachmentBuilder(aiBuffer, { name: attachName2 });
                    let winMsg = (aiWinner === 'tie') ? t('common:games.tie') : t('common:games.you_lose');

                    const finalContainer = new ContainerBuilder()
                        .setAccentColor(aiWinner === 'tie' ? 0xFEE75C : 0xED4245)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${aiWinner === 'tie' ? '🤝' : '🪦'} ${winMsg}`))
                        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachName2}`).setDescription(t('commands:connect4.title'))))
                        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                        .addActionRowComponents(buildGameComponents(gameId, t, game.board, false, true));

                    return interaction.editReply({
                        components: [finalContainer],
                        files: [aiAttach],
                        flags: MessageFlags.IsComponentsV2
                    });
                }

                game.turn = game.userSide;
                const finalBuffer = await renderBoardAsync(game.board, game.colors, aiMove, gameId);
                const attachName3 = `connect4_${Date.now()}_${Math.random().toString(36).slice(2)}.gif`;
                game.lastInfo.attachmentName = attachName3;
                const finalAttach = new AttachmentBuilder(finalBuffer, { name: attachName3 });

                const userContainer = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## ${e.discord_orbs} ${t('commands:connect4.title')}`),
                                new TextDisplayBuilder().setContent(t('common:games.turn_yours'))
                            ).setButtonAccessory(buildForfeitButton(gameId, t))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachName3}`).setDescription(t('commands:connect4.title'))))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(buildGameComponents(gameId, t, game.board));

                return interaction.editReply({
                    components: [userContainer],
                    files: [finalAttach],
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                const nextUser = (game.turn === PLAYER_1) ? game.challengerId : game.opponentId;

                const waitingContainer = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## ${e.discord_orbs} ${t('commands:connect4.title')}`),
                                new TextDisplayBuilder().setContent(`-# ${game.colors.p1.emoji} <@${game.challengerId}> vs ${game.colors.p2.emoji} <@${game.opponentId}>`)
                            ).setButtonAccessory(buildForfeitButton(gameId, t))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${game.lastInfo?.attachmentName}`).setDescription(t('commands:connect4.title'))))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e.loading} ${t('common:games.waiting_for', { user: `<@${nextUser}>` })}`))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(buildGameComponents(gameId, t, game.board, false, true));

                await interaction.update({
                    components: [new TextDisplayBuilder().setContent(`<@${game.challengerId}> <@${game.opponentId}>`), waitingContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                const buffer = await renderBoardAsync(game.board, game.colors, lastMove, gameId);
                logger.debug(`[Connect4] Generated PvP move board buffer, size: ${buffer.length} bytes`);
                const attachName4 = `connect4_${Date.now()}_${Math.random().toString(36).slice(2)}.gif`;
                game.lastInfo.attachmentName = attachName4;
                const attachment = new AttachmentBuilder(buffer, { name: attachName4 });

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## ${e.discord_orbs} ${t('commands:connect4.title')}`),
                                new TextDisplayBuilder().setContent(`-# ${game.colors.p1.emoji} <@${game.challengerId}> vs ${game.colors.p2.emoji} <@${game.opponentId}>`)
                            ).setButtonAccessory(buildForfeitButton(gameId, t))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachName4}`).setDescription(t('commands:connect4.title'))))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t('common:games.turn_user', { user: `<@${nextUser}>` })))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(buildGameComponents(gameId, t, game.board));

                return interaction.editReply({
                    components: [new TextDisplayBuilder().setContent(`<@${game.challengerId}> <@${game.opponentId}>`), container],
                    files: [attachment],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        }
    },
    help: {
        name: "connect4",
        description: "Play Connect 4",
        category: "Games",
        permissions: [],
        botPermissions: [],
        created: 1766066848
    }
};

// contributors: @relentiousdragon