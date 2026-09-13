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
    // 懒加载，TS自动推断
    component: () => import('../pages/game_baking/GameBaking.vue'),
  },
//   {
//     path: '/user',
//     name: 'User',
//     component: () => import('../views/User.vue'),
//   },
//   // 404 兜底路由，放最后
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
