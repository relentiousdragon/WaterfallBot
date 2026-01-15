const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const hangmanState = require("../../util/hangman_state.js");

const HANGMAN_STAGES = [
    [
        "```",
        "  +---+  ",
        "  |   |  ",
        "      |  ",
        "      |  ",
        "      |  ",
        "      |  ",
        "=========",
        "```"
    ],
    [
        "```",
        "  +---+  ",
        "  |   |  ",
        "  O   |  ",
        "      |  ",
        "      |  ",
        "      |  ",
        "=========",
        "```"
    ],
    [
        "```",
        "  +---+  ",
        "  |   |  ",
        "  O   |  ",
        "  |   |  ",
        "      |  ",
        "      |  ",
        "=========",
        "```"
    ],
    [
        "```",
        "  +---+  ",
        "  |   |  ",
        "  O   |  ",
        " /|   |  ",
        "      |  ",
        "      |  ",
        "=========",
        "```"
    ],
    [
        "```",
        "  +---+  ",
        "  |   |  ",
        "  O   |  ",
        " /|\\  |  ",
        "      |  ",
        "      |  ",
        "=========",
        "```"
    ],
    [
        "```",
        "  +---+  ",
        "  |   |  ",
        "  O   |  ",
        " /|\\  |  ",
        " /    |  ",
        "      |  ",
        "=========",
        "```"
    ],
    [
        "```",
        "  +---+  ",
        "  |   |  ",
        "  O   |  ",
        " /|\\  |  ",
        " / \\  |  ",
        "      |  ",
        "=========",
        "```"
    ]
];

const HANGMAN_STYLES = [
    HANGMAN_STAGES,
    [
        ["```", " ____  ", "|    | ", "|      ", "|      ", "|      ", "|______", "```"],
        ["```", " ____  ", "|    | ", "|    O ", "|      ", "|      ", "|______", "```"],
        ["```", " ____  ", "|    | ", "|    O ", "|    | ", "|      ", "|______", "```"],
        ["```", " ____  ", "|    | ", "|    O ", "|   /| ", "|      ", "|______", "```"],
        ["```", " ____  ", "|    | ", "|    O ", "|   /|\\", "|      ", "|______", "```"],
        ["```", " ____  ", "|    | ", "|    O ", "|   /|\\", "|   /  ", "|______", "```"],
        ["```", " ____  ", "|    | ", "|    O ", "|   /|\\", "|   / \\", "|______", "```"]
    ],
    [
        ["```", "╔═══════╗", "║   |   ║", "║       ║", "║       ║", "║       ║", "╚═══════╝", "```"],
        ["```", "╔═══════╗", "║   |   ║", "║   O   ║", "║       ║", "║       ║", "╚═══════╝", "```"],
        ["```", "╔═══════╗", "║   |   ║", "║   O   ║", "║   |   ║", "║       ║", "╚═══════╝", "```"],
        ["```", "╔═══════╗", "║   |   ║", "║   O   ║", "║  /|   ║", "║       ║", "╚═══════╝", "```"],
        ["```", "╔═══════╗", "║   |   ║", "║   O   ║", "║  /|\\  ║", "║       ║", "╚═══════╝", "```"],
        ["```", "╔═══════╗", "║   |   ║", "║   O   ║", "║  /|\\  ║", "║  /    ║", "╚═══════╝", "```"],
        ["```", "╔═══════╗", "║   |   ║", "║   O   ║", "║  /|\\  ║", "║  / \\  ║", "╚═══════╝", "```"]
    ]
];

