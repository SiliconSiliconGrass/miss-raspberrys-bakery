<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref } from 'vue';
    import { useRouter } from 'vue-router';
    import { assetUrl } from '../utils/asset';

    const router = useRouter();
    const bgmSrc = assetUrl('music/ms2.mp3');

    interface LevelOption {
        /** Route name of the mini-game. */
        route: string
        title: string
        subtitle: string
        image: string
    }

    /** The mini-games, in the order their number keys select them. */
    const LEVEL_LIST: LevelOption[] = [
        {
            route: 'GameBaking',
            title: '充能面包',
            subtitle: '按目标配方烤面包',
            image: assetUrl('images/it/energy_bread.svg'),
        },
        {
            route: 'GameCargo',
            title: '货物装箱',
            subtitle: '把货物拼进车厢',
            image: assetUrl('images/it/box.png'),
        },
    ]

    /** The level picker pops up over the title screen; the first click or key opens it. */
    const isPickerOpen = ref(false)
    /** Which card the keyboard acts on; the mouse acts on the card it points at. */
    const selectedInd = ref(0)

    function openPicker() {
        selectedInd.value = 0
        isPickerOpen.value = true
    }

    function closePicker() {
        isPickerOpen.value = false
    }

    // Navigate by route name: the game is not served from the domain root.
    function startLevel(ind: number) {
        const level = LEVEL_LIST[ind]
        if (!level) {
            return
        }
        selectedInd.value = ind
        router.push({ name: level.route })
    }

    /**
     * One handler for both states of this page. The key which opens the picker is
     * a key the picker would see too, and two handlers would both act on it: the
     * level under that key would start right away, without the player picking it.
     */
    function onKeydown(event: KeyboardEvent) {
        if (!isPickerOpen.value) {
            openPicker()
            return
        }

        const key = event.key
        if (key === 'ArrowLeft' || key === 'ArrowUp') {
            event.preventDefault()
            selectedInd.value = (selectedInd.value - 1 + LEVEL_LIST.length) % LEVEL_LIST.length
        } else if (key === 'ArrowRight' || key === 'ArrowDown') {
            event.preventDefault()
            selectedInd.value = (selectedInd.value + 1) % LEVEL_LIST.length
        } else if (key === 'Enter' || key === ' ') {
            // the default of space is scrolling, of enter is clicking the focused card
            event.preventDefault()
            startLevel(selectedInd.value)
        } else if (key >= '1' && key <= String(LEVEL_LIST.length)) {
            startLevel(Number(key) - 1)
        } else if (key === 'Escape') {
            closePicker()
        }
    }

    /** The whole screen starts the game, the way the blinking tip promises. */
    function onWindowClick() {
        if (!isPickerOpen.value) {
            openPicker()
        }
    }

    // these live on window, so they must be removed when the home page is left:
    // otherwise every click inside the game reloads the page
    onMounted(() => {
        document.addEventListener("click", onWindowClick)
        document.addEventListener("touchend", onWindowClick)
        document.addEventListener("keydown", onKeydown)
    })

    onBeforeUnmount(() => {
        document.removeEventListener("click", onWindowClick)
        document.removeEventListener("touchend", onWindowClick)
        document.removeEventListener("keydown", onKeydown)
    })
</script>

<template>
    <div class="title">
        树莓娘面包坊
    </div>
    <div v-if="!isPickerOpen" class="blink-tip">
        CLICK OR PRESS ANY KEY TO START
    </div>
    <div class="bg-home"></div>

    <!--
        The level picker pops up over the title screen, it is not a page of its
        own. The backdrop closes it: `.stop` keeps that click away from the window
        listener above, which would otherwise open the picker again in the same
        breath.
    -->
    <Transition name="backdrop">
        <div v-if="isPickerOpen" class="picker-backdrop" @click.self.stop="closePicker">
            <Transition name="picker">
                <div v-if="isPickerOpen" class="picker-panel">
                    <div class="picker-title">选择关卡</div>
                    <div class="level-list">
                        <button
                            v-for="(level, ind) in LEVEL_LIST"
                            :key="level.route"
                            class="level-card"
                            :class="{ 'is-selected': ind === selectedInd }"
                            type="button"
                            @mouseenter="selectedInd = ind"
                            @focus="selectedInd = ind"
                            @click="startLevel(ind)"
                        >
                            <div class="level-image" :style="{ backgroundImage: `url(${level.image})` }"></div>
                            <div class="level-title">{{ level.title }}</div>
                            <div class="level-subtitle">{{ level.subtitle }}</div>
                            <div class="level-key">{{ ind + 1 }}</div>
                        </button>
                    </div>
                    <div class="picker-tip">点卡片开始，或按数字键 / 方向键 + 回车</div>
                </div>
            </Transition>
        </div>
    </Transition>

    <audio :src="bgmSrc" autoplay loop></audio>
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
    font-family: 'DymonShouXieTi';
    color: #7c3200;
    font-size: min(8vw, 800vh / 9);
    z-index: 10;
    left: 10vw;
    top: 20vh;
}

