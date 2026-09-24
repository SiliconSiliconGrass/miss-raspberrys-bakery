<script setup lang="ts">
import { useRouter } from 'vue-router'

/**
 * The pill every mini-game shows in the top left corner to go back to the title
 * screen.
 *
 * The room it takes is published as `--back-home-height` / `--back-home-room`,
 * so that whatever else lives in that corner keeps clear of it: the target
 * recipe of the baking game, the piece bar of the cargo game. Layouts which
 * have to know the number in px read it from `getBackHomeRoom()`.
 */
const router = useRouter()

/** Back to the title screen, by route name: the game is not served from the domain root. */
function backHome() {
    router.push({ name: 'Home' })
}
</script>

<template>
    <button class="back-home-button" type="button" @click="backHome">返回首页</button>
</template>

<style scoped>
:global(:root) {
    --back-home-height: clamp(36px, 5.6vh, 56px);
    --back-home-gap: max(10px, min(1.6vw, 1.6vh));
    --back-home-room: calc(var(--back-home-height) + var(--back-home-gap));
}

.back-home-button {
    position: fixed;
    left: min(2.4vw, 2.4vh);
    top: min(2.4vw, 2.4vh);
    box-sizing: border-box;
    height: var(--back-home-height);
    padding: 0 min(2.4vw, 26px);
    font-family: 'Ruantang', sans-serif;
    font-size: min(1.6vw, 2.4vh);
    color: #7c3200;
    background-color: rgba(255, 246, 224, 0.88);
    border: none;
    border-radius: 999px;
    box-shadow: 0 2px 6px rgba(60, 30, 0, 0.35);
    cursor: pointer;
    /* a tap is a tap: no double tap zoom on a phone */
    touch-action: manipulation;
    /* above the board and everything the player drags around it */
    z-index: 1000;
}

.back-home-button:hover {
    background-color: #fff6e0;
}
</style>
