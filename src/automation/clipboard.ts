/**
 * Copy text to the clipboard, falling back to the old `execCommand` path when
 * the async Clipboard API is unavailable.
 *
 * The games are often opened from a LAN address (`http://192.168.x.x:5173`),
 * which is not a secure context, and there `navigator.clipboard` is missing.
 * Returns whether the copy is believed to have succeeded.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch {
        // fall through to the textarea fallback
    }

    try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok
    } catch {
        return false
    }
}
