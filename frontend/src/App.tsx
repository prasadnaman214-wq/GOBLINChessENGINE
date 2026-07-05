import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { Move } from "chess.js";
import {
  newGame,
  makeMove,
  aiMove,
  resign,
} from "./api";
import type { GameOverReason } from "./types";
import "./App.css";

const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ─── Module-level constants (created once, never re-allocated on render) ───────

/** Static board style — hoisted so React.memo can get stable object references. */
const BOARD_STYLE: React.CSSProperties = {
  borderRadius: "4px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
};
const DARK_SQ_STYLE: React.CSSProperties = { backgroundColor: "#769656" };
const LIGHT_SQ_STYLE: React.CSSProperties = { backgroundColor: "#eeeed2" };

/** Stable empty array — avoids new [] allocation when no square is selected. */
const EMPTY_MOVES: Move[] = [];

/** Set lookup is O(1) and avoids a new array literal on every render. */
const GAME_OVER_STATUSES = new Set(["checkmate", "stalemate", "draw", "resign"]);

// ─── Pure utility functions (outside component — created once) ─────────────────

/** Format seconds as M:SS. Pure function — lives at module scope. */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface MoveHistoryItem {
  san: string;
  uci: string;
}

function formatResult(
  status: string,
  turn: "white" | "black",
  drawReason: string | null
): string {
  if (status === "checkmate") {
    const winner = turn === "white" ? "Black" : "White";
    return `${winner} wins by checkmate!`;
  }
  if (status === "stalemate") return "Draw by stalemate!";
  if (status === "draw") {
    if (drawReason === "fifty_moves") return "Draw: 50-move rule";
    if (drawReason === "threefold_repetition")
      return "Draw: threefold repetition";
    if (drawReason === "insufficient_material")
      return "Draw: insufficient material";
    return "Draw";
  }
  if (status === "resign") {
    return `${turn === "white" ? "Black" : "White"} wins by resignation!`;
  }
  return "";
}

function getGameOverReason(
  status: string,
  drawReason: string | null
): GameOverReason {
  if (status === "checkmate") return "checkmate";
  if (status === "stalemate") return "stalemate";
  if (status === "draw") return (drawReason as GameOverReason) || null;
  if (status === "resign") return "resign";
  return null;
}

// Memoized Board to prevent re-renders on timer ticks or unnecessary state changes during drag
interface MemoizedBoardProps {
  fen: string;
  playerColor: "white" | "black";
  isGameOver: boolean;
  isAiThinking: boolean;
  turn: "white" | "black";
  onPieceDrop: (args: { sourceSquare: string; targetSquare: string | null }) => boolean;
  customSquareStyles: Record<string, React.CSSProperties>;
  onSquareClick: (square: string) => void;
  canDragPiece: (args: { piece: any; square: string }) => boolean;
  onPieceDrag: (square: string) => void;
}

const ChessboardComponent = React.memo(({
  fen,
  playerColor,
  isGameOver,
  isAiThinking,
  turn,
  onPieceDrop,
  customSquareStyles,
  onSquareClick,
  canDragPiece,
  onPieceDrag
}: MemoizedBoardProps) => {
  // FIX F-C1 + F-C2: memoize the options object so React.memo's shallow comparison
  // actually works. Previously a new options object (with inline arrow fns) was
  // created on every parent render, defeating the memo entirely.
  const options = useMemo(() => ({
    position: fen,
    boardOrientation: playerColor,
    boardStyle: BOARD_STYLE,        // stable module-level constant
    darkSquareStyle: DARK_SQ_STYLE, // stable module-level constant
    lightSquareStyle: LIGHT_SQ_STYLE,
    animationDurationInMs: 200,
    allowDragging: !isGameOver && !isAiThinking && turn === playerColor,
    onPieceDrop,
    squareStyles: customSquareStyles,
    showNotation: true,
    onSquareClick: ({ square }: { square: string | null }) => { if (square) onSquareClick(square); },
    canDragPiece: ({ piece, square }: { piece: any; square: string | null; isSparePiece?: boolean }) => {
      if (!square) return false;
      return canDragPiece({ piece, square });
    },
    onPieceDrag: ({ square }: { square: string | null }) => {
      if (square) onPieceDrag(square);
    },
  }), [fen, playerColor, isGameOver, isAiThinking, turn, onPieceDrop,
       customSquareStyles, onSquareClick, canDragPiece, onPieceDrag]);

  return <Chessboard options={options} />;
});
ChessboardComponent.displayName = "ChessboardComponent";

