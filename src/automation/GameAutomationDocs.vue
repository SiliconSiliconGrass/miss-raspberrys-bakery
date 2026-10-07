<script setup lang="ts">
import { ref } from 'vue'

import { copyTextToClipboard } from './clipboard'
import type { AutomationDocsExample } from './docs'
import {
    AUTOMATION_ACTION_INTERVAL_MS,
    AUTOMATION_CONNECT_TIMEOUT_MS,
    AUTOMATION_PROTOCOL_VERSION,
    AUTOMATION_RECONNECT_INTERVAL_MS,
    AUTOMATION_SUBMIT_INTERVAL_MS,
    type AutomationActionTypeDescriptor,
} from './protocol'

/**
 * The automation manual of one mini-game. Every game builds an
 * `AutomationDocsConfig` and hands it to `GameAutomationPanel`, which renders
 * this component behind its 文档 button. The generic parts of the protocol
 * (commands, events, timing rules) are filled in here, so a game only has to
 * describe its own actions and examples.
 */
defineProps<{
    /** `gameId` the bridge reports. */
    gameId: string
    title: string
    summary: string
    /** Action kinds this game accepts, always a list. */
    actionTypes: AutomationActionTypeDescriptor[]
    examples?: AutomationDocsExample[]
    notes?: string[]
}>()

/** Key of the code block whose copy button was clicked last (for the 已复制 hint). */
const copiedKey = ref('')

async function copy(key: string, value: unknown): Promise<void> {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    const ok = await copyTextToClipboard(text)
    if (!ok) {
        return
    }
    copiedKey.value = key
    window.setTimeout(() => {
        if (copiedKey.value === key) {
            copiedKey.value = ''
        }
    }, 1200)
}

function formatJson(value: unknown): string {
    return JSON.stringify(value, null, 2)
}

const actionIntervalSeconds = AUTOMATION_ACTION_INTERVAL_MS / 1000
const submitIntervalSeconds = AUTOMATION_SUBMIT_INTERVAL_MS / 1000
const reconnectIntervalSeconds = AUTOMATION_RECONNECT_INTERVAL_MS / 1000

const commands = [
    { type: 'states', payload: '{ }', purpose: '读取当前局面，返回 level / state / queue 三部分。' },
    { type: 'actions', payload: '{ "actions": [ … ] }', purpose: '把一批动作追加到执行队列，一秒执行一个。' },
    { type: 'submit', payload: '{ }', purpose: '提交当前答案，排队在动作之后。' },
    { type: 'ping', payload: '{ }', purpose: '确认连接还活着。' },
]
</script>

<template>
    <div class="automation-docs">
        <header class="docs-header">
            <h3 class="docs-title">{{ title }}</h3>
            <p class="docs-summary">{{ summary }}</p>
            <div class="docs-meta">
                <span>gameId：<code>{{ gameId }}</code></span>
                <span>协议版本：<code>{{ AUTOMATION_PROTOCOL_VERSION }}</code></span>
            </div>
        </header>

        <section class="docs-section">
            <h4>一、连接方式</h4>
            <p>
                这个游戏是 <strong>WebSocket 客户端</strong>，你的程序是服务端。默认连接
                <code>ws://localhost:&lt;端口&gt;</code>，端口在自动化面板里填写。
            </p>
            <p>
                连接<strong>必须由玩家在页面上点「连接」发起</strong>：浏览器只在页面有用户激活
                （真实点击）时才询问是否允许访问本机网络，自动拨号会被静默拒绝。
            </p>
        </section>

        <section class="docs-section">
            <h4>二、命令与应答</h4>
            <table class="docs-table">
                <thead>
                    <tr>
                        <th>命令</th>
                        <th>payload</th>
                        <th>作用</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="command in commands" :key="command.type">
                        <td><code>{{ command.type }}</code></td>
                        <td><code>{{ command.payload }}</code></td>
                        <td>{{ command.purpose }}</td>
                    </tr>
                </tbody>
            </table>
            <p>
                每条命令都可以带一个 <code>id</code>，应答会原样回传，方便配对。应答的
                <code>type</code> 恒为 <code>&lt;命令&gt;.result</code>，成功时 <code>ok: true</code>，
                失败时 <code>ok: false</code> 并带 <code>error.code</code>。
            </p>
            <p>
                游戏还会主动推送事件：连上后立刻发 <code>hello</code>，之后每开一关发
                <code>level.started</code>，两条事件都带完整的最新 <code>state</code>。
            </p>
            <p>
                <code>level</code> 里还有 <code>seed</code>：本关的随机种子。面板上可以直接复制它
                （导出）或一键复制分享链接，也可以把种子填回面板导入，或在地址后加
                <code>?seed=&lt;种子&gt;</code>。
                <code>level.seedImported</code> 为 <code>true</code> 时说明这一关是用导入的种子开的：
                它的分数不计入总得分，<code>submit</code> 结果里的 <code>counted</code> 为
                <code>false</code>。
            </p>
        </section>

        <section class="docs-section">
            <h4>三、动作类型（<code>level.actionTypes</code>）</h4>
            <p class="docs-hint">
                无论游戏支持几种动作，<code>level.actionTypes</code> 永远是数组；每一项给出该动作的
                <code>kind</code> 和它需要的字段。
            </p>
            <table class="docs-table">
                <thead>
                    <tr>
                        <th>kind</th>
                        <th>字段</th>
                        <th>说明</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="actionType in actionTypes" :key="actionType.kind">
                        <td><code>{{ actionType.kind }}</code></td>
                        <td>
                            <span v-if="Object.keys(actionType.fields).length === 0" class="docs-muted">
                                （无）
                            </span>
                            <div v-else class="field-list">
                                <span v-for="(type, name) in actionType.fields" :key="name" class="field">
                                    <code>{{ name }}</code><span class="field-type">: {{ type }}</span>
                                </span>
                            </div>
                        </td>
                        <td>{{ actionType.description ?? '' }}</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section v-if="examples && examples.length > 0" class="docs-section">
            <h4>四、请求与应答示例</h4>
            <div v-for="(example, ind) in examples" :key="ind" class="docs-example">
                <div class="example-title">{{ example.title }}</div>
                <p v-if="example.description" class="example-description">{{ example.description }}</p>
                <div class="example-grid">
                    <div class="code-block">
                        <div class="code-head">
                            <span class="code-label">你发送</span>
                            <button
                                v-if="example.request !== undefined"
                                class="code-copy"
                                @click="copy(`req-${ind}`, example.request)"
                            >
                                {{ copiedKey === `req-${ind}` ? '已复制' : '复制' }}
                            </button>
                        </div>
                        <pre v-if="example.request !== undefined" class="code-body">{{ formatJson(example.request) }}</pre>
                        <div v-else class="code-body code-empty">（无请求，游戏主动推送）</div>
                    </div>
                    <div class="code-block">
                        <div class="code-head">
                            <span class="code-label">游戏应答</span>
                            <button class="code-copy" @click="copy(`res-${ind}`, example.response)">
                                {{ copiedKey === `res-${ind}` ? '已复制' : '复制' }}
                            </button>
                        </div>
                        <pre class="code-body">{{ formatJson(example.response) }}</pre>
                    </div>
                </div>
            </div>
        </section>

        <section class="docs-section">
            <h4>五、时间规则（由游戏强制执行）</h4>
            <ul class="docs-list">
                <li>收到的动作先进队列，<strong>每 {{ actionIntervalSeconds }} 秒执行一个</strong>。</li>
                <li><code>submit</code> 排在动作之后：先等队列排空，再与最后一个动作间隔
                    {{ actionIntervalSeconds }} 秒。</li>
                <li>两次 <code>submit</code> 至少相隔 <strong>{{ submitIntervalSeconds }} 秒</strong>，
                    否则返回 <code>submit_rate_limited</code> 与 <code>retryAfterMs</code>。</li>
                <li>连接失败后每 {{ reconnectIntervalSeconds }} 秒重试一次；一次握手
                    {{ AUTOMATION_CONNECT_TIMEOUT_MS }} 毫秒没有完成就算失败。</li>
            </ul>
        </section>

        <section v-if="notes && notes.length > 0" class="docs-section">
            <h4>备注</h4>
            <ul class="docs-list">
                <li v-for="(note, ind) in notes" :key="ind">{{ note }}</li>
            </ul>
        </section>
    </div>
