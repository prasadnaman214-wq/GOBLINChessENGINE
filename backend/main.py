"""
FastAPI Chess Backend — REST API for the chess web app.
"""

import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chess
import chess.pgn
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

# ─── In-memory game storage ──────────────────────────────────────────────────
games: dict[str, dict] = {}


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
    status, is_check, is_checkmate, is_stalemate, is_draw, draw_reason = get_game_status(board)

    # Build move history in algebraic notation
    move_history = []
    pgn_moves = []
    temp_board = chess.Board()
    for move in board.move_stack:
        pgn_moves.append(move)
    # Export PGN to get SAN
    try:
        pgn_game = chess.pgn.Game.from_board(board)
        exporter = chess.pgn.StringExporter(columns=None, comments=False, variations=False)
        pgn_str = pgn_game.accept(exporter)
        # Parse moves from PGN string
        import re
        tokens = re.findall(r'\d+\.\s*\S+|\d+\.\s*\.\.\.\s*\S+', pgn_str)
        for token in tokens:
            parts = token.split()
            for part in parts:
                if part not in ('1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '...'):
                    # Remove move numbers
                    clean = part.strip('.')
                    if clean and clean not in ('1-0', '0-1', '1/2-1/2', '*'):
                        move_history.append(clean)
    except Exception:
        # Fallback: just use UCI moves
        for move in board.move_stack:
            move_history.append(move.uci())

    return {
        "game_id": game_id,
        "fen": board.fen(),
        "status": status,
        "is_check": is_check,
        "is_checkmate": is_checkmate,
        "is_stalemate": is_stalemate,
        "is_draw": is_draw,
        "draw_reason": draw_reason,
        "move_history": move_history,
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
    games[game_id] = {"board": board, "resigned": False}
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

    # Apply move
    san = board.san(move)
    board.push(move)

    resp = board_to_response(board, req.game_id)
    resp["uci_move"] = move.uci()
    resp["san_move"] = san

    return MoveResponse(**resp)


@app.post("/api/ai-move", response_model=AIMoveResponse)
def ai_move(req: AIMoveRequest):
    """Compute and apply the AI's move."""
    if req.game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[req.game_id]
    board = game["board"]

    # Get AI's best move
    ai_best = get_best_move(board)
    if ai_best is None:
        raise HTTPException(status_code=400, detail="No legal moves available for AI")

    san = board.san(ai_best)
    board.push(ai_best)

    resp = board_to_response(board, req.game_id)
    resp["uci_move"] = ai_best.uci()
    resp["san_move"] = san

    return AIMoveResponse(**resp)


@app.get("/api/game-state/{game_id}", response_model=GameStateResponse)
def game_state(game_id: str):
    """Get the current state of a game."""
    if game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[game_id]
    board = game["board"]

    status, is_check, is_checkmate, is_stalemate, is_draw, draw_reason = get_game_status(board)

    resp = board_to_response(board, game_id)
    resp["turn"] = "white" if board.turn == chess.WHITE else "black"
    resp["is_check"] = is_check
    resp["is_checkmate"] = is_checkmate
    resp["is_stalemate"] = is_stalemate
    resp["is_draw"] = is_draw
    resp["draw_reason"] = draw_reason

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
