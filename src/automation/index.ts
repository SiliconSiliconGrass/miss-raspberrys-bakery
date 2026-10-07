/**
 * Reusable WebSocket automation kit.
 *
 * Usage inside a mini-game:
 *
 *     const bridge = new GameAutomationBridge({ gameId: 'my-game', getState, ... })
 *     onBeforeUnmount(() => bridge.dispose())
 *
 *     <GameAutomationPanel :bridge="bridge" />
 *
 * The panel's 连接 button calls `connect()`. Nothing dials in on load: the
 * browser only asks for permission to reach the local network while the page
 * has user activation, and a dial without one is refused without a prompt.
 *
 * See `src/automation/README.md` for the protocol a player program speaks.
 */
export { default as GameAutomationBridge } from './GameAutomationBridge'
export type {
    AutomationBridgeHandle,
    AutomationConnectionStatus,
    AutomationLocalNetworkAccessState,
    AutomationLogDirection,
    AutomationLogEntry,
    GameAutomationAdapter,
    GameAutomationBridgeOptions,
    GameAutomationBridgeState,
} from './GameAutomationBridge'
export { AUTOMATION_LOG_LIMIT } from './GameAutomationBridge'

export { default as GameAutomationPanel } from './GameAutomationPanel.vue'
export { default as GameAutomationDocs } from './GameAutomationDocs.vue'
export { default as GameAutomationShareButton } from './GameAutomationShareButton.vue'

export type { AutomationDocsConfig, AutomationDocsExample } from './docs'

export * from './protocol'
