<template>
  <div class="page-layout">
    <!-- View Header -->
    <div class="view-header">
      <h3 class="view-title">👥 用户统计</h3>
      <div class="view-search flex-row">
        <a-input v-model="query.nickname" placeholder="输入用户昵称搜索..." style="width: 240px; margin-right: 12px" allow-clear @press-enter="handleSearch">
          <template #prefix><icon-search /></template>
        </a-input>
        <a-button type="primary" @click="handleSearch" class="btn-primary">查询</a-button>
        <a-button @click="handleReset" style="margin-left: 8px">重置</a-button>
      </div>
    </div>

    <!-- Table Container -->
    <div class="table-container">
      <a-table
        :data="list"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        class="custom-table"
        @change="handleTableChange"
      >
        <template #columns>
          <a-table-column title="ID" data-index="id" :width="70" />
          <a-table-column title="用户头像" :width="100">
            <template #cell="{ record }">
              <a-avatar v-if="record.avatar_url" :imageUrl="record.avatar_url" :size="36" class="user-avatar" />
              <a-avatar v-else :size="36" style="background-color: #b2c4c1" class="user-avatar">
                <template #icon><icon-user /></template>
              </a-avatar>
            </template>
          </a-table-column>
          <a-table-column title="微信昵称" data-index="nickname">
            <template #cell="{ record }">
              <span class="user-nickname">{{ record.nickname }}</span>
            </template>
          </a-table-column>
          <a-table-column title="总参局数" data-index="total_games" :sortable="{ sortDirections: ['ascend', 'descend'], sorter: true }">
            <template #cell="{ record }">
              <span class="games-badge">{{ record.total_games }} 局</span>
            </template>
          </a-table-column>
          <a-table-column title="赢局数" data-index="won_games" :sortable="{ sortDirections: ['ascend', 'descend'], sorter: true }">
            <template #cell="{ record }">
              <span v-if="record.won_games > 0" class="win-color">+{{ record.won_games }} 局</span>
              <span v-else class="text-muted">0 局</span>
            </template>
          </a-table-column>
          <a-table-column title="输局数" data-index="lost_games" :sortable="{ sortDirections: ['ascend', 'descend'], sorter: true }">
            <template #cell="{ record }">
              <span v-if="record.lost_games > 0" class="loss-color">-{{ record.lost_games }} 局</span>
              <span v-else class="text-muted">0 局</span>
            </template>
          </a-table-column>
          <a-table-column title="胜率" data-index="win_rate" :sortable="{ sortDirections: ['ascend', 'descend'], sorter: true }">
            <template #cell="{ record }">
              <a-progress
                type="circle"
                :percent="getWinRateNum(record)"
                size="mini"
                :status="getWinRateStatus(record)"
                style="margin-right: 8px"
              />
              <span class="win-rate-text">{{ getWinRate(record) }}</span>
            </template>
          </a-table-column>
          <a-table-column title="历史总积分" data-index="total_score" :sortable="{ sortDirections: ['ascend', 'descend'], sorter: true }">
            <template #cell="{ record }">
              <span :class="['total-score-badge', record.total_score > 0 ? 'score-win' : (record.total_score < 0 ? 'score-loss' : 'score-zero')]">
                {{ record.total_score > 0 ? '+' : '' }}{{ record.total_score }} 分
              </span>
            </template>
          </a-table-column>
          <a-table-column title="账号状态" :width="120">
            <template #cell="{ record }">
              <a-switch 
                :model-value="record.status !== 0" 
                type="round" 
                size="small"
                @change="(val) => handleStatusChange(record, val)"
              />
            </template>
          </a-table-column>
          <a-table-column title="注册时间">
            <template #cell="{ record }">
              <span class="time-text">{{ formatTime(record.created_at) }}</span>
            </template>
          </a-table-column>
        </template>
      </a-table>
    </div>

    <!-- Pagination -->
    <div class="pagination-container">
      <a-pagination
        v-model:current="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="total"
        show-total
        show-jumper
        @change="handlePageChange"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Message } from '@arco-design/web-vue';
import { API_BASE } from '../config';

const list = ref([]);
const total = ref(0);
const loading = ref(false);

const query = reactive({
  nickname: '',
  sortField: '',
  sortOrder: ''
});

const pagination = reactive({
  page: 1,
  pageSize: 10
});

