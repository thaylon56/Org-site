/**
 * Ranking de apostadores
 */
const Ranking = {
  async loadRanking(type = 'monthly_bet', limit = 50) {
    const sb = getSupabase();
    const orderCol = type === 'monthly_wins' ? 'monthly_wins' :
                     type === 'best_win_streak' ? 'best_win_streak' :
                     type === 'total_won' ? 'total_won' : 'monthly_bet';

    const { data } = await sb
      .from('profiles')
      .select('id, username, display_name, avatar_url, matches_played, wins, monthly_bet, monthly_wins, best_win_streak, total_won, reputation_score')
      .gt('matches_played', 0)
      .order(orderCol, { ascending: false })
      .limit(limit);

    return data || [];
  },

  renderRanking(players, type, containerId = 'ranking-list') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!players.length) {
      el.innerHTML = '<p class="empty-state">Nenhum jogador no ranking ainda.</p>';
      return;
    }

    const valueKey = type === 'monthly_wins' ? 'monthly_wins' :
                     type === 'best_win_streak' ? 'best_win_streak' :
                     type === 'total_won' ? 'total_won' : 'monthly_bet';

    const formatValue = (p) => {
      if (['monthly_bet', 'total_won'].includes(valueKey)) return Utils.formatCurrency(p[valueKey]);
      return p[valueKey] || 0;
    };

    const medals = ['🥇', '🥈', '🥉'];

    el.innerHTML = players.map((p, i) => `
      <div class="ranking-item ${i < 3 ? 'ranking-top' : ''}">
        <span class="ranking-position">${medals[i] || `#${i + 1}`}</span>
        <div class="ranking-player">
          <span class="ranking-name">${Utils.escapeHtml(p.display_name)}</span>
          <span class="ranking-username">@${Utils.escapeHtml(p.username)}</span>
        </div>
        <div class="ranking-stats">
          <span class="ranking-value">${formatValue(p)}</span>
          <span class="ranking-sub">${p.wins}W · ⭐${p.reputation_score}%</span>
        </div>
      </div>
    `).join('');
  },

  init() {
    const tabs = document.querySelectorAll('[data-ranking-tab]');
    let currentType = 'monthly_bet';

    const load = async (type) => {
      currentType = type;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.rankingTab === type));
      const players = await this.loadRanking(type);
      this.renderRanking(players, type);
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => load(tab.dataset.rankingTab));
    });

    load(currentType);
  }
};
