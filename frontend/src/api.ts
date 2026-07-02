import { Chess } from "chess.js";
import { getBestMove } from "./ai";
import type { NewGameResponse, MoveResponse, GameState } from "./types";

interface GameStoreItem {
  chess: Chess;
  sanHistory: string[];
  resigned: boolean;
}

// In-memory store for active chess games
const games = new Map<string, GameStoreItem>();

// Helper to simulate network latency for AI thinking
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getGameStatus(chess: Chess): {
  status: string;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  drawReason: string | null;
} {
  const isCheck = chess.isCheck();
  const isCheckmate = chess.isCheckmate();
  const isStalemate = chess.isStalemate();
  let isDraw = chess.isDraw();
  let drawReason: string | null = null;
  let status = "active";

  if (isCheckmate) {
    status = "checkmate";
  } else if (isStalemate) {
    status = "stalemate";
    drawReason = "stalemate";
    isDraw = true;
  } else if (chess.isDrawByFiftyMoves()) {
    status = "draw";
    drawReason = "fifty_moves";
    isDraw = true;
  } else if (chess.isInsufficientMaterial()) {
    status = "draw";
    drawReason = "insufficient_material";
    isDraw = true;
  } else if (chess.isThreefoldRepetition()) {
    status = "draw";
    drawReason = "threefold_repetition";
    isDraw = true;
  } else if (isCheck) {
    status = "check";
  }

  return {
    status,
    isCheck,
    isCheckmate,
    isStalemate,
    isDraw,
    drawReason,
  };
}

export async function newGame(): Promise<NewGameResponse> {
  const gameId = Math.random().toString(36).substring(2, 10);
  const chess = new Chess();
  games.set(gameId, {
    chess,
    sanHistory: [],
    resigned: false,
  });
  return {
    game_id: gameId,
    fen: chess.fen(),
    status: "active",
  };
}

export async function makeMove(
  gameId: string,
  moveStr: string
): Promise<MoveResponse> {
  const game = games.get(gameId);
  if (!game) {
    throw new Error("Game not found. Please start a new game.");
  }

  const chess = game.chess;
  let moveResult;

  try {
    // If it's a UCI string (e.g., "e2e4"), parse from, to, and promotion
    const from = moveStr.slice(0, 2);
    const to = moveStr.slice(2, 4);
    const promotion = moveStr.slice(4, 5) || undefined;
    moveResult = chess.move({ from, to, promotion });
  } catch {
    try {
      // Fallback: try raw string parsing (e.g. SAN)
      moveResult = chess.move(moveStr);
    } catch {
      throw new Error(`Illegal move: ${moveStr}`);
    }
  }

  if (!moveResult) {
    throw new Error(`Illegal move: ${moveStr}`);
  }

  const san = moveResult.san;
  game.sanHistory.push(san);

  const statusInfo = getGameStatus(chess);

  return {
    game_id: gameId,
    fen: chess.fen(),
    uci_move: moveResult.from + moveResult.to + (moveResult.promotion || ""),
    san_move: san,
    status: statusInfo.status,
    is_check: statusInfo.isCheck,
    is_checkmate: statusInfo.isCheckmate,
    is_stalemate: statusInfo.isStalemate,
    is_draw: statusInfo.isDraw,
    draw_reason: statusInfo.drawReason,
    move_history: [...game.sanHistory],
  };
}

export async function aiMove(gameId: string): Promise<MoveResponse> {
  const game = games.get(gameId);
  if (!game) {
    throw new Error("Game not found. Please start a new game.");
  }

  const chess = game.chess;

  // Simulate a realistic thinking time so the spinner and AI feel alive
  await sleep(400 + Math.random() * 300);

  const bestMove = getBestMove(chess);
  if (!bestMove) {
    throw new Error("No legal moves available for AI");
  }

  const moveResult = chess.move(bestMove);
  const san = moveResult.san;
  game.sanHistory.push(san);

  const statusInfo = getGameStatus(chess);

  return {
    game_id: gameId,
    fen: chess.fen(),
    uci_move: moveResult.from + moveResult.to + (moveResult.promotion || ""),
    san_move: san,
    status: statusInfo.status,
    is_check: statusInfo.isCheck,
    is_checkmate: statusInfo.isCheckmate,
    is_stalemate: statusInfo.isStalemate,
    is_draw: statusInfo.isDraw,
    draw_reason: statusInfo.drawReason,
    move_history: [...game.sanHistory],
  };
}

export async function getGameState(gameId: string): Promise<GameState> {
  const game = games.get(gameId);
  if (!game) {
    throw new Error("Game not found. Please start a new game.");
  }

  const chess = game.chess;
  const statusInfo = getGameStatus(chess);

  return {
    game_id: gameId,
    fen: chess.fen(),
    status: game.resigned ? "resign" : statusInfo.status,
    turn: chess.turn() === "w" ? "white" : "black",
    is_check: statusInfo.isCheck,
    is_checkmate: statusInfo.isCheckmate,
    is_stalemate: statusInfo.isStalemate,
    is_draw: statusInfo.isDraw,
    draw_reason: statusInfo.drawReason,
    move_history: [...game.sanHistory],
  };
}

export async function resign(gameId: string) {
  const game = games.get(gameId);
  if (!game) {
    throw new Error("Game not found. Please start a new game.");
  }

  const chess = game.chess;
  game.resigned = true;
  const statusInfo = getGameStatus(chess);

  return {
    game_id: gameId,
    fen: chess.fen(),
    status: "resign",
    is_check: statusInfo.isCheck,
    is_checkmate: statusInfo.isCheckmate,
    is_stalemate: statusInfo.isStalemate,
    is_draw: statusInfo.isDraw,
    draw_reason: statusInfo.drawReason,
    move_history: [...game.sanHistory],
  };
}
