/**
 * Chess Application Controller
 * Handles UI drawing, user inputs (drag/drop), Web Audio sound effects,
 * coaching overlays, and integration with chess.js & the chess-engine AI.
 */

// Global state variables
let game = new Chess();
let playerColor = 'w'; // White by default
let aiColor = 'b';
let selectedSquare = null;
let boardFlipped = false;
let audioContext = null;

// Settings (toggled via checkboxes/sidebar)
let showThreats = true;
let showMoveQuality = true;
let aiLevel = 3;

// Metrics track
let totalPositionsCount = 0;
let lastMoveTimeMs = 0;

// Initialize Audio Context on first interaction
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Sound Synthesis using Web Audio API
function playSound(type) {
    try {
        initAudio();
        const now = audioContext.currentTime;
        
        if (type === 'move') {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(320, now);
            osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start();
            osc.stop(now + 0.08);
        } else if (type === 'capture') {
            const bufferSize = audioContext.sampleRate * 0.08;
            const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = audioContext.createBufferSource();
            noise.buffer = buffer;
            const filter = audioContext.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 800;
            const gain = audioContext.createGain();
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(audioContext.destination);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            noise.start();
        } else if (type === 'check') {
            const osc1 = audioContext.createOscillator();
            const osc2 = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioContext.destination);
            osc1.type = 'sine';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(587.33, now); // D5
            osc2.frequency.setValueAtTime(698.46, now); // F5
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc1.start();
            osc2.start();
            osc1.stop(now + 0.22);
            osc2.stop(now + 0.22);
        } else if (type === 'win') {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(261.63, now); // C4
            osc.frequency.setValueAtTime(329.63, now + 0.15); // E4
            osc.frequency.setValueAtTime(392.00, now + 0.3); // G4
            osc.frequency.setValueAtTime(523.25, now + 0.45); // C5
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
            osc.start();
            osc.stop(now + 0.85);
        } else if (type === 'lose') {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220.00, now); // A3
            osc.frequency.setValueAtTime(196.00, now + 0.2); // G3
            osc.frequency.setValueAtTime(174.61, now + 0.4); // F3
            osc.frequency.setValueAtTime(130.81, now + 0.6); // C3
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
            osc.start();
            osc.stop(now + 0.95);
        }
    } catch (e) {
        console.error("Audio playback error:", e);
    }
}

// Clean Wikipedia chess piece SVGs styled dynamically
const PIECE_SVGS = {
    // Pawn
    p: `<svg viewBox="0 0 45 45" width="100%" height="100%"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-.83.62-1.41 1.61-1.41 2.75 0 2.21 1.79 4 4 4h3c2.21 0 4-1.79 4-4 0-1.14-.58-2.13-1.41-2.75 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" class="piece-shape"/></svg>`,
    // Knight
    n: `<svg viewBox="0 0 45 45" width="100%" height="100%"><path d="M 22,10 C 22,10 19,11 16,15 C 13,19 13,23 13,23 C 13,23 14,20 18,20 C 18,20 17,21 15,24 C 13,27 13,30 13,30 C 13,30 14,28 18,28 C 18,28 15,31 16,33 C 17,35 19,35 22,35 C 25,35 27,33 27,30 C 27,27 25,24 22,23 C 25,23 28,21 29,19 C 30,17 31,13 29,11 C 27,9 24,10 22,10 z" class="piece-shape"/></svg>`,
    // Bishop
    b: `<svg viewBox="0 0 45 45" width="100%" height="100%"><path d="M9 36c3.39 0 7.66-.69 11.5-2.33 3.84 1.64 8.11 2.33 11.5 2.33 2 0 3-1 3-2 0-2.06-5.63-8.83-9.5-12.75 1.41-2.34 2.5-5.41 2.5-8.75 0-4.42-3.58-8-8-8s-8 3.58-8 8c0 3.34 1.09 6.41 2.5 8.75C14.63 25.17 9 31.94 9 34c0 1 1 2 3 2zm13.5-30c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5z" class="piece-shape"/></svg>`,
    // Rook
    r: `<svg viewBox="0 0 45 45" width="100%" height="100%"><path d="M9 39h27v-3H9v3zm3-13h21v-4H12v4zm2.5-4l1.5-8h18l1.5 8h-21zm-2.5-8h21v-4H12v4zm1.5-4V7h4v3h3V7h4v3h3V7h4v3h3V7h4v3h1.5v3h-27z" class="piece-shape"/></svg>`,
    // Queen
    q: `<svg viewBox="0 0 45 45" width="100%" height="100%"><path d="M8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm3 22h23v-3H11v3zm1.5-5h20l2.5-11-5.5 3-4-8-4 8-5.5-3 2.5 11zm-1.5-12h23v-2H11v2z" class="piece-shape"/><circle cx="6" cy="12" r="2" class="piece-dot"/><circle cx="12" cy="7" r="2" class="piece-dot"/><circle cx="22.5" cy="5" r="2" class="piece-dot"/><circle cx="33" cy="7" r="2" class="piece-dot"/><circle cx="39" cy="12" r="2" class="piece-dot"/></svg>`,
    // King
    k: `<svg viewBox="0 0 45 45" width="100%" height="100%"><path d="M8.5 36h28v-3h-28v3zm1.5-4h25V18.5L29 23l-6.5-9L16 23l-4-4.5V32zm12.5-23v-5h-3v5h-2v3h2v3h3v-3h2v-3h-2z" class="piece-shape"/></svg>`
};

