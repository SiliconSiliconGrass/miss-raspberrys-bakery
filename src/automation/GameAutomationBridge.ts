import { reactive } from 'vue'

import {
    AUTOMATION_ACTION_INTERVAL_MS,
    AUTOMATION_CONNECT_TIMEOUT_MS,
    AUTOMATION_DEFAULT_PORT,
    AUTOMATION_ERROR_CODES,
    AUTOMATION_PROTOCOL_VERSION,
    AUTOMATION_RECONNECT_INTERVAL_MS,
    AUTOMATION_SUBMIT_INTERVAL_MS,
    automationErrorMessage,
    type AutomationActionsPayload,
    type AutomationCommand,
    type AutomationEvent,
    type AutomationFailure,
    type AutomationResponse,
    type AutomationSuccess,
} from './protocol'

/**
 * What a mini-game has to provide so that `GameAutomationBridge` can drive it.
 * Every game implements this small adapter; the connection handling, the
 * reconnect loop, the action buffer and the rate limits stay identical.
 */
export interface GameAutomationAdapter<
    TAction = unknown,
    TState extends object = Record<string, unknown>,
> {
    /** Stable identifier reported to player programs, e.g. `"baking"`. */
    readonly gameId: string
    /**
     * Snapshot of the *current* game state. Called for every `states` command,
     * so it must read the live game and not a cached initial value.
     */
    getState(): TState
    /**
     * Turn one raw action coming from the player into a validated action.
     * Throw an `Error` with a helpful message to reject it.
     */
    normalizeAction(raw: unknown): TAction
    /** Apply one validated action. Called at most once per action tick. */
    applyAction(action: TAction): void
    /** Return false while the game cannot take actions, e.g. mid transition. */
    canApplyAction?(): boolean
    /** Whether the answer may be submitted right now. */
    canSubmit?(): boolean
    /** Submit the current answer; the returned object is sent back verbatim. */
    submit(): Record<string, unknown> | void
    /** Extra level metadata attached to `hello` / `level.started`. */
    describeLevel?(): Record<string, unknown>
}

export interface GameAutomationBridgeOptions {
    /** Time between two buffered actions, defaults to 1000 ms. */
    actionIntervalMs?: number
    /** Minimum delay between two submissions, defaults to 2000 ms. */
    submitIntervalMs?: number
    /** Delay between two connection attempts, defaults to 1000 ms. */
    reconnectIntervalMs?: number
    /**
     * Give up on a connection attempt that never completes the handshake,
     * defaults to 5000 ms. A local program answers in milliseconds, so a stuck
     * attempt is treated as a failure and retried like any other.
     */
    connectTimeoutMs?: number
    /** Build the URL to dial, defaults to `ws://localhost:<port>`. */
    urlForPort?: (port: number) => string
    /**
     * `localStorage` key remembering the port; pass `null` to disable.
     * Defaults to `automation:port:<gameId>`.
     */
    storageKey?: string | null
    /**
     * Drop actions that are still buffered when a new level starts. On by
     * default: those actions were written for the previous board.
     */
    clearActionBufferOnLevelChange?: boolean
    /**
     * Log every frame sent / received plus connection, action and submit
     * events to the browser console with an `[automation]` prefix.
     * On by default; pass `false` to keep the console quiet.
     */
    debug?: boolean
}

/**
 * `idle` means the player never asked for a connection yet: the games do not
 * dial in on load, see `GameAutomationPanel` for the reason.
 */
export type AutomationConnectionStatus = 'idle' | 'disconnected' | 'connecting' | 'connected'

/**
 * What the browser says about this page reaching the local network. `unknown`
 * covers the browsers which have no such gate, or do not expose it.
 */
export type AutomationLocalNetworkAccessState = 'granted' | 'prompt' | 'denied' | 'unknown'

