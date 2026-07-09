import { createRouter, createWebHistory } from 'vue-router';
import Login from '../views/Login.vue';
import Dashboard from '../views/Dashboard.vue';
import Rooms from '../views/Rooms.vue';
import Users from '../views/Users.vue';
import Overview from '../views/Overview.vue';
import Settings from '../views/Settings.vue';

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
        redirect: '/dashboard/overview'
      },
      {
        path: 'overview',
        name: 'Overview',
        component: Overview
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
      },
      {
        path: 'settings',
        name: 'Settings',
        component: Settings
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard/overview'
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
      next('/dashboard/overview');
    } else {
      next();
    }
  } else {
    next();
  }
});

export default router;
