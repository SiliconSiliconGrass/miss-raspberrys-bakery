import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'

// RouteRecordRaw 是vue-router内置路由类型
const routes = [
  {
    path: '/',
    name: 'Home',
    component: HomePage,
  },
  {
    path: '/game-baking',
    name: 'GameBaking',
    component: () => import('../pages/game_baking/GameBaking.vue'),
  },
  {
    path: '/game-cargo',
    name: 'GameCargo',
    component: () => import('../pages/game_cargo/GameCargo.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../pages/HomePage.vue'),
  },
]

const router = createRouter({
  // Hash history: the host only serves `index.html` and does not rewrite
  // unknown paths to it, so path based routes would 404 on reload.
  history: createWebHashHistory(),
  routes,
})

export default router
