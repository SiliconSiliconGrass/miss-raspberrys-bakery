<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import GameAutomationDocs from './GameAutomationDocs.vue'
import { copyTextToClipboard } from './clipboard'
import type { AutomationDocsConfig } from './docs'
import type {
    AutomationBridgeHandle,
    AutomationLogDirection,
    AutomationLogEntry,
} from './GameAutomationBridge'

/**
 * Reusable control panel for the automation bridge. It stays folded against
 * the right edge (port / status / connect), and a button opens a larger modal
 * with the full connection settings, a rolling log of both directions of the
 * conversation, and — when the game provides one — its automation manual.
 * Every mini-game drops this next to its own UI.
 */
const props = withDefaults(
    defineProps<{
        bridge: AutomationBridgeHandle
        title?: string
        /** The game's documentation; without it the 文档 button is hidden. */
        docs?: AutomationDocsConfig
    }>(),
    { title: '自动化接入' },
)

type PanelTab = 'connect' | 'log' | 'docs'

const portInput = ref(String(props.bridge.state.port))

watch(
    () => props.bridge.state.port,
    (port) => {
        portInput.value = String(port)
    },
)

const status = computed(() => props.bridge.state.status)
const isIdle = computed(() => status.value === 'idle')
const isConnected = computed(() => status.value === 'connected')
const isConnecting = computed(() => status.value === 'connecting')
const isBlocked = computed(() => props.bridge.state.blockedByBrowser)

const statusText = computed(() => {
    if (isBlocked.value) {
        return '被浏览器拦截'
    }
    switch (status.value) {
        case 'connected':
            return '已连接'
        case 'connecting':
            // the second and later attempts follow a failure, say so
            return props.bridge.state.lastError ? '重试连接中…' : '连接中…'
        default:
            return '未连接'
    }
})

const dotClass = computed(() => (isBlocked.value ? 'is-blocked' : `is-${status.value}`))

const queueText = computed(() => {
    const { pendingActions, executedActions } = props.bridge.state
    return `队列 ${pendingActions} · 已执行 ${executedActions}`
})

/** While offline, show that the retry loop is alive and how often it tried. */
const attemptText = computed(() =>
    isConnected.value || isIdle.value ? '' : `已尝试连接 ${props.bridge.state.attemptCount} 次`,
)

/**
 * The browser's verdict on this page reaching the local network, when it has
 * something useful to say: `unknown` means the browser has no such gate (so
 * nothing to show while developing on http://localhost), and `denied` is
 * ambiguous enough that the blocked hint below says it better. Hidden while
 * connected, where it would only contradict the green light.
 */
const permissionText = computed(() => {
    if (isConnected.value) {
        return ''
    }
    switch (props.bridge.state.permissionState) {
        case 'granted':
            return '已允许'
        case 'prompt':
            return '待询问'
        default:
            return ''
    }
})

/**
 * The connection is always started by a click: the browser only shows the
 * local network access prompt while the page has user activation, so an
 * automatic dial would be refused silently, with no prompt to accept.
 */
const hintText = computed(() =>
    isIdle.value
        ? '点「连接」开始。这一步必须由你亲自点：浏览器只在你操作之后才会询问是否允许访问本机网络。'
        : '',
)

/** Returns false when the input is not a usable port, so we can flag it. */
function commitPort(): boolean {
    const accepted = props.bridge.setPort(portInput.value.trim())
    portInput.value = String(props.bridge.state.port)
    return accepted
}

function onPortKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
        commitPort()
    }
}

function onConnect() {
    commitPort()
    props.bridge.connect()
}

function onDisconnect() {
    props.bridge.disconnect()
}

function onRetry() {
    commitPort()
    props.bridge.reconnect()
}

// --------------------------------------------------------------------- modal

const isModalOpen = ref(false)
const activeTab = ref<PanelTab>('connect')

function openModal(tab: PanelTab) {
    if (tab === 'docs' && !props.docs) {
        return
    }
    activeTab.value = tab
    isModalOpen.value = true
    if (tab === 'log') {
        void scrollLogToBottom()
    }
}