/**
 * Returns HTML representation of the SVG piece with color classes.
 */
function getPieceSVG(type, color) {
    const rawSVG = PIECE_SVGS[type];
    if (!rawSVG) return '';
    const colorClass = color === 'w' ? 'white-piece' : 'black-piece';
    return rawSVG.replace('<svg', `<svg class="chess-piece-svg ${colorClass}"`);
}

/**
 * Draws/Renders the chessboard squares and pieces based on FEN.
 */
function drawBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';

    const boardState = game.board();
    const lastMove = game.history({ verbose: true }).slice(-1)[0];

    // Attacked/threatened squares detection
    const attackedSquares = {};
    if (showThreats && game.turn() === playerColor) {
        // Find player's pieces that are currently under attack by the opponent
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = boardState[r][c];
                if (piece && piece.color === playerColor) {
                    const sqName = getSquareName(r, c);
                    if (isSquareAttackedByOpponent(sqName)) {
                        attackedSquares[sqName] = true;
                    }
                }
            }
        }
    }

    for (let r = 0; r < 8; r++) {
        const rowIdx = boardFlipped ? 7 - r : r;
        
        for (let c = 0; c < 8; c++) {
            const colIdx = boardFlipped ? 7 - c : c;
            
            const squareName = getSquareName(rowIdx, colIdx);
            const piece = boardState[rowIdx][colIdx];
            
            const square = document.createElement('div');
            square.id = `square-${squareName}`;
            square.dataset.square = squareName;
            
            // Light/Dark square styling
            const isLight = (rowIdx + colIdx) % 2 === 0;
            square.className = `square ${isLight ? 'light' : 'dark'}`;

            // Highlight last move
            if (lastMove && (lastMove.from === squareName || lastMove.to === squareName)) {
                square.classList.add('last-move');
            }

            // Highlight selected square
            if (selectedSquare === squareName) {
                square.classList.add('selected');
            }

            // Highlight threat
            if (attackedSquares[squareName]) {
                square.classList.add('threatened');
            }

            // Highlight check status (red glow on king if in check)
            if (piece && piece.type === 'k' && piece.color === game.turn() && game.in_check()) {
                square.classList.add('threatened');
            }

            // Add piece if exists
            if (piece) {
                square.classList.add('has-piece');
                const pieceDiv = document.createElement('div');
                pieceDiv.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
                pieceDiv.draggable = (piece.color === playerColor && game.turn() === playerColor && !game.game_over());
                pieceDiv.innerHTML = getPieceSVG(piece.type, piece.color);
                
                // Add drag events
                pieceDiv.addEventListener('dragstart', handleDragStart);
                pieceDiv.addEventListener('dragend', handleDragEnd);

                square.appendChild(pieceDiv);
            }

            // Click interaction
            square.addEventListener('click', handleSquareClick);
            
            // Drag and drop events on squares
            square.addEventListener('dragover', handleDragOver);
            square.addEventListener('drop', handleDrop);

            boardElement.appendChild(square);
        }
    }

    updateCapturedPieces();
    updateMoveHistory();
    updateUIStatus();
}