</template>

<style scoped>
.automation-docs {
    display: flex;
    flex-direction: column;
    gap: 1.1em;
    /* the docs are meant to be read: use the system sans-serif, not the game's
       handwritten font the surrounding panel uses */
    font-family:
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        'PingFang SC',
        'Hiragino Sans GB',
        'Microsoft YaHei',
        'Noto Sans CJK SC',
        sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #4a2400;
}

.docs-header {
    padding-bottom: 0.7em;
    border-bottom: 1px solid rgba(124, 50, 0, 0.25);
}

.docs-title {
    margin: 0 0 0.35em;
    font-size: 1.25em;
}

.docs-summary {
    margin: 0 0 0.5em;
}

.docs-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em 1.2em;
    font-size: 0.85em;
    opacity: 0.8;
}

.docs-section h4 {
    margin: 0 0 0.4em;
    font-size: 1.05em;
}

.docs-section p {
    margin: 0 0 0.5em;
}

.docs-hint {
    font-size: 0.9em;
    opacity: 0.85;
}

.docs-muted {
    opacity: 0.6;
}

code {
    padding: 0 0.25em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 0.92em;
    background-color: rgba(124, 50, 0, 0.1);
    border-radius: 4px;
}

.docs-table {
    width: 100%;
    margin-bottom: 0.6em;
    border-collapse: collapse;
    font-size: 0.92em;
}

.docs-table th,
.docs-table td {
    padding: 0.4em 0.5em;
    text-align: left;
    vertical-align: top;
    border: 1px solid rgba(124, 50, 0, 0.25);
}

.docs-table th {
    background-color: rgba(124, 50, 0, 0.12);
}

.field-list {
    display: flex;
    flex-direction: column;
    gap: 0.15em;
}

.field-type {
    opacity: 0.7;
}

.docs-list {
    margin: 0;
    padding-left: 1.2em;
}

.docs-list li {
    margin-bottom: 0.25em;
}

.docs-example {
    margin-bottom: 1em;
}

.example-title {
    font-weight: bold;
}

.example-description {
    font-size: 0.9em;
    opacity: 0.85;
}

.example-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.6em;
}

.code-block {
    overflow: hidden;
    border: 1px solid rgba(124, 50, 0, 0.3);
    border-radius: 8px;
}

.code-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25em 0.5em;
    background-color: rgba(124, 50, 0, 0.14);
}

.code-label {
    font-size: 0.85em;
}

.code-copy {
    padding: 0.1em 0.6em;
    font-family: inherit;
    font-size: 0.8em;
    color: #7c3200;
    background-color: #ffe9b3;
    border: none;
    border-radius: 999px;
    cursor: pointer;
}

.code-body {
    margin: 0;
    padding: 0.5em 0.6em;
    overflow: auto;
    max-height: 260px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre;
    user-select: text;
}

.code-empty {
    font-family: inherit;
    font-size: 13px;
    opacity: 0.7;
}
</style>
