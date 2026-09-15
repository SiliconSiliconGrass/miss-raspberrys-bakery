import pulp
import numpy as np

def iter_solutions(N, constraints, max_solutions=100, time_limit=30, msg=False):
    """
    用PuLP求解0-1整数规划，逐个产出解
    
    参数:
    ----------
    N : int
        变量个数
    constraints : list
        约束列表，每个元素为 (变量索引列表, 目标值)
        例如 [([0,1,2], 2), ([1,3,4], 1)]
    max_solutions : int, 可选
        最大解数量，默认1。设置为None表示找尽可能多的解
    time_limit : int, 可选
        求解时间限制（秒），默认30秒
    msg : bool, 可选
        是否显示求解器消息，默认False
    
    产出:
    -----
    每个解是一个列表 [x0, x1, ..., x_{N-1}]

    这是个生成器：只要调用方拿到够用的解就不再继续取，剩下的搜索也就不会发生。
    `solve_with_pulp()` 是把它们一次收完的版本，行为与原来一样。
    """
    if max_solutions is None:
        max_solutions = float('inf')
    
    solutions = []
    
    while len(solutions) < max_solutions:
        # 创建问题
        problem = pulp.LpProblem(f"ZeroOneProblem_Solution{len(solutions)+1}", pulp.LpMinimize)
        
        # 创建0-1变量
        x = pulp.LpVariable.dicts('x', range(N), lowBound=0, upBound=1, cat='Binary')
        
        # 目标函数（最小化0，因为我们只求可行解）
        problem += 0
        
        # 添加原始约束
        for var_indices, target in constraints:
            problem += pulp.lpSum(x[i] for i in var_indices) == target
        
        # 添加排除已找到解的约束
        for sol in solutions:
            # 添加约束：新解不能与任何已找到解完全相同
            # 方法1：二进制不相等约束（更精确）
            diff_terms = []
            for i in range(N):
                if sol[i] == 1:
                    diff_terms.append(1 - x[i])  # 原解=1，新解必须=0才算不同
                else:
                    diff_terms.append(x[i])      # 原解=0，新解必须=1才算不同
            problem += pulp.lpSum(diff_terms) >= 1
        
        # 配置求解器
        solver_kwargs = {
            'msg': msg,
            'timeLimit': time_limit,
        }
        
        # 尝试使用更好的求解器，回退到CBC
        solvers_to_try = []
        
        # 按优先级尝试不同的求解器
        if pulp.GUROBI_CMD().available():
            solvers_to_try.append(('GUROBI', pulp.GUROBI_CMD(**solver_kwargs)))
        if pulp.CPLEX_CMD().available():
            solvers_to_try.append(('CPLEX', pulp.CPLEX_CMD(**solver_kwargs)))
        if pulp.GLPK_CMD().available():
            solvers_to_try.append(('GLPK', pulp.GLPK_CMD(**solver_kwargs)))
        
        # 总是包含CBC作为备选
        solvers_to_try.append(('CBC', pulp.PULP_CBC_CMD(**solver_kwargs)))
        
        solution_found = False
        
        for solver_name, solver in solvers_to_try:
            try:
                # if not msg:
                #     print(f"尝试使用 {solver_name} 求解器...")
                
                problem.solve(solver)
                
                if pulp.LpStatus[problem.status] == "Optimal":
                    # 提取解
                    new_solution = [int(pulp.value(x[i])) for i in range(N)]
                    
                    # 检查是否与已有解重复
                    if new_solution in solutions:
                        if not msg:
                            print(f"找到重复解，停止搜索")
                        solution_found = False
                        break
                    
                    solutions.append(new_solution)
                    solution_found = True
                    
                    # if not msg:
                    #     print(f"找到第 {len(solutions)} 个解: {new_solution}")
                    # break
                else:
                    pass
                    # if not msg and solver_name != 'CBC':
                    #     print(f"{solver_name} 未找到可行解，尝试下一个...")
            except Exception as e:
                # if not msg and solver_name != 'CBC':
                #     print(f"{solver_name} 求解失败: {e}，尝试下一个...")
                continue
        
        if not solution_found:
            # if not msg:
            #     print(f"已找到所有 {len(solutions)} 个解")
            break

        yield solutions[-1]

        # 检查是否达到最大解数量限制
        if len(solutions) >= max_solutions:
            # if not msg:
            #     print(f"已达到最大解数量限制: {max_solutions}")
            break


def solve_with_pulp(N, constraints, max_solutions=100, time_limit=30, msg=False):
    """
    用PuLP求解0-1整数规划，支持找多个解（一次把解都收完）

    参数与 `iter_solutions()` 相同，返回所有解的列表。
    """
    return list(iter_solutions(N, constraints, max_solutions=max_solutions,
                               time_limit=time_limit, msg=msg))


def iter_shapes(column_sums: list[int],
                row_sums: list[int],
                fixed_ones: list[tuple[int, int]]=[],
                fixed_zeros: list[tuple[int, int]]=[],
                max_solutions: int=100):
    """
    输入行和约束、列和约束，逐个产出可行的形状
    """
    width = len(column_sums)
    height = len(row_sums)

    constraints = []
    for i, column_sum in enumerate(column_sums):
        constraints.append(([i + j * width for j in range(height)], column_sum))
    for i, row_sum in enumerate(row_sums):
        constraints.append(([i * width + j for j in range(width)], row_sum))
    for x, y in fixed_ones:
        constraints.append(([x + y * width], 1))
    for x, y in fixed_zeros:
        constraints.append(([x + y * width], 0))

    for solution in iter_solutions(width * height, constraints, max_solutions=max_solutions):
        yield np.reshape(solution, (height, width))


def solve_shape(column_sums: list[int],
                row_sums: list[int],
                fixed_ones: list[tuple[int, int]]=[],
                fixed_zeros: list[tuple[int, int]]=[],
                max_solutions: int=100) -> list[np.ndarray]:
    """
    输入行和约束、列和约束，求解形状（一次把所有形状都收完）
    """
    return list(iter_shapes(column_sums, row_sums, fixed_ones, fixed_zeros,
                            max_solutions=max_solutions))


if __name__ == "__main__":
    # column_sums = [3,4,5,4,3]
    # row_sums = [1,3,5,5,5]

    column_sums = [3,3,3,3]
    row_sums = [3,3,3,3]
    fixed_ones = []
    fixed_zeros = [(1,1), (2,2)]
    solutions = solve_shape(column_sums, row_sums, fixed_ones, fixed_zeros)
    print(solutions)
