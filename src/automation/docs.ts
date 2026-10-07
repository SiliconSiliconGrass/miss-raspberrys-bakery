import type { AutomationActionTypeDescriptor } from './protocol'

/**
 * One request / response pair shown in a game's automation documentation.
 * Both sides are plain JSON values, rendered as pretty-printed code blocks.
 */
export interface AutomationDocsExample {
    /** Short heading, e.g. `查询局面` or `放下一个拼图`. */
    title: string
    /** Optional sentence explaining what the example does. */
    description?: string
    /**
     * The frame the player program sends. Omitted for events, which the game
     * pushes on its own and never answers.
     */
    request?: unknown
    /** The frame the game answers with. */
    response: unknown
}

/**
 * Everything `GameAutomationDocs` needs to render one game's automation
 * manual. Each mini-game builds one of these next to its bridge and hands it
 * to `GameAutomationPanel` (the panel shows it behind its 文档 button).
 */
export interface AutomationDocsConfig {
    /** The `gameId` the bridge reports, shown in the header. */
    gameId: string
    /** Heading of the document, e.g. `货物游戏自动化`. */
    title: string
    /** One or two sentences about what a player program has to do. */
    summary: string
    /**
     * The action kinds this game accepts, in the same shape the bridge puts in
     * `level.actionTypes`. Always a list, even for a single kind.
     */
    actionTypes: AutomationActionTypeDescriptor[]
    /** Request / response pairs, e.g. one per action kind plus `states` / `submit`. */
    examples?: AutomationDocsExample[]
    /** Plain-text notes shown at the bottom (each entry is one bullet). */
    notes?: string[]
}