const handleSearch = () => {
  pagination.page = 1;
  fetchUsers();
};

const handleReset = () => {
  query.nickname = '';
  query.sortField = '';
  query.sortOrder = '';
  pagination.page = 1;
  fetchUsers();
};

const handlePageChange = (page) => {
  pagination.page = page;
  fetchUsers();
};

const handleStatusChange = async (record, val) => {
  const token = localStorage.getItem('admin_token');
  const targetStatus = val ? 1 : 0;
  try {
    const response = await fetch(`${API_BASE}/api/admin/user/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        userId: record.id,
        status: targetStatus
      })
    });
    const result = await response.json();
    if (result.code === 0) {
      record.status = targetStatus;
      Message.success(targetStatus === 0 ? `用户「${record.nickname}」已被成功封禁` : `用户「${record.nickname}」已解除封禁，恢复正常`);
    } else {
      Message.error(result.message || '操作失败');
    }
  } catch (err) {
    console.error('Update status error', err);
    Message.error('网络错误，修改失败');
  }
};

const handleTableChange = (data, extra) => {
  if (extra && extra.sorter) {
    query.sortField = extra.sorter.field || '';
    query.sortOrder = extra.sorter.direction || '';
  } else {
    query.sortField = '';
    query.sortOrder = '';
  }
  pagination.page = 1;
  fetchUsers();
};

const fetchUsers = async () => {
  loading.value = true;
  const token = localStorage.getItem('admin_token');
  try {
    const url = `${API_BASE}/api/admin/users?page=${pagination.page}&pageSize=${pagination.pageSize}&nickname=${query.nickname}&sortField=${query.sortField}&sortOrder=${query.sortOrder}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    if (result.code === 0) {
      list.value = (result.data.list || []).map(u => ({
        ...u,
        win_rate: u.total_games > 0 ? parseFloat(((u.won_games / u.total_games) * 100).toFixed(1)) : 0
      }));
      total.value = result.data.total;
    } else {
      Message.error(result.message || '获取用户列表失败');
    }
  } catch (err) {
    console.error('Fetch users error', err);
    Message.error('无法请求接口数据');
  } finally {
    loading.value = false;
  }
};

// Calculate win rate string
const getWinRate = (record) => {
  if (record.total_games === 0) return '0.0%';
  return `${((record.won_games / record.total_games) * 100).toFixed(1)}%`;
};

// Calculate win rate float
const getWinRateNum = (record) => {
  if (record.total_games === 0) return 0;
  return parseFloat(((record.won_games / record.total_games)).toFixed(3));
};

const getWinRateStatus = (record) => {
  const rate = getWinRateNum(record);
  if (rate >= 0.6) return 'success';
  if (rate >= 0.4) return 'normal';
  return 'warning';
};

// Format UTC database time
const formatTime = (timeStr) => {
  if (!timeStr) return '—';
  try {
    const d = new Date(timeStr.replace(' ', 'T') + 'Z');
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    return timeStr;
  }
};

onMounted(() => {
  fetchUsers();
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

.table-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-bottom: 20px;
}

.user-avatar {
  border: 2px solid rgba(11, 155, 119, 0.2);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
}

.user-nickname {
  font-weight: 600;
  color: #2d3748;
}

body[arco-theme='dark'] .user-nickname {
  color: #e2e8f0;
}

.games-badge {
  font-weight: 600;
  background: rgba(0, 150, 199, 0.05);
  color: #0096c7;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 13px;
}

.win-color {
  color: #0b9b77;
  font-weight: 600;
}

.loss-color {
  color: #e53e3e;
  font-weight: 600;
}

.win-rate-text {
  font-family: 'Outfit', monospace;
  font-weight: 600;
  font-size: 14px;
  color: #2d3748;
}

body[arco-theme='dark'] .win-rate-text {
  color: #e2e8f0;
}

.total-score-badge {
  font-family: 'Outfit', monospace;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 13px;
}

.score-win {
  color: #0b9b77;
  background: rgba(11, 155, 119, 0.08);
}

.score-loss {
  color: #e53e3e;
  background: rgba(229, 62, 62, 0.08);
}

.score-zero {
  color: #718096;
  background: rgba(113, 128, 150, 0.08);
}

.text-muted {
  font-size: 13px;
  color: #a0aec0;
}

.time-text {
  font-size: 12px;
  color: #718096;
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}
</style>
