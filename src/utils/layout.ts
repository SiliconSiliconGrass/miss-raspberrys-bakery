/**
 * A portrait screen up to this width counts as a phone, in CSS px. The
 * mini-games lay themselves out as a column there: the pieces above the board
 * instead of beside it, the target of the baking game above its play board.
 */
export const PHONE_MAX_WIDTH = 820

/**
 * True while a screen has to be laid out the phone way: portrait, and no wider
 * than a phone. A phone held sideways keeps the wide layout, which fits it.
 */
export function isPhoneScreen(viewWidth = window.innerWidth, viewHeight = window.innerHeight) {
    return viewWidth <= PHONE_MAX_WIDTH && viewHeight > viewWidth
}

/**
 * Mark the phone layout of one mini-game on `<html>`.
 *
 * Every stylesheet stays in the document once its chunk has been loaded, and
 * the two games share most of their class names, so each game marks its own
 * rules with its own flag (`is-phone-baking`, `is-phone-cargo`) and nothing of
 * one game can reach the other.
 */
export function setPhoneLayoutFlag(game: string, isPhone: boolean) {
    document.documentElement.classList.toggle(`is-phone-${game}`, isPhone)
}

/**
 * Room the back-to-home button takes in the top left corner of a game, in px:
 * its height plus the gap kept under it.
 *
 * This mirrors `--back-home-height` / `--back-home-gap` of `BackHomeButton.vue`,
 * for the layouts which have to know the number in px. Keep both in sync.
 */
export function getBackHomeRoom(viewWidth: number, viewHeight: number) {
    const height = clamp(viewHeight * 0.056, 36, 56)
    const gap = Math.max(10, Math.min(viewWidth, viewHeight) * 0.016)
    return Math.round(height + gap)
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}
