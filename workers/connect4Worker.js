const { parentPort, workerData } = require('worker_threads');
const Canvas = require('canvas');
const GIFEncoder = require('gifencoder');

const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const HUMAN = 1;
const AI = 2;
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

function undoPiece(board, col, row) {
    board[row][col] = EMPTY;
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
            const row = dropPiece(board, col, AI);
            const newScore = minimax(board, depth - 1, alpha, beta, false)[1];
            undoPiece(board, col, row);
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
            const row = dropPiece(board, col, HUMAN);
            const newScore = minimax(board, depth - 1, alpha, beta, true)[1];
            undoPiece(board, col, row);
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

function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

async function renderBoard(board, colors, lastMove = null, gameId = null) {
    if (lastMove) {
        return renderAnimatedBoard(board, colors, lastMove, gameId);
    }

    const canvas = Canvas.createCanvas(BOARD_WIDTH, BOARD_HEIGHT);
    const ctx = canvas.getContext('2d');
    drawFullBoard(ctx, board, colors, [], gameId);
    return canvas.toBuffer();
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
        const prevBoard = createBoard();
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

        const isWinMove = checkWin(board, lastMove.player);
        if (isWinMove) {
            const winningCoords = getWinningCoords(board, lastMove.player);
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

(async () => {
    try {
        const { type, ...options } = workerData;
        let result;

        switch (type) {
            case 'ai':
                result = getAIMove(options.board);
                break;
            case 'render':
                result = await renderBoard(options.board, options.colors, options.lastMove || null, options.gameId || null);
                break;
            default:
                throw new Error(`Unknown task type: ${type}`);
        }

        parentPort.postMessage({ data: result });
    } catch (error) {
        parentPort.postMessage({ error: error.message });
    }
})();

// contributors: @relentiousdragon
