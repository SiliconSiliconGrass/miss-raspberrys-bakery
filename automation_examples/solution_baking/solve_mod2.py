def solve_mod2(equations, N):
    """
    Solve a system of linear equations mod 2.
    equations: list of (vars_idx, b)
    Returns: (solution, info)
      solution: list of 0/1 of length N (free vars set to 0)
      info: dict with 'rank', 'free_vars', 'unique'
    """
    # Build augmented matrix rows (each row is a list of N+1 ints)
    rows = []
    for vars_idx, b in equations:
        row = [0] * (N + 1)
        for i in vars_idx:
            row[i] ^= 1
        row[N] = b % 2
        rows.append(row)

    m = len(rows)

    # Gauss-Jordan elimination to reduced row echelon form (RREF) over GF(2)
    r = 0  # current row
    pivots = {}  # col -> row
    for col in range(N):
        # Find pivot
        pivot_row = None
        for rr in range(r, m):
            if rows[rr][col] == 1:
                pivot_row = rr
                break
        if pivot_row is None:
            continue
        rows[r], rows[pivot_row] = rows[pivot_row], rows[r]
        pivots[col] = r
        # Eliminate this column from ALL other rows (RREF)
        for rr in range(m):
            if rr != r and rows[rr][col] == 1:
                for c in range(N + 1):
                    rows[rr][c] ^= rows[r][c]
        r += 1

    rank = r

    # Check for contradiction: a row with all zeros in A but b=1
    for rr in range(r, m):
        if rows[rr][N] == 1 and all(rows[rr][c] == 0 for c in range(N)):
            return None, {"rank": rank, "unique": False, "reason": "inconsistent"}

    # Determine pivot columns and free columns
    pivot_cols = set(pivots.keys())
    free_cols = [c for c in range(N) if c not in pivot_cols]

    # Back-substitute to find a particular solution (free vars = 0)
    solution = [0] * N
    for col, row_idx in sorted(pivots.items()):
        # The pivot row: col is the leading 1; other cols are either pivot or free
        # Since we did full elimination, row has only one 1 among pivot cols,
        # but may have 1s in free cols. Actually RREF: row = [0...1...0] with
        # possibly 1s in free cols. So: value = b - sum(free cols)
        s = rows[row_idx][N]
        for c in free_cols:
            s ^= rows[row_idx][c] * 0  # free vars = 0
        # More precisely: the pivot variable = rhs - sum of (coeff * other pivot vars)
        # But in RREF, other pivot vars already eliminated from this row, so:
        solution[col] = s

    info = {
        "rank": rank,
        "free_vars": free_cols,
        "unique": (len(free_cols) == 0),
    }
    return solution, info


def verify(solution, equations):
    for k, (vars_idx, b) in enumerate(equations):
        s = sum(solution[i] for i in vars_idx)
        ok = (s % 2) == (b % 2)
        print(f"Eq {k:2d}: {vars_idx} -> sum={s}, parity={s%2}, expected={b%2}, OK={ok}")
        if not ok:
            return False
    return True


# # ---- User's actual data ----
# N = 16
# equations = [
#     ([0, 4, 1], 0),
#     ([1, 5, 2, 0], 1),
#     ([2, 6, 3, 1], 0),
#     ([3, 7, 2], 0),
#     ([4, 8, 0, 5], 0),
#     ([5, 9, 1, 6, 4], 1),
#     ([6, 10, 2, 7, 5], 0),
#     ([7, 11, 3, 6], 1),
#     ([8, 12, 4, 9], 1),
#     ([9, 13, 5, 10, 8], 0),
#     ([10, 14, 6, 11, 9], 1),
#     ([11, 15, 7, 10], 1),
#     ([12, 8, 13], 0),
#     ([13, 9, 14, 12], 0),
#     ([14, 10, 15, 13], 0),
#     ([15, 11, 14], 1),
# ]

# sol, info = solve_mod2(equations, N)
# print("info:", info)
# if sol is None:
#     print("NO SOLUTION (system inconsistent)")
# else:
#     print("solution:", sol)
#     print("\nVerification:")
#     ok = verify(sol, equations)
#     print("\nAll satisfied:", ok)

if __name__ == '__main__':
    # 测试
    N = 5
    equations = [
        ([0], 1),
        ([1], 0),
        ([1, 2], 1),
        ([0, 3, 4], 0),
        ([4], 1),
    ]

    sol = solve_mod2(equations, N)
    print("Solution:", sol)

    # 验证
    if sol:
        for k, (vars_idx, b) in enumerate(equations):
            s = sum(sol[i] for i in vars_idx)
            print(f"Eq {k}: sum={s}, parity={s%2}, expected={b}, OK={s%2==b}")