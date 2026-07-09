<template>
  <a-layout class="layout-container">
    <!-- Header -->
    <a-layout-header class="layout-header glass-panel">
      <div class="header-logo">
        <span class="logo-icon">👑</span>
        <span class="logo-text">记账打牌后台</span>
      </div>
      <div class="header-user">
        <!-- Theme Switch Toggle -->
        <label class="block custom-switch cursor-pointer outline-none border-none" for="theme-switch" style="margin-right: 20px;">
          <div class="moon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 20px; height: 20px; color: #a0aec0; border: none;">
              <path d="M21 13.9066C19.805 14.6253 18.4055 15.0386 16.9095 15.0386C12.5198 15.0386 8.9612 11.4801 8.9612 7.09034C8.9612 5.59439 9.37447 4.19496 10.0931 3C6.03221 3.91866 3 7.5491 3 11.8878C3 16.9203 7.07968 21 12.1122 21C16.451 21 20.0815 17.9676 21 13.9066Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </div>
          <div class="sun">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 19px; height: 19px; color: #ffb703; border: none;">
              <path d="M12 23V22M4.22183 19.7782L4.92893 19.0711M1 12H2M4.22183 4.22183L4.92893 4.92893M12 2V1M19.0711 4.92893L19.7782 4.22183M22 12H23M19.0711 19.0711L19.7782 19.7782M18 12C18 15.3137 15.3137 18 12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </div>
          <input type="checkbox" id="theme-switch" class="input absolute translate-x-[1000px] outline-none border-none" v-model="isDark" @change="toggleTheme">
          <div class="slider border-none"></div>
        </label>
        <span class="username">管理员 (Admin)</span>
        <a-divider direction="vertical" />
        <a-popconfirm content="确定要退出登录吗？" position="br" type="warning" @ok="handleLogout">
          <a-button type="text" status="danger" class="logout-btn">
            <template #icon><IconExport /></template>
            退出登录
          </a-button>
        </a-popconfirm>
      </div>
    </a-layout-header>

    <a-layout-content class="layout-body">
      <a-layout class="layout-inner">
        <!-- Sidebar -->
        <a-layout-sider class="layout-sider glass-panel" :width="220" collapsible>
          <a-menu
            :selected-keys="[activeKey]"
            class="sidebar-menu"
            @menu-item-click="handleMenuClick"
          >
            <a-menu-item key="Overview">
              <template #icon><IconDashboard /></template>
              大盘数据
            </a-menu-item>
            <a-menu-item key="Rooms">
              <template #icon><IconHome /></template>
              房间管理
            </a-menu-item>
            <a-menu-item key="Users">
              <template #icon><IconUserGroup /></template>
              用户统计
            </a-menu-item>
            <a-menu-item key="Settings">
              <template #icon><IconSettings /></template>
              系统配置
            </a-menu-item>
          </a-menu>
        </a-layout-sider>

        <!-- Main Workspace -->
        <a-layout-content class="layout-main">
          <div class="main-card glass-panel">
            <router-view />
          </div>
        </a-layout-content>
      </a-layout>
    </a-layout-content>
  </a-layout>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';

const route = useRoute();
const router = useRouter();

const isDark = ref(localStorage.getItem('theme') === 'dark');

const activeKey = computed(() => {
  return route.name || 'Rooms';
});

const handleMenuClick = (key) => {
  router.push({ name: key });
};

const handleLogout = () => {
  localStorage.removeItem('admin_token');
  Message.success('成功退出登录，再见！');
  router.push('/login');
};

const toggleTheme = () => {
  if (isDark.value) {
    document.body.setAttribute('arco-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.body.removeAttribute('arco-theme');
    localStorage.setItem('theme', 'light');
  }
};

onMounted(() => {
  if (isDark.value) {
    document.body.setAttribute('arco-theme', 'dark');
  } else {
    document.body.removeAttribute('arco-theme');
  }
});
</script>

<style scoped>
.layout-container {
  height: 100vh;
  width: 100vw;
  box-sizing: border-box;
  padding: 16px;
  background: #f4f7f6;
  gap: 16px;
  overflow: hidden;
}

.layout-header {
  height: 64px;
  line-height: 64px;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  border-radius: 16px !important;
  background: rgba(255, 255, 255, 0.8) !important;
}

.header-logo {
  display: flex;
  align-items: center;
  font-size: 18px;
  font-weight: 700;
  color: #0b9b77;
  letter-spacing: 0.5px;
}

.logo-icon {
  font-size: 24px;
  margin-right: 8px;
}

.header-user {
  display: flex;
  align-items: center;
}

.username {
  font-weight: 600;
  font-size: 14px;
  color: #2d3748;
}

.logout-btn {
  font-weight: 500;
  font-size: 13px;
  transition: all 0.2s ease;
}

.logout-btn:hover {
  background: rgba(238, 10, 36, 0.05);
}

.layout-body {
  flex: 1;
  min-height: 0;
}

.layout-inner {
  height: 100%;
  gap: 16px;
  background: transparent !important;
}

.layout-sider {
  border-radius: 16px !important;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.8) !important;
}

.sidebar-menu {
  background: transparent !important;
  height: 100%;
  padding-top: 12px;
}

:deep(.arco-menu-inner) {
  padding: 8px;
}

:deep(.arco-menu-item) {
  border-radius: 10px !important;
  margin-bottom: 6px !important;
  font-weight: 500;
  font-size: 14px;
}

:deep(.arco-menu-selected) {
  background: linear-gradient(135deg, rgba(11, 155, 119, 0.1) 0%, rgba(0, 150, 199, 0.05) 100%) !important;
  color: #0b9b77 !important;
  font-weight: 600;
}

:deep(.arco-menu-selected .arco-icon) {
  color: #0b9b77 !important;
}

.layout-main {
  flex: 1;
  min-width: 0;
  height: 100%;
}

.main-card {
  height: 100%;
  box-sizing: border-box;
  padding: 24px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.85) !important;
}

/* Custom theme switcher styles */
.custom-switch {
  font-size: 17px;
  position: relative;
  display: inline-block;
  width: 60px;
  height: 30px;
  --color: #3a3a3a;
}

.custom-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.custom-switch .slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #3a3a3a;
  transition: .4s;
  border-radius: 300px;
}

.custom-switch .slider:before {
  position: absolute;
  content: "";
  height: 24px;
  width: 24px;
  border-radius: 20px;
  left: 3px;
  bottom: 3px;
  z-index: 2;
  background-color: var(--dark);
  transition: .4s;
}

.custom-switch .sun svg {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
}

.custom-switch .moon svg {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 1;
}

.custom-switch .input:checked+.slider {
  background-color: #cecece;
}

.custom-switch .input:focus+.slider {
  box-shadow: 0 0 1px #cecece;
}

.custom-switch .input:checked+.slider:before {
  transform: translate(29px);
  background: var(--offwhite);
}
</style>
