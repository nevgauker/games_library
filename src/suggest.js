(() => {
  const form = document.getElementById('suggestForm');
  const status = document.getElementById('status');
  const success = document.getElementById('successMessage');

  function getSuggestions() {
    try {
      const raw = localStorage.getItem('gameSuggestions');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveSuggestions(list) {
    localStorage.setItem('gameSuggestions', JSON.stringify(list));
  }

  function validateEmail(email) {
    return /.+@.+\..+/.test(email);
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    status.textContent = '';
    success.classList.add('hidden');

    const data = Object.fromEntries(new FormData(form).entries());

    if (!validateEmail(data.email)) {
      status.textContent = 'Please enter a valid email address.';
      status.style.color = 'var(--danger)';
      return;
    }

    const suggestion = {
      id: crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name: String(data.name || '').trim(),
      email: String(data.email || '').trim(),
      title: String(data.title || '').trim(),
      description: String(data.description || '').trim(),
      createdAt: new Date().toISOString(),
    };

    const list = getSuggestions();
    list.push(suggestion);
    saveSuggestions(list);

    form.reset();
    success.classList.remove('hidden');
    status.textContent = '';
  });
})();

