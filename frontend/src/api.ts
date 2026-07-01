import type { NewGameResponse, MoveResponse, GameState } from "./types";

const BASE = ""; // Vite proxies /api to backend in dev

export async function newGame(): Promise<NewGameResponse> {
  const res = await fetch(`${BASE}/api/new-game`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function makeMove(
  gameId: string,
  move: string
): Promise<MoveResponse> {
  const res = await fetch(`${BASE}/api/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_id: gameId, move }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Move failed");
  }
  return res.json();
}

export async function aiMove(gameId: string): Promise<MoveResponse> {
  const res = await fetch(`${BASE}/api/ai-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_id: gameId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getGameState(gameId: string): Promise<GameState> {
  const res = await fetch(`${BASE}/api/game-state/${gameId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function resign(gameId: string) {
  const res = await fetch(`${BASE}/api/resign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_id: gameId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