/**
 * Returns FIDE coordinate from row/col index.
 */
function getSquareName(row, col) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return files[col] + ranks[row];
}

/**
 * Check if the opponent has an active attack on a specific square.
 */
function isSquareAttackedByOpponent(square) {
    const temp = new Chess();
    const tokens = game.fen().split(' ');
    // Swap active player color
    tokens[1] = tokens[1] === 'w' ? 'b' : 'w';
    
    try {
        temp.load(tokens.join(' '));
        const opponentMoves = temp.moves({ verbose: true });
        return opponentMoves.some(m => m.to === square);
    } catch(e) {
        return false;
    }
}

// Drag and Drop Controllers
let draggedPiece = null;
let draggedFromSquare = null;

function handleDragStart(e) {
    initAudio(); // Activate context on user gesture
    if (game.turn() !== playerColor || game.game_over()) {
        e.preventDefault();
        return;
    }
    draggedPiece = e.target;
    draggedFromSquare = e.target.parentElement.dataset.square;
    
    setTimeout(() => {
        e.target.classList.add('dragging');
        selectedSquare = draggedFromSquare;
        highlightLegalMoves(draggedFromSquare);
    }, 0);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    removeLegalHighlights();
    selectedSquare = null;
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    const targetSquareName = e.currentTarget.dataset.square;
    if (draggedFromSquare && targetSquareName) {
        executePlayerMove(draggedFromSquare, targetSquareName);
    }
    draggedPiece = null;
    draggedFromSquare = null;
}

// Click to move controller
function handleSquareClick(e) {
    initAudio();
    if (game.turn() !== playerColor || game.game_over()) return;

    const squareName = e.currentTarget.dataset.square;
    const boardState = game.board();
    
    // Find piece at clicked square
    let clickedPiece = null;
    const lastMove = game.history({ verbose: true }).slice(-1)[0];
    
    // Convert square name to indices
    const file = squareName.charCodeAt(0) - 97;
    const rank = 8 - parseInt(squareName[1]);
    const piece = boardState[rank][file];

    // Clear hints
    removeHintHighlight();

    if (selectedSquare) {
        if (selectedSquare === squareName) {
            selectedSquare = null;
            removeLegalHighlights();
            drawBoard();
        } else {
            // Check if it is a valid legal move
            const moves = game.moves({ square: selectedSquare, verbose: true });
            const isLegal = moves.some(m => m.to === squareName);
            
            if (isLegal) {
                executePlayerMove(selectedSquare, squareName);
                selectedSquare = null;
                removeLegalHighlights();
            } else if (piece && piece.color === playerColor) {
                // Change selection to the clicked piece
                selectedSquare = squareName;
                removeLegalHighlights();
                highlightLegalMoves(squareName);
                drawBoard();
            } else {
                selectedSquare = null;
                removeLegalHighlights();
                drawBoard();
            }
        }
    } else {
        if (piece && piece.color === playerColor) {
            selectedSquare = squareName;
            highlightLegalMoves(squareName);
            drawBoard();
        }
    }
}

/**
 * Highlights legal destination squares for the selected piece.
 */
function highlightLegalMoves(fromSquare) {
    removeLegalHighlights();
    const moves = game.moves({ square: fromSquare, verbose: true });
    
    moves.forEach(move => {
        const sqElement = document.getElementById(`square-${move.to}`);
        if (sqElement) {
            const dot = document.createElement('div');
            dot.className = 'legal-dot';
            sqElement.appendChild(dot);
        }
    });
}

function removeLegalHighlights() {
    const dots = document.querySelectorAll('.legal-dot');
    dots.forEach(dot => dot.remove());
}

function removeHintHighlight() {
    const squares = document.querySelectorAll('.square.hint');
    squares.forEach(sq => sq.classList.remove('hint'));
}

/**
 * Handle Pawn Promotion Choice
 */
let promotionPromise = null;
function handlePromotion(from, to) {
    const overlay = document.getElementById('promotion-overlay');
    overlay.classList.add('show');
    
    // Color choice SVGs
    document.getElementById('promo-q').innerHTML = getPieceSVG('q', playerColor);
    document.getElementById('promo-r').innerHTML = getPieceSVG('r', playerColor);
    document.getElementById('promo-b').innerHTML = getPieceSVG('b', playerColor);
    document.getElementById('promo-n').innerHTML = getPieceSVG('n', playerColor);

    return new Promise((resolve) => {
        promotionPromise = resolve;
    });
}

