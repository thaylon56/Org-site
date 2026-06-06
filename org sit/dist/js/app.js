/**
 * App principal - navegação e inicialização
 */
const App = {
  async initSidebar(user, profile) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const wallet = await Auth.getWallet(user.id);
    const balanceEl = document.getElementById('sidebar-balance');
    if (balanceEl && wallet) {
      const available = (wallet.balance || 0) + (wallet.cashback_balance || 0);
      balanceEl.textContent = Utils.formatCurrency(available);
    }

    const nameEl = document.getElementById('sidebar-username');
    if (nameEl) nameEl.textContent = profile?.display_name || user.email;

    const adminLink = document.getElementById('admin-nav-link');
    if (adminLink) adminLink.style.display = profile?.is_admin ? 'flex' : 'none';

    // Mobile menu toggle
    const toggle = document.getElementById('menu-toggle');
    const overlay = document.getElementById('sidebar-overlay');
    if (toggle) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay?.classList.toggle('active');
      });
    }
    overlay?.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });

    Auth.initLogoutButtons();
  },

  highlightActiveNav() {
    const page = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link').forEach(link => {
      const href = link.getAttribute('href');
      link.classList.toggle('active', href === page);
    });
  },

  async initPage() {
    this.highlightActiveNav();

    const page = document.body.dataset.page;
    if (!page || page === 'landing' || page === 'auth') return;

    const session = page === 'admin'
      ? await Utils.requireAdmin()
      : await Utils.requireAuth();

    if (!session) return;

    const user = session.user;
    const profile = await Auth.getProfile(user.id);
    await this.initSidebar(user, profile);

    switch (page) {
      case 'dashboard': await this.initDashboard(user, profile); break;
      case 'wallet': await this.initWallet(user); break;
      case 'challenges': await this.initChallenges(user); break;
      case 'matchmaking':
        Matchmaking.renderSearchUI(false);
        Matchmaking.init(user.id);
        break;
      case 'stats': Stats.renderStats(profile); break;
      case 'ranking': Ranking.init(); break;
      case 'proofs': Proofs.init(user.id); break;
      case 'admin': await Admin.init(user.id); break;
    }
  },

  async initDashboard(user, profile) {
    const wallet = await Wallet.loadWallet(user.id);
    Wallet.renderWalletCard(wallet);

    const challenges = await Challenges.loadUserChallenges(user.id);
    const active = challenges.filter(c => !['completed', 'cancelled'].includes(c.status));
    Challenges.renderChallengesList(active.slice(0, 5), user.id, 'active-challenges');

    Stats.renderStats(profile, 'dashboard-stats');

    const confirmRate = Utils.calcConfirmationRate(profile);
    const trustMini = document.getElementById('trust-mini');
    if (trustMini) {
      trustMini.innerHTML = `
        <div class="trust-mini-item"><span>${profile.matches_played}</span> partidas</div>
        <div class="trust-mini-item"><span>${confirmRate}%</span> confirmações</div>
        <div class="trust-mini-item"><span>${profile.reports_count === 0 ? '✅' : '⚠️'}</span> ${profile.reports_count === 0 ? 'Sem denúncias' : profile.reports_count + ' denúncia(s)'}</div>
      `;
    }
  },

  async initWallet(user) {
    const wallet = await Wallet.loadWallet(user.id);
    Wallet.renderWalletCard(wallet);
    const transactions = await Wallet.loadTransactions(user.id);
    Wallet.renderTransactions(transactions);
    Wallet.initDepositForm(user.id);
  },

  async initChallenges(user) {
    Challenges.initCreateForm(user.id);
    const challenges = await Challenges.loadOpenChallenges();
    Challenges.renderChallengesList(challenges, user.id);

    Challenges.subscribeRealtime(user.id, async () => {
      const updated = await Challenges.loadOpenChallenges();
      Challenges.renderChallengesList(updated, user.id);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Auth.initAuthForms();
  if (document.getElementById('app-root')) Layout.render();
  App.initPage();
});