function closeModal() {
    isModalOpen.value = false
}

function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        closeModal()
    }
}

watch(isModalOpen, (open) => {
    if (open) {
        window.addEventListener('keydown', onWindowKeydown)
    } else {
        window.removeEventListener('keydown', onWindowKeydown)
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onWindowKeydown)
})

// ----------------------------------------------------------------------- log

const logBox = ref<HTMLElement | null>(null)
/** Follow new lines, until the player scrolls up to read the history. */
const autoScroll = ref(true)
const copiedLogId = ref<number | null>(null)

const logEntries = computed<AutomationLogEntry[]>(() => props.bridge.state.log)

const directionLabels: Record<AutomationLogDirection, string> = {
    in: '接收',
    out: '发送',
    error: '错误',
    info: '信息',
}

function formatTime(time: number): string {
    const date = new Date(time)
    const pad = (value: number, width = 2) => String(value).padStart(width, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function formatLogLine(entry: AutomationLogEntry): string {
    return `${formatTime(entry.time)} [${directionLabels[entry.direction]}] ${entry.label} ${entry.text}`
}

async function scrollLogToBottom(): Promise<void> {
    await nextTick()
    const box = logBox.value
    if (box) {
        box.scrollTop = box.scrollHeight
    }
}

function onLogScroll() {
    const box = logBox.value
    if (!box) {
        return
    }
    autoScroll.value = box.scrollHeight - box.scrollTop - box.clientHeight < 24
}

watch(
    // the id of the newest line, so the log still follows when the buffer is
    // full and every push also drops the oldest line
    () => logEntries.value[logEntries.value.length - 1]?.id ?? 0,
    () => {
        if (!autoScroll.value || activeTab.value !== 'log' || !isModalOpen.value) {
            return
        }
        void scrollLogToBottom()
    },
)

async function copyAllLog() {
    await copyTextToClipboard(logEntries.value.map(formatLogLine).join('\n'))
}

async function copyEntry(entry: AutomationLogEntry) {
    const ok = await copyTextToClipboard(formatLogLine(entry))
    if (!ok) {
        return
    }
    copiedLogId.value = entry.id
    window.setTimeout(() => {
        if (copiedLogId.value === entry.id) {
            copiedLogId.value = null
        }
    }, 1000)
}

function clearLog() {
    props.bridge.clearLog()
    autoScroll.value = true
}
</script>

<template>
    <div class="automation-panel">
        <div class="panel-title">{{ title }}</div>

        <div class="status-row">
            <span class="status-dot" :class="dotClass"></span>
            <span class="status-text">{{ statusText }}</span>
        </div>

        <div class="info-row">{{ bridge.state.serverUrl }}</div>
        <div class="info-row">{{ queueText }}</div>

        <div class="button-row">
            <button class="panel-button" :disabled="isConnected || isConnecting" @click="onConnect">
                连接
            </button>
            <button class="panel-button" :disabled="isIdle" @click="onDisconnect">
                断开
            </button>
            <button class="panel-button" @click="openModal('connect')">详情</button>
        </div>

        <div class="link-row">
            <button class="link-button" @click="openModal('log')">
                日志<span v-if="logEntries.length > 0">（{{ logEntries.length }}）</span>
            </button>
            <span class="link-sep">·</span>
            <button class="link-button" :disabled="!docs" @click="openModal('docs')">文档</button>
        </div>
    </div>

    <Teleport to="body">
        <Transition name="panel-modal">
            <div v-if="isModalOpen" class="automation-modal-backdrop" @click.self="closeModal">
                <div class="automation-modal" role="dialog" aria-modal="true" :aria-label="title">
                <header class="modal-header">
                    <div class="modal-title">{{ title }}</div>
                    <nav class="modal-tabs">
                        <button
                            class="modal-tab"
                            :class="{ 'is-active': activeTab === 'connect' }"
                            @click="activeTab = 'connect'"
                        >连接</button>
                        <button
                            class="modal-tab"
                            :class="{ 'is-active': activeTab === 'log' }"
                            @click="activeTab = 'log'"
                        >
                            日志
                            <span v-if="logEntries.length > 0" class="tab-count">{{ logEntries.length }}</span>
                        </button>
                        <button
                            v-if="docs"
                            class="modal-tab"
                            :class="{ 'is-active': activeTab === 'docs' }"
                            @click="activeTab = 'docs'"
                        >文档</button>
                    </nav>
                    <button class="modal-close" aria-label="关闭" @click="closeModal">×</button>
                </header>

                <div class="modal-body">
                    <!-- 连接 ---------------------------------------------------->
                    <div v-show="activeTab === 'connect'" class="tab-connect">
                        <label class="port-row">
                            <span class="port-label">端口</span>
                            <input
                                v-model="portInput"
                                class="port-input"
                                type="text"
                                inputmode="numeric"
                                spellcheck="false"
                                @keydown="onPortKeydown"
                                @blur="commitPort"
                            />
                        </label>

                        <div class="status-row">
                            <span class="status-dot" :class="dotClass"></span>
                            <span class="status-text">{{ statusText }}</span>
                        </div>

                        <div class="detail-row"><span class="detail-label">地址</span>{{ bridge.state.serverUrl }}</div>
                        <div class="detail-row"><span class="detail-label">队列</span>{{ queueText }} · {{ bridge.actionIntervalMs / 1000 }} 秒 / 步</div>
                        <div v-if="permissionText" class="detail-row">
                            <span class="detail-label">本地网络</span>{{ permissionText }}
                        </div>
                        <div v-if="attemptText" class="detail-row">
                            <span class="detail-label">重试</span>{{ attemptText }}
                        </div>

                        <div v-if="isBlocked" class="hint-row is-blocked">
                            <div>
                                连不上，而且浏览器报告本地网络访问权限是「已拒绝」。先确认这个端口上确实有
                                服务端在监听；如果服务端没问题，那就是浏览器的 Local Network Access 拦住了。
                            </div>
                            <div>1. 点地址栏左侧的图标 → 网站设置 → 允许「本地网络访问」</div>
                            <div>
                                2. 或在 chrome://flags/#local-network-access-check 里把 Local Network Access
                                Checks 设为 Disabled（需要重启浏览器）
                            </div>
                            <div>改完点「重试」。</div>
                        </div>
                        <div v-else-if="hintText" class="hint-row">{{ hintText }}</div>
                        <div v-if="bridge.state.lastError" class="error-row">{{ bridge.state.lastError }}</div>

                        <div class="button-row">
                            <button class="panel-button" :disabled="isConnected || isConnecting" @click="onConnect">
                                连接
                            </button>
                            <button class="panel-button" :disabled="isIdle" @click="onDisconnect">
                                断开
                            </button>
                            <button class="panel-button" @click="onRetry">重试</button>
                        </div>
                    </div>

                    <!-- 日志 ---------------------------------------------------->
                    <div v-show="activeTab === 'log'" class="tab-log">
                        <div class="log-toolbar">
                            <button class="panel-button is-small" @click="copyAllLog">复制全部</button>
                            <button class="panel-button is-small" :disabled="logEntries.length === 0" @click="clearLog">
                                清空
                            </button>
                            <label class="log-autoscroll">
                                <input v-model="autoScroll" type="checkbox" />
                                自动滚动
                            </label>
                        </div>
                        <div ref="logBox" class="log-box" @scroll="onLogScroll">
                            <div v-if="logEntries.length === 0" class="log-empty">
                                还没有通信记录。点「连接」之后，这里会显示双方收发的每一帧和错误信息。
                            </div>
                            <div
                                v-for="entry in logEntries"
                                :key="entry.id"
                                class="log-entry"
                                :class="`is-${entry.direction}`"
                                title="点击复制这一行"
                                @click="copyEntry(entry)"
                            >
                                <span class="log-time">{{ formatTime(entry.time) }}</span>
                                <span class="log-badge">{{ directionLabels[entry.direction] }}</span>
                                <span class="log-label">{{ entry.label }}</span>
                                <span class="log-text">{{ entry.text }}</span>
                                <span v-if="copiedLogId === entry.id" class="log-copied">已复制</span>
                            </div>
                        </div>
                    </div>

                    <!-- 文档 ---------------------------------------------------->
                    <div v-if="docs" v-show="activeTab === 'docs'" class="tab-docs">
                        <GameAutomationDocs v-bind="docs" />
                    </div>
                </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.automation-panel {
    position: fixed;
    right: min(5vw, 5vh);
    top: 50vh;
    transform: translateY(-50%);
    width: min(20vw, 220px);
    box-sizing: border-box;
    padding: min(1.6vh, 14px);
    display: flex;
    flex-direction: column;
    gap: min(1vh, 8px);
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(1.5vw, 2.2vh);
    line-height: 1.3;
    color: #fff6e0;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
    background-color: rgba(90, 50, 0, 0.35);
    border: 1px solid rgba(255, 246, 224, 0.35);
    border-radius: 12px;
    backdrop-filter: blur(4px);
}

.panel-title {
    font-size: 1.1em;
}

.port-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
}

.port-label {
    flex: none;
}

.port-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 0.25em 0.5em;
    font-family: inherit;
    font-size: inherit;
    color: #7c3200;
    background-color: #ffe9b3;
    border: none;
    border-radius: 6px;
    /* the game disables text selection globally, keep it usable here */
    user-select: text;
}

