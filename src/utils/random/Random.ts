/**
 * Deterministic pseudo-random number generator used by every mini-game that
 * deals a level. All level generation goes through one of these, so a level is
 * fully described by its seed string: run the same seed again and the exact
 * same level comes back.
 *
 * It is mulberry32 with an xmur3 string hash in front of it — a few lines,
 * well tested, and plenty good for dealing cards. It is **not** a
 * cryptographic source, which is fine because nothing here needs to be
 * unpredictable, only reproducible.
 *
 * The only unseeded randomness in the app is `randomSeed()`, which draws a
 * fresh seed when the player does not supply one.
 */

/** A fresh 8-hex-digit seed, e.g. `"3f9c1a07"`. */
export function randomSeed(): string {
    const buffer = new Uint32Array(1)
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(buffer)
    } else {
        // ancient browsers without the platform RNG: anything unique will do
        buffer[0] = Math.floor(Math.random() * 0x100000000)
    }
    return (buffer[0]! >>> 0).toString(16).padStart(8, '0')
}

/** xmur3: fold an arbitrary seed string into a 32-bit state. */
function hashSeed(text: string): number {
    let h = 1779033703 ^ text.length
    for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^ (h >>> 16)) >>> 0
}

/**
 * Turn a seed into a 32-bit state:
 * - a number, or a string of digits, is used as-is,
 * - `0x…` is read as hexadecimal (the format `randomSeed()` produces),
 * - anything else is hashed, so `?seed=hello` works too.
 */
export function seedToState(seed: number | string): number {
    if (typeof seed === 'number') {
        return Math.floor(seed) >>> 0
    }
    const text = seed.trim()
    if (/^0x[0-9a-f]+$/i.test(text)) {
        return Number.parseInt(text, 16) >>> 0
    }
    if (/^\d+$/.test(text)) {
        return Number.parseInt(text, 10) >>> 0
    }
    return hashSeed(text)
}

export default class Random {
    private state: number

    constructor(seed: number | string = randomSeed()) {
        this.state = seedToState(seed)
        // mulberry32 walks away from zero, but make the all-zero state harmless
        if (this.state === 0) {
            this.state = 0x9e3779b9
        }
    }

    /** Next float in `[0, 1)`. */
    next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0
        let t = this.state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    /** Integer in `[min, max]`, both ends included. */
    randint(min: number, max: number): number {
        if (max <= min) {
            return min
        }
        return min + Math.floor(this.next() * (max - min + 1))
    }

    /** Copy of `items` in random order (Fisher-Yates); the argument is not modified. */
    shuffle<T>(items: readonly T[]): T[] {
        const result = [...items]
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.randint(0, i)
            const tmp = result[i]!
            result[i] = result[j]!
            result[j] = tmp
        }
        return result
    }

    /** One random element; `items` must not be empty. */
    pick<T>(items: readonly T[]): T {
        return items[this.randint(0, items.length - 1)]!
    }
}