function selectPromotionPiece(pieceCode) {
    const overlay = document.getElementById('promotion-overlay');
    overlay.classList.remove('show');
    if (promotionPromise) {
        promotionPromise(pieceCode);
        promotionPromise = null;
    }
}

/**
 * Execute player's move.
 */
async function executePlayerMove(from, to) {
    // Check if move is promotion
    const moves = game.moves({ square: from, verbose: true });
    const moveInfo = moves.find(m => m.from === from && m.to === to);
    
    if (!moveInfo) return;

    let promotionPiece = undefined;
    if (moveInfo.flags.includes('p')) { // 'p' stands for promotion flag in chess.js
        promotionPiece = await handlePromotion(from, to);
    }

    const beforeEval = ChessEngine.getEvaluation(game);

    const move = game.move({
        from: from,
        to: to,
        promotion: promotionPiece
    });

    if (move) {
        const afterEval = ChessEngine.getEvaluation(game);
        
        // Evaluate user move quality
        // If White: score change = afterEval - beforeEval
        // If Black: score change = beforeEval - afterEval
        const scoreChange = (playerColor === 'w') ? (afterEval - beforeEval) : (beforeEval - afterEval);
        
        drawBoard();
        
        // Sound check
        if (move.captured) {
            playSound('capture');
        } else {
            playSound('move');
        }

        // Apply visual cues for move quality
        if (showMoveQuality) {
            applyMoveQualityHighlights(from, to, scoreChange);
        }

        // Trigger AI response after a brief pause
        if (!game.game_over()) {
            setTimeout(executeAIMove, 400);
        } else {
            handleGameOver();
        }
    }
}

/**
 * Visual indicators showing the quality of the move.
 */
function applyMoveQualityHighlights(from, to, scoreChange) {
    // Clean old classifications
    const oldMarks = document.querySelectorAll('.good-move, .blunder-move');
    oldMarks.forEach(sq => {
        sq.classList.remove('good-move', 'blunder-move');
    });

    const fromSq = document.getElementById(`square-${from}`);
    const toSq = document.getElementById(`square-${to}`);

    if (scoreChange < -2.0) { // Lost 2+ pawns value: Blunder
        toSq.classList.add('blunder-move');
    } else if (scoreChange >= -0.15) { // Best/Good move
        toSq.classList.add('good-move');
    }
}

/**
 * Execute AI Engine move.
 */
function executeAIMove() {
    updateEngineThinkingStatus(true);
    
    // Use setTimeout to allow UI thread to breathe and show "thinking" badge
    setTimeout(() => {
        const aiResult = ChessEngine.findBestMove(game, aiLevel, aiColor);
        updateEngineThinkingStatus(false);

        if (aiResult) {
            const move = game.move(aiResult.move);
            
            // Record performance metrics
            lastMoveTimeMs = aiResult.timeSpentMs;
            totalPositionsCount = aiResult.positionsCount;
            
            drawBoard();

            // Web Audio sound trigger
            if (game.in_check()) {
                playSound('check');
            } else if (move.captured) {
                playSound('capture');
            } else {
                playSound('move');
            }

            updateEvaluationBar(aiResult.evaluation);

            if (game.game_over()) {
                handleGameOver();
            }
        }
    }, 100);
}

/**
 * Show "thinking..." badge in controls
 */
function updateEngineThinkingStatus(isThinking) {
    const badge = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    
    if (isThinking) {
        badge.style.boxShadow = '0 0 10px #f59e0b';
        badge.style.background = '#f59e0b';
        text.innerText = 'Engine Thinking...';
    } else {
        badge.style.boxShadow = '0 0 8px #10b981';
        badge.style.background = '#10b981';
        text.innerText = 'Ready';
    }
}

/**
 * Sync evaluation bar height and text display.
 */
