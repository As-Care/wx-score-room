<template>
  <a-layout class="layout-container">
    <!-- Header -->
    <a-layout-header class="layout-header glass-panel">
      <div class="header-logo">
        <span class="logo-icon">👑</span>
        <span class="logo-text">记账打牌后台</span>
      </div>
      <div class="header-user">
        <a-avatar :size="32" style="background-color: #0b9b77; margin-right: 8px;">
          <template #icon><IconUser /></template>
        </a-avatar>
        <span class="username">管理员 (Admin)</span>
        <a-divider direction="vertical" />
        <a-button type="text" status="danger" @click="handleLogout" class="logout-btn">
          <template #icon><IconExport /></template>
          退出登录
        </a-button>
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
            <a-menu-item key="Rooms">
              <template #icon><IconHome /></template>
              房间管理
            </a-menu-item>
            <a-menu-item key="Users">
              <template #icon><IconUserGroup /></template>
              用户统计
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
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';

const route = useRoute();
const router = useRouter();

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
</style>
