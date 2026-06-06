/**
 * Utilitários gerais da plataforma
 */

const Utils = {
  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value || 0);
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(dateStr));
  },

  formatRelative(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min atrás`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h atrás`;
    const days = Math.floor(hours / 24);
    return `${days}d atrás`;
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || this._createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span><button class="toast-close">&times;</button>`;
    container.appendChild(toast);
    toast.querySelector('.toast-close').onclick = () => toast.remove();
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4000);
  },

  _createToastContainer() {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
    return el;
  },

  showLoading(show = true) {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(overlay);
    }
    overlay.classList.toggle('active', show);
  },

  async requireAuth(redirectTo = 'index.html') {
    const sb = getSupabase();
    if (!sb) { window.location.href = redirectTo; return null; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = redirectTo; return null; }
    return session;
  },

  async requireAdmin() {
    const session = await this.requireAuth();
    if (!session) return null;
    const sb = getSupabase();
    const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', session.user.id).single();
    if (!profile?.is_admin) {
      this.showToast('Acesso negado. Apenas administradores.', 'error');
      setTimeout(() => window.location.href = 'dashboard.html', 1500);
      return null;
    }
    return session;
  },

  getStatusLabel(status) {
    const labels = {
      open: 'Aberto',
      matched: 'Combinado',
      in_progress: 'Em andamento',
      awaiting_result: 'Aguardando resultado',
      disputed: 'Em disputa',
      completed: 'Finalizado',
      cancelled: 'Cancelado',
      searching: 'Procurando...',
      pending: 'Pendente',
      in_review: 'Em análise',
      approved: 'Aprovado',
      rejected: 'Rejeitado'
    };
    return labels[status] || status;
  },

  getStatusClass(status) {
    const classes = {
      open: 'status-open',
      matched: 'status-matched',
      in_progress: 'status-progress',
      awaiting_result: 'status-awaiting',
      disputed: 'status-disputed',
      completed: 'status-completed',
      cancelled: 'status-cancelled',
      pending: 'status-pending',
      approved: 'status-completed',
      rejected: 'status-cancelled'
    };
    return classes[status] || '';
  },

  calcConfirmationRate(profile) {
    if (!profile?.total_confirmations) return 100;
    return Math.round((profile.confirmations / profile.total_confirmations) * 100);
  },

  calcReputation(profile) {
    const rate = this.calcConfirmationRate(profile);
    const reports = profile?.reports_count || 0;
    if (reports > 0) return Math.max(0, rate - reports * 10);
    return rate;
  },

  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  formatAdminTag(profile) {
    if (!profile) return '';
    const nick = profile.admin_nick;
    const name = profile.display_name || '';
    if (nick) return `[ADM-${nick}] ${name}`;
    return name;
  },

  pixTypeLabel(type) {
    const labels = { cpf: 'CPF', email: 'E-mail', phone: 'Telefone', random: 'Chave aleatória' };
    return labels[type] || 'PIX';
  },

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast('Copiado!', 'success');
    } catch {
      this.showToast('Não foi possível copiar', 'error');
    }
  }
};