export interface GameAutomationBridgeState {
    /** Port currently dialed, the only thing the player has to configure. */
    port: number
    status: AutomationConnectionStatus
    /** URL built from `port`, shown in the UI. */
    serverUrl: string
    /** Timestamp of the last successful connection, null while offline. */
    connectedAt: number | null
    /** Connection attempts since the last successful connection. */
    attemptCount: number
    /** Last connection / protocol error, empty while everything is fine. */
    lastError: string
    /**
     * True once the browser refused a request to the local network: every
     * further attempt is denied without a prompt, so retrying is pointless
     * until the player changes the permission in the site settings.
     */
    blockedByBrowser: boolean
    /** Current state of the local network access permission. */
    permissionState: AutomationLocalNetworkAccessState
    /** Actions waiting in the buffer. */
    pendingActions: number
    /** Actions executed since the bridge was created. */
    executedActions: number
    /** Actions thrown away (invalid or cleared on a level change). */
    droppedActions: number
    /** Timestamp of the last submission, null when nothing was submitted yet. */
    lastSubmitAt: number | null
}

/** The subset of the bridge the reusable UI panel needs. */
export interface AutomationBridgeHandle {
    readonly state: GameAutomationBridgeState
    readonly submitIntervalMs: number
    readonly actionIntervalMs: number
    setPort(port: number | string): boolean
    connect(port?: number): void
    disconnect(): void
    reconnect(): void
}

/**
 * Owns the WebSocket connection to the player's automation program plus the
 * timing rules of the protocol:
 *
 * - reconnect every second while the connection cannot be established,
 * - execute one buffered action per second,
 * - refuse two submissions that are less than two seconds apart.
 */
export default class GameAutomationBridge<
    TAction = unknown,
    TState extends object = Record<string, unknown>,
