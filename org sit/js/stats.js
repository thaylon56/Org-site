/**
 * Estatísticas de apostas do jogador
 */
const Stats = {
  async loadProfile(userId) {
    return Auth.getProfile(userId);
  },

  renderStats(profile, containerId = 'stats-grid') {
    const el = document.getElementById(containerId);
    if (!el || !profile) return;

    const confirmRate = Utils.calcConfirmationRate(profile);
    const reputation = Utils.calcReputation(profile);

    el.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon">💰</div>
        <div class="stat-value">${Utils.formatCurrency(profile.total_bet)}</div>
        <div class="stat-label">Total Apostado</div>
      </div>
      <div class="stat-card stat-win">
        <div class="stat-icon">🏆</div>
        <div class="stat-value">${Utils.formatCurrency(profile.total_won)}</div>
        <div class="stat-label">Total Ganho</div>
      </div>
      <div class="stat-card stat-loss">
        <div class="stat-icon">📉</div>
        <div class="stat-value">${Utils.formatCurrency(profile.total_lost)}</div>
        <div class="stat-label">Total Perdido</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">💎</div>
        <div class="stat-value">${Utils.formatCurrency(profile.biggest_win)}</div>
        <div class="stat-label">Maior Vitória</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🔥</div>
        <div class="stat-value">${profile.best_win_streak}</div>
        <div class="stat-label">Maior Sequência</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🎁</div>
        <div class="stat-value">${Utils.formatCurrency(profile.cashback_earned)}</div>
        <div class="stat-label">Cashback Total</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⚔️</div>
        <div class="stat-value">${profile.matches_played}</div>
        <div class="stat-label">Partidas</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-value">${profile.wins}W / ${profile.losses}L</div>
        <div class="stat-label">Vitórias / Derrotas</div>
      </div>
    `;

    const trustEl = document.getElementById('trust-card');
    if (trustEl) {
      trustEl.innerHTML = `
        <div class="trust-header">
          <h3>Histórico de Confiança</h3>
          <div class="reputation-badge ${reputation >= 90 ? 'rep-high' : reputation >= 70 ? 'rep-medium' : 'rep-low'}">
            ${reputation}% Reputação
          </div>
        </div>
        <div class="trust-stats">
          <div class="trust-item">
            <span class="trust-number">${profile.matches_played}</span>
            <span class="trust-label">Partidas</span>
          </div>
          <div class="trust-item">
            <span class="trust-number">${confirmRate}%</span>
            <span class="trust-label">Confirmações</span>
          </div>
          <div class="trust-item">
            <span class="trust-number">${profile.cancellations}</span>
            <span class="trust-label">Cancelamentos</span>
          </div>
          <div class="trust-item">
            <span class="trust-number">${profile.reports_count}</span>
            <span class="trust-label">Denúncias</span>
          </div>
        </div>
        <div class="trust-bar">
          <div class="trust-bar-fill" style="width: ${reputation}%"></div>
        </div>
        ${profile.reports_count === 0 ? '<p class="trust-clean">✅ Sem denúncias</p>' : '<p class="trust-warning">⚠️ Possui denúncias</p>'}
      `;
    }
  }
};
