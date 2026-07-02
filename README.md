# ♟️ Mini Chess Engine

A full-stack Chess Web Application featuring a custom-built AI engine based on **Minimax with Alpha-Beta pruning**. The app is divided into a robust **FastAPI backend** (Python) and a modern **React frontend** (TypeScript + Vite).

---

## 🚀 Key Features

*   **Custom AI Opponent**: Uses a Minimax algorithm optimized with Alpha-Beta pruning and MVV-LVA move ordering.
*   **Human-like Play Style**: Simulates human inconsistency by adding slight evaluation noise (~800 - 1200 ELO range).
*   **Responsive Web UI**: Built using React, Tailwind (if styling is applied) / custom CSS, and `react-chessboard`.
*   **Asynchronous Move Computing**: Offloads CPU-bound minimax computations to a Python thread pool to prevent blocking other active games.
*   **Smart In-Memory Game Cache**: Implements an automatic `TTLCache` (with 2-hour inactivity expiration) to prevent memory leaks and handle up to 1000 concurrent matches.

---

## 📁 Project Structure

```
├── backend/
│   ├── ai_engine.py       # Minimax search & position evaluation logic (PSTs)
│   ├── main.py            # FastAPI endpoints & session/cache management
│   ├── requirements.txt   # Backend dependencies
│   └── test_ai_engine.py  # Unit tests for the AI move selection
│
├── frontend/
│   ├── src/               # React TypeScript code (App, Chessboard components)
│   ├── package.json       # Frontend dependencies & run scripts
│   ├── vite.config.ts     # Vite configuration
│   └── tsconfig.json      # TypeScript configuration
│
└── README.md              # Project documentation
```

---

## 🛠️ Tech Stack

*   **Backend**: Python, [FastAPI](https://fastapi.tiangolo.com/), [python-chess](https://python-chess.readthedocs.io/), `cachetools`, `uvicorn`.
*   **Frontend**: React (v19), TypeScript, Vite, [react-chessboard](https://github.com/ClariSora/react-chessboard), [chess.js](https://github.com/jhlywa/chess.js).

---

## 💻 Local Installation & Setup

### 1. Prerequisites
*   [Python 3.10+](https://www.python.org/)
*   [Node.js (v18+)](https://nodejs.org/)

### 2. Backend Setup
Navigate to the `backend` folder, set up a virtual environment, and install dependencies:
```bash
# Go to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

Run the backend server:
```bash
python main.py
```
The backend API will start running at `http://localhost:8000`. You can access the interactive API docs at `http://localhost:8000/docs`.

### 3. Frontend Setup
Navigate to the `frontend` folder, install Node packages, and run the development server:
```bash
# Go to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```
The frontend will start running (usually at `http://localhost:5173`).

---

## 🧠 AI Engine Architecture

The AI is implemented inside `backend/ai_engine.py`:

1.  **Minimax Algorithm**: A decision-making algorithm that searches the game tree to a target depth of 2 (or 3 when the number of legal moves is small).
2.  **Alpha-Beta Pruning**: Significantly reduces the number of evaluated nodes by skipping branches that cannot influence the final decision.
3.  **Move Ordering (MVV-LVA)**: Prioritizes captures (Most Valuable Victim - Least Valuable Attacker), checks, and pawn promotions first. This makes alpha-beta pruning far more efficient.
4.  **Positional Evaluation**: Combines material values with custom **Piece-Square Tables (PST)** to encourage piece development, central control, and king safety.
5.  **Noise Injection**: Adds dynamic random variation to move scores, making games feel natural, beatable, and varied.
