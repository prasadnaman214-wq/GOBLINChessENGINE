import unittest
import chess
from ai_engine import get_best_move, evaluate, evaluate_detailed, _pst_value

class TestAIEngine(unittest.TestCase):
    def test_hanging_queen_capture(self):
        # White to move. Black queen on e5 is completely undefended and can be captured by White knight on f3.
        # FEN: White: Ke1, Qd1, Ra1, Rh1, Bc1, Bf1, Nb1, Nf3. Pawns on a2, b2, c2, d2, e2, f2, g2, h2.
        #      Black: Ke8, Qe5, Ra8, Rh8, Bc8, Bf8, Nb8, Ng8. Pawns on a7, b7, c7, d7, f7, g7, h7 (no e-pawn, pawn on d7, etc.)
        # FEN string representing this state:
        fen = "rnb1kbnr/pppp1ppp/8/4q3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1"
        board = chess.Board(fen)
        
        # Verify black queen on e5 is indeed present and Nf3 can capture it
        self.assertEqual(board.piece_at(chess.E5), chess.Piece(chess.QUEEN, chess.BLACK))
        self.assertEqual(board.piece_at(chess.F3), chess.Piece(chess.KNIGHT, chess.WHITE))
        
        best_move = get_best_move(board)
        self.assertIsNotNone(best_move)
        # The best move should be Nf3xe5 (f3e5)
        self.assertEqual(best_move.uci(), "f3e5")

    def test_checkmate_in_one(self):
        # Scholar's mate position: White to move can checkmate in 1 with Qxf7#
        fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4"
        board = chess.Board(fen)
        
        best_move = get_best_move(board)
        self.assertIsNotNone(best_move)
        self.assertEqual(best_move.uci(), "f3f7")

    def test_black_turn_defense(self):
        # Black to move. White queen is undefended on e4 and can be captured by Black knight on f6.
        # If the perspective/maximization bug is present, Black will play a random move or move into check.
        # FEN: Black knight on f6, White queen on e4 (undefended). Black to move (turn 'b').
        fen = "rnbqkb1r/pppppppp/5n2/8/4Q3/8/PPPPPPPP/RNB1KBNR b KQkq - 0 1"
        board = chess.Board(fen)
        
        best_move = get_best_move(board)
        self.assertIsNotNone(best_move)
        self.assertEqual(best_move.uci(), "f6e4")

    def test_pst_value_perspective(self):
        # Clear board, place White Pawn on e2 and Black Pawn on e7.
        # They should have the same PST values mirrored.
        board = chess.Board(None)
        board.set_piece_at(chess.E2, chess.Piece(chess.PAWN, chess.WHITE))
        board.set_piece_at(chess.E7, chess.Piece(chess.PAWN, chess.BLACK))
        
        val_white = _pst_value(chess.PAWN, chess.WHITE, chess.E2)
        val_black = _pst_value(chess.PAWN, chess.BLACK, chess.E7)
        self.assertEqual(val_white, val_black)
        
        # Total evaluation should be exactly 0 since white and black pawns are identical in material and position.
        self.assertEqual(evaluate(board), 0.0)

    def test_minimax_draw_eval(self):
        # Stalemate position: Black has no legal moves and is not in check.
        fen = "2k5/2P5/2K5/8/8/8/8/8 b - - 0 1"
        board = chess.Board(fen)
        self.assertTrue(board.is_stalemate() or len(list(board.legal_moves)) == 0)

        # FIX: evaluate() no longer handles terminal nodes — that's minimax()'s job (B-M1).
        # Verify that minimax correctly returns 0.0 for a stalemate (draw) position.
        from ai_engine import minimax
        self.assertEqual(minimax(board, 2, float("-inf"), float("inf"), False), 0.0)
        # Also confirm board.is_game_over() so minimax hits the terminal branch before evaluate().
        self.assertTrue(board.is_game_over())

    def test_minimax_checkmate_depth(self):
        # Scholar's mate position: White to move can checkmate in 1 (Qxf7#)
        fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4"
        board = chess.Board(fen)
        
        from ai_engine import minimax
        # If we search mate in 1, the score should incorporate depth.
        score = minimax(board, 2, float("-inf"), float("inf"), True)
        self.assertTrue(score > 15000)
        
    def test_eval_breakdown_logging(self):
        # Print/log the eval breakdown for a few test positions.
        positions = {
            "Starting Position": chess.Board(),
            "Middle Game": chess.Board("r1bqk2r/ppp2ppp/2np1n2/4p3/2B1P3/3P1N2/PPP2PPP/RN1QK2R w KQkq - 0 6"),
            "Endgame (K+P vs K)": chess.Board("8/8/8/4k3/8/4K3/4P3/8 w - - 0 1")
        }
        
        print("\n=== EVALUATION BREAKDOWN LOGS ===")
        for name, board in positions.items():
            mat_score, pst_score = evaluate_detailed(board)
            noise = 10.0 # simulated noise
            total = mat_score + pst_score + noise
            print(f"[{name}]")
            print(f"  FEN: {board.fen()}")
            print(f"  Material Score (White perspective): {mat_score:.1f}")
            print(f"  Positional Score (PST):             {pst_score:.1f}")
            print(f"  Simulated Noise:                    {noise:.1f}")
            print(f"  Total Score:                        {total:.1f}")
        print("==================================\n")

if __name__ == "__main__":
    unittest.main()
