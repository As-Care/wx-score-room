import { createRouter, createWebHistory } from 'vue-router';
import Login from '../views/Login.vue';
import Dashboard from '../views/Dashboard.vue';
import Rooms from '../views/Rooms.vue';
import Users from '../views/Users.vue';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresGuest: true }
  },
  {
    path: '/dashboard',
    component: Dashboard,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: '/dashboard/rooms'
      },
      {
        path: 'rooms',
        name: 'Rooms',
        component: Rooms
      },
      {
        path: 'users',
        name: 'Users',
        component: Users
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard/rooms'
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('admin_token');

  if (to.matched.some(record => record.meta.requiresAuth)) {
    if (!token) {
      next('/login');
    } else {
      next();
    }
  } else if (to.matched.some(record => record.meta.requiresGuest)) {
    if (token) {
      next('/dashboard/rooms');
    } else {
      next();
    }
  } else {
    next();
  }
});

export default router;