function updateEvaluationBar(score) {
    // Limit evaluation score in bar representation
    let clampedScore = Math.max(-6.0, Math.min(6.0, score));
    
    // Convert to percentage of white
    // +6 => 95% (white dominant)
    // 0 => 50%
    // -6 => 5% (black dominant)
    let percentage = 50 + (clampedScore / 6.0) * 45;
    
    const barWhite = document.getElementById('eval-white');
    const scoreText = document.getElementById('eval-text');
    
    // Adjust height for White (bottom side)
    // If board is flipped, we want the bar layout inverted
    if (boardFlipped) {
        barWhite.style.height = `${percentage}%`;
    } else {
        // Standard view (White bottom)
        barWhite.style.height = `${percentage}%`;
    }
    
    // Round score text
    const absVal = Math.abs(score).toFixed(1);
    let scoreDisplay = score === 0 ? '0.0' : (score > 0 ? `+${absVal}` : `-${absVal}`);
    
    // Checkmate display
    if (Math.abs(score) > 9000) {
        scoreDisplay = score > 0 ? 'M' : '-M';
    }
    
    scoreText.innerText = scoreDisplay;
}

/**
 * Handle game over states (Draw, win, lose check).
 */
function handleGameOver() {
    const overlay = document.getElementById('gameover-overlay');
    const title = document.getElementById('gameover-title');
    const desc = document.getElementById('gameover-desc');
    
    overlay.classList.add('show');
    
    if (game.in_checkmate()) {
        const loser = game.turn();
        if (loser === playerColor) {
            title.innerText = 'Game Over';
            title.className = 'gameover-title';
            desc.innerText = 'The chess engine has defeated you. Keep practicing to improve!';
            playSound('lose');
        } else {
            title.innerText = 'Victory!';
            title.className = 'gameover-title win';
            desc.innerText = 'Congratulations! You defeated the chess engine!';
            playSound('win');
        }
    } else if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
        title.innerText = 'Draw!';
        title.className = 'gameover-title draw';
        
        let reason = 'Draw by stalemate or repetition.';
        if (game.in_stalemate()) reason = 'Stalemate! No legal moves available.';
        else if (game.in_threefold_repetition()) reason = 'Draw by threefold repetition.';
        
        desc.innerText = reason;
        playSound('check');
    }
}

function restartGame() {
    game = new Chess();
    selectedSquare = null;
    removeLegalHighlights();
    removeHintHighlight();
    
    // Hide game over overlays
    document.getElementById('gameover-overlay').classList.remove('show');
    document.getElementById('promotion-overlay').classList.remove('show');
    
    // Redraw
    drawBoard();
    updateEvaluationBar(0.0);
    
    // If AI is white, trigger first move
    if (playerColor === 'b') {
        setTimeout(executeAIMove, 200);
    }
}

/**
 * Undo last move. Under FIDE AI rules, undoing returns the game before the player's last move,
 * which means undoing BOTH the AI's last move and the Player's last move.
 */
function undoMove() {
    if (game.game_over()) return;
    
    removeHintHighlight();
    removeLegalHighlights();
    
    // Undo opponent's move, then player's move
    if (game.turn() === playerColor) {
        // Opponent had just moved, player wants to undo both
        game.undo();
        game.undo();
    } else {
        // Player has moved, AI is thinking or just completed
        game.undo();
    }
    
    drawBoard();
    
    // Re-evaluate
    const currentEval = ChessEngine.getEvaluation(game);
    updateEvaluationBar(currentEval);
}

/**
 * Highlight engine recommended move.
 */
function getHint() {
    if (game.turn() !== playerColor || game.game_over()) return;
    
    // Temporarily trigger search at higher depth (Advanced level)
    const hintResult = ChessEngine.findBestMove(game, 4, playerColor);
    
    if (hintResult && hintResult.move) {
        removeHintHighlight();
        
        const fromSq = document.getElementById(`square-${hintResult.move.from}`);
        const toSq = document.getElementById(`square-${hintResult.move.to}`);
        
        if (fromSq && toSq) {
            fromSq.classList.add('hint');
            toSq.classList.add('hint');
        }
    }
}

/**
 * Toggles board visual layout.
 */
function flipBoard() {
    boardFlipped = !boardFlipped;
    
    // Redraw board with new layout order
    drawBoard();
}

/**
 * Capture state calculator (calculates and draws captured pieces and material score diff).
 */
