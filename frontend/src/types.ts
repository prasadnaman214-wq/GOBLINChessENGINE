export interface NewGameResponse {
  game_id: string;
  fen: string;
  status: string;
}

export interface MoveResponse {
  game_id: string;
  fen: string;
  uci_move: string;
  san_move: string;
  status: string;
  is_check: boolean;
  is_checkmate: boolean;
  is_stalemate: boolean;
  is_draw: boolean;
  draw_reason: string | null;
  move_history: string[];
}

export interface GameState {
  game_id: string;
  fen: string;
  status: string;
  turn: "white" | "black";
  is_check: boolean;
  is_checkmate: boolean;
  is_stalemate: boolean;
  is_draw: boolean;
  draw_reason: string | null;
  move_history: string[];
}

export type GameOverReason =
  | "checkmate"
  | "stalemate"
  | "fifty_moves"
  | "threefold_repetition"
  | "insufficient_material"
  | "resign"
  | null;
