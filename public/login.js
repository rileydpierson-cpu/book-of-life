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
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: input.value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Login failed.');
    }
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