function updateCapturedPieces() {
    const boardState = game.board();
    const whiteCaptured = { p:0, n:0, b:0, r:0, q:0 };
    const blackCaptured = { p:0, n:0, b:0, r:0, q:0 };
    
    // Starting piece counts
    const startCounts = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    
    // Current piece counts on board
    const currentCounts = {
        w: { p:0, n:0, b:0, r:0, q:0 },
        b: { p:0, n:0, b:0, r:0, q:0 }
    };
    
    for (let r=0; r<8; r++) {
        for (let c=0; c<8; c++) {
            const piece = boardState[r][c];
            if (piece && piece.type !== 'k') {
                currentCounts[piece.color][piece.type]++;
            }
        }
    }
    
    // Compute captured values
    // White pieces captured by Black
    let wScore = 0;
    let bScore = 0;
    
    const valueMap = { p:1, n:3, b:3, r:5, q:9 };
    
    for (let key in startCounts) {
        const wCapCount = startCounts[key] - currentCounts.w[key];
        whiteCaptured[key] = wCapCount;
        bScore += wCapCount * valueMap[key]; // Black gets points for captured White pieces
        
        const bCapCount = startCounts[key] - currentCounts.b[key];
        blackCaptured[key] = bCapCount;
        wScore += bCapCount * valueMap[key]; // White gets points for captured Black pieces
    }
    
    const wCapContainer = document.getElementById('white-captured-pieces');
    const bCapContainer = document.getElementById('black-captured-pieces');
    const wDiffLabel = document.getElementById('white-diff');
    const bDiffLabel = document.getElementById('black-diff');
    
    wCapContainer.innerHTML = '';
    bCapContainer.innerHTML = '';
    
    // Add captured pieces SVG symbols
    // White pieces captured (shown in Black's captured section)
    for (let key in whiteCaptured) {
        for (let i=0; i < whiteCaptured[key]; i++) {
            wCapContainer.innerHTML += getPieceSVG(key, 'w');
        }
    }
    
    // Black pieces captured (shown in White's captured section)
    for (let key in blackCaptured) {
        for (let i=0; i < blackCaptured[key]; i++) {
            bCapContainer.innerHTML += getPieceSVG(key, 'b');
        }
    }
    
    // Draw scores comparison
    if (wScore > bScore) {
        wDiffLabel.innerText = `+${wScore - bScore}`;
        bDiffLabel.innerText = '';
    } else if (bScore > wScore) {
        bDiffLabel.innerText = `+${bScore - wScore}`;
        wDiffLabel.innerText = '';
    } else {
        wDiffLabel.innerText = '';
        bDiffLabel.innerText = '';
    }
}

/**
 * Updates the moves history scroll panel.
 */
function updateMoveHistory() {
    const history = game.history();
    const historyElement = document.getElementById('move-history');
    historyElement.innerHTML = '';
    
    let html = '';
    for (let i = 0; i < history.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const whiteMove = history[i];
        const blackMove = history[i + 1] || '';
        
        html += `
            <div class="move-row">
                <span class="move-num">${moveNum}.</span>
                <span class="move-text">${whiteMove}</span>
                <span class="move-text">${blackMove}</span>
            </div>
        `;
    }
    historyElement.innerHTML = html;
    historyElement.scrollTop = historyElement.scrollHeight;
}

/**
 * Sync board indicators with current active game state.
 */
function updateUIStatus() {
    const textStatus = document.getElementById('game-status-text');
    const positionsLabel = document.getElementById('metric-nodes');
    const speedLabel = document.getElementById('metric-speed');
    
    if (game.game_over()) {
        textStatus.innerText = 'Game Over';
    } else {
        const turn = game.turn() === 'w' ? 'White' : 'Black';
        textStatus.innerText = `${turn}'s Turn`;
    }
    
    // Display metrics
    positionsLabel.innerText = totalPositionsCount.toLocaleString();
    speedLabel.innerText = `${lastMoveTimeMs.toFixed(0)}ms`;
}

