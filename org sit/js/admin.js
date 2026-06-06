/**
 * Painel Administrativo
 */
const Admin = {
  async loadDashboardStats() {
    const sb = getSupabase();
    const [users, challenges, deposits, disputes] = await Promise.all([
      sb.from('profiles').select('*', { count: 'exact', head: true }),
      sb.from('challenges').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      sb.from('deposit_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('disputes').select('*', { count: 'exact', head: true }).eq('status', 'pending')
    ]);

    return {
      totalUsers: users.count || 0,
      completedChallenges: challenges.count || 0,
      pendingDeposits: deposits.count || 0,
      pendingDisputes: disputes.count || 0
    };
  },

  async loadPendingDeposits() {
    const sb = getSupabase();
    const { data } = await sb
      .from('deposit_requests')
      .select('*, profiles(username, display_name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    return data || [];
  },

  async loadPendingDisputes() {
    const sb = getSupabase();
    const { data } = await sb
      .from('disputes')
      .select(`
        *,
        challenge:challenges(*, creator:profiles!challenges_creator_id_fkey(display_name), acceptor:profiles!challenges_acceptor_id_fkey(display_name)),
        reporter:profiles!disputes_reported_by_fkey(display_name)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    return data || [];
  },

  async approveDeposit(depositId, adminId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('approve_deposit', {
      p_deposit_id: depositId,
      p_admin_id: adminId
    });
    if (error) throw error;
    if (!data) throw new Error('Falha ao aprovar depósito');
    return data;
  },

  async rejectDeposit(depositId, adminId, notes) {
    const sb = getSupabase();
    const { error } = await sb.from('deposit_requests').update({
      status: 'rejected',
      processed_by: adminId,
      processed_at: new Date().toISOString(),
      admin_notes: notes
    }).eq('id', depositId);
    if (error) throw error;
  },

  async resolveDispute(disputeId, challengeId, winnerId, adminId, notes) {
    const sb = getSupabase();
    await sb.rpc('resolve_challenge', { p_challenge_id: challengeId, p_winner_id: winnerId });
    await sb.from('disputes').update({
      status: winnerId ? 'resolved_creator' : 'cancelled',
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
      admin_notes: notes
    }).eq('id', disputeId);
  },

  async loadAllUsers() {
    const sb = getSupabase();
    const { data } = await sb
      .from('profiles')
      .select('*, wallets(balance, locked_balance)')
      .order('created_at', { ascending: false })
      .limit(100);
    return data || [];
  },

  renderAdminStats(stats, containerId = 'admin-stats') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="admin-stat-card">
        <span class="admin-stat-value">${stats.totalUsers}</span>
        <span class="admin-stat-label">Usuários</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-value">${stats.completedChallenges}</span>
        <span class="admin-stat-label">Partidas Finalizadas</span>
      </div>
      <div class="admin-stat-card alert">
        <span class="admin-stat-value">${stats.pendingDeposits}</span>
        <span class="admin-stat-label">Depósitos Pendentes</span>
      </div>
      <div class="admin-stat-card alert">
        <span class="admin-stat-value">${stats.pendingDisputes}</span>
        <span class="admin-stat-label">Disputas Pendentes</span>
      </div>
    `;
  },

  renderDeposits(deposits, adminId, containerId = 'admin-deposits') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!deposits.length) {
      el.innerHTML = '<p class="empty-state">Nenhum depósito pendente.</p>';
      return;
    }

    el.innerHTML = deposits.map(d => `
      <div class="admin-item" data-id="${d.id}">
        <div class="admin-item-info">
          <strong>${Utils.escapeHtml(d.profiles?.display_name || '')}</strong>
          <span>@${Utils.escapeHtml(d.profiles?.username || '')}</span>
          <span class="admin-item-amount">${Utils.formatCurrency(d.amount)}</span>
          <span class="admin-item-date">${Utils.formatDate(d.created_at)}</span>
        </div>
        <div class="admin-item-actions">
          ${d.pix_proof_url ? `<a href="${d.pix_proof_url}" target="_blank" class="btn btn-outline btn-sm">Ver Comprovante</a>` : ''}
          <button class="btn btn-success btn-sm" onclick="Admin.handleApproveDeposit('${d.id}', '${adminId}')">Aprovar</button>
          <button class="btn btn-danger btn-sm" onclick="Admin.handleRejectDeposit('${d.id}', '${adminId}')">Rejeitar</button>
        </div>
      </div>
    `).join('');
  },

  renderDisputes(disputes, adminId, containerId = 'admin-disputes') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!disputes.length) {
      el.innerHTML = '<p class="empty-state">Nenhuma disputa pendente.</p>';
      return;
    }

    el.innerHTML = disputes.map(d => {
      const c = d.challenge;
      return `
        <div class="admin-item dispute-item" data-id="${d.id}">
          <div class="admin-item-info">
            <strong>Disputa #${d.id.slice(0, 8)}</strong>
            <span>${Utils.escapeHtml(c?.creator?.display_name || '')} vs ${Utils.escapeHtml(c?.acceptor?.display_name || '')}</span>
            <span class="admin-item-amount">${Utils.formatCurrency(c?.bet_amount || 0)}</span>
            <p class="dispute-reason">${Utils.escapeHtml(d.reason)}</p>
          </div>
          <div class="admin-item-actions">
            <button class="btn btn-success btn-sm" onclick="Admin.handleResolveDispute('${d.id}', '${c?.id}', '${c?.creator_id}', '${adminId}')">Vitória Criador</button>
            <button class="btn btn-success btn-sm" onclick="Admin.handleResolveDispute('${d.id}', '${c?.id}', '${c?.acceptor_id}', '${adminId}')">Vitória Aceitador</button>
            <a href="proofs.html?challenge=${c?.id}" class="btn btn-outline btn-sm">Ver Provas</a>
          </div>
        </div>
      `;
    }).join('');
  },

  renderUsers(users, containerId = 'admin-users') {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Jogador</th>
            <th>Partidas</th>
            <th>Reputação</th>
            <th>Saldo</th>
            <th>Admin</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>
                <strong>${Utils.escapeHtml(u.display_name)}</strong>
                <br><small>@${Utils.escapeHtml(u.username)}</small>
              </td>
              <td>${u.matches_played} (${u.wins}W/${u.losses}L)</td>
              <td>${u.reputation_score}%</td>
              <td>${Utils.formatCurrency((Array.isArray(u.wallets) ? u.wallets[0] : u.wallets)?.balance || 0)}</td>
              <td>${u.is_admin ? '✅' : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async handleApproveDeposit(id, adminId) {
    try {
      Utils.showLoading(true);
      await this.approveDeposit(id, adminId);
      Utils.showToast('Depósito aprovado!', 'success');
      const deposits = await this.loadPendingDeposits();
      this.renderDeposits(deposits, adminId);
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleRejectDeposit(id, adminId) {
    const notes = prompt('Motivo da rejeição (opcional):');
    try {
      Utils.showLoading(true);
      await this.rejectDeposit(id, adminId, notes);
      Utils.showToast('Depósito rejeitado', 'info');
      const deposits = await this.loadPendingDeposits();
      this.renderDeposits(deposits, adminId);
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleResolveDispute(disputeId, challengeId, winnerId, adminId) {
    if (!confirm('Confirmar resolução desta disputa?')) return;
    try {
      Utils.showLoading(true);
      await this.resolveDispute(disputeId, challengeId, winnerId, adminId, 'Resolvido pelo admin');
      Utils.showToast('Disputa resolvida!', 'success');
      const disputes = await this.loadPendingDisputes();
      this.renderDisputes(disputes, adminId);
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  initTabs() {
    document.querySelectorAll('[data-admin-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.adminTab;
        document.querySelectorAll('[data-admin-tab]').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${target}`));
      });
    });
  },

  async init(adminId) {
    this.initTabs();
    const stats = await this.loadDashboardStats();
    this.renderAdminStats(stats);

    const [deposits, disputes, users] = await Promise.all([
      this.loadPendingDeposits(),
      this.loadPendingDisputes(),
      this.loadAllUsers()
    ]);

    this.renderDeposits(deposits, adminId);
    this.renderDisputes(disputes, adminId);
    this.renderUsers(users);
  }
};
