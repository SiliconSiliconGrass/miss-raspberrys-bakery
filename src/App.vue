<template>
    <router-view />
</template>

<style>
@font-face {
    font-family: "DymonShouXieTi";
    src: url("/fonts/Dymon-ShouXieTi.otf") format("opentype");
}

* {
    margin: 0;
    padding: 0;
    user-select: none;
}

/*
    The mini-games fill the screen with their boards, so the page itself has
    nothing to scroll. A drag which starts above the top edge must not reload the
    page on a phone, and nothing may bounce at the ends of a board.
*/
html {
    overscroll-behavior: none;
}
</style>
