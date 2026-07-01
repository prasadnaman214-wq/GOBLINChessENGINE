/**
 * Chess AI Engine
 * Implements Minimax with Alpha-Beta Pruning, Move Ordering, and Piece-Square Tables.
 */

// Piece values in centipawns
const PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000
};

// Piece-Square Tables (PSTs) from White's perspective.
// Index 0,0 corresponds to rank 8 (a8-h8) and 7,7 corresponds to rank 1 (a1-h1).
// For Black pieces, the rank is inverted.
const PAWN_PST = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5,   5, 10, 27, 27, 10,  5,  5],
    [0,   0,  0, 25, 25,  0,  0,  0],
    [5,  -5,-10,  0,  0,-10, -5,  5],
    [5,  10, 10,-25,-25, 10, 10,  5],
    [0,   0,  0,  0,  0,  0,  0,  0]
];

const KNIGHT_PST = [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
];

const BISHOP_PST = [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
];

const ROOK_PST = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [0,  0,  0,  5,  5,  0,  0,  0]
];

const QUEEN_PST = [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [-5,  0,  5,  5,  5,  5,  0, -5],
    [0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  5,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
];

// Middlegame King safety table
const KING_MIDDLE_PST = [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [20, 20,  0,  0,  0,  0, 20, 20],
    [20, 30, 10,  0,  0, 10, 30, 20]
];

// Endgame King active table
const KING_END_PST = [
    [-50,-40,-30,-20,-20,-30,-40,-50],
    [-30,-20,-10,  0,  0,-10,-20,-30],
    [-30,-10, 20, 30, 30, 20,-10,-30],
    [-30,-10, 30, 40, 40, 30,-10,-30],
    [-30,-10, 30, 40, 40, 30,-10,-30],
    [-30,-10, 20, 30, 30, 20,-10,-30],
    [-30,-30,  0,  0,  0,  0,-30,-30],
    [-50,-30,-30,-30,-30,-30,-30,-50]
];

/**
 * Checks if it's the endgame (fewer major pieces).
 */
function isEndgame(chess) {
    let majorPiecesCount = 0;
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && piece.type !== 'p' && piece.type !== 'k') {
                majorPiecesCount++;
            }
        }
    }
    // If each side has 3 or fewer major pieces, it's generally considered endgame
    return majorPiecesCount <= 6;
}

/**
 * Returns static evaluation score of the board from White's perspective.
 * Positive = White advantage, Negative = Black advantage.
 */
function evaluateBoard(chess) {
    if (chess.in_checkmate()) {
        // If it's checkmate, evaluate who lost.
        // If it's White's turn, Black won (return negative infinity), and vice versa.
        return chess.turn() === 'w' ? -1e7 : 1e7;
    }
    if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition()) {
        return 0;
    }

    let score = 0;
    const board = chess.board();
    const endgame = isEndgame(chess);

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece) {
                const type = piece.type;
                const color = piece.color;
                
                // Get base material value
                let val = PIECE_VALUES[type];
                
                // Get positional table value
                let pstVal = 0;
                switch (type) {
                    case 'p': pstVal = PAWN_PST[color === 'w' ? r : 7 - r][c]; break;
                    case 'n': pstVal = KNIGHT_PST[color === 'w' ? r : 7 - r][c]; break;
                    case 'b': pstVal = BISHOP_PST[color === 'w' ? r : 7 - r][c]; break;
                    case 'r': pstVal = ROOK_PST[color === 'w' ? r : 7 - r][c]; break;
                    case 'q': pstVal = QUEEN_PST[color === 'w' ? r : 7 - r][c]; break;
                    case 'k': pstVal = (endgame ? KING_END_PST : KING_MIDDLE_PST)[color === 'w' ? r : 7 - r][c]; break;
                }

                const totalVal = val + pstVal;
                if (color === 'w') {
                    score += totalVal;
                } else {
                    score -= totalVal;
                }
            }
        }
    }
    return score;
}

/**
 * Orders moves to improve Alpha-Beta pruning efficiency.
 * Captures and promotions first.
 */
