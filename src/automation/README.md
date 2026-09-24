# 自动化接入（Automation kit）

给玩家一个用程序操作 UI 的入口：游戏主动去连接玩家自己写的 WebSocket 服务端，
通过一套固定协议读取局面、投递操作、提交答案。整个模块与具体游戏无关，
任何小游戏实现一个几十行的 adapter 就能接入。

| 文件 | 作用 |
| --- | --- |
| `protocol.ts` | 协议常量与类型：命令、应答、事件、时间间隔 |
| `GameAutomationBridge.ts` | 连接 / 重连、action 缓冲与执行节奏、提交限流 |
| `GameAutomationPanel.vue` | 右侧面板：端口输入、连接 / 断开 / 重试、状态显示 |
| `index.ts` | 统一出口 |

## 连接方式

**游戏是 WebSocket 客户端**，玩家程序是服务端，所以端口由玩家决定并在页面上填入。

* 默认连接 `ws://localhost:<port>`，默认端口 `8000`，端口会记在 `localStorage` 里。
* **连接由玩家点面板上的「连接」按钮发起，页面加载时不会自动拨号。**
  这是必须的：浏览器只在页面有用户激活（真实点击）时才会询问是否允许访问
  本机网络，自动拨号没有手势，会被**静默拒绝且不弹窗**，玩家只会看到连接失败。
* 连接失败（包括握手迟迟不完成）后**每秒重试一次**，直到连上或被手动断开。
* 浏览器明确报告本地网络访问被拒时，重试会停下来，面板改成提示去开启权限；
  改完站点设置后点「重试」即可。
* 页面右侧面板提供 `连接` / `断开` / `重试` 三个按钮和实时状态。

## 协议

### 命令（玩家程序 → 游戏）

```json
{ "id": 1, "type": "states",  "payload": {} }
{ "id": 2, "type": "actions", "payload": { "actions": [ { "rowInd": 0, "colInd": 1 } ] } }
{ "id": 3, "type": "submit",  "payload": {} }
{ "id": 4, "type": "ping",    "payload": {} }
```

`id` 可省略；带上时游戏会在应答里原样回传，方便并发请求配对。
`actions` 的 payload 也可以直接是数组：`[ { "rowInd": 0, "colInd": 1 } ]`。

### 应答（游戏 → 玩家程序）

```json
{ "id": 1, "type": "states.result", "ok": true,  "payload": { } }
{ "id": 3, "type": "submit.result", "ok": false, "error": { "code": "submit_rate_limited", "message": "…", "details": { "retryAfterMs": 640 } } }
```

应答的 `type` 恒为 `<命令>.result`，无法解析的帧用 `type: "error"`。

### 事件（游戏 → 玩家程序，主动推送）

```json
{ "type": "event", "event": "hello",         "payload": { "protocolVersion": "1.0.0", "gameId": "baking", "actionIntervalMs": 1000, "submitIntervalMs": 2000, "level": { }, "state": { } } }
{ "type": "event", "event": "level.started", "payload": { "gameId": "baking", "level": { }, "state": { } } }
```

连接建立后立刻收到 `hello`，之后每开一关都会收到 `level.started`，
两条事件都带完整的最新 `state`，客户端不必再多问一次 `states`。

### 三条时间规则（由游戏强制执行）

| 规则 | 值 |
| --- | --- |
| action 缓冲 | 收到的 action 先进 buffer，**每 1 秒执行一个** |
| 提交排队 | `submit` 排在 action 之后：先等 buffer 排空，再与最后一个 action **间隔 1 秒** |
| 提交间隔 | 两次 `submit` 至少相隔 **2 秒**，否则返回 `submit_rate_limited` + `retryAfterMs` |
| 重连间隔 | 连接失败后**每 1 秒重试一次** |

