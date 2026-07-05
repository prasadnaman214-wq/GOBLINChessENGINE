import { Chess } from "chess.js";
import type { Move } from "chess.js";

// Material values (centipawns)
const MATERIAL: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-Square Tables (encourage central control & normal development)
// Values from white's perspective; mirrored for black.
const PAWN_PST = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
];

const KNIGHT_PST = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
];

const BISHOP_PST = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
];

const ROOK_PST = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
];

const QUEEN_PST = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
];

const KING_PST = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
];

const PST: Record<string, number[]> = {
  p: PAWN_PST,
  n: KNIGHT_PST,
  b: BISHOP_PST,
  r: ROOK_PST,
  q: QUEEN_PST,
  k: KING_PST,
};

export function evaluateDetailed(chess: Chess): [number, number] {
  let materialScore = 0;
  let positionalScore = 0;

  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece) {
        const mat = MATERIAL[piece.type];
        const sqIdx = (7 - r) * 8 + c;
        const pstVal = piece.color === "w" 
          ? PST[piece.type][sqIdx] 
          : PST[piece.type][sqIdx ^ 56];
        const sign = piece.color === "w" ? 1 : -1;
        materialScore += sign * mat;
        positionalScore += sign * pstVal;
      }
    }
  }

  return [materialScore, positionalScore];
}

export function evaluate(chess: Chess): number {
  const [matScore, pstScore] = evaluateDetailed(chess);
  return matScore + pstScore;
}

function orderMoves(moves: Move[]): Move[] {
  const scored: [number, Move][] = [];

  for (const m of moves) {
    let priority = 0;

    if (m.captured) {
      const capturedVal = MATERIAL[m.captured] || 0;
      const attackerVal = MATERIAL[m.piece] || 0;
      priority += 1000 + capturedVal - attackerVal;
    }

    if (m.promotion) {
      priority += 900;
    }

    scored.push([priority, m]);
  }

  scored.sort((a, b) => b[0] - a[0]);
  return scored.map((x) => x[1]);
}

function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  deadline: number
): number {
  if (Date.now() > deadline) {
    return evaluate(chess);
  }

  if (chess.isGameOver()) {
    if (chess.isCheckmate()) {
      return chess.turn() === "w" ? -20000 - depth : 20000 + depth;
    }
    return 0;
  }

  if (depth === 0) {
    return evaluate(chess);
  }

  let legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) {
    // FIX Incidental: chess.inCheck() is a deprecated alias that resolves to
    // chess.isCheck() in chess.js v1.x (same backing field). Drop the OR branch.
    if (chess.isCheck()) {
      return chess.turn() === "w" ? -20000 - depth : 20000 + depth;
    }
    return 0;
  }

  legalMoves = orderMoves(legalMoves);

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of legalMoves) {
      chess.move(move);
      const evalVal = minimax(chess, depth - 1, alpha, beta, false, deadline);
      chess.undo();
      maxEval = Math.max(maxEval, evalVal);
      alpha = Math.max(alpha, evalVal);
      if (beta <= alpha) {
        break;
      }
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of legalMoves) {
      chess.move(move);
      const evalVal = minimax(chess, depth - 1, alpha, beta, true, deadline);
      chess.undo();
      minEval = Math.min(minEval, evalVal);
      beta = Math.min(beta, evalVal);
      if (beta <= alpha) {
        break;
      }
    }
    return minEval;
  }
}

export function getBestMove(chess: Chess, timeoutMs: number = 1500): Move | null {
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) {
    return null;
  }
  if (legalMoves.length === 1) {
    return legalMoves[0];
  }

  const depth = legalMoves.length >= 10 ? 2 : 3;
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;
  let bestMove: Move | null = null;

  const turn = chess.turn();
  const maximizing = turn === "w";

  let bestScore = maximizing ? -Infinity : Infinity;
  let alpha = -Infinity;
  let beta = Infinity;

  const orderedMoves = orderMoves(legalMoves);

  for (const move of orderedMoves) {
    if (Date.now() > deadline) {
      break;
    }

    chess.move(move);
    const cleanScore = minimax(chess, depth - 1, alpha, beta, !maximizing, deadline);
    chess.undo();

    const noise = Math.random() * 30 - 15;
    const scoreWithNoise = cleanScore + noise;

    if (maximizing) {
      if (scoreWithNoise > bestScore) {
        bestScore = scoreWithNoise;
        bestMove = move;
      }
      alpha = Math.max(alpha, cleanScore);
    } else {
      if (scoreWithNoise < bestScore) {
        bestScore = scoreWithNoise;
        bestMove = move;
      }
      beta = Math.min(beta, cleanScore);
    }
  }

  if (!bestMove) {
    bestMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  return bestMove;
}