function orderMoves(chess, moves) {
    // Standard heuristic: MVV-LVA (Most Valuable Victim - Least Valuable Aggressor)
    return moves.map(move => {
        let score = 0;
        
        // Is it a capture?
        if (move.captured) {
            score += 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece];
            score += 1000; // base capture bonus
        }
        
        // Promotion?
        if (move.promotion) {
            score += 900;
        }

        // Checks are generally good to explore first
        chess.move(move);
        if (chess.in_check()) {
            score += 50;
        }
        chess.undo();

        // Under attack? Penalize moving a piece into a square where it can be captured cheaply
        // For simple engine, MVV-LVA and promo/checks is already quite effective.

        return { move, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.move);
}

// Global variable to count evaluated positions (for metrics)
let positionsEvaluated = 0;

/**
 * Minimax with Alpha-Beta Pruning.
 * Returns the score of the position.
 */
function minimax(chess, depth, alpha, beta, isMaximizing) {
    positionsEvaluated++;
    
    // Base case
    if (depth === 0 || chess.game_over()) {
        return evaluateBoard(chess);
    }

    let rawMoves = chess.moves({ verbose: true });
    let moves = orderMoves(chess, rawMoves);

    if (isMaximizing) {
        let maxEval = -Infinity;
        for (let i = 0; i < moves.length; i++) {
            chess.move(moves[i]);
            let evaluation = minimax(chess, depth - 1, alpha, beta, false);
            chess.undo();
            maxEval = Math.max(maxEval, evaluation);
            alpha = Math.max(alpha, evaluation);
            if (beta <= alpha) {
                break; // Beta cutoff
            }
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (let i = 0; i < moves.length; i++) {
            chess.move(moves[i]);
            let evaluation = minimax(chess, depth - 1, alpha, beta, true);
            chess.undo();
            minEval = Math.min(minEval, evaluation);
            beta = Math.min(beta, evaluation);
            if (beta <= alpha) {
                break; // Alpha cutoff
            }
        }
        return minEval;
    }
}

/**
 * Public interface to find the best move.
 * @param {Chess} chess - chess.js instance
 * @param {number} level - difficulty level (1 to 4)
 * @param {string} aiColor - 'w' or 'b'
 * @returns {object} { move: Move, evaluation: number, timeSpentMs: number, positionsCount: number }
 */
function findBestMove(chess, level, aiColor) {
    const startTime = performance.now();
    positionsEvaluated = 0;
    
    const isMaximizing = aiColor === 'w';
    let rawMoves = chess.moves({ verbose: true });
    
    if (rawMoves.length === 0) return null;

    // Map difficulty level to search depth and random action probability
    let depth = 3;
    let randomChance = 0.0;
    
    switch (level) {
        case 1: // Beginner
            depth = 1;
            randomChance = 0.25; // 25% chance of playing a random legal move
            break;
        case 2: // Casual
            depth = 2;
            randomChance = 0.05; // 5% chance of random move
            break;
        case 3: // Intermediate
            depth = 3;
            randomChance = 0.0;
            break;
        case 4: // Advanced
            depth = 4;
            randomChance = 0.0;
            break;
        default:
            depth = 3;
    }

    // Check if we inject a random/imperfect move for lower difficulties
    if (Math.random() < randomChance) {
        const randomMove = rawMoves[Math.floor(Math.random() * rawMoves.length)];
        // Evaluate the random move's strength
        chess.move(randomMove);
        const evalScore = evaluateBoard(chess);
        chess.undo();
        const endTime = performance.now();
        return {
            move: randomMove,
            evaluation: evalScore / 100.0, // Convert centipawns to pawn units
            timeSpentMs: endTime - startTime,
            positionsCount: 1
        };
    }

    let orderedMoves = orderMoves(chess, rawMoves);
    let bestMove = null;
    let bestValue = isMaximizing ? -Infinity : Infinity;

    for (let i = 0; i < orderedMoves.length; i++) {
        const move = orderedMoves[i];
        chess.move(move);
        
        let boardValue = minimax(chess, depth - 1, -Infinity, Infinity, !isMaximizing);
        chess.undo();

        if (isMaximizing) {
            if (boardValue > bestValue) {
                bestValue = boardValue;
                bestMove = move;
            }
        } else {
            if (boardValue < bestValue) {
                bestValue = boardValue;
                bestMove = move;
            }
        }
    }

    const endTime = performance.now();
    return {
        move: bestMove,
        evaluation: bestValue / 100.0, // Convert centipawns to standard pawn units
        timeSpentMs: endTime - startTime,
        positionsCount: positionsEvaluated
    };
}

/**
 * Returns static evaluation in standard pawn units.
 */
function getEvaluation(chess) {
    return evaluateBoard(chess) / 100.0;
}

// Export functions for browser use
window.ChessEngine = {
    findBestMove,
    getEvaluation,
    evaluateBoard,
    PIECE_VALUES
};
