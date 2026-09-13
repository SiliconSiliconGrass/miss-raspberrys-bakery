<script setup lang="ts">
import { ref, onMounted } from 'vue';

const cardArea = ref<HTMLDivElement | null>(null)

function setCardArea(numRows: number, numCols: number) {
    const cards: HTMLDivElement[] = []
    
    // 设置容器为 Grid
    if (cardArea.value) {
        cardArea.value.style.display = 'grid'
        cardArea.value.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`
        cardArea.value.style.gap = '10px'
    }
    
    for (let i = 0; i < numRows; i++) {
        for (let j = 0; j < numCols; j++) {
            const card = document.createElement('div')
            card.id = `card_${i}_${j}`
            card.className = 'card'
            
            // 正方形关键：宽高比 1:1
            card.style.aspectRatio = '1 / 1'
            card.style.width = '100%'
            
            cards.push(card)
        }
    }
    
    // 一次性添加所有卡片
    cardArea.value?.replaceChildren(...cards)
}



onMounted(() => {
    setCardArea(5, 4)
})



</script>


<template>
    <div ref="cardArea" class="card-area"></div>
</template>


<style>
html {
    background-color: #b27f00;
}

.card-area {
    position: fixed;
    width: min(30vw, 80vh);
    left: 50vw;
    top: 50vh;
    transform: translate(-50%, -50%);
}

.card {
    border: 1px solid black;
}

</style>
