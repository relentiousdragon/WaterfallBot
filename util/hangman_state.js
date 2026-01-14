const { WebhookClient, EmbedBuilder } = require('discord.js');
const logger = require('../logger.js');
const { settings } = require('./settingsModule.js');
const Hangman = require('../schemas/hangman.js');
const crypto = require('crypto');

let currentWord = null;
let pendingWord = null;
const playerSessions = new Map();
const failedPlayers = new Set();

let expirationInterval = null;
let initialized = false;

async function init(bot) {
    if (initialized) return;
    initialized = true;

    try {
        const doc = await Hangman.findById('current');
        if (doc) {
            if (Date.now() > doc.expiresAt) {
                if (doc.pendingWord?.word) {
                    currentWord = {
                        word: doc.pendingWord.word,
                        description: doc.pendingWord.description,
                        setByUserId: doc.pendingWord.setByUserId,
                        setByUsername: doc.pendingWord.setByUsername,
                        setAt: Date.now(),
                        expiresAt: Date.now() + (24 * 60 * 60 * 1000),
                        solved: 0,
                        attempts: 0,
                        winners: [],
                        firstWinner: null
                    };
                    await saveToDb();
                }
            } else {
                currentWord = {
                    word: doc.word,
                    description: doc.description,
                    setByUserId: doc.setByUserId,
                    setByUsername: doc.setByUsername,
                    setAt: doc.setAt,
                    expiresAt: doc.expiresAt,
                    solved: doc.solved,
                    attempts: doc.attempts,
                    winners: doc.winners || [],
                    firstWinner: doc.firstWinner?.userId ? doc.firstWinner : null
                };

                doc.failedPlayers?.forEach(id => failedPlayers.add(id));

                if (doc.pendingWord?.word) {
                    pendingWord = {
                        word: doc.pendingWord.word,
                        description: doc.pendingWord.description,
                        setByUserId: doc.pendingWord.setByUserId,
                        setByUsername: doc.pendingWord.setByUsername
                    };
                }
            }
            logger.info('[Hangman] Loaded state from database');
        }
    } catch (error) {
        logger.error('[Hangman] Failed to load state from database:', error);
    }

    startExpirationCheck(bot);
}

async function saveToDb() {
    try {
        if (!currentWord && !pendingWord) {
            await Hangman.findByIdAndDelete('current');
            return;
        }

        const data = {
            _id: 'current',
            word: currentWord?.word || '',
            description: currentWord?.description || null,
            setByUserId: currentWord?.setByUserId || '',
            setByUsername: currentWord?.setByUsername || '',
            setAt: currentWord?.setAt || 0,
            expiresAt: currentWord?.expiresAt || 0,
            solved: currentWord?.solved || 0,
            attempts: currentWord?.attempts || 0,
            winners: currentWord?.winners || [],
            firstWinner: currentWord?.firstWinner || { userId: null, username: null, solveTime: null },
            failedPlayers: currentWord ? [...failedPlayers] : [],
            pendingWord: pendingWord ? {
                word: pendingWord.word,
                description: pendingWord.description,
                setByUserId: pendingWord.setByUserId,
                setByUsername: pendingWord.setByUsername
            } : { word: null, description: null, setByUserId: null, setByUsername: null }
        };

        await Hangman.findByIdAndUpdate('current', data, { upsert: true });
    } catch (error) {
        logger.error('[Hangman] Failed to save state to database:', error);
    }
}

async function setWord(options, bot) {
    const { word, description, setByUserId, setByUsername, scheduled } = options;

    const normalizedWord = word.toUpperCase().replace(/[^A-Z]/g, '');

    if (normalizedWord.length < 3 || normalizedWord.length > 20) {
        throw new Error('Word must be between 3 and 20 letters.');
    }

    const newWordData = {
        word: normalizedWord,
        description: description || null,
        setByUserId,
        setByUsername,
        setAt: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000),
        solved: 0,
        attempts: 0,
        winners: [],
        firstWinner: null
    };

    if (scheduled) {
        pendingWord = newWordData;
        await saveToDb();
        return { scheduled: true, word: normalizedWord };
    }

    if (currentWord) {
        await sendWordSummary(bot, 'replaced');
    }

    playerSessions.clear();
    failedPlayers.clear();

    currentWord = newWordData;
    await saveToDb();
    startExpirationCheck(bot);

    return { scheduled: false, word: normalizedWord };
}

