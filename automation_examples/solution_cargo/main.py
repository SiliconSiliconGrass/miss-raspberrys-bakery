#!/usr/bin/env python
"""Automation test program: play every level, one after another, forever.

The game is the WebSocket client, so this script is the server. For each level:

    1. take the state the game pushed (hello / level.started), or ask for it
       with "states" when the actions are still running,
    2. ask solution.py which actions to play, send them with "actions" and wait
       until the buffer is empty (the game executes one action per second),
    3. "submit", then wait for the next "level.started" and start over.

Which actions get played is decided in solution.py, not here.

Nothing here treats an error answer from the game as fatal: a refused action, a
refused submit or a level the solver cannot handle is printed and then the run
carries on with the next level. Only a lost connection ends a session, and then
the game reconnects by itself.

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


def format_demands(state: dict) -> str:
    """The demand of every row and of every column, one line each.

    A row demand of ``[1, 2]`` asks for one block of type 1 and two of type 2.
    """
    lines = []
    for name, demands in (("row", state["rowDemands"]), ("col", state["colDemands"])):
        rendered = " | ".join(" ".join(str(count) for count in entry) for entry in demands)
        lines.append(f"    {name} demands: {rendered}")
    return "\n".join(lines)


def format_fixed(state: dict) -> str:
    """The cells which are taken before the player starts."""
    cells = []
    for cell in state["fixed"]:
        if cell["typeId"] < 0:
            cells.append(f"(row {cell['row']}, col {cell['col']}) void")
        else:
            cells.append(f"(row {cell['row']}, col {cell['col']}) type {cell['typeId']}")
    return "    " + (", ".join(cells) if cells else "none")


def format_pieces(state: dict) -> str:
    """Every piece with the blocks it is made of, and where it lies right now."""
    lines = []
    for piece in state["pieces"]:
        placement = piece["placement"]
        if placement is None:
            where = "in the piece bar"
        else:
            unstable = " (unstable)" if piece["unstable"] else ""
            where = (
                f"row {placement['row']}, col {placement['col']}, "
                f"rotation {placement['rotation']}{unstable}"
            )
        lines.append(
            f"    piece {piece['ind']}: type {piece['typeId']}, "
            f"{piece['width']}x{piece['height']}, {where}"
        )
        for shape_row in piece["shape"]:
            lines.append("        " + "".join("#" if cell else "." for cell in shape_row))
    return "\n".join(lines)


def format_metrics(state: dict) -> str:
    metrics = state["metrics"]
    return (
        f"satisfaction {metrics['satisfaction']:.2f}, "
        f"expected score {metrics['expectedScore']:.2f}, "
        f"total score {metrics['totalScore']:.2f}"
    )


class Game:
    """Sends a command and returns the answer to it, printing every frame.

    Nothing in here raises because the game answered with an error: a player
    program which dies on `invalid_action` or `game_busy` would be useless, so
    every refusal is printed and the run carries on.
    """

    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self._next_id = 1

    def recv(self, timeout: float | None = 30.0) -> dict | None:
        """Read one frame, or None when the game does not answer in time."""
        try:
            message = json.loads(self.ws.recv(timeout=timeout))
        except TimeoutError:
            print("  (the game did not answer in time, carrying on)", flush=True)
            return None
        log_frame("<-", message)
        return message

    def command(self, type_: str, payload: Any = None) -> dict | None:
        """Send a command and return the answer to it, None when there is none."""
        message = {"id": self._next_id, "type": type_, "payload": payload or {}}
        self._next_id += 1
        log_frame("->", message)
        self.ws.send(json.dumps(message))
        while True:
            # events may arrive between a command and its answer; print and skip
            answer = self.recv()
            if answer is None:
                return None
            if answer.get("type") != "event":
                return answer

    def payload_of(self, type_: str, payload: Any = None) -> Any | None:
        """The payload of a successful answer, None when it was refused.

        The refusal is only printed: the game must not be able to stop this
        program by answering with an error.
        """
        answer = self.command(type_, payload)
        if answer is None:
            return None
        if not answer.get("ok"):
            error = json.dumps(answer.get("error"), ensure_ascii=False)
            print(f"  ! {type_} was refused, ignoring it: {error}", flush=True)
            return None
        return answer["payload"]


def wait_for_level_state(game: Game) -> dict:
    """Wait for a hello / level.started event and return the state it carries."""
    while True:
        message = game.recv()
        if message is None:
            continue
        event = message.get("event")
        if event in ("hello", "level.started"):
            print(f"  ({event} carries the new level state)", flush=True)
            return message["payload"]["state"]


def wait_for_actions_done(game: Game) -> dict | None:
    """Poll states until the action buffer is empty, then return the state."""
    while True:
        payload = game.payload_of("states")
        if payload is None:
            time.sleep(1.0)
            continue
        queue = payload["queue"]
        print(f"  .. {format_metrics(payload['state'])}, pending {queue['pending']}", flush=True)
        if queue["pending"] == 0:
            return payload["state"]
        time.sleep(1.0)


def submit(game: Game) -> dict | None:
    """Submit the level, waiting out the 2 s submit limit when needed.

    A refusal is never fatal and never the end of the attempt: the level only
    changes when a submission goes through, so this keeps asking (with a pause,
    so a rate limit is not hammered) until the game takes it.
    """
    while True:
        answer = game.command("submit")
        if answer is None:
            time.sleep(1.0)
            continue
        if answer.get("ok"):
            return answer["payload"]

        error = answer.get("error") or {}
        print(f"  ! submit was refused: {json.dumps(error, ensure_ascii=False)}", flush=True)
        if error.get("code") == "submit_rate_limited":
            retry_ms = (error.get("details") or {}).get("retryAfterMs", 1000)
            print(f"  waiting {retry_ms / 1000:.1f}s for the submit limit", flush=True)
            time.sleep(retry_ms / 1000 + 0.1)
        else:
            time.sleep(1.0)


def solution_or_nothing(state: dict) -> list[dict]:
    """Ask solution.py which actions to play, never letting it end the run."""
    try:
        return solution(state)
    except Exception:  # noqa: BLE001 - show what happened, then play on
        import traceback

        traceback.print_exc()
        print("  ! the solver failed on this level, submitting it as it is", flush=True)
        return []


def session(ws: Any) -> None:
    game = Game(ws)

    print("waiting for the first level ...", flush=True)
    state = wait_for_level_state(game)

    round_index = 0
    while True:
        round_index += 1
        print(
            f"\n=== level {round_index}: {state['numRows']}x{state['numCols']}, "
            f"numTypes={state['numTypes']}, {len(state['pieces'])} piece(s) ===",
            flush=True,
        )
        print("demands:", flush=True)
        print(format_demands(state), flush=True)
        print("fixed:", flush=True)
        print(format_fixed(state), flush=True)
        print("pieces:", flush=True)
        print(format_pieces(state), flush=True)

        actions = solution_or_nothing(state)
        print(f"solution(): {len(actions)} action(s) {json.dumps(actions, ensure_ascii=False)}", flush=True)

        if actions:
            queued = game.payload_of("actions", {"actions": actions})
            if queued is None:
                print("  ! the game did not take the actions, submitting as it is", flush=True)
            else:
                print(f"  queued: {json.dumps(queued, ensure_ascii=False)}", flush=True)
                state = wait_for_actions_done(game) or state
        else:
            print("  solution() returned nothing, submitting as it is", flush=True)

        print("submitting ...", flush=True)
        result = submit(game)
        print(f"  result: {json.dumps(result, ensure_ascii=False)}", flush=True)

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
    parser = argparse.ArgumentParser(description="solve every cargo level and submit it")
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
    print("open http://localhost:5173/game-cargo, the game dials in by itself", flush=True)

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
