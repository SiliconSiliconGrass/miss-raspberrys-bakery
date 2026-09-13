/**
 * Wire protocol shared by every mini-game that supports external automation.
 *
 * The game is always the WebSocket **client**: it connects to a WebSocket server
 * written by the player (`ws://localhost:<port>` by default), so a player can
 * drive the UI with their own program. The same protocol is used by all
 * mini-games, only the `state` payload and the action shape differ.
 *
 * Command (player program -> game):
 *
 *     { "id": 1, "type": "states" | "actions" | "submit" | "ping", "payload": { ... } }
 *
 * Response (game -> player program, `id` is echoed back so requests can be
 * matched up; `type` is always `<command>.result`):
 *
 *     { "id": 1, "type": "states.result", "ok": true,  "payload": { ... } }
 *     { "id": 1, "type": "submit.result", "ok": false, "error": { "code": "...", "message": "..." } }
 *
 * Event (game -> player program, unsolicited, never has an `id`):
 *
 *     { "type": "event", "event": "hello" | "level.started" | ..., "payload": { ... } }
 *
 * Commands may be sent at any time and as often as the player wants; the game
 * answers every one of them. The three timing rules below are part of the
 * protocol and are enforced by the game, not by the player program.
 */

export const AUTOMATION_PROTOCOL_VERSION = '1.0.0'

/** A buffered action is executed once per second. */
export const AUTOMATION_ACTION_INTERVAL_MS = 1000

/** Two submissions must be at least two seconds apart. */
export const AUTOMATION_SUBMIT_INTERVAL_MS = 2000

/** After a failed connection attempt the game retries once per second. */
export const AUTOMATION_RECONNECT_INTERVAL_MS = 1000

/** A connection attempt that never completes its handshake is a failure. */
export const AUTOMATION_CONNECT_TIMEOUT_MS = 5000

/** Port the game tries to connect to when the player never typed one. */
export const AUTOMATION_DEFAULT_PORT = 8000

/** Command types understood by every game. */
export type AutomationCommandType = 'states' | 'actions' | 'submit' | 'ping'

export const AUTOMATION_ERROR_CODES = {
    /** The frame was not a JSON object with a `type` string. */
    badRequest: 'bad_request',
    /** The `type` is not one of the command types the game knows. */
    unknownCommand: 'unknown_command',
    /** The `actions` payload did not look like a list of actions. */
    invalidActionPayload: 'invalid_action_payload',
    /** At least one action was rejected; nothing from that batch was queued. */
    invalidAction: 'invalid_action',
    /** The player called `submit` again too soon (see `retryAfterMs`). */
    submitRateLimited: 'submit_rate_limited',
    /** Another `submit` is already waiting for the buffered actions to finish. */
    submitPending: 'submit_pending',
    /** The game is in a transition (e.g. the submit animation) and cannot submit. */
    gameBusy: 'game_busy',
    /** The game itself failed to answer the command. */
    internalError: 'internal_error',
} as const

export type AutomationErrorCode =
    (typeof AUTOMATION_ERROR_CODES)[keyof typeof AUTOMATION_ERROR_CODES]

export interface AutomationError {
    code: AutomationErrorCode | string
    message: string
    /** Extra machine readable information, e.g. `{ retryAfterMs: 800 }`. */
    details?: unknown
}

/** Anything meaningful that a player program may send. */
export interface AutomationCommand<TPayload = unknown> {
    id?: string | number
    type: AutomationCommandType | string
    payload?: TPayload
}

export interface AutomationSuccess<TPayload = unknown> {
    id?: string | number
    type: string
    ok: true
    payload: TPayload
}

export interface AutomationFailure {
    id?: string | number
    type: string
    ok: false
    error: AutomationError
}

export type AutomationResponse<TPayload = unknown> =
    | AutomationSuccess<TPayload>
    | AutomationFailure

export interface AutomationEvent<TPayload = unknown> {
    type: 'event'
    event: string
    payload?: TPayload
}

/** Board shape shared by the grid based games, e.g. the baking game. */
export interface AutomationBoardSnapshot {
    numRows: number
    numCols: number
    numTypes: number
    /** `matrix[rowInd][colInd]`, a copy that the player may mutate freely. */
    matrix: number[][]
}

/** Queue / rate limit information attached to every `states` answer. */
export interface AutomationQueueSnapshot {
    /** Actions still waiting in the buffer. */
    pending: number
    /** Actions executed since the game was loaded. */
    executed: number
    /** Time between two buffered actions, in milliseconds. */
    actionIntervalMs: number
    /**
     * True while a `submit` is waiting for the buffer to drain, so that the
     * submit never overtakes the actions.
     */
    submitHeld: boolean
    /** Milliseconds until `submit` is accepted again, 0 when it is ready. */
    submitReadyInMs: number
    /** Minimum delay between two submissions, in milliseconds. */
    submitIntervalMs: number
}

/** Payload of the `actions` command / answer. */
export interface AutomationActionsPayload<TAction = unknown> {
    actions: TAction[]
}

export interface AutomationActionsResult {
    /** Number of actions added to the buffer by this command. */
    accepted: number
    /** Actions still waiting in the buffer. */
    pending: number
    /** Milliseconds until every accepted action has been executed. */
    estimatedDrainMs: number
    actionIntervalMs: number
}

/** The `hello` event is sent right after the connection is established. */
export interface AutomationHelloEvent {
    protocolVersion: string
    gameId: string
    serverTime: number
    actionIntervalMs: number
    submitIntervalMs: number
    level?: Record<string, unknown>
    state?: unknown
}

export function isAutomationCommand(value: unknown): value is AutomationCommand {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as AutomationCommand).type === 'string'
    )
}

/** Human readable message for a thrown value. */
export function automationErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }
    return String(error)
}