function getCurrentWord() {
    if (!currentWord) return null;
    if (Date.now() > currentWord.expiresAt) return null;
    return currentWord;
}

function isWordActive() {
    return getCurrentWord() !== null;
}

function canUserPlay(userId) {
    if (!isWordActive()) return false;
    if (failedPlayers.has(userId)) return false;
    if (currentWord?.winners && currentWord.winners.includes(userId)) return false;
    return true;
}

function getSession(userId) {
    if (!playerSessions.has(userId)) {
        if (!isWordActive()) return null;

        playerSessions.set(userId, {
            guessedLetters: new Set(),
            wrongGuesses: 0,
            startedAt: Date.now(),
            wordSetAt: currentWord.setAt
        });
        currentWord.attempts++;
        saveToDb();
    }

    const session = playerSessions.get(userId);

    if (session.wordSetAt !== currentWord?.setAt) {
        playerSessions.delete(userId);
        return null;
    }

    return session;
}

function processGuess(userId, letter) {
    if (!isWordActive()) return { error: 'word_expired' };

    if (failedPlayers.has(userId)) {
        return { error: 'already_failed' };
    }

    if (currentWord?.winners?.includes(userId)) {
        return { error: 'already_won' };
    }

    const session = getSession(userId);
    if (!session) return { error: 'no_session' };

    const upperLetter = letter.toUpperCase();

    if (session.guessedLetters.has(upperLetter)) {
        return { error: 'already_guessed' };
    }

    session.guessedLetters.add(upperLetter);

    const isCorrect = currentWord.word.includes(upperLetter);

    if (!isCorrect) {
        session.wrongGuesses++;
    }

    const wordLetters = new Set(currentWord.word.split(''));
    const allLettersGuessed = [...wordLetters].every(l => session.guessedLetters.has(l));

    const maxWrong = 6;
    const isLoss = session.wrongGuesses >= maxWrong;

    return {
        correct: isCorrect,
        letter: upperLetter,
        wrongGuesses: session.wrongGuesses,
        guessedLetters: [...session.guessedLetters],
        isWin: allLettersGuessed,
        isLoss,
        word: currentWord.word,
        description: currentWord.description
    };
}

async function recordWin(userId, username, bot) {
    if (!currentWord) return;

    const session = playerSessions.get(userId);
    if (!session) return;

    currentWord.solved++;
    currentWord.winners.push(userId);

    const solveTime = Date.now() - session.startedAt;

    if (!currentWord.firstWinner) {
        currentWord.firstWinner = { userId, username, solveTime };
        await logWinner(bot, userId, username, solveTime);
    }

    playerSessions.delete(userId);
    await saveToDb();
}

async function recordFail(userId) {
    failedPlayers.add(userId);
    playerSessions.delete(userId);
    await saveToDb();
}

async function logWinner(bot, userId, username, solveTime) {
    try {
        const webhook = new WebhookClient({
            id: settings.logWebhook[0],
            token: settings.logWebhook[1]
        });

        const minutes = Math.floor(solveTime / 60000);
        const seconds = Math.floor((solveTime % 60000) / 1000);
        const timeString = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('First Hangman Winner!')
            .addFields(
                { name: 'User', value: `${username} (${userId})`, inline: true },
                { name: 'Word', value: `\`${currentWord.word}\``, inline: true },
                { name: 'Time to Solve', value: timeString, inline: true }
            )
            .setFooter({ text: 'Waterfall', iconURL: bot.user.displayAvatarURL() })
            .setTimestamp();

        if (currentWord.description) {
            embed.addFields({ name: 'Description', value: currentWord.description });
        }

        await webhook.send({ embeds: [embed] });
    } catch (error) {
        logger.error('[Hangman] Failed to log winner:', error);
    }
}

