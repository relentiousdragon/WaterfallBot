const Analytics = require("../schemas/analytics.js");

const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const HUMAN = 1;
const AI = 2;

let globalWaterfallWins = 0;
let globalHumanWins = 0;
let pendingWaterfallWins = 0;
let pendingHumanWins = 0;
const BATCH_SIZE = 5;

(async () => {
    try {
        const stats = await Analytics.findOne({ timestamp: new Date(0) });
        globalWaterfallWins = stats?.connect4WaterfallWins || 0;
        globalHumanWins = stats?.connect4HumanWins || 0;
    } catch (err) {
        console.error("[C4 AI] Error loading global stats:", err);
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
                    connect4WaterfallWins: w,
                    connect4HumanWins: h
                }
            },
            { upsert: true, new: true }
        );
        if (updated) {
            globalWaterfallWins = updated.connect4WaterfallWins;
            globalHumanWins = updated.connect4HumanWins;
        }
    } catch (err) {
        pendingWaterfallWins += w;
        pendingHumanWins += h;
        console.error("[C4 AI] Error syncing with MongoDB:", err);
    }
}

function recordGameResult(winner) {
    if (winner === AI) {
        pendingWaterfallWins++;
    } else if (winner === HUMAN) {
        pendingHumanWins++;
    }

    if (pendingWaterfallWins + pendingHumanWins >= BATCH_SIZE) {
        syncWithDB();
    }
}

function getGlobalStats() {
    return {
        waterfallWins: globalWaterfallWins + pendingWaterfallWins,
        humanWins: globalHumanWins + pendingHumanWins
    };
}

function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

function copyBoard(board) {
    return board.map(row => [...row]);
}

function isValidMove(board, col) {
    return board[0][col] === EMPTY;
}

function getValidMoves(board) {
    const validMoves = [];
    for (let col = 0; col < COLS; col++) {
        if (isValidMove(board, col)) {
            validMoves.push(col);
        }
    }
    return validMoves;
}

function dropPiece(board, col, piece) {
    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === EMPTY) {
            board[r][col] = piece;
            return r;
        }
    }
    return -1;
}

function checkWin(board, piece) {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            if (board[r][c] === piece && board[r][c + 1] === piece && board[r][c + 2] === piece && board[r][c + 3] === piece) return true;
        }
    }
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c] === piece && board[r + 1][c] === piece && board[r + 2][c] === piece && board[r + 3][c] === piece) return true;
        }
    }
    for (let r = 3; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            if (board[r][c] === piece && board[r - 1][c + 1] === piece && board[r - 2][c + 2] === piece && board[r - 3][c + 3] === piece) return true;
        }
    }
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            if (board[r][c] === piece && board[r + 1][c + 1] === piece && board[r + 2][c + 2] === piece && board[r + 3][c + 3] === piece) return true;
        }
    }
    return false;
}

function getWinningCoords(board, piece) {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            if (board[r][c] === piece && board[r][c + 1] === piece && board[r][c + 2] === piece && board[r][c + 3] === piece) {
                return [{ r, c }, { r, c: c + 1 }, { r, c: c + 2 }, { r, c: c + 3 }];
            }
        }
    }
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c] === piece && board[r + 1][c] === piece && board[r + 2][c] === piece && board[r + 3][c] === piece) {
                return [{ r, c }, { r: r + 1, c }, { r: r + 2, c }, { r: r + 3, c }];
            }
        }
    }
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            if (board[r][c] === piece && board[r + 1][c + 1] === piece && board[r + 2][c + 2] === piece && board[r + 3][c + 3] === piece) {
                return [{ r, c }, { r: r + 1, c: c + 1 }, { r: r + 2, c: c + 2 }, { r: r + 3, c: c + 3 }];
            }
        }
    }
    for (let r = 3; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            if (board[r][c] === piece && board[r - 1][c + 1] === piece && board[r - 2][c + 2] === piece && board[r - 3][c + 3] === piece) {
                return [{ r, c }, { r: r - 1, c: c + 1 }, { r: r - 2, c: c + 2 }, { r: r - 3, c: c + 3 }];
            }
        }
    }
    return [];
}

