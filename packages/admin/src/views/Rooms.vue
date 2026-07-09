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
        @change="handleTableChange"
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
          <a-table-column title="最大赢家" data-index="max_winner_score" :sortable="{ sortDirections: ['ascend', 'descend'], sorter: true }">
            <template #cell="{ record }">
              <span v-if="record.max_winner_name" class="win-color">
                👑 {{ record.max_winner_name }} (+{{ record.max_winner_score }}分)
              </span>
              <span v-else class="text-muted">—</span>
            </template>
          </a-table-column>
          <a-table-column title="最大输家" data-index="max_loser_score" :sortable="{ sortDirections: ['ascend', 'descend'], sorter: true }">
            <template #cell="{ record }">
              <span v-if="record.max_loser_name" class="loss-color">
                💸 {{ record.max_loser_name }} ({{ record.max_loser_score }}分)
              </span>
              <span v-else class="text-muted">—</span>
            </template>
          </a-table-column>
          <a-table-column title="创建时间" data-index="created_at">
            <template #cell="{ record }">
              <span>{{ formatTime(record.created_at) }}</span>
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="110" align="center">
            <template #cell="{ record }">
              <div class="action-group">
                <a-tooltip content="查看对账单" position="top">
                  <a-button type="outline" shape="circle" size="small" @click="showTransactions(record)" class="action-btn" style="margin-right: 8px">
                    <template #icon><icon-list /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip :content="record.status !== 1 && record.player_count !== 1 ? '进行中且多于一人的房间不可删除' : '删除房间'" position="top">
                  <a-popconfirm content="确认删除该房间的所有数据（包含流水、玩家战绩和总积分）吗？此操作无法恢复。" position="br" type="warning" @ok="handleDeleteRoom(record)">
                    <a-button type="outline" status="danger" shape="circle" size="small" class="delete-btn" :loading="record.deleteLoading" :disabled="record.status !== 1 && record.player_count !== 1">
                      <template #icon><icon-delete /></template>
                    </a-button>
                  </a-popconfirm>
                </a-tooltip>
              </div>
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
      width="1060px"
      :footer="false"
      class="custom-modal"
    >
      <div v-if="txLoading" class="modal-loading flex-center">
        <a-spin :size="36" />
      </div>
      <div v-else>
        <a-table :data="transactions" :pagination="false" :bordered="false" class="modal-table">
          <template #columns>
            <a-table-column title="序号" data-index="id" :width="90">
              <template #cell="{ record, rowIndex }">
                <span class="round-badge">R{{ transactions.length - rowIndex }}</span>
              </template>
            </a-table-column>
            <a-table-column title="出分人 (扣分)" :width="140">
              <template #cell="{ record }">
                <span :class="{ 'undone-text': record.is_undone === 1 }">{{ record.from_nickname }}</span>
              </template>
            </a-table-column>
            <a-table-column title="方向" :width="70">
              <template #cell>
                <span class="tx-arrow">➔</span>
              </template>
            </a-table-column>
            <a-table-column title="得分人 (加分)" :width="140">
              <template #cell="{ record }">
                <span :class="{ 'undone-text': record.is_undone === 1 }">{{ record.to_nickname }}</span>
              </template>
            </a-table-column>
            <a-table-column title="分值" :width="110">
              <template #cell="{ record }">
                <span :class="['score-val', record.is_undone === 1 ? 'undone-text' : 'score-active']">{{ record.amount }} 分</span>
              </template>
            </a-table-column>
            <a-table-column title="已扣茶水" :width="120">
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
            <a-table-column title="记账时间" :width="170">
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
  room_code: '',
  sortField: '',
  sortOrder: ''
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
  query.sortField = '';
  query.sortOrder = '';
  pagination.page = 1;
  fetchRooms();
};

const handlePageChange = (page) => {
  pagination.page = page;
  fetchRooms();
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
  fetchRooms();
};

const fetchRooms = async () => {
  loading.value = true;
  const token = localStorage.getItem('admin_token');
  try {
    const url = `${API_BASE}/api/admin/rooms?page=${pagination.page}&pageSize=${pagination.pageSize}&room_code=${query.room_code}&sortField=${query.sortField}&sortOrder=${query.sortOrder}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    if (result.code === 0) {
      list.value = (result.data.list || []).map(r => ({
        ...r,
        deleteLoading: false
      }));
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

const handleDeleteRoom = async (room) => {
  room.deleteLoading = true;
  const token = localStorage.getItem('admin_token');
  try {
    const url = `${API_BASE}/api/admin/room?room_id=${room.id}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    if (result.code === 0) {
      Message.success('房间及其关联的所有数据已成功彻底删除！');
      fetchRooms(); // 重新加载表格数据
    } else {
      Message.error(result.message || '删除房间失败');
      room.deleteLoading = false;
    }
  } catch (err) {
    console.error('Delete room error', err);
    Message.error('网络错误或无权限，删除房间失败');
    room.deleteLoading = false;
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

body[arco-theme='dark'] .tea-info {
  color: #e2e8f0;
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
  display: flex;
  justify-content: center;
  align-items: center;
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

body[arco-theme='dark'] .time-text {
  color: #a0aec0;
}

.empty-tx {
  padding: 40px 0;
}

.win-color {
  color: #0b9b77;
  font-weight: 600;
}

.loss-color {
  color: #e53e3e;
  font-weight: 600;
}

:deep(.modal-table .arco-table-th-title) {
  white-space: nowrap !important;
}

:deep(.modal-table .arco-table-cell) {
  white-space: nowrap !important;
}
</style>