.status-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
}

.status-dot {
    width: 0.7em;
    height: 0.7em;
    border-radius: 50%;
    background-color: #d9d9d9;
}

.status-dot.is-connected {
    background-color: #7dff9b;
    box-shadow: 0 0 6px rgba(70, 255, 128, 0.9);
}

.status-dot.is-connecting {
    background-color: #ffd479;
}

.status-dot.is-blocked {
    background-color: #ff8f8f;
    box-shadow: 0 0 6px rgba(255, 90, 90, 0.9);
}

.info-row {
    font-size: 0.85em;
    opacity: 0.85;
    word-break: break-all;
}

.hint-row {
    display: flex;
    flex-direction: column;
    gap: 0.3em;
    padding: 0.35em 0.5em;
    font-size: 0.85em;
    color: #ffe9b3;
    background-color: rgba(124, 50, 0, 0.4);
    border-radius: 6px;
    word-break: break-word;
}

.hint-row.is-blocked {
    color: #ffd2d2;
    background-color: rgba(200, 40, 40, 0.35);
}

.error-row {
    font-size: 0.85em;
    color: #ffc9c9;
    word-break: break-word;
}

.button-row {
    display: flex;
    gap: 0.4em;
}

.panel-button {
    flex: 1;
    padding: 0.3em 0.2em;
    font-family: inherit;
    font-size: 0.9em;
    color: #7c3200;
    background-color: #ffe9b3;
    border: none;
    border-radius: 999px;
    cursor: pointer;
}

