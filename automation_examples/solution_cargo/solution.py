"""How to play one level.

`solution()` is the only function you have to rewrite to make the test program
play properly. Everything else (connecting, pacing the actions, waiting for the
level to change, submitting) lives in main.py.

This one reads the level the game reports, hands it to the solver next to it
(see [solve.py](solve.py)) and turns the arrangement it finds into actions.

It clears the board first (`{"kind": "clear"}`), so that the arrangement cannot
land on pieces which are still lying around from an earlier attempt.

It only knows levels with a single kind of block (`numTypes == 1`), which is
what the game deals today: the demands of a row / column are then a single
number, and the solver works with those numbers.
"""

from __future__ import annotations

import traceback
from typing import Any

from solve import solve


# The game runs one action per second, and one action may carry several pieces.
# Keep this on to watch the pieces fly in one by one (and to see the pacing of
# the protocol), switch it off to send the whole arrangement in a single step.
ONE_PIECE_PER_ACTION = True


def solution(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the actions to play for the level described by `state`.

    `state` is the ``state`` object carried by a ``states`` answer, a ``hello``
    event or a ``level.started`` event:

        {
          "started": True,
          "numRows": 8, "numCols": 8, "numTypes": 1,
          # what every row / column asks for: rowDemands[rowInd][typeInd] counts
          # blocks of type (typeInd + 1)
          "rowDemands": [[1], [2], ...],
          "colDemands": [[1], [2], ...],
          # cells which are taken before the player starts; typeId -1 means
          # "nothing may cover this cell"
          "fixed": [{"row": 0, "col": 2, "typeId": -1}, ...],
          # every piece, with the blocks it is made of and where it lies right now
          "pieces": [
            {"ind": 0, "typeId": 1, "shape": [[1, 1], [0, 1]], "width": 2, "height": 2,
             "placement": None, "unstable": False},
            ...
          ],
          "metrics": {"satisfaction": 0.0, "expectedScore": 0.0,
                      "totalScore": 0.0, "isDemandMet": False},
          "busy": False,
        }

    A piece is turned clockwise in quarter turns: ``rotation`` 1 is 90 degrees,
    2 is 180, 3 is 270, and any whole number does (`5` is the same turn as `1`).
    `rotation` may be left out; the piece then keeps the turn it has.

    Return a list of actions, each in one of these two shapes:

        {"kind": "place", "pieceInd": 0, "row": 0, "col": 0, "rotation": 0}
        {"kind": "clear"}

    ``"place"`` puts that piece down with its turned bounding box at (`row`,
    `col`), counted from the top left of the board. One action may also carry
    several pieces at once, which still counts as one step:

        {"kind": "place", "pieces": [{"pieceInd": 0, ...}, {"pieceInd": 1, ...}]}

    ``"clear"`` sends every piece back into the piece bar.

    Pieces which end up on top of something else are still put down, and glow
    red until the next action moves something: they count as ``unstable`` in the
    state, and they do not count towards the demands while they glow. The list
    may be long - the game buffers it and runs one action per second. Returning
    an empty list is fine and just submits the level as it is.
    """
    num_types = state["numTypes"]
    if num_types != 1:
        print(
            f"  ! this solver only knows levels with one kind of block, this one has {num_types}; "
            f"submitting it as it is",
            flush=True,
        )
        return []

    # the demands of a single-type level are one number per row / column
    column_sums = [demands[0] for demands in state["colDemands"]]
    row_sums = [demands[0] for demands in state["rowDemands"]]
    pieces = [piece["shape"] for piece in state["pieces"]]

    # a cell which is already filled is part of the picture and must not be covered by a
    # piece; a void cell must stay empty
    fixed_ones = [(cell["col"], cell["row"]) for cell in state["fixed"] if cell["typeId"] > 0]
    fixed_zeros = [(cell["col"], cell["row"]) for cell in state["fixed"] if cell["typeId"] < 0]

    try:
        # one arrangement is enough for the level, so the search stops at the first one
        solutions = solve(
            column_sums, row_sums, pieces, fixed_ones, fixed_zeros,
            max_solutions=1, max_solutions_per_shape=1,
        )
    except Exception:  # noqa: BLE001 - a level the solver chokes on must not end the run
        traceback.print_exc()
        print("  ! the solver failed on this level, submitting it as it is", flush=True)
        return []

    if not solutions:
        print("  ! the solver found no arrangement, submitting the level as it is", flush=True)
        return []

    print(f"  solver: found an arrangement of {len(solutions[0])} piece(s)", flush=True)
    placements = [placement(state, entry) for entry in solutions[0]]

    # The board may still hold pieces of an earlier attempt, and a fresh arrangement is
    # only correct on an empty board. Clearing it first costs one step and removes every
    # "was this cell already taken?" question.
    clear = {"kind": "clear"}
    if ONE_PIECE_PER_ACTION:
        return [clear] + [{"kind": "place", **entry} for entry in placements]
    return [clear, {"kind": "place", "pieces": placements}]


def placement(state: dict[str, Any], entry: tuple[int, int, int, int]) -> dict[str, int]:
    """One solved `(piece_index, rotation_index, x, y)` as the fields of an action."""
    piece_index, rotation_index, col, row = entry
    return {
        # the solver numbers the pieces the way the state lists them
        "pieceInd": state["pieces"][piece_index]["ind"],
        "row": int(row),
        "col": int(col),
        # the solver counts turns counter-clockwise (`np.rot90`), the game clockwise
        "rotation": int(-rotation_index % 4),
    }
