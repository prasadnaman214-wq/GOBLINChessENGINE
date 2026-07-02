"""
Chess AI Engine — Minimax with alpha-beta pruning.
Target strength: ~800-1200 ELO. Keep it simple and beatable.
"""

import chess
import random
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

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

    FIX B-H5: Use board.piece_map() instead of iterating all 64 squares.
    piece_map() returns only occupied squares (~16–20 in a typical position vs 64),
    giving a 3–4× speedup on this hotpath which is called at every leaf node.
    """
    material_score = 0.0
    positional_score = 0.0

    for square, piece in board.piece_map().items():  # only occupied squares
        mat = MATERIAL[piece.piece_type]
        pst = _pst_value(piece.piece_type, piece.color, square)
        sign = 1 if piece.color == chess.WHITE else -1
        material_score += sign * mat
        positional_score += sign * pst

    return material_score, positional_score


def evaluate(board: chess.Board) -> float:
    """
    Simple evaluation: material + piece-square tables.
    Small random noise is added by the caller to simulate human inconsistency.

    FIX B-M1: Removed redundant board.is_game_over() check — minimax already
    handles terminal nodes before calling evaluate(), so this guard was unreachable.
    """
    mat_score, pst_score = evaluate_detailed(board)
    return mat_score + pst_score


def _order_moves(board: chess.Board, moves: list[chess.Move]) -> list[chess.Move]:
    """
    Move ordering: captures and checks first for better alpha-beta pruning.
    This is a performance optimization, not a strength increase.

    FIX B-C2: Previously used board.push(m)/board.pop() inside the sort key to detect
    checks, causing O(N²) board mutations per node. Replaced with board.gives_check(m)
    which checks for check without mutating the board at all.
    Also pre-computes piece lookups in a linear pass before sorting (O(N)) instead of
    re-calling piece_at() O(N log N) times inside the sort comparator.
    """
    piece_at = board.piece_at  # local reference avoids repeated attribute lookup
    scored: list[tuple[int, chess.Move]] = []
    for m in moves:
        priority = 0
        if board.is_capture(m):
            captured = piece_at(m.to_square)
            attacker = piece_at(m.from_square)
            if captured and attacker:
                # MVV-LVA: Most Valuable Victim - Least Valuable Attacker
                priority += 1000 + MATERIAL.get(captured.piece_type, 0) - MATERIAL.get(attacker.piece_type, 0)
            else:
                priority += 500
        if m.promotion:
            priority += 900
        if board.gives_check(m):  # FIX B-C2: no board.push/pop — zero board mutations
            priority += 500
        scored.append((priority, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored]


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

    # Ensure we return something legal even if we timed out before any move was evaluated
    if best_move is None:
        # FIX B-C3: Previously called minimax() again here, completely defeating the
        # timeout. Now just return a random legal move — fast and safe.
        best_move = random.choice(legal_moves)

    elapsed = time.time() - start_time

    # FIX B-M2 + B-M3: Removed extra board.push/evaluate_detailed/board.pop purely for
    # debug logging (redundant evaluation). Use scores already tracked during the search.
    # Replaced print() with structured logger.debug() — filterable, non-blocking, no GIL stdout lock.
    logger.debug(
        "[AI] depth=%d move=%s clean_score=%.1f noise=%.1f total=%.1f time=%.3fs",
        depth, best_move.uci(), best_clean_score, best_noise, best_score, elapsed,
    )

    return best_move

