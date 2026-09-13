"""How to play one level.

`solution()` is the only function you have to rewrite to make the test program
play properly. Everything else (connecting, pacing the actions, waiting for the
level to change, submitting) lives in main.py.

For now it is a placeholder that always returns the same two taps, which is
enough to watch the UI react.
"""

from __future__ import annotations

from typing import Any
import numpy as np
from solve_mod2 import solve_mod2


def solution(state: dict[str, Any]) -> list[dict[str, int]]:
    """Return the actions to play for the level described by `state`.

    `state` is the ``state`` object carried by a ``states`` answer, a ``hello``
    event or a ``level.started`` event:

        {
          "board":   {"numRows": 4, "numCols": 6, "numTypes": 2,
                      "matrix": [[1, 1, 0, ...], ...]},
          "target":  {"numRows": 4, "numCols": 6, "numTypes": 2,
                      "matrix": [[0, 1, 1, ...], ...]},
          "metrics": {"similarity": 0.5, "expectedScore": 0.05,
                      "totalScore": 0, "isPerfect": False},
          "busy": False,
        }

    Return a list of actions, each ``{"rowInd": int, "colInd": int}`` meaning
    "tap that cell": the cell and its four orthogonal neighbours go +1 modulo
    ``numTypes``. The list may be long - the game buffers it and executes one
    action per second. Returning an empty list is fine and just submits the
    level as it is.

    Right now this ignores `state` and always plays the same two taps.
    """
    board = np.array(state['board']['matrix'])
    target = np.array(state['target']['matrix'])

    zero_target = np.logical_xor(board, target)

    num_rows, num_cols = zero_target.shape
    num_vars = num_rows * num_cols
    def global_var_id(r, c):
        return r * num_cols + c

    equations = []
    for i in range(num_rows):
        for j in range(num_cols):

            neighbors = [
                [i, j],
                [i + 1, j],
                [i - 1, j],
                [i, j + 1],
                [i, j - 1]
            ]
            exist_neighbors = [
                n for n in neighbors
                if (0 <= n[0] < num_rows) and (0<= n[1] < num_cols)
            ]

            equation = ([global_var_id(*n) for n in exist_neighbors], int(zero_target[i][j]))
            equations.append(equation)

    solution, info = solve_mod2(equations, num_vars)
    if solution:
        solution = np.array(solution).astype(int).reshape((num_rows, num_cols))
        coords = np.argwhere(solution == 1)
        actions = [
            {"rowInd": int(c[0]), "colInd": int(c[1])} for c in coords
        ]
        return actions
    else:
        return []



if __name__ == '__main__':
    test_state = {'board': {'matrix': [
                                        [1, 0, 0, 1],
                                        [1, 0, 0, 1],
                                        [0, 1, 0, 0],
                                        [1, 1, 1, 0]
                                        ],
                            'numCols': 4,
                            'numRows': 4,
                            'numTypes': 2},
                    'busy': False,
                    'metrics': {'expectedScore': 0.06,
                                'isPerfect': False,
                                'similarity': 0.56,
                                'totalScore': 0},
                    'started': True,
                    'target': {'matrix': [
                                        [1, 1, 0, 1],
                                        [1, 1, 0, 0],
                                        [1, 1, 1, 1],
                                        [1, 1, 1, 1]],
                                'numCols': 4,
                                'numRows': 4,
                                'numTypes': 2}}
    sol = solution(test_state)
    print(sol)
