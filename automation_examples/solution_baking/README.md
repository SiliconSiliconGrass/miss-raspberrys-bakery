# solution_baking

The game is the WebSocket client, this script is the server. For every level it
asks [solution.py](solution.py) which taps to play, sends them, waits for the
buffer to drain and submits.

## Run with uv

    uv run main.py                # listens on ws://localhost:8000
    uv run main.py -p 8321

The first run creates `.venv` and installs `numpy` and `websockets`. The Python
version is pinned by `.python-version`; `uv python install` gets it if it is
missing.

To stay in sync with the lock file (for example in CI):

    uv sync --frozen

Then open `http://localhost:5173/game-baking` in the browser; the page dials in
by itself.