async function sendWordSummary(bot, reason = 'expired') {
    if (!currentWord) return;

    try {
        const webhook = new WebhookClient({
            id: settings.logWebhook[0],
            token: settings.logWebhook[1]
        });

        const winRate = currentWord.attempts > 0
            ? ((currentWord.solved / currentWord.attempts) * 100).toFixed(1)
            : '0.0';

        const duration = Date.now() - currentWord.setAt;
        const hours = Math.floor(duration / (60 * 60 * 1000));
        const minutes = Math.floor((duration % (60 * 60 * 1000)) / 60000);

        const embed = new EmbedBuilder()
            .setColor(reason === 'expired' ? 0xFEE75C : 0x5865F2)
            .setTitle(`Hangman Word ${reason === 'expired' ? 'Expired' : 'Replaced'}`)
            .addFields(
                { name: 'Word', value: `\`${currentWord.word}\``, inline: true },
                { name: 'Set By', value: `${currentWord.setByUsername} (${currentWord.setByUserId})`, inline: true },
                { name: 'Duration', value: `${hours}h ${minutes}m`, inline: true },
                { name: 'Stats', value: `Solved: ${currentWord.solved} / Attempts: ${currentWord.attempts} (${winRate}% win rate)` }
            )
            .setFooter({ text: 'Waterfall Hangman', iconURL: bot.user.displayAvatarURL() })
            .setTimestamp();

        if (currentWord.description) {
            embed.addFields({ name: 'Description', value: currentWord.description });
        }

        if (currentWord.firstWinner) {
            const solveTime = currentWord.firstWinner.solveTime;
            const mins = Math.floor(solveTime / 60000);
            const secs = Math.floor((solveTime % 60000) / 1000);
            embed.addFields({
                name: 'First Winner',
                value: `${currentWord.firstWinner.username} (${mins > 0 ? `${mins}m ` : ''}${secs}s)`
            });
        }

        await webhook.send({ embeds: [embed] });
    } catch (error) {
        logger.error('[Hangman] Failed to send word summary:', error);
    }
}

function startExpirationCheck(bot) {
    if (expirationInterval) {
        clearInterval(expirationInterval);
    }

    expirationInterval = setInterval(async () => {
        if (currentWord && Date.now() > currentWord.expiresAt) {
            await sendWordSummary(bot, 'expired');

            if (pendingWord) {
                currentWord = {
                    ...pendingWord,
                    setAt: Date.now(),
                    expiresAt: Date.now() + (24 * 60 * 60 * 1000),
                    solved: 0,
                    attempts: 0,
                    winners: [],
                    firstWinner: null
                };
                pendingWord = null;
            } else {
                currentWord = null;
            }

            playerSessions.clear();
            failedPlayers.clear();
            await saveToDb();
        }
    }, 60000);
}

function getWordDisplay(guessedLetters) {
    if (!currentWord) return '';

    return currentWord.word
        .split('')
        .map(letter => guessedLetters.has(letter) ? letter : '\\_')
        .join(' ');
}

function generateLetterButtons(wordLetters) {
    const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const wordSet = new Set(wordLetters);
    const buttonLetters = [...wordSet];

    const remaining = allLetters.filter(l => !wordSet.has(l));
    while (buttonLetters.length < 25 && remaining.length > 0) {
        const idx = Math.floor(Math.random() * remaining.length);
        buttonLetters.push(remaining.splice(idx, 1)[0]);
    }

    for (let i = buttonLetters.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [buttonLetters[i], buttonLetters[j]] = [buttonLetters[j], buttonLetters[i]];
    }

    return buttonLetters;
}

function getWordInfo() {
    if (!currentWord) return null;

    return {
        word: currentWord.word,
        description: currentWord.description,
        setByUserId: currentWord.setByUserId,
        setByUsername: currentWord.setByUsername,
        setAt: currentWord.setAt,
        expiresAt: currentWord.expiresAt,
        solved: currentWord.solved,
        attempts: currentWord.attempts,
        hasPending: !!pendingWord
    };
}

function getPendingWordInfo() {
    if (!pendingWord) return null;
    return {
        word: pendingWord.word,
        description: pendingWord.description
    };
}
//
module.exports = {
    init,
    setWord,
    getCurrentWord,
    isWordActive,
    canUserPlay,
    getSession,
    processGuess,
    recordWin,
    recordFail,
    getWordDisplay,
    generateLetterButtons,
    getWordInfo,
    getPendingWordInfo
};


// contributors: @relentiousdragon