.panel-button.is-small {
    flex: none;
    padding: 0.25em 0.8em;
    font-size: 0.85em;
}

.panel-button:active {
    transform: translateY(1px);
}

.panel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.link-row {
    display: flex;
    align-items: center;
    gap: 0.4em;
    font-size: 0.85em;
}

.link-button {
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    color: #fff6e0;
    text-decoration: underline;
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.85;
}

.link-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.link-sep {
    opacity: 0.6;
}

/* ---------------------------------------------------------------- modal */

.automation-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3vh 3vw;
    box-sizing: border-box;
    background-color: rgba(40, 20, 0, 0.5);
}

.automation-modal {
    display: flex;
    flex-direction: column;
    /* one fixed box for every tab: the size must not breathe when the content
       of 连接 / 日志 / 文档 changes */
    width: min(90vw, 760px);
    height: min(86vh, 640px);
    overflow: hidden;
    font-family: 'DymonShouXieTi', sans-serif;
    color: #4a2400;
    background-color: #fff6e0;
    border: 2px solid #c98a2e;
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(40, 20, 0, 0.45);
    /* the box grows out of the middle of the mask */
    transform: scale(1);
    opacity: 1;
    transition: transform 0.24s ease, opacity 0.24s ease;
}

/* enter / leave: the mask fades, the box scales up from small */
.panel-modal-enter-active,
.panel-modal-leave-active {
    transition: opacity 0.24s ease;
}