`actions` 可以分多次发送，每次都追加到已有 buffer 之后；应答里的
`estimatedDrainMs` 给出「全部执行完大概还要多久」。开新关卡时，属于上一关的
残留 action 会被丢弃（可用 `clearActionBufferOnLevelChange: false` 关掉）。
动作执行时机由游戏决定，所以玩家程序只要等待即可，不必自己计时。

`submit` 不会插队：如果还有 action 没执行完，或者最后一个 action 刚过去不到 1 秒，
提交会等满这一拍再执行（等待期间 `states` 的 `queue.submitHeld` 为 `true`），
所以「点卡片 → 提交」之间的节奏和「点卡片 → 点卡片」一样是 1 秒。
这期间若再发一次 `submit`，返回 `submit_pending`。

## 烘焙游戏（GameBaking）

`states` 应答的 `payload`：

```json
{
  "gameId": "baking",
  "serverTime": 1730000000000,
  "level": { "numRows": 5, "numCols": 4, "numTypes": 2, "actionKind": "tap", "actionFields": { "rowInd": "int", "colInd": "int" } },
  "state": {
    "started": true,
    "board":  { "numRows": 5, "numCols": 4, "numTypes": 2, "matrix": [[0,1],[1,0]] },
    "target": { "numRows": 5, "numCols": 4, "numTypes": 2, "matrix": [[1,1],[0,0]] },
    "metrics": { "similarity": 0.5, "expectedScore": 0.05, "totalScore": 10.1, "isPerfect": false },
    "busy": false
  },
  "queue": { "pending": 3, "executed": 5, "actionIntervalMs": 1000, "submitReadyInMs": 0, "submitIntervalMs": 2000 }
}
```

`board` 是当前棋盘，`target` 是目标配方，两者都是**每次调用时的实时快照**，
不是初始化时的那一份。矩阵取值 `0 … numTypes-1`，`matrix[rowInd][colInd]`。

`actions` 的 action 形如 `{ "rowInd": 0, "colInd": 1 }`，表示点一下这个格子
（该格及其上下左右各 +1 并对 `numTypes` 取模）。坐标越界会被整批拒绝并返回
`invalid_action`。

`submit` 的应答：

```json
{ "similarity": 1, "expectedScore": 10, "totalScore": 20.1, "perfect": true, "submittedAt": 1730000000000 }
```

提交后关卡会在约 2 秒的淡入淡出中切换，期间 `state.busy` 为 `true`，
`actions` 会暂缓执行（留在 buffer 里），`submit` 返回 `game_busy`。

## 货物游戏（GameCargo）

`states` 应答的 `payload`：

```json
{
  "gameId": "cargo",
  "serverTime": 1730000000000,
  "level": { "numRows": 8, "numCols": 8, "numTypes": 1, "numPieces": 12, "actionKinds": ["place", "clear"] },
  "state": {
    "started": true,
    "numRows": 8,
    "numCols": 8,
    "numTypes": 1,
    "rowDemands": [[1], [2], [0]],
    "colDemands": [[1], [0], [2]],
    "fixed": [{ "row": 0, "col": 2, "typeId": -1 }],
    "pieces": [
      { "ind": 0, "typeId": 1, "shape": [[1, 1], [0, 1]], "width": 2, "height": 2,
        "placement": { "row": 3, "col": 4, "rotation": 1 }, "unstable": false }
    ],
    "metrics": { "satisfaction": 0.83, "expectedScore": 0.08, "totalScore": 10.1, "isDemandMet": false },
    "busy": false
  },
  "queue": { "pending": 3, "executed": 5, "actionIntervalMs": 1000, "submitReadyInMs": 0, "submitIntervalMs": 2000 }
}
```

`state` 与烘焙游戏不同，它一次给全：`rowDemands[rowInd][typeInd]` 和
`colDemands[colInd][typeInd]` 分别是这一行 / 这一列要求多少个 `typeInd + 1`
种类的块；`fixed` 是开局就占住的格子（`typeId` 为 `-1` 表示这个格子不能放
任何东西）；`pieces` 里每个 piece 给出 `shape`（`shape[y][x]`，`1` 是块）、
`width` / `height` 和当前的 `placement`（`null` 表示还在 pieceBar 里），
动作里的 `pieceInd` 就是这个 `ind`。`metrics.satisfaction` 是需求满足度
（0 … 1），`metrics.isDemandMet` 为 `true` 时它正好是 1。

