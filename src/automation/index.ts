/**
 * Reusable WebSocket automation kit.
 *
 * Usage inside a mini-game:
 *
 *     const bridge = new GameAutomationBridge({ gameId: 'my-game', getState, ... })
 *     onMounted(() => bridge.connect())
 *     onBeforeUnmount(() => bridge.dispose())
 *
 *     <GameAutomationPanel :bridge="bridge" />
 *
 * See `src/automation/README.md` for the protocol a player program speaks.
 */
export { default as GameAutomationBridge } from './GameAutomationBridge'
export type {
    AutomationBridgeHandle,
    AutomationConnectionStatus,
    GameAutomationAdapter,
    GameAutomationBridgeOptions,
    GameAutomationBridgeState,
} from './GameAutomationBridge'

export { default as GameAutomationPanel } from './GameAutomationPanel.vue'

export * from './protocol'