function evaluateWindow(window, piece) {
    let score = 0;
    const oppPiece = piece === AI ? HUMAN : AI;

    let pieceCount = window.filter(p => p === piece).length;
    let emptyCount = window.filter(p => p === EMPTY).length;
    let oppCount = window.filter(p => p === oppPiece).length;

    if (pieceCount === 4) {
        score += 10000;
    } else if (pieceCount === 3 && emptyCount === 1) {
        score += 5;
    } else if (pieceCount === 2 && emptyCount === 2) {
        score += 2;
    }

    if (oppCount === 3 && emptyCount === 1) {
        score -= 4;
    }

    return score;
}

function scorePosition(board, piece) {
    let score = 0;

    const centerArray = [];
    for (let r = 0; r < ROWS; r++) {
        centerArray.push(board[r][Math.floor(COLS / 2)]);
    }
    const centerCount = centerArray.filter(p => p === piece).length;
    score += centerCount * 3;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            const window = board[r].slice(c, c + 4);
            score += evaluateWindow(window, piece);
        }
    }
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS - 3; r++) {
            const window = [board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]];
            score += evaluateWindow(window, piece);
        }
    }
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            const window = [board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]];
            score += evaluateWindow(window, piece);
        }
    }
    for (let r = 0; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS - 3; c++) {
            const window = [board[r + 3][c], board[r + 2][c + 1], board[r + 1][c + 2], board[r][c + 3]];
            score += evaluateWindow(window, piece);
        }
    }

    return score;
}

function isTerminalNode(board) {
    return checkWin(board, AI) || checkWin(board, HUMAN) || getValidMoves(board).length === 0;
}

function minimax(board, depth, alpha, beta, maximizingPlayer) {
    const validMoves = getValidMoves(board);
    const isTerminal = isTerminalNode(board);

    if (depth === 0 || isTerminal) {
        if (isTerminal) {
            if (checkWin(board, AI)) {
                return [null, 10000000];
            } else if (checkWin(board, HUMAN)) {
                return [null, -10000000];
            } else {
                return [null, 0];
            }
        } else {
            return [null, scorePosition(board, AI)];
        }
    }

    if (maximizingPlayer) {
        let value = -Infinity;
        let column = validMoves[Math.floor(Math.random() * validMoves.length)];
        for (const col of validMoves) {
            const tempBoard = copyBoard(board);
            dropPiece(tempBoard, col, AI);
            const newScore = minimax(tempBoard, depth - 1, alpha, beta, false)[1];
            if (newScore > value) {
                value = newScore;
                column = col;
            }
            alpha = Math.max(alpha, value);
            if (alpha >= beta) break;
        }
        return [column, value];
    } else {
        let value = Infinity;
        let column = validMoves[Math.floor(Math.random() * validMoves.length)];
        for (const col of validMoves) {
            const tempBoard = copyBoard(board);
            dropPiece(tempBoard, col, HUMAN);
            const newScore = minimax(tempBoard, depth - 1, alpha, beta, true)[1];
            if (newScore < value) {
                value = newScore;
                column = col;
            }
            beta = Math.min(beta, value);
            if (alpha >= beta) break;
        }
        return [column, value];
    }
}

function getAIMove(board) {
    if (board.every(row => row.every(cell => cell === EMPTY))) {
        return 3;
    }
    const [col, minimaxScore] = minimax(board, 5, -Infinity, Infinity, true);
    return col;
}
//
module.exports = {
    getAIMove,
    checkWin,
    getWinningCoords,
    dropPiece,
    recordGameResult,
    getGlobalStats,
    EMPTY,
    HUMAN,
    AI,
    ROWS,
    COLS,
    isValidMove,
    createBoard,
    getValidMoves
};