`actions` 的 action 有这三种写法：

```json
{ "kind": "place", "pieceInd": 0, "row": 0, "col": 0, "rotation": 0 }
{ "kind": "place", "pieces": [ { "pieceInd": 0, "row": 0, "col": 0 }, { "pieceInd": 1, "row": 4, "col": 4, "rotation": 2 } ] }
{ "kind": "clear" }
```

* `place` 把某个 piece **旋转后外框**的左上角放到（`row`, `col`），坐标从棋盘
  左上角算起。`rotation` 是顺时针 90° 的个数，任意整数都可以（`5` 与 `1`
  是同一个朝向），省略则保持它当前的朝向。一个 action 里可以带多个 piece
  （`pieces` 数组），它们同属**一步**，仍然是一秒一步。
* `clear` 把棋盘上所有 piece 送回 pieceBar。
* 旋转后放不进棋盘、`row` / `col` 越界都会被整批拒收并返回 `invalid_action`。
* 放上去会压到别的块或 `fixed` 格子时**照样放**，该 piece 记为 `unstable`
  并红光提示；下一次动到某个 piece（玩家拖拽或自动化都算）时，会把其余
  `unstable` 的 piece 送回 pieceBar。

`submit` 的应答：

```json
{ "satisfaction": 1, "expectedScore": 10, "totalScore": 20.1, "demandMet": true, "submittedAt": 1730000000000 }
```

提交后棋盘和 pieceBar 会在约 2 秒的淡入淡出中换成下一题，期间
`state.busy` 为 `true`，`actions` 会暂缓执行（留在 buffer 里），`submit`
返回 `game_busy`。手动按「提交」也会占用这 2 秒，所以玩家程序和手动提交
不会互相抢节奏。

## 接到新小游戏上

```ts
import { GameAutomationBridge, GameAutomationPanel } from '@/automation'

const bridge = new GameAutomationBridge<MyAction, MyState>({
    gameId: 'my-game',
    getState: () => ({ /* 每次调用都读当前局面 */ }),
    describeLevel: () => ({ /* 棋盘尺寸之类的元信息，可省略 */ }),
    normalizeAction: (raw) => {
        // 校验并把玩家传来的 JSON 变成内部 action，抛 Error 即拒收
        return { ... }
    },
    applyAction: (action) => { /* 把 action 应用到游戏上 */ },
    canApplyAction: () => !isBusy.value,   // 可选：过场动画期间先不执行
    canSubmit: () => !isBusy.value,        // 可选
    submit: () => { /* 提交并返回结果对象 */ },
}, {
    // 第二个参数是 bridge 选项；debug 默认就是 true，
    // 控制台会以 [automation] 为前缀打印每一帧收发、连接状态、action 执行和提交结果
    debug: true,
})

// 不要在这里 bridge.connect()：拨号必须发生在玩家点击按钮的手势里，
// 否则浏览器不会弹本地网络访问的权限窗，只会静默拒绝。详见「连接方式」。
onBeforeUnmount(() => bridge.dispose())    // 关掉 socket 与定时器

// 手动点提交按钮时也调一次，让 2 秒限制对两边都生效
bridge.markSubmitted()
```

```html
<GameAutomationPanel :bridge="bridge" />
```

## 测试服务端

`websocket_test/` 下是两个文件：

- `main.py`：玩家程序本体（Python，WebSocket 服务端）。它负责连接、取当前局面、
  把 `solution.py` 给出的 action 发进去、等 buffer 排空、`submit`，然后等游戏自己
  推来的 `level.started`，拿到新关卡状态后**再走一遍，如此循环**（Ctrl-C 退出）。
  每一帧收发都会打印：`->` 发出、`<-` 收到。
