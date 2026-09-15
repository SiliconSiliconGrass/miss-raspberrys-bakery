"""Fit the pieces of one level into the picture the demands describe.

Two steps, both as 0-1 integer programs:

    1. `solve_shape()` looks for a picture (a 0/1 matrix) whose row sums and
       column sums are the demands of the level,
    2. every piece is then put into that picture exactly once, every filled
       pixel covered exactly once and every empty pixel covered not at all.

The result is a list of `(piece_index, rotation_index, x, y)` tuples, which
`solution.py` turns into actions the game understands.
"""

import numpy as np
from scipy import signal
from typing import TypeVar, Literal, Union

from solve_shape import iter_shapes, solve_with_pulp

Piece = TypeVar("Piece", bound=Union[np.ndarray, list[list[Literal[0, 1]]]])

def get_piece_rotations(piece: Piece) -> list[np.ndarray]:
    piece = np.array(piece, dtype=np.uint8)
    rotations = [
        piece,
        np.rot90(piece, k=1), # 逆时针旋转90度
        np.rot90(piece, k=2), # 旋转180度
        np.rot90(piece, k=3) # 顺时针旋转90度
    ]
    return rotations

def get_piece_possible_positions(map: np.ndarray,
                                 piece: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    piece_area = np.sum(piece)
    conv: np.ndarray = signal.correlate2d(map, piece, mode='valid')
    possible_indices: np.ndarray = np.where(conv == piece_area)
    return possible_indices


def solve(column_sums: list[int],
          row_sums: list[int],
          pieces: list[Piece],
          fixed_ones: list[tuple[int, int]]=[],
          fixed_zeros: list[tuple[int, int]]=[],
          max_shapes: int=100,
          max_solutions_per_shape: int=10,
          max_solutions: int | None=1) -> list[list[tuple[int, int, int, int]]]:
    """找出一套摆放方案。

    `column_sums` / `row_sums` 是每一列 / 每一行要求的块数，`fixed_ones` 是开局
    就已经放好的格子（不用拼图覆盖），`fixed_zeros` 是必须空着的格子。

    返回解的列表，每个解是一串 `(piece_index, rotation_index, x, y)`：
    `rotation_index` 是 `np.rot90` 的逆时针 90° 次数，`x` / `y` 是这一块旋转后
    外框左上角所在的列 / 行。

    三个上限只影响搜索的多少：`max_shapes` 是最多看多少个形状候选，
    `max_solutions_per_shape` 是每个形状找几个解，`max_solutions` 是拿到这么多个
    解就收工（默认一个就停，`None` 表示全部找完，比较慢）。

    形状是**边找边用**的：某个形状一旦能拼成，后面的候选形状就不会再算了，
    所以默认情况下多做不了多少无用功。
    """

    possible_shapes = iter_shapes(column_sums, row_sums, fixed_ones, fixed_zeros,
                                  max_solutions=max_shapes)

    formatted_solutions: list[list[tuple[int, int, int, int]]] = []

    for shape in possible_shapes:

        for x, y in fixed_ones + fixed_zeros:
            shape[y][x] = 0

        height = shape.shape[0]
        width = shape.shape[1]

        constraints = []
        # (piece_index, rotation_index, x, y)[]
        piece_methods: list[tuple[int, int, int, int]] = []
        pixel_method_map: list[list[list[int]]] = [[[] for _ in range(width)] for _ in range(height)]

        for piece_index, piece in enumerate(pieces):
            rotations = get_piece_rotations(piece)

            curr_piece_method_indices = []

            for rotation_index, piece_rotation in enumerate(rotations):
                possible_positions = get_piece_possible_positions(shape, piece_rotation)
                for y, x in zip(*possible_positions):
                    x = int(x)
                    y = int(y)
                    curr_method_index = len(piece_methods)
                    curr_piece_method_indices.append(curr_method_index)
                    piece_methods.append((piece_index, rotation_index, x, y))
            
                    # 记录每个像素被哪些method占用
                    for y0, x0 in zip(*np.where(piece_rotation > 0)):
                        x0 = int(x0)
                        y0 = int(y0)
                        pixel_method_map[y + y0][x + x0].append(curr_method_index)

            # 约束：每块拼图必须使用且仅用一次
            constraints.append((curr_piece_method_indices, 1))

        # 约束：每个有色像素必须被覆盖且只被覆盖一次
        for y, x in zip(*np.where(shape > 0)):
            x = int(x)
            y = int(y)
            constraints.append((pixel_method_map[y][x], 1))
        # 约束：每个无色像素必须不被覆盖
        for y, x in zip(*np.where(shape == 0)):
            x = int(x)
            y = int(y)
            constraints.append((pixel_method_map[y][x], 0))
        
        raw_solutions = solve_with_pulp(len(piece_methods), constraints,
                                        max_solutions=max_solutions_per_shape)

        # 格式化输出
        for solution in raw_solutions:
            method_indices = np.where(np.array(solution) > 0)[0]
            formatted_solution = [piece_methods[int(method_index)]
                                  for method_index in method_indices]
            formatted_solutions.append(formatted_solution)

            map = np.zeros((height, width), dtype=np.int64)
            for (piece_index, rotation_index, x, y) in formatted_solution:
                rotated_piece = get_piece_rotations(pieces[piece_index])[rotation_index]
                for y0, x0 in zip(*np.where(rotated_piece > 0)):
                    x0 = int(x0)
                    y0 = int(y0)
                    map[y+y0][x+x0] = piece_index + 1
            print(map)
            print()

        if max_solutions is not None and len(formatted_solutions) >= max_solutions:
            break

    return formatted_solutions
