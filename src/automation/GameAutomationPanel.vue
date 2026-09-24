<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { AutomationBridgeHandle } from './GameAutomationBridge'

/**
 * Reusable control panel for the automation bridge: pick the port, connect,
 * disconnect and retry. Every mini-game drops this next to its own UI.
 */
const props = withDefaults(
    defineProps<{
        bridge: AutomationBridgeHandle
        title?: string
    }>(),
    { title: '自动化接入' },
)

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
</script>

<template>
    <div class="automation-panel">
        <div class="panel-title">{{ title }}</div>

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

        <div class="info-row">{{ bridge.state.serverUrl }}</div>
        <div class="info-row">{{ queueText }} · {{ bridge.actionIntervalMs / 1000 }} 秒 / 步</div>
        <div v-if="permissionText" class="info-row">本地网络访问权限：{{ permissionText }}</div>
        <div v-if="attemptText" class="info-row">{{ attemptText }}</div>

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

.panel-button:active {
    transform: translateY(1px);
}

.panel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
