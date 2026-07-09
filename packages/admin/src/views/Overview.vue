<template>
  <div class="page-layout">
    <div class="view-header">
      <h1 class="view-title">📊 大盘数据总览</h1>
      <a-button type="primary" size="medium" class="refresh-btn" @click="fetchStats" :loading="loading">
        <template #icon><IconRefresh /></template>
        刷新数据
      </a-button>
    </div>

    <!-- Stats Grid -->
    <a-row :gutter="20" class="stats-grid">
      <a-col :span="6">
        <div class="stat-card glass-panel gradient-blue">
          <div class="card-icon-wrapper">
            <IconUserGroup class="card-icon" />
          </div>
          <div class="stat-details">
            <span class="stat-label">总注册用户数</span>
            <span class="stat-value">{{ stats.total_users }}</span>
          </div>
        </div>
      </a-col>
      <a-col :span="6">
        <div class="stat-card glass-panel gradient-green">
          <div class="card-icon-wrapper">
            <IconLiveclass class="card-icon" />
          </div>
          <div class="stat-details">
            <span class="stat-label">进行中活跃房间</span>
            <span class="stat-value">{{ stats.active_rooms }}</span>
          </div>
        </div>
      </a-col>
      <a-col :span="6">
        <div class="stat-card glass-panel gradient-purple">
          <div class="card-icon-wrapper">
            <IconHome class="card-icon" />
          </div>
          <div class="stat-details">
            <span class="stat-label">历史房间总数</span>
            <span class="stat-value">{{ stats.total_rooms }}</span>
          </div>
        </div>
      </a-col>
      <a-col :span="6">
        <div class="stat-card glass-panel gradient-orange">
          <div class="card-icon-wrapper">
            <IconHistory class="card-icon" />
          </div>
          <div class="stat-details">
            <span class="stat-label">记账流水总笔数</span>
            <span class="stat-value">{{ stats.total_transactions }}</span>
          </div>
        </div>
      </a-col>
    </a-row>

    <!-- Welcome Section / Quick Actions -->
    <div class="welcome-section glass-panel">
      <div class="welcome-content">
        <div class="welcome-text">
          <h2>👑 记账打牌管理控制台</h2>
          <p>欢迎回到管理端。目前系统运行正常，所有数据实时同步并进行了安全加密。</p>
        </div>
        <div class="action-buttons">
          <a-button type="primary" size="large" class="action-btn" @click="$router.push('/dashboard/rooms')">
            <template #icon><IconHome /></template>
            管理房间
          </a-button>
          <a-button type="outline" size="large" class="action-btn" @click="$router.push('/dashboard/settings')">
            <template #icon><IconSettings /></template>
            配置系统
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Message } from '@arco-design/web-vue';
import { API_BASE } from '../config';

const loading = ref(false);
const stats = reactive({
  total_users: 0,
  active_rooms: 0,
  total_rooms: 0,
  total_transactions: 0
});

const fetchStats = async () => {
  loading.value = true;
  const token = localStorage.getItem('admin_token');
  try {
    const response = await fetch(`${API_BASE}/api/admin/dashboard`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    if (result.code === 0) {
      Object.assign(stats, result.data);
    } else {
      Message.error(result.message || '获取大盘统计失败');
    }
  } catch (err) {
    console.error('Fetch stats error', err);
    Message.error('无法请求接口数据');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchStats();
});
</script>

<style scoped>
.page-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-shrink: 0;
}

.view-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #1a202c;
}

body[arco-theme='dark'] .view-title {
  color: #f5f5f5;
}

.refresh-btn {
  border-radius: 8px;
  font-weight: 600;
}

.stats-grid {
  margin-bottom: 24px;
  flex-shrink: 0;
}

.stat-card {
  padding: 24px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  gap: 20px;
  position: relative;
  overflow: hidden;
  height: 110px;
  box-sizing: border-box;
}

.card-icon-wrapper {
  width: 54px;
  height: 54px;
  border-radius: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
}

.card-icon {
  font-size: 24px;
  color: #fff;
}

.stat-details {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 4px;
}

.stat-value {
  font-family: 'Outfit', sans-serif;
  font-size: 28px;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}

/* Vibrant color card themes */
.gradient-blue {
  background: linear-gradient(135deg, #0077b6 0%, #0096c7 100%) !important;
}

.gradient-green {
  background: linear-gradient(135deg, #0b9b77 0%, #10b981 100%) !important;
}

.gradient-purple {
  background: linear-gradient(135deg, #7209b7 0%, #9b5de5 100%) !important;
}

.gradient-orange {
  background: linear-gradient(135deg, #e36414 0%, #fb8b24 100%) !important;
}

.welcome-section {
  flex: 1;
  border-radius: 16px;
  display: flex;
  align-items: center;
  padding: 40px;
  background: rgba(255, 255, 255, 0.6) !important;
}

body[arco-theme='dark'] .welcome-section {
  background: rgba(30, 30, 35, 0.4) !important;
}

.welcome-content {
  max-width: 600px;
}

.welcome-text h2 {
  font-size: 24px;
  font-weight: 700;
  margin-top: 0;
  margin-bottom: 12px;
}

.welcome-text p {
  font-size: 14px;
  color: #4a5568;
  line-height: 1.6;
  margin-bottom: 30px;
}

body[arco-theme='dark'] .welcome-text p {
  color: #a0aec0;
}

.action-buttons {
  display: flex;
  gap: 16px;
}

.action-btn {
  border-radius: 8px;
  font-weight: 600;
}
</style>
