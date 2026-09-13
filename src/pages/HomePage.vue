<script setup lang="ts">
    window.addEventListener("click", (e) => {
        window.location.href = "/game-baking"
    });
    window.addEventListener("keydown", (e) => {
        window.location.href = "/game-baking"
    });
</script>

<template>
    <div class="title">
        树莓娘面包坊
    </div>
    <div class="blink-tip">
        CLICK OR PRESS ANY KEY TO START
    </div>
    <div class="bg-home"></div>
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
