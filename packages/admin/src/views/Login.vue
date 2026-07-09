<template>
  <div class="login-container">
    <!-- Top Left Theme Switcher -->
    <div class="theme-switcher-wrapper">
      <label class="block custom-switch cursor-pointer outline-none border-none" for="theme-switch">
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
    </div>

    <!-- Login Card Container -->
    <div class="container animate-fade-in">
      <form class="form" @submit.prevent="handleSubmit">
        <div class="form_front">
          <div class="form_details">Login</div>
          <input type="text" class="input" placeholder="Username" v-model="form.username" required>
          <input type="password" class="input" placeholder="Password" v-model="form.password" required>
          <button class="btn" type="submit" :disabled="loading">
            {{ loading ? 'Logging in...' : 'Login' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import { API_BASE } from '../config';

const router = useRouter();
const loading = ref(false);

const isDark = ref(localStorage.getItem('theme') === 'dark');

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
.login-container {
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  background-color: #212121; /* Default Dark */
  transition: background-color 0.3s ease;
  position: relative;
}

body:not([arco-theme='dark']) .login-container {
  background-color: #f4f7f6; /* Light Mode Background */
}

/* Theme Switcher Wrapper */
.theme-switcher-wrapper {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 100;
}

/* Custom Switch Toggle Styles */
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

/* User's login card styles */
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  z-index: 10;
  width: 440px;
  height: 380px;
}

.form {
  width: 100%;
  height: 100%;
  position: relative;
}

.form .form_front {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 20px;
  position: absolute;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 40px 45px;
  border-radius: 15px;
  background-color: #212121;
  box-shadow: inset 2px 2px 10px rgba(0,0,0,1),
  inset -1px -1px 5px rgba(255, 255, 255, 0.6);
  transition: background-color 0.3s, box-shadow 0.3s;
}

body:not([arco-theme='dark']) .form .form_front {
  background-color: #f4f7f6;
  box-shadow: inset 2px 2px 10px rgba(0,0,0,0.1),
  inset -1px -1px 5px rgba(255, 255, 255, 0.9),
  0 10px 30px rgba(0,0,0,0.05);
}

.form_details {
  font-size: 25px;
  font-weight: 600;
  padding-bottom: 10px;
  color: white;
  transition: color 0.3s;
}

body:not([arco-theme='dark']) .form_details {
  color: #212121;
}

.input {
  width: 280px;
  min-height: 45px;
  color: #fff;
  outline: none;
  transition: 0.35s;
  padding: 0px 12px;
  box-sizing: border-box;
  background-color: #212121;
  border-radius: 6px;
  border: 2px solid #212121;
  box-shadow: 6px 6px 10px rgba(0,0,0,1),
  1px 1px 10px rgba(255, 255, 255, 0.6);
}

body:not([arco-theme='dark']) .input {
  color: #212121;
  background-color: #f4f7f6;
  border: 2px solid #cecece;
  box-shadow: 6px 6px 10px rgba(0,0,0,0.05),
  1px 1px 10px rgba(255, 255, 255, 0.9);
}

.input::placeholder {
  color: #999;
}

.input:focus.input::placeholder {
  transition: 0.3s;
  opacity: 0;
}

.input:focus {
  transform: scale(1.05);
  box-shadow: 6px 6px 10px rgba(0,0,0,1),
  1px 1px 10px rgba(255, 255, 255, 0.6),
  inset 2px 2px 10px rgba(0,0,0,1),
  inset -1px -1px 5px rgba(255, 255, 255, 0.6);
}

body:not([arco-theme='dark']) .input:focus {
  box-shadow: 6px 6px 10px rgba(0,0,0,0.05),
  1px 1px 10px rgba(255, 255, 255, 0.9),
  inset 2px 2px 10px rgba(0,0,0,0.08),
  inset -1px -1px 5px rgba(255, 255, 255, 0.9);
  border-color: #212121;
}

.btn {
  padding: 10px 35px;
  cursor: pointer;
  background-color: #212121;
  border-radius: 6px;
  border: 2px solid #212121;
  box-shadow: 6px 6px 10px rgba(0,0,0,1),
  1px 1px 10px rgba(255, 255, 255, 0.6);
  color: #fff;
  font-size: 15px;
  font-weight: bold;
  transition: 0.35s;
  width: 280px;
  box-sizing: border-box;
}

body:not([arco-theme='dark']) .btn {
  background-color: #212121;
  color: #fff;
  border: 2px solid #212121;
  box-shadow: 6px 6px 10px rgba(0,0,0,0.1),
  1px 1px 10px rgba(255, 255, 255, 0.9);
}

.btn:hover {
  transform: scale(1.05);
  box-shadow: 6px 6px 10px rgba(0,0,0,1),
  1px 1px 10px rgba(255, 255, 255, 0.6),
  inset 2px 2px 10px rgba(0,0,0,1),
  inset -1px -1px 5px rgba(255, 255, 255, 0.6);
}

body:not([arco-theme='dark']) .btn:hover {
  box-shadow: 6px 6px 10px rgba(0,0,0,0.1),
  1px 1px 10px rgba(255, 255, 255, 0.9),
  inset 2px 2px 10px rgba(0,0,0,0.2),
  inset -1px -1px 5px rgba(255, 255, 255, 0.9);
}

.btn:focus {
  transform: scale(1.05);
  box-shadow: 6px 6px 10px rgba(0,0,0,1),
  1px 1px 10px rgba(255, 255, 255, 0.6),
  inset 2px 2px 10px rgba(0,0,0,1),
  inset -1px -1px 5px rgba(255, 255, 255, 0.6);
}

body:not([arco-theme='dark']) .btn:focus {
  box-shadow: 6px 6px 10px rgba(0,0,0,0.1),
  1px 1px 10px rgba(255, 255, 255, 0.9),
  inset 2px 2px 10px rgba(0,0,0,0.2),
  inset -1px -1px 5px rgba(255, 255, 255, 0.9);
}

.animate-fade-in {
  animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
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