export default function App() {
  const [gameId, setGameId] = useState<string | null>(null);
  const [fen, setFen] = useState<string>(STARTING_FEN);
  const [turn, setTurn] = useState<"white" | "black">("white");
  const [status, setStatus] = useState<string>("active");
  const [isCheck, setIsCheck] = useState<boolean>(false);
  const [drawReason, setDrawReason] = useState<string | null>(null);
  const [moveHistory, setMoveHistory] = useState<MoveHistoryItem[]>([]);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [showGameOver, setShowGameOver] = useState<boolean>(false);
  const [whiteTime, setWhiteTime] = useState<number>(0);
  const [blackTime, setBlackTime] = useState<number>(0);
  const [playerColor, setPlayerColor] = useState<"white" | "black">("white");
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  // FIX F-H1: useMemo + module-level Set avoids allocating a new array on every render.
  const isGameOver = useMemo(() => GAME_OVER_STATUSES.has(status), [status]);

  // Local chess.js instance for client-side move validation
  const chessRef = useRef<Chess>(new Chess());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkmateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGameIdRef = useRef<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const boardWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenElement =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement;

      setIsFullscreen(fullscreenElement === boardWrapperRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = boardWrapperRef.current;
    if (!element) {
      setError("Board element not found.");
      return;
    }

    const fullscreenElement =
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement;

    setError(null); // Clear previous errors

    try {
      if (!fullscreenElement) {
        if (element.requestFullscreen) {
          element.requestFullscreen().catch((err) => {
            console.error("Fullscreen error:", err);
            setError(`Fullscreen request failed: ${err.message || err.toString() || "Permission Denied"}. Note: If you are running the app inside an iframe, make sure the iframe has 'allow="fullscreen"' enabled.`);
          });
        } else if ((element as any).webkitRequestFullscreen) {
          (element as any).webkitRequestFullscreen();
        } else if ((element as any).mozRequestFullScreen) {
          (element as any).mozRequestFullScreen();
        } else if ((element as any).msRequestFullscreen) {
          (element as any).msRequestFullscreen();
        } else {
          setError("Fullscreen API is not supported in this browser or environment.");
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch((err) => {
            console.error("Exit fullscreen error:", err);
            setError(`Failed to exit fullscreen: ${err.message || err.toString()}`);
          });
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          (document as any).msExitFullscreen();
        } else {
          setError("Fullscreen exit API is not supported in this browser or environment.");
        }
      }
    } catch (e: any) {
      console.error("Fullscreen exception:", e);
      setError(`Fullscreen exception: ${e.message || e.toString()}`);
    }
  }, []);

  const handleRetryAiMove = useCallback(async () => {
    if (!gameId || isGameOver || isAiThinking || turn === playerColor) return;
    setError(null);
    setIsAiThinking(true);
    try {
      const aiRes = await aiMove(gameId);
      if (activeGameIdRef.current !== gameId) return;

      chessRef.current.load(aiRes.fen);
      setFen(aiRes.fen);
      setStatus(aiRes.status);
      setIsCheck(aiRes.is_check);
      setDrawReason(aiRes.draw_reason);
      setTurn(chessRef.current.turn() === "w" ? "white" : "black");
      setLastMove([aiRes.uci_move.slice(0, 2), aiRes.uci_move.slice(2, 4)]);
      setMoveHistory((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].uci === aiRes.uci_move) return prev;
        return [...prev, { san: aiRes.san_move, uci: aiRes.uci_move }];
      });

      if (aiRes.status === "checkmate") {
        setShowGameOver(true);
      } else if (
        aiRes.status === "stalemate" ||
        aiRes.status === "draw" ||
        aiRes.status === "resign"
      ) {
        setShowGameOver(true);
      }
    } catch (e) {
      const errMsg = (e as Error).message;
      if (errMsg.includes("Game not found") || errMsg.includes("404")) {
        setError("Your game session was lost because the server restarted. Please click 'New Game' to start a new match.");
      } else {
        setError("AI move failed: " + errMsg);
      }
    } finally {
      setIsAiThinking(false);
    }
  }, [gameId, isGameOver, isAiThinking, turn, playerColor]);



  // FIX F-C3: Keep current turn in a ref so the interval callback always reads the
  // latest value without restarting the interval on every move. Previously 'turn' in
  // the dep array caused clearInterval+setInterval on each move, potentially skipping
  // ~1 second of clock time after every move.
  const turnRef = useRef(turn);
  useEffect(() => { turnRef.current = turn; }, [turn]);

  // Timer — stable interval; only restarts when game-over state or AI state changes.
  useEffect(() => {
    if (showGameOver || isAiThinking) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      if (turnRef.current === "white") setWhiteTime((t) => t + 1);
      else setBlackTime((t) => t + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [showGameOver, isAiThinking]); // 'turn' intentionally removed — handled via ref

  // Clean up timeouts
  useEffect(() => {
    return () => {
      if (checkmateTimeoutRef.current) {
        clearTimeout(checkmateTimeoutRef.current);
      }
    };
  }, []);

  const handleNewGame = useCallback(
    async (asColor: "white" | "black" = "white") => {
      if (checkmateTimeoutRef.current) {
        clearTimeout(checkmateTimeoutRef.current);
      }
      setPlayerColor(asColor);
      setError(null);
      setShowGameOver(false);
      setMoveHistory([]);
      setLastMove(null);
      setWhiteTime(0);
      setBlackTime(0);
      setIsAiThinking(false);
      setIsCheck(false);
      setDrawReason(null);
      setSelectedSquare(null);
      chessRef.current = new Chess();
      // Temporary token to identify this handleNewGame invocation before gameId is set
      const newGameAttemptId = Math.random().toString(36).substring(2, 9);
      activeGameIdRef.current = newGameAttemptId;

      try {
        const res = await newGame();
        if (activeGameIdRef.current !== newGameAttemptId) return;

        activeGameIdRef.current = res.game_id;
        setGameId(res.game_id);
        setFen(res.fen);
        setTurn("white");
        setStatus("active");

        if (asColor === "black") {
          setIsAiThinking(true);
          const aiRes = await aiMove(res.game_id);
          if (activeGameIdRef.current !== res.game_id) return;

          chessRef.current.load(aiRes.fen);
          setFen(aiRes.fen);
          setStatus(aiRes.status);
          setIsCheck(aiRes.is_check);
          setDrawReason(aiRes.draw_reason);
          setTurn(chessRef.current.turn() === "w" ? "white" : "black");
          setLastMove([aiRes.uci_move.slice(0, 2), aiRes.uci_move.slice(2, 4)]);
          setMoveHistory([
            { san: aiRes.san_move, uci: aiRes.uci_move },
          ]);
        }
      } catch (e) {
        if (activeGameIdRef.current === newGameAttemptId) {
          setError("Failed to start new game: " + (e as Error).message);
        }
      } finally {
        if (activeGameIdRef.current === newGameAttemptId || activeGameIdRef.current === null) {
          setIsAiThinking(false);
        }
      }
    },
    []
  );

  const getLegalMovesForSquare = useCallback(
    (square: string) => {
      if (isGameOver || isAiThinking || turn !== playerColor) return [];
      const piece = chessRef.current.get(square as any);
      if (!piece || piece.color !== (playerColor === "white" ? "w" : "b")) return [];
      return chessRef.current.moves({ square: square as any, verbose: true });
    },
    [isGameOver, isAiThinking, turn, playerColor]
  );

  const executeMove = useCallback(
    async (sourceSquare: string, targetSquare: string): Promise<boolean> => {
      if (isGameOver || isAiThinking || turn !== playerColor) return false;

      const currentGameId = gameId;

      // Client-side validation using chess.js.
      // FIX Bug #1: chess.js v1.x move() THROWS Error("Invalid move: …") on an
      // illegal move instead of returning null. The old `if (!moveResult)` guard
      // was dead code and the throw escaped into the surrounding catch block
      // AFTER mutating chessRef.current — leaving state half-applied and the
      // outer catch logic running with stale assumptions. Catch here, before
      // any state mutation, and reject cleanly.
      let moveResult;
      try {
        moveResult = chessRef.current.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q", // Auto-promote to queen for simplicity
        });
      } catch {
        return false; // Illegal move — reject
      }

      if (!moveResult) {
        return false; // Illegal move — reject (defensive: some v1.x paths can return null)
      }

      const moveStr = sourceSquare + targetSquare + (moveResult.promotion ? moveResult.promotion : "");
      setError(null);

      // Optimistically update board with client-side move
      setFen(chessRef.current.fen());
      
      // Update turn optimistically
      const nextTurn = chessRef.current.turn() === "w" ? "white" : "black";
      setTurn(nextTurn);

      let moveAppliedOnServer = false;

      try {
        const res = await makeMove(gameId!, moveStr);
        if (activeGameIdRef.current !== currentGameId) return false;
        moveAppliedOnServer = true;

        chessRef.current.load(res.fen);
        setFen(res.fen);
        setStatus(res.status);
        setIsCheck(res.is_check);
        setDrawReason(res.draw_reason);
        setTurn(chessRef.current.turn() === "w" ? "white" : "black");
        setLastMove([res.uci_move.slice(0, 2), res.uci_move.slice(2, 4)]);
        setMoveHistory((prev) => [
          ...prev,
          { san: res.san_move, uci: res.uci_move },
        ]);

        if (res.status === "checkmate") {
          checkmateTimeoutRef.current = setTimeout(() => {
            if (activeGameIdRef.current === currentGameId) {
              setShowGameOver(true);
            }
          }, 1200);
          return true;
        } else if (
          res.status === "stalemate" ||
          res.status === "draw" ||
          res.status === "resign"
        ) {
          setShowGameOver(true);
          return true;
        }

        // Trigger AI move
        setIsAiThinking(true);
        const aiRes = await aiMove(gameId!);
        if (activeGameIdRef.current !== currentGameId) return false;

        chessRef.current.load(aiRes.fen);
        setFen(aiRes.fen);
        setStatus(aiRes.status);
        setIsCheck(aiRes.is_check);
        setDrawReason(aiRes.draw_reason);
        setTurn(chessRef.current.turn() === "w" ? "white" : "black");
        setLastMove([aiRes.uci_move.slice(0, 2), aiRes.uci_move.slice(2, 4)]);
        setMoveHistory((prev) => [
          ...prev,
          { san: aiRes.san_move, uci: aiRes.uci_move },
        ]);

        if (aiRes.status === "checkmate") {
          checkmateTimeoutRef.current = setTimeout(() => {
            if (activeGameIdRef.current === currentGameId) {
              setShowGameOver(true);
            }
          }, 1200);
        } else if (
          aiRes.status === "stalemate" ||
          aiRes.status === "draw" ||
          aiRes.status === "resign"
        ) {
          setShowGameOver(true);
        }
      } catch (e) {
        if (activeGameIdRef.current === currentGameId) {
          if (!moveAppliedOnServer) {
            // Revert on error only if the player's move failed on the server
            chessRef.current.undo();
            setFen(chessRef.current.fen());
            setTurn(chessRef.current.turn() === "w" ? "white" : "black");
          } else {
            // FIX Bug #3: player's move was applied successfully (server FEN is
            // loaded into chessRef + state), but aiMove() then threw. State turn
            // currently reflects the OPPONENT side. Flip it back to the player so
            // they can retry, and clear isAiThinking via finally (Bug #4).
            setTurn(playerColor);
          }
          const errMsg = (e as Error).message;
          if (errMsg.includes("Game not found") || errMsg.includes("404")) {
            setError("Your game session was lost because the server restarted. Please click 'New Game' to start a new match.");
          } else {
            setError(errMsg);
          }
        }
      } finally {
        // FIX Bug #4: isAiThinking is component-level state, not per-game. If
        // the user starts a new game mid-AI-think, activeGameIdRef.current will
        // have moved on to the new gameId, and the old guard would skip this
        // reset — leaking `true` into the new game and freezing input. Always
        // clear it; the new game's own initialization also resets it on entry.
        setIsAiThinking(false);
      }

      return true;
    },
    [gameId, isGameOver, isAiThinking, turn, playerColor]
  );

  const onPieceDrop = useCallback(
    (
      { sourceSquare, targetSquare }: {
        sourceSquare: string;
        targetSquare: string | null;
      }
    ): boolean => {
      setSelectedSquare(null); // Clear selectedSquare immediately on drop
      if (!targetSquare) return false;

      // FIX Bug #2: react-chessboard reads onPieceDrop's return value SYNCHRONOUSLY
      // (no `await`) to decide whether to keep the piece in the drop target or
      // snap it back. executeMove returns Promise<boolean>, so we cannot forward
      // its resolved value through this return slot. Pre-validate synchronously
      // against chess.js (already loaded in chessRef) so illegal moves reject
      // immediately and the board snaps the piece back. executeMove still
      // re-validates internally as a defensive check.
      if (
        isGameOver ||
        isAiThinking ||
        turn !== playerColor
      ) {
        return false;
      }
      const legalMoves = chessRef.current.moves({
        square: sourceSquare as any,
        verbose: true,
      });
      const isLegal = legalMoves.some((m) => m.to === targetSquare);
      if (!isLegal) return false;

      // Kick off the async pipeline; the sync check above is the authoritative
      // signal for snap-back.
      void executeMove(sourceSquare, targetSquare);
      return true;
    },
    [executeMove, isGameOver, isAiThinking, turn, playerColor]
  );

  const handleResign = useCallback(async () => {
    if (!gameId || isGameOver) return;
    const currentGameId = gameId;
    try {
      await resign(gameId);
      if (activeGameIdRef.current !== currentGameId) return;
      setStatus("resign");
      setShowGameOver(true);
    } catch (e) {
      if (activeGameIdRef.current === currentGameId) {
        setError("Resign failed: " + (e as Error).message);
      }
    }
  }, [gameId, isGameOver]);

  // FIX F-H7/H8/H9: Stable onClick handlers — previously inline arrow fns recreated every render.
  // handleNewGameSameColor renders every timer tick (every second), so this is especially important.
  const handlePlayAgain = useCallback(() => {
    setShowGameOver(false);
    handleNewGame(playerColor);
  }, [handleNewGame, playerColor]);

  const handlePlayAsWhite = useCallback(() => handleNewGame("white"), [handleNewGame]);
  const handlePlayAsBlack = useCallback(() => handleNewGame("black"), [handleNewGame]);
  const handleNewGameSameColor = useCallback(() => handleNewGame(playerColor), [handleNewGame, playerColor]);

  // FIX F-H2: formatTime moved to module scope (see top of file) — no longer recreated on every render.

  // FIX F-H3: memoize derived game-over values so they don't recompute on every timer tick.
  const gameOverReason = useMemo(() => getGameOverReason(status, drawReason), [status, drawReason]);
  const gameOverResultText = useMemo(() => formatResult(status, turn, drawReason), [status, turn, drawReason]);

  // FIX F-H4: Replace useCallback with useMemo so the 8×8 board scan only runs
  // when `status` changes (i.e., once at checkmate), not on every customSquareStyles
  // recomputation (which happened on every lastMove/highlight change).
  const losingKingSquare = useMemo((): string | null => {
    if (status !== "checkmate") return null;
    const losingColor = chessRef.current.turn();
    const board = chessRef.current.board();
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.type === "k" && piece.color === losingColor) {
          return files[c] + ranks[r];
        }
      }
    }
    return null;
  }, [status]); // only re-runs when game status changes

  const highlightedMoves = useMemo(() => {
    // Short-circuit when no square selected — returns stable EMPTY_MOVES constant
    // instead of allocating a new [] on every render.
    if (!selectedSquare) return EMPTY_MOVES;
    return getLegalMovesForSquare(selectedSquare);
  }, [selectedSquare, getLegalMovesForSquare, fen]); // re-evaluate when board state changes

  const handleSquareClick = useCallback(
    (square: string) => {
      if (isGameOver || isAiThinking || turn !== playerColor) return;

      // Check if clicking a highlighted legal move square
      const move = highlightedMoves.find((m) => m.to === square);
      if (move) {
        executeMove(selectedSquare!, square);
        setSelectedSquare(null);
        return;
      }

      // Otherwise, select own piece
      const piece = chessRef.current.get(square as any);
      if (piece && piece.color === (playerColor === "white" ? "w" : "b")) {
        if (selectedSquare === square) {
          setSelectedSquare(null);
        } else {
          setSelectedSquare(square);
        }
      } else {
        setSelectedSquare(null);
      }
    },
    [highlightedMoves, selectedSquare, executeMove, isGameOver, isAiThinking, turn, playerColor]
  );

  const handleCanDragPiece = useCallback(
    ({ piece }: { piece: any }): boolean => {
      if (isGameOver || isAiThinking || turn !== playerColor) return false;
      const pieceType = piece.pieceType || piece; // Fallback in case of type variations
      const isPlayerPiece = pieceType[0] === (playerColor === "white" ? "w" : "b");
      return isPlayerPiece;
    },
    [isGameOver, isAiThinking, turn, playerColor]
  );

  const handlePieceDrag = useCallback(
    (square: string) => {
      setSelectedSquare(square);
    },
    []
  );

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    // 1. Highlight last move
    if (lastMove) {
      const [from, to] = lastMove;
      styles[from] = { backgroundColor: "rgba(255, 255, 0, 0.4)" };
      styles[to] = { backgroundColor: "rgba(255, 255, 0, 0.4)" };
    }

    // 2. Highlight losing king's square with red-flash animation
    // FIX F-H4: losingKingSquare is now a useMemo (not a useCallback call),
    // so it doesn't trigger an extra 8×8 scan here.
    if (losingKingSquare) {
      styles[losingKingSquare] = {
        animation: "red-flash 1.5s ease-in-out infinite",
      };
    }

    // 3. Highlight legal moves
    highlightedMoves.forEach((move) => {
      const isCapture = move.captured !== undefined || move.flags.includes('c') || move.flags.includes('e');
      if (isCapture) {
        styles[move.to] = {
          background: "radial-gradient(circle, transparent 60%, rgba(0, 0, 0, 0.2) 62%, rgba(0, 0, 0, 0.2) 70%, transparent 72%)",
          cursor: "pointer",
        };
      } else {
        styles[move.to] = {
          background: "radial-gradient(circle, rgba(0, 0, 0, 0.2) 20%, transparent 22%)",
          cursor: "pointer",
        };
      }
    });

    return styles;
  }, [lastMove, highlightedMoves, losingKingSquare]);

  return (
    <div className="app">
      <header className="header">
        <h1>♔ Chess AI</h1>
        <p className="subtitle">
          Play against a beginner-friendly AI opponent (~800–1200 ELO)
        </p>
      </header>

      <div className="game-layout">
        {/* Left panel */}
        <div className="side-panel">
          <div className="panel-section">
            <div className="player-info">
              <span className="player-label">
                Black {playerColor === "black" ? "(You)" : "(AI)"}
              </span>
              <span className="timer">{formatTime(blackTime)}</span>
            </div>
          </div>
        </div>

        {/* Center — Board */}
        <div className="board-center">
          {!gameId ? (
            <div className="start-screen">
              <h2>Welcome to Chess AI</h2>
              <p>Choose your color to start a new game</p>
              <div className="start-buttons">
                {/* FIX F-H8: useCallback-wrapped handlers avoid new fn refs on every render */}
                <button
                  className="btn btn-primary btn-large"
                  onClick={handlePlayAsWhite}
                >
                  ♔ Play as White
                </button>
                <button
                  className="btn btn-secondary btn-large"
                  onClick={handlePlayAsBlack}
                >
                  ♚ Play as Black
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                ref={boardWrapperRef}
                className={`board-wrapper ${isAiThinking ? "ai-thinking-active" : ""} ${
                  isFullscreen ? "fullscreen-active" : ""
                }`}
              >
                <div className="chessboard-container">
                  {/* FIX F-M1: Removed key prop — it was causing full unmount/remount of
                      the board on every fullscreen toggle. CSS :fullscreen handles layout. */}
                  <ChessboardComponent
                    fen={fen}
                    playerColor={playerColor}
                    isGameOver={isGameOver}
                    isAiThinking={isAiThinking}
                    turn={turn}
                    onPieceDrop={onPieceDrop}
                    customSquareStyles={customSquareStyles}
                    onSquareClick={handleSquareClick}
                    canDragPiece={handleCanDragPiece}
                    onPieceDrag={handlePieceDrag}
                  />
                </div>
                {isAiThinking && (
                  <div className="ai-thinking">
                    <div className="ai-spinner" />
                    <span>AI is thinking...</span>
                  </div>
                )}
                <button
                  className="floating-fullscreen-btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                  {isFullscreen ? (
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H5.25A1.5 1.5 0 003.75 5.25v3.75M9 3.75v3.75c0 .828-.672 1.5-1.5 1.5H3.75M15 3.75h3.75a1.5 1.5 0 011.5 1.5v3.75M15 3.75v3.75c0 .828.672 1.5 1.5 1.5h3.75M9 20.25H5.25a1.5 1.5 0 01-1.5-1.5v-3.75M9 20.25v-3.75c0-.828-.672-1.5-1.5-1.5H3.75M15 20.25h3.75a1.5 1.5 0 001.5-1.5v-3.75M15 20.25v-3.75c0-.828.672-1.5 1.5-1.5h3.75" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
                    </svg>
                  )}
                </button>
              </div>

              {error && <div className="error-banner">{error}</div>}

              <div className="status-bar">
                {!isGameOver && (
                  <span className="turn-indicator">
                    {isAiThinking
                      ? "AI's turn..."
                      : `Your turn${isCheck ? " — CHECK!" : ""}`}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        <div className="side-panel right-panel">
          {gameId && (
            <>
              <div className="panel-section">
                <div className="section-title">Move History</div>
                <div className="move-list">
                  {moveHistory.length === 0 ? (
                    <div className="empty-history">No moves yet</div>
                  ) : (
                    moveHistory.map((m, i) => (
                      <div
                        key={`move-${i}-${m.uci}`}
                        className={`move-row ${i % 2 === 0 ? "white-move" : "black-move"}`}
                      >
                        {/* FIX F-H6: Composite key instead of array index — stable on reorder/reset */}
                        {i % 2 === 0 && (
                          <span className="move-number">
                            {Math.floor(i / 2) + 1}.
                          </span>
                        )}
                        <span className="move-san">{m.san}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="panel-section">
                <div className="section-title">Controls</div>
                <div className="control-buttons">
                  {/* FIX F-H9: useCallback-wrapped — this renders every timer tick */}
                  <button
                    className="btn btn-primary"
                    onClick={handleNewGameSameColor}
                  >
                    New Game
                  </button>
                  {!isGameOver && (
                    <button className="btn btn-danger" onClick={handleResign}>
                      Resign
                    </button>
                  )}
                  {turn !== playerColor && !isGameOver && !isAiThinking && (
                    <button className="btn btn-secondary" onClick={handleRetryAiMove}>
                      Retry AI Move
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={toggleFullscreen}
                  >
                    {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  </button>
                </div>
              </div>

              <div className="panel-section">
                <div className="player-info">
                  <span className="player-label">
                    White {playerColor === "white" ? "(You)" : "(AI)"}
                  </span>
                  <span className="timer">{formatTime(whiteTime)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Game over modal */}
      {showGameOver && gameId && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-icon">
              {gameOverReason === "checkmate" ? "🏆" : "🤝"}
            </div>
            <h2>Game Over</h2>
            <p className="result-text">
              {/* FIX F-H3: use memoized value instead of calling formatResult inline */}
              {gameOverResultText}
            </p>
            <div className="modal-buttons">
              {/* FIX F-H7: useCallback-wrapped — avoids new fn ref on every render */}
              <button
                className="btn btn-primary btn-large"
                onClick={handlePlayAgain}
              >
                Play Again
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowGameOver(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
