"""
Chess AI Engine — Minimax with alpha-beta pruning.
Target strength: ~800-1200 ELO. Keep it simple and beatable.
"""

import chess
import random
import time
from typing import Optional

# ─── Material values (centipawns) ────────────────────────────────────────────
MATERIAL = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}

# ─── Piece-Square Tables (encourage central control & normal development) ────
# Values from white's perspective; mirrored for black.
# Higher = better square for that piece.

PAWN_PST = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
]

KNIGHT_PST = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
]

BISHOP_PST = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
]

ROOK_PST = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
]

QUEEN_PST = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
]

# King PST — protect the king in the opening/middlegame
KING_PST = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
]

PST = {
    chess.PAWN: PAWN_PST,
    chess.KNIGHT: KNIGHT_PST,
    chess.BISHOP: BISHOP_PST,
    chess.ROOK: ROOK_PST,
    chess.QUEEN: QUEEN_PST,
    chess.KING: KING_PST,
}


def _pst_value(piece_type: int, color: chess.Color, square: int) -> int:
    """Return PST score for a piece on a square. Mirrors for black."""
    pst = PST[piece_type]
    if color == chess.WHITE:
        return pst[square]
    else:
        return pst[chess.square_mirror(square)]


def evaluate_detailed(board: chess.Board) -> tuple[float, float]:
    """
    Returns (material_score, positional_score) from White's perspective.
    """
    material_score = 0.0
    positional_score = 0.0

    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece:
            mat = MATERIAL[piece.piece_type]
            pst = _pst_value(piece.piece_type, piece.color, square)
            if piece.color == chess.WHITE:
                material_score += mat
                positional_score += pst
            else:
                material_score -= mat
                positional_score -= pst

    return material_score, positional_score


def evaluate(board: chess.Board) -> float:
    """
    Simple evaluation: material + piece-square tables.
    Small random noise is added by the caller to simulate human inconsistency.
    """
    if board.is_game_over():
        if board.is_checkmate():
            return -20000.0 if board.turn == chess.WHITE else 20000.0
        return 0.0

    mat_score, pst_score = evaluate_detailed(board)
    return mat_score + pst_score


def _order_moves(board: chess.Board, moves: list[chess.Move]) -> list[chess.Move]:
    """
    Move ordering: captures and checks first for better alpha-beta pruning.
    This is a performance optimization, not a strength increase.
    """
    def move_priority(m: chess.Move) -> int:
        priority = 0
        if board.is_capture(m):
            captured = board.piece_at(m.to_square)
            if captured:
                priority += 1000 + MATERIAL.get(captured.piece_type, 0) - MATERIAL.get(
                    board.piece_at(m.from_square).piece_type, 0
                )
        # Promotions are good
        if m.promotion:
            priority += 900
        # Checks put pressure
        board.push(m)
        if board.is_check():
            priority += 500
        board.pop()
        return priority

    moves.sort(key=move_priority, reverse=True)
    return moves


def minimax(
    board: chess.Board,
    depth: int,
    alpha: float,
    beta: float,
    maximizing: bool,
) -> float:
    """Minimax with alpha-beta pruning."""

    # Game over checks first (terminal nodes)
    if board.is_game_over():
        if board.is_checkmate():
            # Reward shorter mate paths by incorporating depth.
            return -20000.0 - depth if board.turn == chess.WHITE else 20000.0 + depth
        return 0.0

    if depth == 0:
        return evaluate(board)

    legal_moves = list(board.legal_moves)
    if not legal_moves:
        if board.is_check():
            return -20000.0 - depth if board.turn == chess.WHITE else 20000.0 + depth
        return 0.0

    legal_moves = _order_moves(board, legal_moves)

    if maximizing:
        max_eval = float("-inf")
        for move in legal_moves:
            board.push(move)
            eval_score = minimax(board, depth - 1, alpha, beta, False)
            board.pop()
            max_eval = max(max_eval, eval_score)
            alpha = max(alpha, eval_score)
            if beta <= alpha:
                break
        return max_eval
    else:
        min_eval = float("inf")
        for move in legal_moves:
            board.push(move)
            eval_score = minimax(board, depth - 1, alpha, beta, True)
            board.pop()
            min_eval = min(min_eval, eval_score)
            beta = min(beta, eval_score)
            if beta <= alpha:
                break
        return min_eval


def get_best_move(board: chess.Board, timeout_seconds: float = 1.5) -> Optional[chess.Move]:
    """
    Find the best move using minimax + alpha-beta pruning.
    Depth 2 by default; depth 3 only when <10 legal moves (to stay within ELO target).

    Adds small random noise to evaluation to simulate human-like inconsistency.
    Includes a hard timeout fallback.
    """
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return None
    if len(legal_moves) == 1:
        return legal_moves[0]

    # Decide depth: extend to 3 only when very few moves available
    depth = 2 if len(legal_moves) >= 10 else 3

    start_time = time.time()
    best_move = None
    
    # Maximizing player depends on whose turn it is
    maximizing = board.turn == chess.WHITE
    
    best_score = float("-inf") if maximizing else float("inf")
    best_clean_score = 0.0
    best_noise = 0.0
    alpha = float("-inf")
    beta = float("inf")

    # Evaluate all moves
    for move in legal_moves:
        # Check timeout — return best so far if we're running long
        if time.time() - start_time > timeout_seconds:
            break

        board.push(move)
        clean_score = minimax(board, depth - 1, alpha, beta, not maximizing)
        board.pop()

        # Add human-like noise: +/- 5–15 centipawns
        noise = random.uniform(-15, 15)
        score_with_noise = clean_score + noise

        if maximizing:
            if score_with_noise > best_score:
                best_score = score_with_noise
                best_clean_score = clean_score
                best_noise = noise
                best_move = move
            alpha = max(alpha, clean_score)
        else:
            if score_with_noise < best_score:
                best_score = score_with_noise
                best_clean_score = clean_score
                best_noise = noise
                best_move = move
            beta = min(beta, clean_score)

    # Ensure we return something legal even if we timed out
    if best_move is None:
        best_move = random.choice(legal_moves)
        board.push(best_move)
        best_clean_score = minimax(board, depth - 1, alpha, beta, not maximizing)
        board.pop()
        best_noise = 0.0
        best_score = best_clean_score

    elapsed = time.time() - start_time
    
    # Get static evaluation of the final position chosen
    board.push(best_move)
    mat_score, pst_score = evaluate_detailed(board)
    board.pop()
    
    print(
        f"[AI] Depth={depth} | Move={best_move.uci()} | "
        f"Material={mat_score:.1f} | Positional={pst_score:.1f} | "
        f"Noise={best_noise:.1f} | Total Score={best_score:.1f} | "
        f"Time={elapsed:.3f}s"
    )

    return best_move

