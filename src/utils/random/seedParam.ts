/**
 * Read a `?seed=` from the URL, so a level exported by the game can be played
 * again. The app uses hash routing (`#/game-cargo`), so the seed may sit either
 * behind the normal `?` (`/?seed=abc#/game-cargo`) or inside the hash route
 * (`#/game-cargo?seed=abc`).
 */
export function readSeedParam(): string | null {
    if (typeof window === 'undefined') {
        return null
    }
    const fromSearch = new URLSearchParams(window.location.search).get('seed')
    if (fromSearch && fromSearch.trim() !== '') {
        return fromSearch.trim()
    }
    const hash = window.location.hash
    const queryStart = hash.indexOf('?')
    if (queryStart >= 0) {
        const fromHash = new URLSearchParams(hash.slice(queryStart + 1)).get('seed')
        if (fromHash && fromHash.trim() !== '') {
            return fromHash.trim()
        }
    }
    return null
}
