<template>
  <div class="page-layout">
    <!-- View Header -->
    <div class="view-header">
      <h3 class="view-title">🏠 房间列表</h3>
      <div class="view-search flex-row">
        <a-input v-model="query.room_code" placeholder="输入房间号搜索..." style="width: 240px; margin-right: 12px" allow-clear @press-enter="handleSearch">
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
      >
        <template #columns>
          <a-table-column title="ID" data-index="id" :width="70" />
          <a-table-column title="房间号" data-index="room_code">
            <template #cell="{ record }">
              <span class="room-code-tag">{{ record.room_code }}</span>
            </template>
          </a-table-column>
          <a-table-column title="当前状态" data-index="status">
            <template #cell="{ record }">
              <a-tag :color="record.status === 1 ? 'red' : 'green'" class="status-tag">
                {{ record.status === 1 ? '🔴 已结算' : '🟢 进行中' }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="创建人 (房主)" data-index="owner_nickname">
            <template #cell="{ record }">
              <span>{{ record.owner_nickname || '未知用户' }}</span>
            </template>
          </a-table-column>
          <a-table-column title="在房人数" data-index="player_count">
            <template #cell="{ record }">
              <a-badge status="processing" :text="`${record.player_count} / 5 人`" />
            </template>
          </a-table-column>
          <a-table-column title="茶水金库统计">
            <template #cell="{ record }">
              <div v-if="record.total_tea_money > 0">
                <div class="tea-info">
                  累计收取: <span class="tea-num">{{ record.accumulated_tea_money }}</span> / {{ record.total_tea_money }} 分
                </div>
                <div class="tea-sub">
                  模式: {{ record.tea_mode === 1 ? '比例扣除' : '固定额度' }} ({{ record.tea_money_per_tx }}{{ record.tea_mode === 1 ? '%' : '分' }}/笔)
                </div>
              </div>
              <span v-else class="text-muted">未开启</span>
            </template>
          </a-table-column>
          <a-table-column title="创建时间" data-index="created_at">
            <template #cell="{ record }">
              <span>{{ formatTime(record.created_at) }}</span>
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="130">
            <template #cell="{ record }">
              <a-button type="outline" size="small" @click="showTransactions(record)" class="action-btn">
                <template #icon><icon-list /></template>
                流水对账单
              </a-button>
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

    <!-- Modal for Transactions -->
    <a-modal
      v-model:visible="modalVisible"
      :title="`📜 房间 [${selectedRoomCode}] 记账流水明细`"
      width="820px"
      :footer="false"
      class="custom-modal"
    >
      <div v-if="txLoading" class="modal-loading flex-center">
        <a-spin :size="36" />
      </div>
      <div v-else>
        <a-table :data="transactions" :pagination="false" :bordered="false" class="modal-table">
          <template #columns>
            <a-table-column title="序号" data-index="id" :width="80">
              <template #cell="{ record, rowIndex }">
                <span class="round-badge">R{{ transactions.length - rowIndex }}</span>
              </template>
            </a-table-column>
            <a-table-column title="出分人 (扣分)">
              <template #cell="{ record }">
                <span :class="{ 'undone-text': record.is_undone === 1 }">{{ record.from_nickname }}</span>
              </template>
            </a-table-column>
            <a-table-column title="方向" :width="60">
              <template #cell>
                <span class="tx-arrow">➔</span>
              </template>
            </a-table-column>
            <a-table-column title="得分人 (加分)">
              <template #cell="{ record }">
                <span :class="{ 'undone-text': record.is_undone === 1 }">{{ record.to_nickname }}</span>
              </template>
            </a-table-column>
            <a-table-column title="分值">
              <template #cell="{ record }">
                <span :class="['score-val', record.is_undone === 1 ? 'undone-text' : 'score-active']">{{ record.amount }} 分</span>
              </template>
            </a-table-column>
            <a-table-column title="已扣茶水">
              <template #cell="{ record }">
                <span :class="{ 'undone-text': record.is_undone === 1 }">{{ record.tea_deducted > 0 ? record.tea_deducted + ' 分' : '—' }}</span>
              </template>
            </a-table-column>
            <a-table-column title="状态" :width="110">
              <template #cell="{ record }">
                <a-tag :color="record.is_undone === 1 ? 'gray' : 'green'">
                  {{ record.is_undone === 1 ? '已撤销' : '生效中' }}
                </a-tag>
              </template>
            </a-table-column>
            <a-table-column title="记账时间">
              <template #cell="{ record }">
                <span class="time-text">{{ formatTime(record.created_at) }}</span>
              </template>
            </a-table-column>
          </template>
        </a-table>
        <div v-if="transactions.length === 0" class="empty-tx flex-center">
          <a-empty description="该房间暂无记分记录" />
        </div>
      </div>
    </a-modal>
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
  room_code: ''
});

