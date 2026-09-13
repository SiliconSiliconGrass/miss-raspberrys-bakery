#!/usr/bin/env python
"""Automation test program: play every level, one after another, forever.

The game is the WebSocket client, so this script is the server. For each level:

    1. take the state the game pushed (hello / level.started), or ask for it
       with "states" when the actions are still running,
    2. ask solution.py which actions to play, send them with "actions" and wait
       until the buffer is empty (the game executes one action per second),
    3. "submit", then wait for the next "level.started" and start over.

Which actions get played is decided in solution.py, not here.

Usage:
    python main.py                # listens on ws://localhost:8000
    python main.py -p 8321

Every frame is printed: "->" is what this script sends, "<-" what it receives.
By default it listens on both 127.0.0.1 and ::1 and accepts any Origin header
(the WebSocket handshake isn't subject to CORS; the server decides).
"""

from __future__ import annotations

import argparse
import json
import socket
import threading
import time
from contextlib import ExitStack
from typing import Any

from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

from solution import solution


def log_frame(arrow: str, message: dict) -> None:
    """Print one protocol frame so both sides can be compared."""
    text = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
    if len(text) > 400:
        text = text[:400] + f"...(+{len(text) - 400} chars)"
    print(f"  {arrow} {text}", flush=True)


def format_board(matrix: list[list[int]]) -> str:
    return "\n".join("    " + " ".join(str(value) for value in row) for row in matrix)


class Game:
    """Sends a command and returns the answer to it, printing every frame."""

    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self._next_id = 1

    def recv(self, timeout: float | None = 30.0) -> dict:
        message = json.loads(self.ws.recv(timeout=timeout))
        log_frame("<-", message)
        return message

    def command(self, type_: str, payload: Any = None) -> dict:
        message = {"id": self._next_id, "type": type_, "payload": payload or {}}
        self._next_id += 1
        log_frame("->", message)
        self.ws.send(json.dumps(message))
        while True:
            # events may arrive between a command and its answer; print and skip
            answer = self.recv()
            if answer.get("type") != "event":
                return answer

    def command_ok(self, type_: str, payload: Any = None) -> Any:
        """Same as command(), but raise instead of returning an ok=false answer."""
        answer = self.command(type_, payload)
        if not answer.get("ok"):
            raise RuntimeError(f"{type_} failed: {json.dumps(answer.get('error'), ensure_ascii=False)}")
        return answer["payload"]


def wait_for_level_state(game: Game) -> dict:
    """Wait for a hello / level.started event and return the state it carries."""
    while True:
        message = game.recv()
        event = message.get("event")
        if event in ("hello", "level.started"):
            print(f"  ({event} carries the new level state)", flush=True)
            return message["payload"]["state"]


def wait_for_actions_done(game: Game) -> dict:
    """Poll states until the action buffer is empty, then return the state."""
    while True:
        payload = game.command_ok("states")
        queue = payload["queue"]
        print(
            f"  .. similarity {payload['state']['metrics']['similarity']:.2f}, "
            f"pending {queue['pending']}, executed {queue['executed']}",
            flush=True,
        )
        if queue["pending"] == 0:
            return payload["state"]
        time.sleep(1.0)


def submit(game: Game) -> dict:
    """Submit the level, waiting out the 2 s submit limit when needed."""
    while True:
        answer = game.command("submit")
        if answer.get("ok"):
            return answer["payload"]

        error = answer.get("error") or {}
        if error.get("code") != "submit_rate_limited":
            raise RuntimeError(f"submit failed: {json.dumps(error, ensure_ascii=False)}")

        retry_ms = (error.get("details") or {}).get("retryAfterMs", 1000)
        print(f"  submit is rate limited, waiting {retry_ms / 1000:.1f}s", flush=True)
        time.sleep(retry_ms / 1000 + 0.1)