> implements AutomationBridgeHandle {
    readonly adapter: GameAutomationAdapter<TAction, TState>
    readonly actionIntervalMs: number
    readonly submitIntervalMs: number
    readonly reconnectIntervalMs: number
    readonly connectTimeoutMs: number
    readonly state: GameAutomationBridgeState

    private readonly urlForPort: (port: number) => string
    private readonly storageKey: string | null
    private readonly clearActionBufferOnLevelChange: boolean
    private readonly debug: boolean

    private socket: WebSocket | null = null
    private retryTimer: ReturnType<typeof setTimeout> | null = null
    private connectTimer: ReturnType<typeof setTimeout> | null = null
    private actionTimer: ReturnType<typeof setInterval> | null = null
    private submitTimer: ReturnType<typeof setTimeout> | null = null
    private actionBuffer: TAction[] = []
    private pendingSubmit: AutomationCommand | null = null
    private lastActionAt = 0
    private wantConnection = false
    private lastSubmitAt = 0
    private disposed = false

    constructor(
        adapter: GameAutomationAdapter<TAction, TState>,
        options: GameAutomationBridgeOptions = {},
    ) {
        this.adapter = adapter
        this.actionIntervalMs = options.actionIntervalMs ?? AUTOMATION_ACTION_INTERVAL_MS
        this.submitIntervalMs = options.submitIntervalMs ?? AUTOMATION_SUBMIT_INTERVAL_MS
        this.reconnectIntervalMs = options.reconnectIntervalMs ?? AUTOMATION_RECONNECT_INTERVAL_MS
        this.connectTimeoutMs = options.connectTimeoutMs ?? AUTOMATION_CONNECT_TIMEOUT_MS
        this.urlForPort = options.urlForPort ?? ((port) => `ws://localhost:${port}`)
        this.storageKey =
            options.storageKey === undefined ? `automation:port:${adapter.gameId}` : options.storageKey
        this.clearActionBufferOnLevelChange = options.clearActionBufferOnLevelChange ?? true
        this.debug = options.debug ?? true

        const port = this.loadPort() ?? AUTOMATION_DEFAULT_PORT
        this.state = reactive<GameAutomationBridgeState>({
            port,
            status: 'idle',
            serverUrl: this.urlForPort(port),
            connectedAt: null,
            attemptCount: 0,
            lastError: '',
            blockedByBrowser: false,
            permissionState: 'unknown',
            pendingActions: 0,
            executedActions: 0,
            droppedActions: 0,
            lastSubmitAt: null,
        })

        // only fills in the display before the player asks for a connection
        void this.refreshPermissionState()
    }

    // ---------------------------------------------------------------- connection

    /**
     * Remember the port the player wants to talk to. Returns false (and keeps
     * the previous port) when the value is not a valid TCP port.
     */
    setPort(port: number | string): boolean {
        const value = typeof port === 'string' ? Number.parseInt(port, 10) : Math.trunc(port)
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
            return false
        }
        this.state.port = value
        this.state.serverUrl = this.urlForPort(value)
        this.savePort(value)
        return true
    }

    /** Start dialing, retrying once per second until the player program answers. */
    connect(port?: number): void {
        if (port !== undefined) {
            this.setPort(port)
        }
        if (this.disposed) {
            return
        }
        this.log(`connect requested, dialing ${this.state.serverUrl}`)
        this.wantConnection = true
        this.state.lastError = ''
        this.state.blockedByBrowser = false
        this.clearRetryTimer()
        // Dials synchronously: the browser only asks for the local network
        // access permission while the page has user activation, so this has to
        // stay inside the click that called us.
        this.openSocket()
        void this.refreshPermissionState()
    }

    /** Stop dialing and close the current connection. */
    disconnect(): void {
        this.log('disconnect requested')
        this.wantConnection = false
        this.clearRetryTimer()
        this.dropPendingSubmit()
        this.closeSocket()
        this.state.status = 'idle'
        this.state.connectedAt = null
        this.state.blockedByBrowser = false
    }

    /** Manual retry: forget the failure count and dial again right now. */
    reconnect(): void {
        this.log('manual retry')
        this.state.attemptCount = 0
        this.connect()
    }

    /** Close everything and release the timers, called when the game unmounts. */
    dispose(): void {
        this.disposed = true
        this.disconnect()
        this.stopActionTimer()
        this.dropPendingSubmit()
        this.actionBuffer = []
        this.state.pendingActions = 0
    }

    private openSocket(): void {
        this.closeSocket()
        if (!this.wantConnection || this.disposed) {
            return
        }

        this.state.status = 'connecting'
        this.state.attemptCount += 1
        this.log(`opening ${this.state.serverUrl} (attempt ${this.state.attemptCount})`)

        let socket: WebSocket
        try {
            socket = new WebSocket(this.state.serverUrl)
        } catch (error) {
            this.log('socket construction failed:', automationErrorMessage(error))
            this.recordFailure(automationErrorMessage(error))
            this.scheduleRetry()
            return
        }

        this.socket = socket
        socket.addEventListener('open', this.handleOpen)
        socket.addEventListener('message', this.handleMessage)
        socket.addEventListener('close', this.handleClose)
        socket.addEventListener('error', this.handleError)

        this.clearConnectTimer()
        this.connectTimer = setTimeout(() => {
            this.connectTimer = null
            this.log(`handshake did not finish within ${this.connectTimeoutMs} ms, retrying`)
            this.recordFailure(`timed out connecting to ${this.state.serverUrl}`)
            this.closeSocket()
            this.scheduleRetry()
            void this.noteConnectionFailure()
        }, this.connectTimeoutMs)
    }

    private closeSocket(): void {
        this.clearConnectTimer()
        const socket = this.socket
        this.socket = null
        if (!socket) {
            return
        }
        socket.removeEventListener('open', this.handleOpen)
        socket.removeEventListener('message', this.handleMessage)
        socket.removeEventListener('close', this.handleClose)
        socket.removeEventListener('error', this.handleError)
        try {
            socket.close()
        } catch {
            // closing an already broken socket is fine
        }
    }

    private readonly handleOpen = (): void => {
        this.clearConnectTimer()
        this.log(`connected to ${this.state.serverUrl}`)
        this.state.status = 'connected'
        this.state.connectedAt = Date.now()
        this.state.attemptCount = 0
        this.state.lastError = ''
        // reaching the player program is the last word: whatever the permission
        // query claims, this page clearly may talk to the local network
        this.state.blockedByBrowser = false

        this.sendEvent('hello', {
            protocolVersion: AUTOMATION_PROTOCOL_VERSION,
            gameId: this.adapter.gameId,
            serverTime: Date.now(),
            actionIntervalMs: this.actionIntervalMs,
            submitIntervalMs: this.submitIntervalMs,
            level: this.describeLevel(),
            state: this.safeGetState(),
        })
    }

    private readonly handleMessage = (event: MessageEvent): void => {
        if (typeof event.data !== 'string') {
            this.log('<-- (binary frame ignored)')
            this.sendFailure(undefined, AUTOMATION_ERROR_CODES.badRequest, 'only text frames are supported')
            return
        }
        this.log(`<-- ${event.data}`)

        let command: AutomationCommand
        try {
            const parsed: unknown = JSON.parse(event.data)
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('a command must be a JSON object')
            }
            if (typeof (parsed as AutomationCommand).type !== 'string') {
                throw new Error('a command must have a string "type" field')
            }
            command = parsed as AutomationCommand
        } catch (error) {
            this.sendFailure(undefined, AUTOMATION_ERROR_CODES.badRequest, automationErrorMessage(error))
            return
        }

        switch (command.type) {
            case 'states':
                this.handleStates(command)
                return
            case 'actions':
                this.handleActions(command)
                return
            case 'submit':
                this.handleSubmit(command)
                return
            case 'ping':
                this.sendSuccess(command, {
                    gameId: this.adapter.gameId,
                    serverTime: Date.now(),
                })
                return
            default:
                this.sendFailure(
                    command,
                    AUTOMATION_ERROR_CODES.unknownCommand,
                    `unknown command type "${command.type}", expected "states", "actions", "submit" or "ping"`,
                )
        }
    }

    private readonly handleClose = (event: CloseEvent): void => {
        this.clearConnectTimer()
        const wasConnected = this.state.status === 'connected'
        this.log(`socket closed (code ${event.code}${event.reason ? `, reason ${event.reason}` : ''})`)
        this.dropPendingSubmit()
        this.socket = null
        this.state.status = 'disconnected'
        this.state.connectedAt = null
        if (this.wantConnection && !this.disposed) {
            // code 1006 means the handshake never completed, usually because
            // nothing is listening on the port yet
            this.recordFailure(
                wasConnected
                    ? `connection to ${this.state.serverUrl} was closed (code ${event.code})`
                    : `cannot connect to ${this.state.serverUrl} (code ${event.code})`,
            )
            this.scheduleRetry()
            void this.noteConnectionFailure()
        }
    }

    private readonly handleError = (): void => {
        // the close event follows and schedules the retry
        this.log(`socket error on ${this.state.serverUrl}`)
        this.recordFailure(`cannot connect to ${this.state.serverUrl}`)
    }

    private scheduleRetry(): void {
        this.clearRetryTimer()
        if (!this.wantConnection || this.disposed) {
            return
        }
        this.log(`retrying in ${this.reconnectIntervalMs} ms`)
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            this.openSocket()
        }, this.reconnectIntervalMs)
    }

    private clearRetryTimer(): void {
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer)
            this.retryTimer = null
        }
    }

    private clearConnectTimer(): void {
        if (this.connectTimer !== null) {
            clearTimeout(this.connectTimer)
            this.connectTimer = null
        }
    }

    private recordFailure(message: string): void {
        this.state.lastError = message
        this.state.status = 'disconnected'
    }

    /** Read the permission for the panel's display only; it decides nothing. */
    private async refreshPermissionState(): Promise<void> {
        const permission = await queryLocalNetworkAccess()
        if (this.disposed) {
            return
        }
        this.state.permissionState = permission
    }

    /**
     * Called after a connection attempt really failed. Only then does a denied
     * permission mean the browser blocked us: a page can be marked denied and
     * still connect, for example when Chrome's `Local Network Access Checks`
     * flag is switched off.
     *
     * While it is blocked, retrying is pointless (a denied page gets no new
     * prompt), so the retry loop stops and the panel explains the two ways out.
     */
    private async noteConnectionFailure(): Promise<void> {
        await this.refreshPermissionState()
        if (this.disposed || this.state.permissionState !== 'denied') {
            return
        }
        // a successful retry, or the player pressing 断开, wins over this
        if (!this.wantConnection || this.state.status === 'connected') {
            return
        }
        this.log('the connection failed and local network access is denied, stopping the retry loop')
        this.clearRetryTimer()
        this.wantConnection = false
        this.state.blockedByBrowser = true
        this.state.status = 'disconnected'
    }

    // ----------------------------------------------------------------- commands

    private handleStates(command: AutomationCommand): void {
        try {
            this.sendSuccess(command, {
                gameId: this.adapter.gameId,
                serverTime: Date.now(),
                level: this.describeLevel(),
                state: this.adapter.getState(),
                queue: {
                    pending: this.actionBuffer.length,
                    executed: this.state.executedActions,
                    actionIntervalMs: this.actionIntervalMs,
                    submitHeld: this.pendingSubmit !== null,
                    submitReadyInMs: this.submitReadyInMs(),
                    submitIntervalMs: this.submitIntervalMs,
                },
            })
        } catch (error) {
            this.sendFailure(command, AUTOMATION_ERROR_CODES.internalError, automationErrorMessage(error))
        }
    }

    private handleActions(command: AutomationCommand): void {
        const rawActions = extractActionList(command.payload)
        if (rawActions === null) {
            this.sendFailure(
                command,
                AUTOMATION_ERROR_CODES.invalidActionPayload,
                'payload must be an array of actions, or an object like { "actions": [ ... ] }',
            )
            return
        }

        const accepted: TAction[] = []
        const rejected: Array<{ index: number; message: string }> = []
        rawActions.forEach((rawAction, index) => {
            try {
                accepted.push(this.adapter.normalizeAction(rawAction))
            } catch (error) {
                rejected.push({ index, message: automationErrorMessage(error) })
            }
        })

        // all or nothing: a partially applied solution is harder to reason about
        if (rejected.length > 0) {
            this.sendFailure(
                command,
                AUTOMATION_ERROR_CODES.invalidAction,
                `${rejected.length} of ${rawActions.length} actions were rejected, nothing was queued`,
                { rejected },
            )
            return
        }

        if (accepted.length === 0) {
            this.sendSuccess(command, {
                accepted: 0,
                pending: this.actionBuffer.length,
                estimatedDrainMs: 0,
                actionIntervalMs: this.actionIntervalMs,
            })
            return
        }

        this.actionBuffer.push(...accepted)
        this.syncPendingActions()
        this.startActionTimer()
        this.log(
            `queued ${accepted.length} action(s), ${this.actionBuffer.length} pending, ` +
            `${this.actionIntervalMs} ms per action`,
            accepted,
        )

        this.sendSuccess(command, {
            accepted: accepted.length,
            pending: this.actionBuffer.length,
            estimatedDrainMs: this.actionBuffer.length * this.actionIntervalMs,
            actionIntervalMs: this.actionIntervalMs,
        })
    }

    private handleSubmit(command: AutomationCommand): void {
        // The submit is the step *after* the action queue: it waits for every
        // buffered action and keeps the 1 s spacing after the last one, so a
        // tap and the submit can never land on the same beat.
        if (this.actionBuffer.length > 0 || this.actionWaitRemainingMs() > 0) {
            if (this.pendingSubmit) {
                this.sendFailure(
                    command,
                    AUTOMATION_ERROR_CODES.submitPending,
                    'another submit is already waiting for the buffered actions',
                )
                return
            }
            this.pendingSubmit = command
            this.log(
                `submit held back until ${this.actionBuffer.length} buffered action(s) ` +
                `are done plus ${this.actionIntervalMs} ms`,
            )
            this.flushPendingSubmit()
            return
        }

        this.performSubmit(command)
    }

    /** Run a held back submit as soon as the action queue allows it. */
    private flushPendingSubmit(): void {
        const command = this.pendingSubmit
        if (!command) {
            return
        }
        // while actions are still buffered the action timer calls us again
        if (this.actionBuffer.length > 0) {
            return
        }

        const waitMs = this.actionWaitRemainingMs()
        if (waitMs > 0) {
            if (this.submitTimer === null) {
                this.log(`submit will run in ${waitMs} ms (one action interval after the last tap)`)
                this.submitTimer = setTimeout(() => {
                    this.submitTimer = null
                    this.flushPendingSubmit()
                }, waitMs)
            }
            return
        }

        this.pendingSubmit = null
        this.clearSubmitTimer()
        this.performSubmit(command)
    }

    /** Milliseconds left before a submit may follow the last executed action. */
    private actionWaitRemainingMs(): number {
        if (this.lastActionAt === 0) {
            return 0
        }
        const elapsed = Date.now() - this.lastActionAt
        return elapsed >= this.actionIntervalMs ? 0 : this.actionIntervalMs - elapsed
    }

    private performSubmit(command: AutomationCommand): void {
        const readyInMs = this.submitReadyInMs()
        if (readyInMs > 0) {
            this.sendFailure(
                command,
                AUTOMATION_ERROR_CODES.submitRateLimited,
                `submit is limited to one call every ${this.submitIntervalMs} ms`,
                { retryAfterMs: readyInMs, submitIntervalMs: this.submitIntervalMs },
            )
            return
        }

        if (this.adapter.canSubmit && !this.adapter.canSubmit()) {
            this.sendFailure(
                command,
                AUTOMATION_ERROR_CODES.gameBusy,
                'the game is still playing the previous submission',
            )
            return
        }

        try {
            const result = this.adapter.submit() ?? {}
            this.markSubmitted()
            this.log('submit accepted:', result)
            this.sendSuccess(command, { ...result, submittedAt: Date.now() })
        } catch (error) {
            this.log('submit failed:', automationErrorMessage(error))
            this.sendFailure(command, AUTOMATION_ERROR_CODES.internalError, automationErrorMessage(error))
        }
    }

    private dropPendingSubmit(): void {
        if (this.pendingSubmit) {
            this.log('dropping the held submit, the connection is gone')
            this.pendingSubmit = null
        }
        this.clearSubmitTimer()
    }

    private clearSubmitTimer(): void {
        if (this.submitTimer !== null) {
            clearTimeout(this.submitTimer)
            this.submitTimer = null
        }
    }

    /**
     * Start the 2 s cooldown. Called by the bridge itself and, for the manual
     * submit button, by the game through this public method.
     */
    markSubmitted(): void {
        this.lastSubmitAt = Date.now()
        this.state.lastSubmitAt = this.lastSubmitAt
    }

    /** Milliseconds until the next `submit` is accepted, 0 when it is ready. */
    submitReadyInMs(): number {
        if (this.lastSubmitAt === 0) {
            return 0
        }
        const elapsed = Date.now() - this.lastSubmitAt
        return elapsed >= this.submitIntervalMs ? 0 : this.submitIntervalMs - elapsed
    }

    // -------------------------------------------------------------- action buffer

    private startActionTimer(): void {
        if (this.actionTimer !== null) {
            return
        }
        this.actionTimer = setInterval(() => this.executeNextAction(), this.actionIntervalMs)
    }

    private stopActionTimer(): void {
        if (this.actionTimer !== null) {
            clearInterval(this.actionTimer)
            this.actionTimer = null
        }
    }

    private executeNextAction(): void {
        if (this.actionBuffer.length === 0) {
            this.stopActionTimer()
            return
        }
        // wait for transitions (e.g. the submit animation) instead of wasting actions
        if (this.adapter.canApplyAction && !this.adapter.canApplyAction()) {
            return
        }

        const action = this.actionBuffer.shift() as TAction
        this.syncPendingActions()
        try {
            this.adapter.applyAction(action)
            this.state.executedActions += 1
            this.lastActionAt = Date.now()
            this.log(
                `executed action ${this.state.executedActions} ` +
                `(${this.actionBuffer.length} still buffered):`,
                action,
            )
        } catch (error) {
            this.state.droppedActions += 1
            this.log('action failed:', automationErrorMessage(error))
            this.recordFailure(`action failed: ${automationErrorMessage(error)}`)
        }

        if (this.actionBuffer.length === 0) {
            this.stopActionTimer()
        }
        // the queue moved, a held submit may be allowed to run now (or soon)
        this.flushPendingSubmit()
    }

    private syncPendingActions(): void {
        this.state.pendingActions = this.actionBuffer.length
    }

    // -------------------------------------------------------------------- events

    /** Send an unsolicited event to the player program, if one is connected. */
    sendEvent(event: string, payload?: unknown): void {
        const message: AutomationEvent = payload === undefined
            ? { type: 'event', event }
            : { type: 'event', event, payload }
        this.send(message)
    }

    /**
     * Tell the bridge that a new level was dealt: buffered actions belong to
     * the previous board and are dropped, then `level.started` is announced.
     */
    notifyLevelStarted(): void {
        if (this.clearActionBufferOnLevelChange && this.actionBuffer.length > 0) {
            this.log(`level changed, dropping ${this.actionBuffer.length} buffered action(s)`)
            this.state.droppedActions += this.actionBuffer.length
            this.actionBuffer = []
            this.syncPendingActions()
            this.stopActionTimer()
        }
        this.sendEvent('level.started', {
            gameId: this.adapter.gameId,
            serverTime: Date.now(),
            level: this.describeLevel(),
            state: this.safeGetState(),
        })
    }

    private describeLevel(): Record<string, unknown> {
        return this.adapter.describeLevel?.() ?? {}
    }

    private safeGetState(): TState | null {
        try {
            return this.adapter.getState()
        } catch {
            return null
        }
    }

    // ------------------------------------------------------------------ plumbing

    private sendSuccess<TResult extends object>(
        command: AutomationCommand,
        payload: TResult,
    ): void {
        const response: AutomationSuccess<TResult> = {
            id: command.id,
            type: `${command.type}.result`,
            ok: true,
            payload,
        }
        this.send(response)
    }

    private sendFailure(
        command: AutomationCommand | undefined,
        code: string,
        message: string,
        details?: unknown,
    ): void {
        const response: AutomationFailure = {
            id: command?.id,
            type: typeof command?.type === 'string' ? `${command.type}.result` : 'error',
            ok: false,
            error: details === undefined ? { code, message } : { code, message, details },
        }
        this.send(response)
    }

    private send(message: AutomationResponse | AutomationEvent): void {
        const socket = this.socket
        const text = JSON.stringify(message)
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            this.log(`--> dropped (socket not open): ${text}`)
            return
        }
        this.log(`--> ${text}`)
        socket.send(text)
    }

    /** Console logging, prefixed so it can be filtered with `[automation]`. */
    private log(...parts: unknown[]): void {
        if (!this.debug) {
            return
        }
        console.log('[automation]', ...parts)
    }

    private loadPort(): number | null {
        if (this.storageKey === null || typeof localStorage === 'undefined') {
            return null
        }
        try {
            const stored = localStorage.getItem(this.storageKey)
            return stored === null ? null : Number.parseInt(stored, 10)
        } catch {
            return null
        }
    }

    private savePort(port: number): void {
        if (this.storageKey === null || typeof localStorage === 'undefined') {
            return
        }
        try {
            localStorage.setItem(this.storageKey, String(port))
        } catch {
            // private mode and friends
        }
    }
}

/**
 * Accept both `[ {...}, {...} ]` and `{ "actions": [ {...} ] }` so a player
 * program can pick whichever is convenient.
 */
function extractActionList(payload: unknown): unknown[] | null {
    if (Array.isArray(payload)) {
        return payload
    }
    if (typeof payload === 'object' && payload !== null) {
        const actions = (payload as AutomationActionsPayload).actions
        if (Array.isArray(actions)) {
            return actions
        }
    }
    return null
}

/**
 * Ask the browser whether this page may talk to the local network.
 *
 * Chrome gates requests from a public page (an `https://...` toy host) to a
 * loopback address behind the `local-network-access` permission, and only
 * prompts while the page has user activation. Browsers without that gate, or
 * without the permission in their queryable set, answer `unknown`.
 */
async function queryLocalNetworkAccess(): Promise<AutomationLocalNetworkAccessState> {
    const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
    if (!permissions || typeof permissions.query !== 'function') {
        return 'unknown'
    }
    try {
        // the name is not in the DOM typings yet
        const descriptor = { name: 'local-network-access' } as unknown as PermissionDescriptor
        const status = await permissions.query(descriptor)
        return status.state
    } catch {
        return 'unknown'
    }
}
