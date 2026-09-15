import { createRouter, createWebHistory } from 'vue-router'
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
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