const sessionButtonLetters = new Map();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('hangman')
        .setNameLocalizations(commandMeta.hangman?.name || {})
        .setDescription('Play the daily Hangman word game')
        .setDescriptionLocalizations(commandMeta.hangman?.description || {}),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    sessionButtonLetters,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            const userId = interaction.user.id;

            if (!hangmanState.isWordActive()) {
                const wordInfo = hangmanState.getWordInfo();
                let message = `${e.pixel_cross} ${t('commands:hangman.no_word_set')}`;

                if (wordInfo?.expiresAt) {
                    message = `${e.pixel_cross} ${t('commands:hangman.word_expired')}`;
                }

                return interaction.reply({
                    content: message,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!hangmanState.canUserPlay(userId)) {
                const wordInfo = hangmanState.getWordInfo();
                const expiresAt = Math.floor(wordInfo.expiresAt / 1000);

                const currentWord = hangmanState.getCurrentWord();
                if (currentWord?.winners?.includes(userId)) {
                    return interaction.reply({
                        content: `${e.pixel_check} ${t('commands:hangman.already_won')}\n-# ${t('commands:hangman.next_word', { time: `<t:${expiresAt}:R>` })}${getFirstWinnerText(currentWord, t)}`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:hangman.already_failed')}\n-# ${t('commands:hangman.next_word', { time: `<t:${expiresAt}:R>` })}${getFirstWinnerText(currentWord, t)}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const session = hangmanState.getSession(userId);
            if (!session) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:hangman.session_error')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const currentWord = hangmanState.getCurrentWord();

            const buttonLetters = hangmanState.generateLetterButtons(currentWord.word.split(''));
            const sessionId = Date.now().toString(36);
            sessionButtonLetters.set(`${userId}_${sessionId}`, buttonLetters);

            const styleIndex = Math.floor(Math.random() * HANGMAN_STYLES.length);

            const container = buildGameContainer(
                userId,
                sessionId,
                session,
                currentWord,
                buttonLetters,
                styleIndex,
                t
            );

            await interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            logger.error("[/Hangman] Error executing command:", error);
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
        if (parts.length < 5) return;

        const targetUserId = parts[1];
        const sessionId = parts[2];
        const letter = parts[3];
        const styleIndex = parseInt(parts[4]) || 0;

        if (userId !== targetUserId) {
            return interaction.reply({
                content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!hangmanState.isWordActive()) {
            const expireContainer = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('commands:hangman.word_expired_mid')}`)
                );

            return interaction.update({
                components: [expireContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const sessionKey = `${userId}_${sessionId}`;
        const buttonLetters = sessionButtonLetters.get(sessionKey) || [];
        if (buttonLetters.length === 0) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:hangman.session_expired')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const result = hangmanState.processGuess(userId, letter);

        if (result.error === 'already_guessed') {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:hangman.already_guessed')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (result.error === 'already_won' || result.error === 'already_failed') {
            const wordInfo = hangmanState.getWordInfo();
            const currentWord = hangmanState.getCurrentWord();
            const expiresAt = Math.floor(wordInfo.expiresAt / 1000);
            const content = result.error === 'already_won'
                ? `${e.pixel_check} ${t('commands:hangman.already_won')}\n-# ${t('commands:hangman.next_word', { time: `<t:${expiresAt}:R>` })}${getFirstWinnerText(currentWord, t)}`
                : `${e.pixel_cross} ${t('commands:hangman.already_failed')}\n-# ${t('commands:hangman.next_word', { time: `<t:${expiresAt}:R>` })}${getFirstWinnerText(currentWord, t)}`;

            return interaction.reply({
                content,
                flags: MessageFlags.Ephemeral
            });
        }

        if (result.error === 'word_expired' || result.error === 'no_session') {
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('commands:hangman.session_expired')}`)
                );

            return interaction.update({
                components: [errorContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const currentWord = hangmanState.getCurrentWord();
        const session = hangmanState.getSession(userId);

        if (result.isWin) {
            await hangmanState.recordWin(userId, interaction.user.username, bot);
            sessionButtonLetters.delete(sessionKey);

            const wordDisplay = result.word.split('').join(' ');
            const winStages = HANGMAN_STYLES[styleIndex][result.wrongGuesses];

            const winContainer = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# 🎉 ${t('commands:hangman.you_win')}`),
                    new TextDisplayBuilder().setContent(winStages.join('\n')),
                    new TextDisplayBuilder().setContent(`\n**${wordDisplay}**`)
                );

            if (result.description) {
                winContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# ${result.description}`)
                );
            }

            const winFooter = getFirstWinnerText(currentWord, t);
            if (winFooter) {
                winContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(winFooter.trim())
                );
            }

            winContainer.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            winContainer.addActionRowComponents(...buildDisabledButtons(buttonLetters, new Set(result.guessedLetters), result.word, userId, sessionId, styleIndex));

            return interaction.update({
                components: [winContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (result.isLoss) {
            await hangmanState.recordFail(userId);
            sessionButtonLetters.delete(sessionKey);

            const wordDisplay = result.word.split('').join(' ');
            const loseStages = HANGMAN_STYLES[styleIndex][6];
            const wordInfo = hangmanState.getWordInfo();
            const expiresAt = Math.floor(wordInfo.expiresAt / 1000);

            const loseContainer = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# 🏳️ ${t('commands:hangman.you_lose')}`),
                    new TextDisplayBuilder().setContent(loseStages.join('\n')),
                    new TextDisplayBuilder().setContent(`\n${t('commands:hangman.word_was_hidden')}`)
                );

            if (result.description) {
                loseContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# ${result.description}`)
                );
            }

            loseContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`\n-# ${t('commands:hangman.next_word', { time: `<t:${expiresAt}:R>` })}${getFirstWinnerText(currentWord, t)}`)
            );

            loseContainer.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            loseContainer.addActionRowComponents(...buildDisabledButtons(buttonLetters, new Set(result.guessedLetters), result.word, userId, sessionId, styleIndex));

            return interaction.update({
                components: [loseContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const gameContainer = buildGameContainer(
            userId,
            sessionId,
            session,
            currentWord,
            buttonLetters,
            styleIndex,
            t,
            new Set(result.guessedLetters)
        );

        return interaction.update({
            components: [gameContainer],
            flags: MessageFlags.IsComponentsV2
        });
    },
    help: {
        name: "hangman",
        description: "Play the daily Hangman word game",
        category: "Games",
        permissions: [],
        botPermissions: [],
        created: 1767970682
    }
};

function buildGameContainer(userId, sessionId, session, currentWord, buttonLetters, styleIndex, t, guessedLetters = null) {
    const guessed = guessedLetters || session.guessedLetters;
    const wrongGuesses = session.wrongGuesses;
    const wordDisplay = hangmanState.getWordDisplay(guessed);
    const hangmanArt = HANGMAN_STYLES[styleIndex][Math.min(wrongGuesses, 6)];
    const wordInfo = hangmanState.getWordInfo();

    const container = new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:hangman.title')}`),
            new TextDisplayBuilder().setContent(hangmanArt.join('\n')),
            new TextDisplayBuilder().setContent(`\n**${wordDisplay}**`)
        );

    if (currentWord.description) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${t('commands:hangman.hint')}: ${currentWord.description}`)
        );
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${t('commands:hangman.wrong_guesses', { count: wrongGuesses, max: 6 })} • ${t('commands:hangman.expires', { time: `<t:${Math.floor(wordInfo.expiresAt / 1000)}:R>` })}${getFirstWinnerText(currentWord, t)}`)
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const buttonRows = buildLetterButtons(buttonLetters, guessed, currentWord.word, userId, sessionId, styleIndex);
    container.addActionRowComponents(...buttonRows);

    return container;
}

function buildLetterButtons(letters, guessedLetters, word, userId, sessionId, styleIndex) {
    const rows = [];

    for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();

        for (let j = 0; j < 5; j++) {
            const idx = i * 5 + j;
            if (idx >= letters.length) break;

            const letter = letters[idx];
            const isGuessed = guessedLetters.has(letter);
            const isCorrect = word.includes(letter);

            let style = ButtonStyle.Secondary;
            if (isGuessed) {
                style = isCorrect ? ButtonStyle.Success : ButtonStyle.Danger;
            }

            const btn = new ButtonBuilder()
                .setCustomId(`hm_${userId}_${sessionId}_${letter}_${styleIndex}`)
                .setLabel(letter)
                .setStyle(style)
                .setDisabled(isGuessed);

            row.addComponents(btn);
        }

        rows.push(row);
    }

    return rows;
}

function buildDisabledButtons(letters, guessedLetters, word, userId, sessionId, styleIndex) {
    const rows = [];

    for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();

        for (let j = 0; j < 5; j++) {
            const idx = i * 5 + j;
            if (idx >= letters.length) break;

            const letter = letters[idx];
            const isGuessed = guessedLetters.has(letter);
            const isCorrect = word.includes(letter);

            let style = ButtonStyle.Secondary;
            if (isGuessed) {
                style = isCorrect ? ButtonStyle.Success : ButtonStyle.Danger;
            } else if (isCorrect) {
                style = ButtonStyle.Success;
            }

            const btn = new ButtonBuilder()
                .setCustomId(`hm_${userId}_${sessionId}_${letter}_${styleIndex}`)
                .setLabel(letter)
                .setStyle(style)
                .setDisabled(true);

            row.addComponents(btn);
        }

        rows.push(row);
    }

    return rows;
}

function getFirstWinnerText(word, t) {
    if (word?.firstWinner?.username) {
        return `\n-# ${t('commands:hangman.first_winner', { user: word.firstWinner.username })}`;
    }
    return '';
}

// contributors: @relentiousdragon