<template>
  <div class="page-layout">
    <div class="view-header">
      <h1 class="view-title">⚙️ 系统全局配置</h1>
    </div>

    <div class="settings-content">
      <a-spin :loading="loading" style="width: 100%">
        <a-form :model="form" layout="vertical" class="settings-form" @submit.prevent="handleSave">
          
          <!-- Section 1: 公告设置 -->
          <div class="settings-section glass-panel">
            <h3 class="section-title">📢 微信小程序公告</h3>
            <p class="section-desc">编辑此公告文案，将在微信小程序的首页顶部进行展示，提示打牌玩家重要信息。</p>
            <a-form-item field="announcement" label="公告内容">
              <a-textarea 
                v-model="form.announcement" 
                placeholder="例如：打牌记账，自觉自觉！撤销分数需要找房主进行。" 
                :auto-size="{ minRows: 3, maxRows: 6 }"
                class="custom-textarea"
              />
            </a-form-item>
          </div>

          <!-- Section 2: 安全限制 -->
          <div class="settings-section glass-panel">
            <h3 class="section-title">🔒 平台安全与限制</h3>
            <p class="section-desc">限制单个用户的活跃资源，防止出现恶意建房等滥用服务器资源的行为。</p>
            <a-form-item field="max_active_rooms" label="单用户最大活跃房间数">
              <a-input-number 
                v-model="form.max_active_rooms" 
                :min="1" 
                :max="50" 
                placeholder="默认: 5" 
                class="custom-number-input"
              />
              <template #extra>
                <div>当房主拥有的进行中房间数达到此限制时，将无法创建新房间，直至历史房间结算。</div>
              </template>
            </a-form-item>
          </div>

          <!-- Section 3: 系统维护 -->
          <div class="settings-section glass-panel">
            <h3 class="section-title">🛠️ 系统运行状态</h3>
            <p class="section-desc">紧急或例行维护时开启，开启后小程序将冻结房间的创建和玩家的加入。</p>
            <a-form-item field="maintenance_mode" label="系统维护模式">
              <a-switch 
                v-model="form.maintenance_mode" 
                type="round"
                class="custom-switch-input"
              >
                <template #checked>开启</template>
                <template #unchecked>关闭</template>
              </a-switch>
              <template #extra>
                <div :class="{ 'warning-text': form.maintenance_mode }">
                  {{ form.maintenance_mode ? '⚠️ 当前系统处于维护状态，小程序端所有玩家将无法创建或加入新房间！' : '系统运行正常。' }}
                </div>
              </template>
            </a-form-item>
          </div>

          <!-- Save Button -->
          <div class="form-actions">
            <a-button type="primary" size="large" class="save-btn" html-type="submit" :loading="saving">
              <template #icon><IconSave /></template>
              保存配置项
            </a-button>
          </div>

        </a-form>
      </a-spin>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Message } from '@arco-design/web-vue';
import { API_BASE } from '../config';

const loading = ref(false);
const saving = ref(false);

const form = reactive({
  announcement: '',
  max_active_rooms: 5,
  maintenance_mode: false
});

const fetchConfig = async () => {
  loading.value = true;
  const token = localStorage.getItem('admin_token');
  try {
    const response = await fetch(`${API_BASE}/api/admin/config`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    if (result.code === 0) {
      form.announcement = result.data.announcement || '';
      form.max_active_rooms = parseInt(result.data.max_active_rooms || '5');
      form.maintenance_mode = result.data.maintenance_mode === '1';
    } else {
      Message.error(result.message || '获取配置失败');
    }
  } catch (err) {
    console.error('Fetch config error', err);
    Message.error('无法请求接口数据');
  } finally {
    loading.value = false;
  }
};

const handleSave = async () => {
  saving.value = true;
  const token = localStorage.getItem('admin_token');
  try {
    const response = await fetch(`${API_BASE}/api/admin/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        announcement: form.announcement,
        max_active_rooms: String(form.max_active_rooms),
        maintenance_mode: form.maintenance_mode ? '1' : '0'
      })
    });
    const result = await response.json();
    if (result.code === 0) {
      Message.success('配置已保存成功！');
      fetchConfig();
    } else {
      Message.error(result.message || '保存配置失败');
    }
  } catch (err) {
    console.error('Save config error', err);
    Message.error('接口请求错误，无法保存');
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  fetchConfig();
});
</script>

<style scoped>
.page-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.view-header {
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

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 40px;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.settings-section {
  padding: 24px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.45) !important;
}

body[arco-theme='dark'] .settings-section {
  background: rgba(30, 30, 35, 0.4) !important;
}

.section-title {
  margin-top: 0;
  margin-bottom: 6px;
  font-size: 16px;
  font-weight: 700;
}

.section-desc {
  font-size: 13px;
  color: #718096;
  margin-top: 0;
  margin-bottom: 20px;
}

body[arco-theme='dark'] .section-desc {
  color: #a0aec0;
}

.custom-textarea, .custom-number-input, .custom-switch-input {
  border-radius: 8px;
}

.warning-text {
  color: #e53e3e;
  font-weight: 600;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.save-btn {
  border-radius: 8px;
  font-weight: 600;
  min-width: 140px;
}
</style>