// Set up UI Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Restart button
    document.getElementById('btn-restart').addEventListener('click', restartGame);
    document.getElementById('btn-overlay-restart').addEventListener('click', restartGame);
    
    // Undo button
    document.getElementById('btn-undo').addEventListener('click', undoMove);
    
    // Hint button
    document.getElementById('btn-hint').addEventListener('click', getHint);
    
    // Flip board button
    document.getElementById('btn-flip').addEventListener('click', flipBoard);
    
    // Toggles for coaching options
    const threatToggle = document.getElementById('toggle-threats');
    threatToggle.checked = showThreats;
    threatToggle.addEventListener('change', (e) => {
        showThreats = e.target.checked;
        drawBoard();
    });
    
    const qualityToggle = document.getElementById('toggle-quality');
    qualityToggle.checked = showMoveQuality;
    qualityToggle.addEventListener('change', (e) => {
        showMoveQuality = e.target.checked;
        if (!showMoveQuality) {
            // Clean active quality marks
            document.querySelectorAll('.good-move, .blunder-move').forEach(sq => {
                sq.classList.remove('good-move', 'blunder-move');
            });
        } else {
            drawBoard();
        }
    });
    
    // Color picking trigger buttons
    const btnPlayWhite = document.getElementById('picker-white');
    const btnPlayBlack = document.getElementById('picker-black');
    
    btnPlayWhite.addEventListener('click', () => {
        if (playerColor === 'w') return;
        playerColor = 'w';
        aiColor = 'b';
        btnPlayWhite.classList.add('active');
        btnPlayBlack.classList.remove('active');
        boardFlipped = false;
        restartGame();
    });
    
    btnPlayBlack.addEventListener('click', () => {
        if (playerColor === 'b') return;
        playerColor = 'b';
        aiColor = 'w';
        btnPlayBlack.classList.add('active');
        btnPlayWhite.classList.remove('active');
        boardFlipped = true;
        restartGame();
    });

    // Difficulty slider listener
    const slider = document.getElementById('ai-difficulty');
    const difficultyLabel = document.getElementById('difficulty-label');
    const difficultyDesc = document.getElementById('difficulty-desc');
    
    const descriptions = {
        1: "Beginner - Depth 1 AI. Makes frequent tactical errors.",
        2: "Casual - Depth 2 AI. Plays basic moves, overlooks traps.",
        3: "Intermediate - Depth 3 AI. Searches deeper, solid tactician.",
        4: "Advanced - Depth 4 AI. Aggressive evaluations, hard to beat."
    };
    
    slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        aiLevel = val;
        
        const labels = ['Beginner', 'Casual', 'Intermediate', 'Advanced'];
        difficultyLabel.innerText = labels[val - 1];
        difficultyDesc.innerText = descriptions[val];
    });

    // Promotion choices event hooks
    document.getElementById('promo-q').addEventListener('click', () => selectPromotionPiece('q'));
    document.getElementById('promo-r').addEventListener('click', () => selectPromotionPiece('r'));
    document.getElementById('promo-b').addEventListener('click', () => selectPromotionPiece('b'));
    document.getElementById('promo-n').addEventListener('click', () => selectPromotionPiece('n'));

    // Enable touch gestures for mobile screens
    setupTouchControls();

    // Start board state
    drawBoard();
});

/**
 * Mobile-friendly touch drag support.
 */
function setupTouchControls() {
    let touchStartSquare = null;
    
    document.getElementById('board').addEventListener('touchstart', (e) => {
        initAudio();
        if (game.turn() !== playerColor || game.game_over()) return;
        
        const target = e.target.closest('.piece');
        if (!target) return;
        
        const sqElement = target.parentElement;
        touchStartSquare = sqElement.dataset.square;
        
        selectedSquare = touchStartSquare;
        removeLegalHighlights();
        highlightLegalMoves(touchStartSquare);
        
        // Visual indicator on touch start
        target.classList.add('dragging');
    }, { passive: true });
    
    document.getElementById('board').addEventListener('touchend', (e) => {
        const targetElement = document.elementFromPoint(
            e.changedTouches[0].clientX,
            e.changedTouches[0].clientY
        );
        
        const sqElement = targetElement ? targetElement.closest('.square') : null;
        const targetSquareName = sqElement ? sqElement.dataset.square : null;
        
        const draggedElement = document.querySelector('.piece.dragging');
        if (draggedElement) draggedElement.classList.remove('dragging');
        
        if (touchStartSquare && targetSquareName && touchStartSquare !== targetSquareName) {
            executePlayerMove(touchStartSquare, targetSquareName);
            selectedSquare = null;
            removeLegalHighlights();
        }
        
        touchStartSquare = null;
    }, { passive: true });
}
