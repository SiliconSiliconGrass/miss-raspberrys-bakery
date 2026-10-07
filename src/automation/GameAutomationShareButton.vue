<script setup lang="ts">
import { ref } from 'vue'

import { copyTextToClipboard } from './clipboard'

/**
 * Copy a shareable link to the current level.
 *
 * It is used by `GameAutomationPanel` on a wide screen, and rendered on its own
 * by the games on a phone, where the panel is hidden. The URL is read from the
 * page itself, because the deployment path is not known at build time (a toy
 * can be served from `https://www.bilibili.com/toy/miss-raspberrys-bakery/`, a
 * local dev server, …). The route stays in the hash and the seed goes in front
 * of it: exactly the shape the games read back with `readSeedParam()`.
 */
const props = withDefaults(
    defineProps<{
        seed: string
        label?: string
        copiedLabel?: string
    }>(),
    { label: '分享这一关', copiedLabel: '已复制分享链接' },
)

const copied = ref(false)

function buildShareMessage(seed: string): string {
    const { origin, pathname, hash } = window.location
    // keep `#/game-cargo`, drop a seed left over from an earlier share
    const route = hash.split('?')[0] ?? ''
    const url = `${origin}${pathname}?seed=${encodeURIComponent(seed)}${route}`
    return `来挑战树莓娘面包坊里这一关吧！${url}`
}

async function share() {
    if (!props.seed) {
        return
    }
    const ok = await copyTextToClipboard(buildShareMessage(props.seed))
    if (!ok) {
        return
    }
    copied.value = true
    window.setTimeout(() => {
        copied.value = false
    }, 1600)
}
</script>

<template>
    <button type="button" class="automation-share-button" @click="share">
        {{ copied ? copiedLabel : label }}
    </button>
</template>

<style scoped>
.automation-share-button {
    box-sizing: border-box;
    padding: 0.35em 0.6em;
    /* the font size is left to the host: the panel's dock on a wide screen,
       the game's phone rules on a phone */
    font-family: 'DymonShouXieTi', sans-serif;
    line-height: 1.2;
    color: #7c3200;
    text-shadow: none;
    background-color: #ffe9b3;
    border: none;
    border-radius: 999px;
    box-shadow: 0 2px 8px rgba(40, 20, 0, 0.3);
    cursor: pointer;
    touch-action: manipulation;
}

.automation-share-button:active {
    /* not `transform`: on a phone the button is centered with translateX(-50%) */
    filter: brightness(0.94);
}
</style>
