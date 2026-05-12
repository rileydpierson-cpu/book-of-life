import '../../styles/login.css';
import { postJson } from '../../core/api.js';

const form = document.getElementById('loginForm');
const input = document.getElementById('secretInput');
const button = document.getElementById('loginButton');
const errorNode = document.getElementById('loginError');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorNode.textContent = '';
  errorNode.classList.add('hidden');
  button.disabled = true;
  try {
    const payload = await postJson('/auth/login', { secret: input.value });
    window.location.href = payload.redirectTo || '/';
  } catch (error) {
    errorNode.textContent = error.message || 'Login failed.';
    errorNode.classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
});

window.addEventListener('pageshow', () => {
  input.focus();
});