.blink-tip {
    position: fixed;
    font-family: 'DymonShouXieTi';
    font-size: min(2vw, 200vh / 9);
    z-index: 10;
    left: 50vw;
    bottom: 5vh;
    transform: translateX(-50%);
    animation: blink 2s ease-in-out infinite;
}

/* --- the level picker --- */

.picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(60, 30, 0, 0.45);
    backdrop-filter: blur(2px);
}

.picker-panel {
    box-sizing: border-box;
    padding: min(4.5vh, 45px) min(5vw, 50px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: min(2.6vh, 26px);
    background-color: rgba(255, 246, 224, 0.95);
    border: min(0.5vh, 5px) solid rgba(124, 50, 0, 0.55);
    border-radius: min(4vh, 40px);
    box-shadow: 0 min(1.6vh, 16px) min(5vh, 50px) rgba(60, 30, 0, 0.5);
}

.picker-title {
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(4.4vw, 6.6vh);
    line-height: 1.1;
    color: #7c3200;
}

.level-list {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: min(4vw, 40px);
}

.level-card {
    position: relative;
    box-sizing: border-box;
    width: min(20vw, 30vh);
    padding: min(2.4vh, 24px) min(1.6vw, 16px) min(4vh, 40px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: min(1.2vh, 12px);
    font: inherit;
    color: #fff6e0;
    background-color: rgba(124, 50, 0, 0.9);
    border: min(0.4vh, 4px) solid rgba(124, 50, 0, 0.35);
    border-radius: min(3vh, 30px);
    box-shadow: 0 min(1vh, 10px) min(2.6vh, 26px) rgba(60, 30, 0, 0.35);
    cursor: pointer;
    transition: transform 160ms ease-out, border-color 160ms ease-out, box-shadow 160ms ease-out;
}

.level-card.is-selected {
    transform: scale(1.06);
    border-color: #ffd873;
    box-shadow:
        0 min(1vh, 10px) min(2.6vh, 26px) rgba(60, 30, 0, 0.35),
        0 0 min(3vh, 30px) rgba(255, 216, 115, 0.9);
}

.level-image {
    width: min(11vw, 18vh);
    aspect-ratio: 1;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    filter: drop-shadow(0 2px 4px rgba(60, 30, 0, 0.5));
}

.level-title {
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(2.4vw, 3.6vh);
    line-height: 1.1;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
}

.level-subtitle {
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(1.5vw, 2.4vh);
    line-height: 1.2;
    color: rgba(255, 246, 224, 0.82);
}

.level-key {
    position: absolute;
    right: min(1.4vw, 16px);
    bottom: min(1.4vh, 14px);
    width: min(3.2vh, 32px);
    height: min(3.2vh, 32px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(1.9vh, 19px);
    color: #7c3200;
    background-color: rgba(255, 246, 224, 0.85);
    border-radius: 50%;
}

.picker-tip {
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(1.5vw, 2.2vh);
    color: rgba(124, 50, 0, 0.75);
}

/*
    The popup: the backdrop fades, the panel scales up into place. The scale is on
    the panel and not on the backdrop, because a scaled backdrop would leave the
    edges of the screen uncovered while it grows.
*/
.backdrop-enter-active {
    transition: opacity 220ms ease-out;
}

.backdrop-leave-active {
    transition: opacity 160ms ease-in;
}

.backdrop-enter-from,
.backdrop-leave-to {
    opacity: 0;
}

.picker-enter-active {
    transition: opacity 220ms ease-out, transform 240ms cubic-bezier(0.2, 1.35, 0.4, 1);
}

.picker-leave-active {
    transition: opacity 140ms ease-in, transform 140ms ease-in;
}

.picker-enter-from,
.picker-leave-to {
    opacity: 0;
    transform: scale(0.8);
}
</style>
