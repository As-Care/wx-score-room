<template>
  <div class="login-container">
    <!-- Animated modern background mesh -->
    <div class="bg-mesh">
      <div class="mesh-sphere sphere-1"></div>
      <div class="mesh-sphere sphere-2"></div>
      <div class="mesh-sphere sphere-3"></div>
    </div>

    <!-- Login Glass Panel Card -->
    <div class="login-card glass-panel animate-fade-in">
      <div class="login-header">
        <div class="logo-box">
          <span class="logo-emoji">📊</span>
        </div>
        <h2 class="title">打牌记账管理端</h2>
        <p class="subtitle">Enter credentials to manage rooms and users</p>
      </div>

      <a-form :model="form" layout="vertical" @submit="handleSubmit">
        <a-form-item field="username" label="管理员账号" required>
          <a-input v-model="form.username" placeholder="请输入账号..." size="large">
            <template #prefix>
              <icon-user />
            </template>
          </a-input>
        </a-form-item>

        <a-form-item field="password" label="管理员密码" required>
          <a-input-password v-model="form.password" placeholder="请输入密码..." size="large">
            <template #prefix>
              <icon-lock />
            </template>
          </a-input-password>
        </a-form-item>

        <div style="margin-top: 32px">
          <a-button type="primary" html-type="submit" size="large" long :loading="loading" class="btn-gradient">
            立即登录
          </a-button>
        </div>
      </a-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import { API_BASE } from '../config';

const router = useRouter();
const loading = ref(false);

const form = reactive({
  username: '',
  password: ''
});

const handleSubmit = async () => {
  if (!form.username || !form.password) {
    Message.warning('请填写完整的账号和密码');
    return;
  }

  loading.value = true;
  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(form)
    });

    const result = await response.json();
    if (result.code === 0) {
      localStorage.setItem('admin_token', result.data.token);
      Message.success('登录成功，欢迎回来！');
      router.push('/dashboard/rooms');
    } else {
      Message.error(result.message || '用户名或密码错误');
    }
  } catch (err) {
    console.error('Login error', err);
    Message.error('无法连接到服务端接口，请检查后端运行状态');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  background: #0b221d; /* Deep slate background */
}

/* Background animated circles */
.bg-mesh {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.mesh-sphere {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.45;
  animation: move-spheres 25s infinite ease-in-out alternate;
}

.sphere-1 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, #0b9b77 0%, rgba(11, 155, 119, 0) 70%);
  top: -10%;
  left: 10%;
}

.sphere-2 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #0096c7 0%, rgba(0, 150, 199, 0) 70%);
  bottom: 10%;
  right: 10%;
  animation-delay: -5s;
}

.sphere-3 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, #9b5de5 0%, rgba(155, 93, 229, 0) 70%);
  top: 40%;
  left: 50%;
  animation-delay: -10s;
}

@keyframes move-spheres {
  0% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(50px, -50px) scale(1.1);
  }
  100% {
    transform: translate(-30px, 40px) scale(0.95);
  }
}

.login-card {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 420px;
  padding: 40px 32px;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(25px);
  -webkit-backdrop-filter: blur(25px);
  border-radius: 24px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-box {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(11, 155, 119, 0.15);
  border: 1px solid rgba(11, 155, 119, 0.3);
  margin-bottom: 16px;
}

.logo-emoji {
  font-size: 32px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: #ffffff;
  margin: 0 0 8px 0;
  letter-spacing: 1px;
}

.subtitle {
  font-size: 13px;
  color: #a0aec0;
  margin: 0;
}

/* Custom styles for form items to fit dark theme */
:deep(.arco-form-item-label) {
  color: #e2e8f0 !important;
  font-weight: 500;
  margin-bottom: 6px;
}

:deep(.arco-input-wrapper) {
  background-color: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 10px !important;
  color: #ffffff !important;
}

:deep(.arco-input-wrapper:hover), :deep(.arco-input-wrapper-focus) {
  background-color: rgba(255, 255, 255, 0.08) !important;
  border-color: #0b9b77 !important;
  box-shadow: 0 0 0 2px rgba(11, 155, 119, 0.2) !important;
}

:deep(.arco-input-prefix) {
  color: #b2c4c1 !important;
}

.btn-gradient {
  background: linear-gradient(135deg, #0b9b77 0%, #0096c7 100%) !important;
  border: none !important;
  border-radius: 10px !important;
  font-weight: 600;
  letter-spacing: 1px;
  box-shadow: 0 6px 20px rgba(11, 155, 119, 0.35) !important;
  transition: all 0.2s ease-in-out !important;
}

.btn-gradient:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(11, 155, 119, 0.5) !important;
}

.btn-gradient:active {
  transform: translateY(0);
}

.animate-fade-in {
  animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
