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

    const redirectTo = `${window.location.origin}/verify-email.html`;

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
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

  /**
   * Processa retorno do link de verificação de e-mail (Supabase Auth)
   */
  async handleEmailCallback() {
    const sb = getSupabase();
    if (!sb) return { status: 'error', message: 'Supabase não configurado' };

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.substring(1) : '';
    const hashParams = new URLSearchParams(hash);
    const queryParams = new URLSearchParams(window.location.search);

    // Fluxo PKCE (?code=...)
    const code = queryParams.get('code');
    if (code) {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) {
        return this._mapVerifyError(error.message, hashParams.get('error_code'));
      }
      window.history.replaceState({}, document.title, window.location.pathname);
      return { status: 'success', message: 'E-mail verificado com sucesso!' };
    }

    const authError = hashParams.get('error');
    const errorCode = hashParams.get('error_code');
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');

    // Link com token válido — Supabase processa automaticamente
    if (accessToken) {
      await new Promise((r) => setTimeout(r, 600));
      const { data: { session } } = await sb.auth.getSession();
      window.history.replaceState({}, document.title, window.location.pathname);
      if (session) {
        return { status: 'success', message: 'E-mail verificado com sucesso!' };
      }
    }

    // Erro no hash (ex: link expirado ou já usado)
    if (authError) {
      const { data: { session } } = await sb.auth.getSession();
      window.history.replaceState({}, document.title, window.location.pathname);

      // Link já usado mas conta já verificada / sessão ativa
      if (session) {
        return { status: 'success', message: 'E-mail verificado com sucesso!' };
      }

      return this._mapVerifyError(
        decodeURIComponent((hashParams.get('error_description') || '').replace(/\+/g, ' ')),
        errorCode
      );
    }

    // Tentativa final: sessão já criada pelo detectSessionInUrl
    await new Promise((r) => setTimeout(r, 400));
    const { data: { session } } = await sb.auth.getSession();
    if (session && (type === 'signup' || type === 'email' || type === 'recovery')) {
      window.history.replaceState({}, document.title, window.location.pathname);
      return { status: 'success', message: 'E-mail verificado com sucesso!' };
    }

    return null;
  },

  _mapVerifyError(description, errorCode) {
    if (errorCode === 'otp_expired') {
      return {
        status: 'info',
        title: 'Link expirado ou já utilizado',
        message: 'Seu e-mail provavelmente já foi confirmado. Faça login com seu e-mail e senha para entrar.'
      };
    }
    return {
      status: 'error',
      message: description || 'Não foi possível verificar o e-mail. Tente solicitar um novo link.'
    };
  },

  /** Redireciona callbacks de auth que caírem em outras páginas */
  redirectAuthCallbackIfNeeded() {
    const hash = window.location.hash;
    const search = window.location.search;
    const isVerifyPage = window.location.pathname.endsWith('verify-email.html');
    if (isVerifyPage) return;

    const hasAuthHash = hash && (
      hash.includes('access_token') ||
      hash.includes('error=') ||
      hash.includes('type=signup') ||
      hash.includes('type=email')
    );
    const hasAuthQuery = search && search.includes('code=');

    if (hasAuthHash || hasAuthQuery) {
      window.location.replace(`verify-email.html${search}${hash}`);
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