const pagination = reactive({
  page: 1,
  pageSize: 10
});

const handleSearch = () => {
  pagination.page = 1;
  fetchRooms();
};

const handleReset = () => {
  query.room_code = '';
  pagination.page = 1;
  fetchRooms();
};

const handlePageChange = (page) => {
  pagination.page = page;
  fetchRooms();
};

const fetchRooms = async () => {
  loading.value = true;
  const token = localStorage.getItem('admin_token');
  try {
    const url = `${API_BASE}/api/admin/rooms?page=${pagination.page}&pageSize=${pagination.pageSize}&room_code=${query.room_code}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    if (result.code === 0) {
      list.value = result.data.list;
      total.value = result.data.total;
    } else {
      Message.error(result.message || '获取房间列表失败');
    }
  } catch (err) {
    console.error('Fetch rooms error', err);
    Message.error('无法请求接口数据');
  } finally {
    loading.value = false;
  }
};

// Modal transactions state
const modalVisible = ref(false);
const txLoading = ref(false);
const transactions = ref([]);
const selectedRoomCode = ref('');

const showTransactions = async (room) => {
  selectedRoomCode.value = room.room_code;
  modalVisible.value = true;
  txLoading.value = true;
  transactions.value = [];

  const token = localStorage.getItem('admin_token');
  try {
    const url = `${API_BASE}/api/admin/room/transactions?room_id=${room.id}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    if (result.code === 0) {
      transactions.value = result.data;
    } else {
      Message.error(result.message || '获取流水失败');
    }
  } catch (err) {
    console.error('Fetch tx error', err);
    Message.error('请求流水详情失败');
  } finally {
    txLoading.value = false;
  }
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
  fetchRooms();
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

.room-code-tag {
  font-family: 'Outfit', monospace;
  font-weight: 700;
  font-size: 14px;
  color: #0b9b77;
  background: rgba(11, 155, 119, 0.08);
  padding: 4px 10px;
  border-radius: 8px;
}

.status-tag {
  font-weight: 600;
  border-radius: 6px;
}

.tea-info {
  font-size: 13px;
  color: #2d3748;
}

.tea-num {
  font-weight: 700;
  color: #0b9b77;
}

.tea-sub {
  font-size: 11px;
  color: #a0aec0;
  margin-top: 2px;
}

.text-muted {
  font-size: 12px;
  color: #a0aec0;
}

.action-btn {
  border-color: #0b9b77 !important;
  color: #0b9b77 !important;
  font-weight: 500;
  border-radius: 8px;
}

.action-btn:hover {
  background: rgba(11, 155, 119, 0.05) !important;
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

.modal-loading {
  height: 200px;
}

.round-badge {
  font-family: 'Outfit', monospace;
  font-weight: 700;
  font-size: 12px;
  color: #0096c7;
  background: rgba(0, 150, 199, 0.08);
  padding: 2px 6px;
  border-radius: 6px;
}

.tx-arrow {
  color: #809a96;
  font-weight: bold;
}

.score-val {
  font-weight: 700;
}

.score-active {
  color: #e53e3e;
}

.undone-text {
  text-decoration: line-through;
  color: #a0aec0 !important;
}

.time-text {
  font-size: 12px;
  color: #718096;
}

.empty-tx {
  padding: 40px 0;
}
</style>