- `solution.py`：只放“这一关怎么打”。`solution(state)` 现在固定返回 `(0, 0)`、
  `(0, 1)` 两个点位，之后要换成真正的解法只改这个函数即可。

```bash
cd websocket_test
python main.py            # 监听 ws://localhost:8000
python main.py -p 8321    # 换端口，页面右侧端口框里填一样的值
```

## 连接失败怎么排查

浏览器控制台里的 `WebSocket connection to 'ws://localhost:8000/' failed` 只是
「握手没有成功」，具体原因按下面顺序看：

1. **8000 端口上到底有没有服务端。** 最常见的情况就是忘了启动玩家程序。
   `lsof -nP -iTCP:8000 -sTCP:LISTEN` 有输出才算在听；浏览器里 `code 1006`
   基本就是这个意思。右侧面板会显示 `已尝试连接 N 次`，说明每秒重试还活着。
2. **和跨域（CORS）无关。** WebSocket 握手不走 CORS，浏览器只会带上
   `Origin: http://localhost:5173`，放不放行由服务端决定。
   `websockets` 服务端默认 `origins=None`，即**不校验 Origin**，只有显式传了
   `origins=[...]` 才会因为来源不符返回 403（控制台会写 `Unexpected response code: 403`）。
   所以测试服务端不需要额外配置 CORS，`websocket_test/main.py` 还会把每次握手
   的 `Host` / `Origin` 打出来。
3. **`localhost` 解析到 IPv4 还是 IPv6。** 浏览器自行决定用 `::1` 还是
   `127.0.0.1`，Chrome 会回退，Safari 之类不一定。测试服务端现在同时监听
   `127.0.0.1` 和 `::1`，两边都能连上；只监听一个地址时才会出现「服务端明明
   在跑却连不上」。
4. **页面是不是公网地址，而目标是本机回环地址。** 这是最容易被忽略的一条，
   也是「本地能连、部署到玩具的 preview 就连不上」的原因。

   Chrome 把「公网页面 → `localhost`」当作本地网络访问（Local Network
   Access），需要 `local-network-access` 权限，而**权限弹窗只在页面有用户
   激活时出现**：

   * 在控制台手敲 `new WebSocket('ws://localhost:8000')`（回车算一次用户
     激活）会弹窗，允许后就能连上，服务端也能看到握手；
   * 页面自己在加载时自动拨号则没有手势，浏览器**不弹窗、直接静默拒绝**，
     表现就是「前端报连接失败 + 服务端握手日志一行都没有」。

   所以公网页面上必须点面板的「连接」按钮来发起连接；如果已经点过「阻止」，
   去地址栏左侧的站点设置里允许「本地网络访问」，再点「重试」。
   当前状态可以用
   `await navigator.permissions.query({ name: 'local-network-access' })` 查看
   （返回 `denied` 就是被拒过）。

   已经验证可行的捷径：在 `chrome://flags/#local-network-access-check` 里把
   **Local Network Access Checks** 设为 `Disabled` 并重启浏览器，公网页面就能
   直接连上本机（自用调试够用，但它是全局的实验性开关）。注意这种情况下
   `permissions.query` 仍可能报 `denied`，所以权限状态只用来提示，**真正的判据
   永远是握手有没有成功**：握手成功就一切照常，只有「权限被拒 + 真的连不上」
   才按拦截处理并停下重试。

   用 `http://localhost:5173` 打开页面不属于跨地址空间访问，永远不需要这个
   权限；用 `http://192.168.x.x:5173` 这种局域网地址打开则同样会被拦。
   另外 `https` 页面连 `ws://` 在 Chrome 之外（Safari、Firefox）还可能被当作
   混合内容拦掉（Chrome 对 `localhost` 有豁免），这种情况控制台会明确写
   `Mixed Content`。
