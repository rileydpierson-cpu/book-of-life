import '../../styles/login.css';
import { postJson } from '../../core/api.js';

const form = document.getElementById('authForm');
const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const confirmPasswordWrap = document.getElementById('confirmPasswordWrap');
const confirmPasswordInput = document.getElementById('confirmPasswordInput');
const button = document.getElementById('authButton');
const subtitle = document.getElementById('loginSubtitle');
const hint = document.getElementById('loginHint');
const errorNode = document.getElementById('loginError');
const modeButtons = Array.from(document.querySelectorAll('[data-auth-mode]'));

const MODE_COPY = {
  login: {
    subtitle: 'Sign in with your account to open your timeline and media.',
    hint: 'Use the username and password for an existing account.',
    button: 'Log in',
    endpoint: '/auth/login',
    icon: 'sign-in'
  },
  signup: {
    subtitle: 'Create an account with a username that has already been approved in server config.',
    hint: 'Only usernames listed in LIFESERVER_ALLOWED_USERS may sign up.',
    button: 'Create account',
    endpoint: '/auth/signup',
    icon: 'user-plus'
  }
};

let mode = 'login';

function renderMode() {
  const copy = MODE_COPY[mode];
  subtitle.textContent = copy.subtitle;
  hint.textContent = copy.hint;
  button.innerHTML = `<i class="ph-bold ph-${copy.icon}"></i><span id="authButtonLabel">${copy.button}</span>`;
  confirmPasswordWrap.classList.toggle('hidden', mode !== 'signup');
  passwordInput.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
  confirmPasswordInput.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'off');
  modeButtons.forEach((item) => {
    const active = item.dataset.authMode === mode;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  errorNode.textContent = '';
  errorNode.classList.add('hidden');
}

modeButtons.forEach((item) => {
  item.addEventListener('click', () => {
    mode = item.dataset.authMode === 'signup' ? 'signup' : 'login';
    renderMode();
    usernameInput.focus();
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorNode.textContent = '';
  errorNode.classList.add('hidden');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (mode === 'signup' && password !== confirmPassword) {
    errorNode.textContent = 'The passwords did not match.';
    errorNode.classList.remove('hidden');
    confirmPasswordInput.focus();
    return;
  }

  button.disabled = true;
  try {
    const payload = await postJson(MODE_COPY[mode].endpoint, { username, password });
    window.location.href = payload.redirectTo || '/';
  } catch (error) {
    errorNode.textContent = error.message || `${MODE_COPY[mode].button} failed.`;
    errorNode.classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
});

window.addEventListener('pageshow', () => {
  usernameInput.focus();
});

renderMode();