def session(ws: Any) -> None:
    game = Game(ws)

    print("waiting for the first level ...", flush=True)
    state = wait_for_level_state(game)

    round_index = 0
    while True:
        round_index += 1
        board = state["board"]
        print(
            f"\n=== level {round_index}: {board['numRows']}x{board['numCols']}, "
            f"numTypes={board['numTypes']} ===",
            flush=True,
        )
        print("board:", flush=True)
        print(format_board(board["matrix"]), flush=True)
        print("target:", flush=True)
        print(format_board(state["target"]["matrix"]), flush=True)

        actions = solution(state)
        print(f"solution(): {len(actions)} action(s) {json.dumps(actions, ensure_ascii=False)}", flush=True)

        if actions:
            queued = game.command_ok("actions", {"actions": actions})
            print(f"  queued: {json.dumps(queued, ensure_ascii=False)}", flush=True)
            state = wait_for_actions_done(game)
        else:
            print("  solution() returned nothing, submitting as it is", flush=True)

        print("submitting ...", flush=True)
        print(f"  result: {json.dumps(submit(game), ensure_ascii=False)}", flush=True)

        print("waiting for the game to push the next level ...", flush=True)
        state = wait_for_level_state(game)


def log_handshake(connection: Any, request: Any) -> None:
    """Print every HTTP upgrade request so a rejected one is never silent."""
    headers = getattr(request, "headers", {})
    print(
        f"  handshake: path={getattr(request, 'path', '?')} "
        f"host={headers.get('Host')} origin={headers.get('Origin')}",
        flush=True,
    )
    return None


def create_listeners(port: int, host: str | None) -> list[socket.socket]:
    """Listen on both loopback families so "localhost" always resolves to us."""
    if host is not None:
        return [socket.create_server((host, port))]

    listeners: list[socket.socket] = []
    for family, address in (
        (socket.AF_INET, ("127.0.0.1", port)),
        (socket.AF_INET6, ("::1", port)),
    ):
        try:
            listeners.append(socket.create_server(address, family=family))
        except OSError as error:
            print(f"  note: cannot listen on {address[0]}:{port} ({error})", flush=True)
    if not listeners:
        raise SystemExit(f"nothing to listen on, port {port} is unusable")
    return listeners


def format_address(sock: socket.socket) -> str:
    """``host:port`` with brackets around IPv6 literals."""
    host, port = sock.getsockname()[:2]
    return f"[{host}]:{port}" if ":" in host else f"{host}:{port}"


def main() -> None:
    parser = argparse.ArgumentParser(description="tap (0,0), tap (0,1), submit")
    parser.add_argument("-p", "--port", type=int, default=8000, help="default: 8000")
    parser.add_argument(
        "--host",
        default=None,
        help="bind only this address instead of both 127.0.0.1 and ::1",
    )
    args = parser.parse_args()

    busy = threading.Lock()
    listeners = create_listeners(args.port, args.host)
    print("listening on " + ", ".join(f"ws://{format_address(sock)}" for sock in listeners), flush=True)
    print("open http://localhost:5173/game-baking, the game dials in by itself", flush=True)

    def handler(ws: Any) -> None:
        print(f"\nconnection from {getattr(ws, 'remote_address', None)}", flush=True)
        if not busy.acquire(blocking=False):
            print("  !!! another page is already connected, this one gets no commands", flush=True)
            return
        try:
            session(ws)
        except ConnectionClosed as error:
            print(f"the game disconnected: {error}", flush=True)
            print("  (code 1001 = the page went away, e.g. it was reloaded)", flush=True)
        except Exception:  # noqa: BLE001 - show whatever went wrong
            import traceback

            traceback.print_exc()
        finally:
            busy.release()

    with ExitStack() as stack:
        servers = [
            stack.enter_context(serve(handler, sock=sock, process_request=log_handshake))
            for sock in listeners
        ]
        for server in servers[1:]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        servers[0].serve_forever()


if __name__ == "__main__":
    main()
