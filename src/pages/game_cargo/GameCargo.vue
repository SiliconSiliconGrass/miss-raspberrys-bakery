<script setup lang="ts">
import { Application, Assets, Sprite } from 'pixi.js';

const app = new Application();
await app.init({ background: 'b27f00', resizeTo: window });
app.canvas.className = "canvas";
document.body.appendChild(app.canvas);


// const texture = await Assets.load('/images/energy_bread.png');
// const bunny = new Sprite(texture);
// bunny.anchor.set(0.5);           // 锚点居中
// bunny.x = app.screen.width / 2;  // 屏幕中心
// bunny.y = app.screen.height / 2;
// app.stage.addChild(bunny);       // 加入舞台


const boxTexture = await Assets.load('/images/it/box.png');
// const boxTexture = await Assets.load('/images/it/energy_bread.png');

const boxes: Array<Sprite> = [];
const boxSize = app.screen.width * 0.08;

const cols = 5;
const rows = 4;
for (let i = 0; i < rows; i ++) {
    for (let j = 0; j < cols; j++) {
        const box = new Sprite(boxTexture);
        box.anchor.set(0.5);
        box.width = boxSize;
        box.height = boxSize;
        box.x = app.screen.width / 2 + (-(cols - 1) * 0.5 + j) * boxSize
        box.y = app.screen.height / 2 + (-(rows - 1) * 0.5 + i) * boxSize
        boxes.push(box)
        app.stage.addChild(box);
    }
}

// 3. 逐帧动画（Ticker）
app.ticker.add((time) => {
    // for (let box of boxes) {
    //     box.rotation += 0.001 * time.deltaTime;
    // }
});


</script>

<template>

</template>

<style>
.canvas {
    position: fixed;
    top: 0;
    left: 0;
    padding: 0;
    margin: 0;
}
</style>
