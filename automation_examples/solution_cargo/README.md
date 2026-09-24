# solution_cargo

The game is the WebSocket client, this script is the server. For every level it
solves the level, sends the arrangement it found and submits.

## Run with uv

    uv run main.py                # listens on ws://localhost:8000
    uv run main.py -p 8321

The first run creates `.venv`, installs `numpy`, `scipy`, `pulp` and
`websockets` and writes `uv.lock`. The Python version is pinned by
`.python-version`; `uv python install` gets it if it is missing.

Commit that lock file if you want runs to be reproducible, then:

    uv sync --frozen

Then open `http://localhost:5173/#/game-cargo` in the browser and click 连接 in
the automation panel. The dial is not automatic: the browser only asks for
permission to reach the local network while the page has user activation, so a
connection started on page load is refused without ever showing a prompt.

## How it solves a level

| 文件 | 作用 |
| --- | --- |
| `main.py` | 连接、逐关循环、发动作、等缓冲排空、提交、打印每一帧 |
| `solution.py` | 把游戏状态翻译成求解器的输入，再把解翻译成 action |
| `solve.py` | 求解主体：形状候选 + 精确覆盖 |
| `solve_shape.py` | 0-1 整数规划工具（PuLP）：逐个产出图案 / 解的生成器与列表版本 |

求解分两步，都是 0-1 整数规划（`pulp`，默认用它自带的 CBC 求解器）：

1. `solve_shape()` 找出所有"行和、列和正好等于需求"的 0/1 图案；
2. 对每个图案（`solve.py`）做一个精确覆盖：每块拼图用且只用一次、每个有色格子
   被覆盖且只被覆盖一次、每个空格子完全不被覆盖。

两处刻意的"省算力"：

* 图案是**边找边用**的（`iter_shapes()` 是生成器），某个图案一旦能拼成就不再
  继续找后面的图案了；`max_solutions=1` 意味着拿到第一套摆法就收工，所以默认
  不会把 100 个图案候选都算出来。
* 每关发动作前先发一条 `{"kind": "clear"}`，把棋盘清空再摆。棋盘上若还留着上
  一次的块，新摆法就可能压在它们上面变成 unstable；清一次只要一步（1 秒）。

顺带一提，这个游戏只看行 / 列计数，所以求解器找出来的图案不一定和出题时那张
原图一样——只要行列需求对上，就是 100% 满足度。

## 已知限制

* **只支持 `numTypes == 1`**（当前游戏也只会出这种题）。多种块时需求是一个数组，
  这套逻辑只会用单一数字，所以 `solution.py` 会打印提示并直接提交原局面。
* 求解只要**一个**解就开工（`max_solutions=1`），所以每关的等待时间主要在形状
  搜索上；想更快可以把 `max_shapes` 调小，想更完整可以调大。

## 遇到错误不会中断

`main.py` 刻意**忽略**游戏返回的错误应答：动作被拒（`invalid_action`）、提交被拒
（`submit_rate_limited` / `game_busy` 等）、`states` 查不动、某一关求解器抛异常，
都只会打印一行日志然后继续下一关。只有连接断开才会结束这次会话，而游戏自己会
每秒重连。

协议本身（状态字段、两种 action、限速规则）见
[`src/automation/README.md`](../../src/automation/README.md) 的
「货物游戏（GameCargo）」一节，也可以看 `solution()` 的 docstring。
