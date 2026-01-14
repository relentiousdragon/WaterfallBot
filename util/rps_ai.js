const Analytics = require("../schemas/analytics.js");
const MOVES = ['r', 'p', 's'];
const WINS = { r: 's', p: 'r', s: 'p' };

let globalWaterfallWins = 0;
let globalHumanWins = 0;
let pendingWaterfallWins = 0;
let pendingHumanWins = 0;
const BATCH_SIZE = 5;

(async () => {
    try {
        const stats = await Analytics.findOne({ timestamp: new Date(0) });
        globalWaterfallWins = stats.rpsWaterfallWins || 0;
        globalHumanWins = stats.rpsHumanWins || 0;
    } catch (err) {
        console.error("[RPS AI] Error loading global stats:", err);
    }
})();

async function syncWithDB() {
    if (pendingWaterfallWins === 0 && pendingHumanWins === 0) return;

    const w = pendingWaterfallWins;
    const h = pendingHumanWins;
    pendingWaterfallWins = 0;
    pendingHumanWins = 0;

    try {
        const updated = await Analytics.findOneAndUpdate(
            { timestamp: new Date(0) },
            {
                $inc: {
                    rpsWaterfallWins: w,
                    rpsHumanWins: h
                }
            },
            { upsert: true, new: true }
        );
        if (updated) {
            globalWaterfallWins = updated.rpsWaterfallWins;
            globalHumanWins = updated.rpsHumanWins;
        }
    } catch (err) {
        pendingWaterfallWins += w;
        pendingHumanWins += h;
        console.error("[RPS AI] Error syncing with MongoDB:", err);
    }
}

function getRandomMove() {
    return MOVES[Math.floor(Math.random() * MOVES.length)];
}

function getWinningMove(opponentMove) {
    for (const [winner, loser] of Object.entries(WINS)) {
        if (loser === opponentMove) return winner;
    }
    return getRandomMove();
}

const Predictors = {
    Random: () => getRandomMove(),
    Frequency: (history) => {
        if (history.length === 0) return getRandomMove();
        const counts = { r: 0, p: 0, s: 0 };
        for (const move of history) counts[move]++;
        return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    },
    MarkovO1: (history) => {
        if (history.length < 2) return getRandomMove();
        const lastMove = history[history.length - 1];
        const counts = { r: 0, p: 0, s: 0 };
        for (let i = 0; i < history.length - 1; i++) {
            if (history[i] === lastMove) {
                const next = history[i + 1];
                counts[next]++;
            }
        }
        if (Object.values(counts).reduce((a, b) => a + b) === 0) return getRandomMove();
        return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    },
    MarkovO2: (history) => {
        if (history.length < 3) return getRandomMove();
        const lastTwo = history.slice(-2).join('');
        const counts = { r: 0, p: 0, s: 0 };
        for (let i = 0; i < history.length - 2; i++) {
            if (history[i] + history[i + 1] === lastTwo) {
                const next = history[i + 2];
                counts[next]++;
            }
        }
        if (Object.values(counts).reduce((a, b) => a + b) === 0) return getRandomMove();
        return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    },
    BeatLastAI: (history, myHistory) => {
        if (myHistory.length === 0) return getRandomMove();
        const lastAIMove = myHistory[myHistory.length - 1];
        return getWinningMove(lastAIMove);
    },
    WinStay: (history, myHistory, myWins) => {
        if (history.length === 0) return getRandomMove();
        const lastMove = history[history.length - 1];
        const lastWin = !myWins[myWins.length - 1];
        if (lastWin) return lastMove;
        return getRandomMove();
    }
};

const PATTERN_EXPIRY = 30 * 60 * 1000;
const activeEnsembles = new Map();
//
class Ensemble {
    constructor(userId) {
        this.userId = userId;
        this.history = [];
        this.myHistory = [];
        this.myWins = [];
        this.scores = {};
        this.lastUpdate = Date.now();
        for (const key of Object.keys(Predictors)) {
            this.scores[key] = 0;
        }
    }
    touch() {
        this.lastUpdate = Date.now();
    }
    getMultiStrategyMove() {
        const predictions = {};
        for (const [name, fn] of Object.entries(Predictors)) {
            predictions[name] = fn(this.history, this.myHistory, this.myWins);
        }
        let bestPredictor = 'Random';
        let maxScore = -Infinity;
        for (const [name, score] of Object.entries(this.scores)) {
            if (score > maxScore) {
                maxScore = score;
                bestPredictor = name;
            }
        }
        if (this.history.length < 3) {
            return getWinningMove(Predictors.MarkovO1(this.history));
        }
        const predictedPlayerMove = predictions[bestPredictor];
        this.pendingPredictions = predictions;
        return getWinningMove(predictedPlayerMove);
    }
    scoreLastRound(realPlayerMove) {
        if (!this.pendingPredictions) return;
        for (const [name, predictedMove] of Object.entries(this.pendingPredictions)) {
            if (predictedMove === realPlayerMove) {
                this.scores[name]++;
            } else {
                this.scores[name] *= 0.95;
            }
        }
        this.pendingPredictions = null;
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [id, session] of activeEnsembles) {
        if (now - session.lastUpdate > PATTERN_EXPIRY) {
            activeEnsembles.delete(id);
        }
    }
}, 60000);

function getAIMove(userId) {
    if (!activeEnsembles.has(userId)) {
        activeEnsembles.set(userId, new Ensemble(userId));
    }
    const session = activeEnsembles.get(userId);
    return session.getMultiStrategyMove();
}

function recordResult(userId, playerMove, aiMove) {
    if (!activeEnsembles.has(userId)) return;
    const session = activeEnsembles.get(userId);

    session.scoreLastRound(playerMove);
    session.history.push(playerMove);
    session.myHistory.push(aiMove);

    let aiWon = false;
    if (WINS[aiMove] === playerMove) {
        aiWon = true;
        pendingWaterfallWins++;
    } else if (WINS[playerMove] === aiMove) {
        pendingHumanWins++;
    }

    if (pendingWaterfallWins + pendingHumanWins >= BATCH_SIZE) {
        syncWithDB();
    }

    session.myWins.push(aiWon);
    session.touch();
}

function getGlobalStats() {
    return {
        waterfallWins: globalWaterfallWins + pendingWaterfallWins,
        humanWins: globalHumanWins + pendingHumanWins
    };
}
//
module.exports = {
    getAIMove,
    recordResult,
    getGlobalStats,
    MOVES,
    WINS
};


// contributors: @relentiousdragon