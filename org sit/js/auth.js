/**
 * Autenticação com Supabase Auth
 */
const Auth = {
  async login(email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase não configurado');

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async register(email, password, username, displayName, ffId) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase não configurado');

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: displayName, ff_id: ffId }
      }
    });
    if (error) throw error;

    // Atualizar perfil com dados extras
    if (data.user) {
      await sb.from('profiles').update({
        username,
        display_name: displayName,
        ff_id: ffId
      }).eq('id', data.user.id);
    }

    return data;
  },

  async logout() {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    window.location.href = 'index.html';
  },

  async getCurrentUser() {
    const sb = getSupabase();
    if (!sb) return null;
    const { data: { user } } = await sb.auth.getUser();
    return user;
  },

  async getProfile(userId) {
    const sb = getSupabase();
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    return data;
  },

  async getWallet(userId) {
    const sb = getSupabase();
    const { data } = await sb.from('wallets').select('*').eq('user_id', userId).single();
    return data;
  },

  initAuthForms() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        try {
          Utils.showLoading(true);
          await this.login(email, password);
          Utils.showToast('Login realizado!', 'success');
          window.location.href = 'dashboard.html';
        } catch (err) {
          Utils.showToast(err.message || 'Erro ao fazer login', 'error');
        } finally {
          Utils.showLoading(false);
        }
      });
    }

    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const username = document.getElementById('reg-username').value.trim();
        const displayName = document.getElementById('reg-display').value.trim();
        const ffId = document.getElementById('reg-ffid').value.trim();

        if (password.length < 6) {
          Utils.showToast('Senha deve ter no mínimo 6 caracteres', 'error');
          return;
        }

        try {
          Utils.showLoading(true);
          await this.register(email, password, username, displayName, ffId);
          Utils.showToast('Conta criada! Verifique seu e-mail.', 'success');
          setTimeout(() => window.location.href = 'index.html', 2000);
        } catch (err) {
          Utils.showToast(err.message || 'Erro ao criar conta', 'error');
        } finally {
          Utils.showLoading(false);
        }
      });
    }
  },

  initLogoutButtons() {
    document.querySelectorAll('[data-logout]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
      });
    });
  }
};
