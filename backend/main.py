"""
FastAPI Chess Backend — REST API for the chess web app.
"""

import uuid
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chess
from cachetools import TTLCache
from ai_engine import get_best_move

app = FastAPI(title="Chess AI API")

# ─── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Thread pool for CPU-bound AI search ────────────────────────────────────
# FIX B-C1: Offload minimax to a thread pool so the async event loop stays
# responsive. Max 4 concurrent AI searches — adjust to CPU core count.
_executor = ThreadPoolExecutor(max_workers=4)

# ─── In-memory game storage ──────────────────────────────────────────────────
# FIX B-C4: TTLCache replaces the unbounded dict. Caps at 1000 concurrent games;
# each game expires automatically after 2 hours of inactivity, preventing OOM.
_games_lock = threading.Lock()
games: TTLCache = TTLCache(maxsize=1000, ttl=7200)


# ─── Pydantic models ─────────────────────────────────────────────────────────
class NewGameResponse(BaseModel):
    game_id: str
    fen: str
    status: str


class MoveRequest(BaseModel):
    game_id: str
    move: str  # UCI or SAN


class MoveResponse(BaseModel):
    game_id: str
    fen: str
    uci_move: str
    san_move: str
    status: str
    is_check: bool
    is_checkmate: bool
    is_stalemate: bool
    is_draw: bool
    draw_reason: str | None
    move_history: list[str]


class AIMoveRequest(BaseModel):
    game_id: str


class AIMoveResponse(BaseModel):
    game_id: str
    fen: str
    uci_move: str
    san_move: str
    status: str
    is_check: bool
    is_checkmate: bool
    is_stalemate: bool
    is_draw: bool
    draw_reason: str | None
    move_history: list[str]


class GameStateResponse(BaseModel):
    game_id: str
    fen: str
    status: str
    turn: str
    is_check: bool
    is_checkmate: bool
    is_stalemate: bool
    is_draw: bool
    draw_reason: str | None
    move_history: list[str]


# ─── Helpers ──────────────────────────────────────────────────────────────────
def get_game_status(board: chess.Board) -> tuple[str, bool, bool, bool, bool, str | None]:
    """Return (status, is_check, is_checkmate, is_stalemate, is_draw, draw_reason)."""
    is_check = board.is_check()
    is_checkmate = board.is_checkmate()
    is_stalemate = board.is_stalemate()
    is_draw = False
    draw_reason = None

    if is_checkmate:
        status = "checkmate"
    elif is_stalemate:
        status = "stalemate"
        draw_reason = "stalemate"
        is_draw = True
    elif board.is_fifty_moves():
        status = "draw"
        draw_reason = "fifty_moves"
        is_draw = True
    elif board.is_insufficient_material():
        status = "draw"
        draw_reason = "insufficient_material"
        is_draw = True
    elif board.can_claim_threefold_repetition():
        status = "draw"
        draw_reason = "threefold_repetition"
        is_draw = True
    elif is_check:
        status = "check"
    else:
        status = "active"

    return status, is_check, is_checkmate, is_stalemate, is_draw, draw_reason


def board_to_response(board: chess.Board, game_id: str) -> dict:
    """
    Build API response dict from current board state.

    FIX B-H3: Replaced O(N) PGN rebuild + regex parse with O(1) read of the
    incrementally-maintained san_history list stored in the game dict.
    Also removed dead code: unused temp_board and pgn_moves list.
    Also removed `import re` from inside this function body (FIX B-H4).
    """
    status, is_check, is_checkmate, is_stalemate, is_draw, draw_reason = get_game_status(board)
    return {
        "game_id": game_id,
        "fen": board.fen(),
        "status": status,
        "is_check": is_check,
        "is_checkmate": is_checkmate,
        "is_stalemate": is_stalemate,
        "is_draw": is_draw,
        "draw_reason": draw_reason,
        "move_history": list(games[game_id].get("san_history", [])),
    }


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "Chess AI API is running"}


@app.post("/api/new-game", response_model=NewGameResponse)
def new_game():
    """Start a new game. Returns game_id and starting FEN."""
    game_id = str(uuid.uuid4())[:8]
    board = chess.Board()
    with _games_lock:
        # FIX B-H3: Store san_history list for O(1) incremental move history updates.
        games[game_id] = {"board": board, "resigned": False, "san_history": []}
    return NewGameResponse(
        game_id=game_id,
        fen=board.fen(),
        status="active",
    )


@app.post("/api/move", response_model=MoveResponse)
def make_move(req: MoveRequest):
    """Validate and apply a human player's move."""
    if req.game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[req.game_id]
    board = game["board"]

    # Parse the move (try UCI first, then SAN)
    move = None
    move_str = req.move.strip()

    # Try UCI format first (e.g., "e2e4")
    try:
        move = chess.Move.from_uci(move_str)
        if move not in board.legal_moves:
            move = None
    except ValueError:
        pass

    # Try SAN format
    if move is None:
        try:
            move = board.parse_san(move_str)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Illegal or unknown move: {move_str}")

    if move not in board.legal_moves:
        raise HTTPException(status_code=400, detail=f"Illegal move: {move_str}")

    # Apply move — track SAN before push (board state needed for SAN generation)
    san = board.san(move)
    board.push(move)
    # FIX B-H3: Append to incremental san_history list instead of rebuilding PGN.
    games[req.game_id]["san_history"].append(san)

    resp = board_to_response(board, req.game_id)
    resp["uci_move"] = move.uci()
    resp["san_move"] = san

    return MoveResponse(**resp)


@app.post("/api/ai-move", response_model=AIMoveResponse)
async def ai_move(req: AIMoveRequest):
    """
    Compute and apply the AI's move.

    FIX B-C1: Changed from sync def to async def + run_in_executor so the
    ~1.5s minimax search runs in a thread pool, keeping the event loop free
    to handle other requests concurrently.
    """
    if req.game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[req.game_id]
    board = game["board"]

    # Copy the board so the thread pool search doesn't race with other mutations
    board_copy = board.copy()
    loop = asyncio.get_event_loop()
    ai_best = await loop.run_in_executor(_executor, get_best_move, board_copy)

    if ai_best is None:
        raise HTTPException(status_code=400, detail="No legal moves available for AI")

    # Apply the AI move on the real (non-copy) board
    san = board.san(ai_best)
    board.push(ai_best)
    # FIX B-H3: Append to incremental san_history list.
    games[req.game_id]["san_history"].append(san)

    resp = board_to_response(board, req.game_id)
    resp["uci_move"] = ai_best.uci()
    resp["san_move"] = san

    return AIMoveResponse(**resp)


@app.get("/api/game-state/{game_id}", response_model=GameStateResponse)
def game_state(game_id: str):
    """
    Get the current state of a game.

    FIX B-H6: Previously called get_game_status() twice (once directly, once inside
    board_to_response). Now calls board_to_response() once and adds `turn` to the result.
    """
    if game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    board = games[game_id]["board"]
    resp = board_to_response(board, game_id)
    resp["turn"] = "white" if board.turn == chess.WHITE else "black"

    return GameStateResponse(**resp)


class ResignRequest(BaseModel):
    game_id: str


@app.post("/api/resign")
def resign(req: ResignRequest):
    """Player resigns the game."""
    if req.game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[req.game_id]
    board = game["board"]
    game["resigned"] = True

    # Opponent wins
    winner = "black" if board.turn == chess.WHITE else "white"

    resp = board_to_response(board, req.game_id)
    resp["status"] = "resign"
    resp["winner"] = winner
    resp["turn"] = "white" if board.turn == chess.WHITE else "black"

    return resp


# ─── Run ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