.panel-modal-enter-from,
.panel-modal-leave-to {
    opacity: 0;
}

.panel-modal-enter-from .automation-modal,
.panel-modal-leave-to .automation-modal {
    transform: scale(0.84);
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .panel-modal-enter-active,
    .panel-modal-leave-active,
    .automation-modal {
        transition-duration: 0.01ms;
    }
}

.modal-header {
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.6em 0.9em;
    background-color: #ffe0a3;
    border-bottom: 1px solid rgba(124, 50, 0, 0.25);
}

.modal-title {
    font-size: 1.15em;
    white-space: nowrap;
}

.modal-tabs {
    display: flex;
    gap: 0.3em;
    margin-left: auto;
}

.modal-tab {
    padding: 0.25em 0.9em;
    font-family: inherit;
    font-size: 0.95em;
    color: #7c3200;
    background-color: rgba(124, 50, 0, 0.12);
    border: none;
    border-radius: 999px;
    cursor: pointer;
}

.modal-tab.is-active {
    color: #fff6e0;
    background-color: #c98a2e;
}

.tab-count {
    margin-left: 0.3em;
    font-size: 0.8em;
    opacity: 0.85;
}

.modal-close {
    flex: none;
    width: 1.8em;
    height: 1.8em;
    padding: 0;
    font-size: 1.2em;
    line-height: 1;
    color: #7c3200;
    background-color: rgba(124, 50, 0, 0.12);
    border: none;
    border-radius: 50%;
    cursor: pointer;
}

.modal-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0.9em;
    overflow: hidden;
    user-select: text;
}

.tab-connect {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.6em;
}

.detail-row {
    display: flex;
    gap: 0.5em;
    font-size: 0.9em;
    word-break: break-all;
}

.detail-label {
    flex: none;
    min-width: 4.5em;
    opacity: 0.65;
}

.tab-log {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5em;
}

.log-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5em;
}

.log-autoscroll {
    display: flex;
    align-items: center;
    gap: 0.3em;
    margin-left: auto;
    font-size: 0.85em;
    cursor: pointer;
}

.log-box {
    flex: 1;
    min-height: 0;
    padding: 0.5em;
    overflow: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #2f1a00;
    background-color: #2b1a08;
    border-radius: 8px;
    user-select: text;
}

.log-empty {
    padding: 1em;
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: 14px;
    color: #ffe9b3;
    opacity: 0.75;
}

.log-entry {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
    padding: 0.15em 0.3em;
    color: #f6e4c0;
    border-radius: 4px;
}

.log-entry:hover {
    background-color: rgba(255, 246, 224, 0.08);
}

.log-entry.is-in {
    color: #b9f0ff;
}

.log-entry.is-out {
    color: #cdf7c8;
}

.log-entry.is-error {
    color: #ffb0b0;
}

.log-entry.is-info {
    color: #ffe0a3;
}

.log-time {
    flex: none;
    opacity: 0.6;
}

.log-badge {
    flex: none;
    padding: 0 0.35em;
    border: 1px solid currentColor;
    border-radius: 4px;
    opacity: 0.8;
}

.log-label {
    flex: none;
    font-weight: bold;
}

.log-text {
    flex: 1;
    min-width: 0;
    word-break: break-all;
    white-space: pre-wrap;
}

.log-copied {
    /* taken out of the flow so the 已复制 hint cannot rewrap the line */
    position: absolute;
    top: 0.15em;
    right: 0.3em;
    padding: 0 0.4em;
    background-color: rgba(43, 26, 8, 0.92);
    border: 1px solid currentColor;
    border-radius: 4px;
    color: #7dff9b;
}

.tab-docs {
    flex: 1;
    min-height: 0;
    overflow: auto;
    color: #4a2400;
}
</style>
