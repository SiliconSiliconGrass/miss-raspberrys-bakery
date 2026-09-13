<script setup lang="ts">
    import { onBeforeUnmount, onMounted } from 'vue';

    function startGame() {
        window.location.href = "/game-baking"
    }

    // these live on window, so they must be removed when the home page is left:
    // otherwise every click inside the game reloads the page
    onMounted(() => {
        window.addEventListener("click", startGame)
        window.addEventListener("keydown", startGame)
    })

    onBeforeUnmount(() => {
        window.removeEventListener("click", startGame)
        window.removeEventListener("keydown", startGame)
    })
</script>

<template>
    <div class="title">
        树莓娘面包坊
    </div>
    <div class="blink-tip">
        CLICK OR PRESS ANY KEY TO START
    </div>
    <div class="bg-home"></div>
    <audio src="/music/Piece and Piece.mp3" autoplay loop></audio>
</template>

<style scoped>
@keyframes blink {
    0% {opacity: 100%;}
    50% {opacity: 0%;}
    100% {opacity: 100%;}
}

.bg-home {
    position: fixed;
    left: 0;
    right: 0;
    margin: 0;
    padding: 0;
    background-image: url("/images/bg/home.png");
    background-size: contain;
    width: max(100vw, 1600vh / 9);
    aspect-ratio: 16/9;
    z-index: 0;
}

.title {
    position: fixed;
    font-family: 'Ruantang';
    color: #7c3200;
    font-size: min(8vw, 800vh / 9);
    z-index: 10;
    left: 10vw;
    top: 20vh;
}

.blink-tip {
    position: fixed;
    font-family: 'Ruantang';
    font-size: min(2vw, 200vh / 9);
    z-index: 10;
    left: 50vw;
    bottom: 5vh;
    transform: translateX(-50%);
    animation: blink 2s ease-in-out infinite;
}
</style>
