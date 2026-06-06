/**
 * Painel Administrativo v2
 * - Cadastro de nick ADM e chave PIX
 * - Depósitos com atribuição e assumir análise
 * - Disputas com assumir análise
 */
const Admin = {
  _adminId: null,
  _profile: null,
  _deposits: [],
  _disputes: [],
  _proofUrls: {},

  async loadProfile(adminId) {
    const sb = getSupabase();
    const { data } = await sb.from('profiles').select('*').eq('id', adminId).single();
    return data;
  },

  async saveAdminProfile(adminNick, pixKey, pixKeyType) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('update_admin_profile', {
      p_admin_nick: adminNick,
      p_pix_key: pixKey,
      p_pix_key_type: pixKeyType
    });
    if (error) throw error;
    if (!data) throw new Error('Não foi possível salvar. Verifique nick e chave PIX.');
    return data;
  },

  async loadDashboardStats(adminId) {
    const sb = getSupabase();
    const [users, challenges, deposits, disputes, myDeposits] = await Promise.all([
      sb.from('profiles').select('*', { count: 'exact', head: true }),
      sb.from('challenges').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      sb.from('deposit_requests').select('*', { count: 'exact', head: true }).in('status', ['pending', 'in_review']),
      sb.from('disputes').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.rpc('list_deposits_for_admin', { p_admin_id: adminId })
    ]);

    const depositList = myDeposits.data || [];
    const myQueue = depositList.filter(d => d.can_view).length;
    const available = depositList.filter(d => !d.can_view && !d.claimed_by_admin_id).length;

    return {
      totalUsers: users.count || 0,
      completedChallenges: challenges.count || 0,
      pendingDeposits: deposits.count || 0,
      pendingDisputes: disputes.count || 0,
      myQueue,
      availableToClaim: available
    };
  },

  async loadDeposits(adminId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('list_deposits_for_admin', { p_admin_id: adminId });
    if (error) throw error;
    this._deposits = data || [];
    return this._deposits;
  },

  async loadDisputes(adminId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('list_disputes_for_admin', { p_admin_id: adminId });
    if (error) throw error;
    this._disputes = data || [];
    return this._disputes;
  },

  async getProofSignedUrl(path) {
    if (!path) return null;
    if (this._proofUrls[path]) return this._proofUrls[path];
    const sb = getSupabase();
    const { data, error } = await sb.storage.from('deposits').createSignedUrl(path, 3600);
    if (error) return null;
    this._proofUrls[path] = data.signedUrl;
    return data.signedUrl;
  },

  async claimDeposit(depositId, adminId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('claim_deposit', {
      p_deposit_id: depositId,
      p_admin_id: adminId
    });
    if (error) throw error;
    if (!data) throw new Error('Não foi possível assumir. Outro ADM pode já estar analisando.');
    return data;
  },

  async approveDeposit(depositId, adminId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('approve_deposit', {
      p_deposit_id: depositId,
      p_admin_id: adminId
    });
    if (error) throw error;
    if (!data) throw new Error('Falha ao aprovar. Você precisa ser o ADM atribuído ou ter assumido a análise.');
    return data;
  },

  async rejectDeposit(depositId, adminId, notes) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('reject_deposit', {
      p_deposit_id: depositId,
      p_admin_id: adminId,
      p_notes: notes
    });
    if (error) throw error;
    if (!data) throw new Error('Falha ao rejeitar depósito');
    return data;
  },

  async claimDispute(disputeId, adminId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('claim_dispute', {
      p_dispute_id: disputeId,
      p_admin_id: adminId
    });
    if (error) throw error;
    if (!data) throw new Error('Disputa já assumida por outro ADM');
    return data;
  },

  async resolveDispute(disputeId, challengeId, winnerId, adminId, notes) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('resolve_dispute_admin', {
      p_dispute_id: disputeId,
      p_admin_id: adminId,
      p_challenge_id: challengeId,
      p_winner_id: winnerId,
      p_notes: notes
    });
    if (error) throw error;
    if (!data) throw new Error('Falha ao resolver disputa');
    return data;
  },

  async loadActiveChatRooms(adminId) {
    const sb = getSupabase();
    const { data } = await sb
      .from('chat_rooms')
      .select(`
        *,
        challenge:challenges(bet_amount, game_mode, creator_id, acceptor_id,
          creator:profiles!challenges_creator_id_fkey(display_name),
          acceptor:profiles!challenges_acceptor_id_fkey(display_name)
        )
      `)
      .in('status', ['waiting_admin', 'waiting_room', 'active', 'awaiting_proof'])
      .order('created_at', { ascending: false });
    return data || [];
  },

  renderActiveChats(rooms, adminId, containerId = 'admin-active-chats') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!rooms.length) {
      el.innerHTML = '<p class="empty-state">Nenhuma sala ativa no momento.</p>';
      return;
    }

    const statusLabels = {
      waiting_admin: '⏳ Sem ADM',
      waiting_room: '🛡️ Criar sala FF',
      active: '🎮 Em jogo',
      awaiting_proof: '📸 Provas'
    };

    el.innerHTML = rooms.map(r => {
      const c = r.challenge;
      const isMine = r.assigned_admin_id === adminId || !r.assigned_admin_id;
      return `
        <div class="admin-ticket admin-ticket--active">
          <div class="admin-ticket-header">
            <div>
              <span class="admin-ticket-amount">${c?.game_mode} · ${Utils.formatCurrency(c?.bet_amount || 0)}</span>
              <span class="ticket-badge ${isMine ? 'assigned' : 'locked'}">${statusLabels[r.status] || r.status}</span>
            </div>
          </div>
          <div class="admin-ticket-body">
            <div class="admin-ticket-row">
              <span>Jogadores</span>
              <strong>${Utils.escapeHtml(c?.creator?.display_name || '')} vs ${Utils.escapeHtml(c?.acceptor?.display_name || '')}</strong>
            </div>
            ${r.room_code ? `<div class="admin-ticket-row"><span>Sala FF</span><strong>${Utils.escapeHtml(r.room_code)}</strong></div>` : ''}
          </div>
          <div class="admin-ticket-actions">
            <a href="challenge-chat.html?challenge=${r.challenge_id}" class="btn btn-primary btn-sm">Abrir chat</a>
          </div>
        </div>
      `;
    }).join('');
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
        <span class="admin-stat-value">${stats.myQueue}</span>
        <span class="admin-stat-label">Na sua fila</span>
      </div>
      <div class="admin-stat-card alert">
        <span class="admin-stat-value">${stats.availableToClaim}</span>
        <span class="admin-stat-label">Disponíveis p/ assumir</span>
      </div>
      <div class="admin-stat-card alert">
        <span class="admin-stat-value">${stats.pendingDeposits}</span>
        <span class="admin-stat-label">Depósitos pendentes</span>
      </div>
      <div class="admin-stat-card alert">
        <span class="admin-stat-value">${stats.pendingDisputes}</span>
        <span class="admin-stat-label">Disputas pendentes</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-value">${stats.totalUsers}</span>
        <span class="admin-stat-label">Usuários</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-value">${stats.completedChallenges}</span>
        <span class="admin-stat-label">Partidas OK</span>
      </div>
    `;
  },

  renderAdminProfileForm(profile, containerId = 'admin-profile-form') {
    const el = document.getElementById(containerId);
    if (!el) return;

    const configured = profile?.admin_nick && profile?.pix_key;
    el.innerHTML = `
      ${configured ? `
        <div class="admin-profile-status ok">
          ✅ Perfil ADM configurado — <strong>[ADM-${Utils.escapeHtml(profile.admin_nick)}]</strong>
        </div>
      ` : `
        <div class="admin-profile-status warn">
          ⚠️ Configure seu nick e chave PIX para receber depósitos dos jogadores.
        </div>
      `}
      <form id="admin-settings-form" class="admin-settings-form">
        <div class="form-row">
          <div class="form-group">
            <label for="admin-nick">Nick de ADM *</label>
            <input type="text" id="admin-nick" class="form-control" placeholder="ZéPix" required
              value="${Utils.escapeHtml(profile?.admin_nick || '')}" pattern="[a-zA-Z0-9_-]+" maxlength="20">
            <small class="field-hint">Aparece como [ADM-SeuNick] para os jogadores</small>
          </div>
          <div class="form-group">
            <label for="admin-pix-type">Tipo da chave</label>
            <select id="admin-pix-type" class="form-control">
              <option value="cpf" ${profile?.pix_key_type === 'cpf' ? 'selected' : ''}>CPF</option>
              <option value="email" ${profile?.pix_key_type === 'email' ? 'selected' : ''}>E-mail</option>
              <option value="phone" ${profile?.pix_key_type === 'phone' ? 'selected' : ''}>Telefone</option>
              <option value="random" ${!profile?.pix_key_type || profile?.pix_key_type === 'random' ? 'selected' : ''}>Aleatória</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="admin-pix-key">Chave PIX *</label>
          <input type="text" id="admin-pix-key" class="form-control" placeholder="Sua chave PIX" required
            value="${Utils.escapeHtml(profile?.pix_key || '')}">
        </div>
        <button type="submit" class="btn btn-primary">Salvar Perfil ADM</button>
      </form>
    `;

    document.getElementById('admin-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nick = document.getElementById('admin-nick').value.trim();
      const pixKey = document.getElementById('admin-pix-key').value.trim();
      const pixType = document.getElementById('admin-pix-type').value;
      try {
        Utils.showLoading(true);
        await this.saveAdminProfile(nick, pixKey, pixType);
        Utils.showToast('Perfil ADM salvo!', 'success');
        this._profile = await this.loadProfile(this._adminId);
        this.renderAdminProfileForm(this._profile);
      } catch (err) {
        Utils.showToast(err.message, 'error');
      } finally {
        Utils.showLoading(false);
      }
    });
  },

  async renderDeposits(deposits, adminId, containerId = 'admin-deposits') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!deposits.length) {
      el.innerHTML = '<p class="empty-state">Nenhum depósito pendente no momento.</p>';
      return;
    }

    const cards = await Promise.all(deposits.map(async (d) => {
      const isMine = d.can_view;
      const isAssignedToMe = d.assigned_admin_id === adminId;
      const proofUrl = isMine && d.proof_storage_path
        ? await this.getProofSignedUrl(d.proof_storage_path)
        : null;

      let statusBadge = '';
      if (isAssignedToMe) statusBadge = '<span class="ticket-badge assigned">Atribuído a você</span>';
      else if (d.claimed_by_admin_id === adminId) statusBadge = '<span class="ticket-badge claimed">Você assumiu</span>';
      else if (d.claimed_by_admin_id) statusBadge = `<span class="ticket-badge locked">Em análise por ${Utils.escapeHtml(d.claimed_admin_tag || 'ADM')}</span>`;
      else statusBadge = `<span class="ticket-badge open">ADM: ${Utils.escapeHtml(d.assigned_admin_tag || '—')}</span>`;

      return `
        <div class="admin-ticket ${isMine ? 'admin-ticket--active' : 'admin-ticket--locked'}" data-id="${d.id}">
          <div class="admin-ticket-header">
            <div>
              <span class="admin-ticket-amount">${Utils.formatCurrency(d.amount)}</span>
              ${statusBadge}
            </div>
            <span class="admin-ticket-date">${Utils.formatDate(d.created_at)}</span>
          </div>

          ${isMine ? `
            <div class="admin-ticket-body">
              <div class="admin-ticket-row"><span>Jogador</span><strong>${Utils.escapeHtml(d.player_display_name)} (@${Utils.escapeHtml(d.player_username)})</strong></div>
              ${d.player_message ? `<div class="admin-ticket-message"><span>💬 Mensagem</span><p>${Utils.escapeHtml(d.player_message)}</p></div>` : ''}
              ${proofUrl ? `
                <div class="admin-ticket-proof">
                  <span>📎 Comprovante</span>
                  <a href="${proofUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Abrir comprovante</a>
                </div>
              ` : '<p class="text-muted">Sem comprovante anexado</p>'}
            </div>
            <div class="admin-ticket-actions">
              <button class="btn btn-success btn-sm" onclick="Admin.handleApproveDeposit('${d.id}')">✅ Aprovar</button>
              <button class="btn btn-danger btn-sm" onclick="Admin.handleRejectDeposit('${d.id}')">❌ Rejeitar</button>
            </div>
          ` : `
            <div class="admin-ticket-body locked-body">
              <p>🔒 Detalhes ocultos — apenas o ADM escolhido ou quem assumir a análise pode ver comprovante e mensagem.</p>
              ${!d.claimed_by_admin_id ? `
                <button class="btn btn-primary btn-sm" onclick="Admin.handleClaimDeposit('${d.id}')">Assumir análise</button>
              ` : ''}
            </div>
          `}
        </div>
      `;
    }));

    el.innerHTML = cards.join('');
  },

  renderDisputes(disputes, adminId, containerId = 'admin-disputes') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!disputes.length) {
      el.innerHTML = '<p class="empty-state">Nenhuma disputa pendente.</p>';
      return;
    }

    el.innerHTML = disputes.map(d => {
      const isMine = d.can_view;
      const claimed = d.claimed_by_admin_id && d.claimed_by_admin_id !== adminId;

      return `
        <div class="admin-ticket ${isMine ? 'admin-ticket--active' : 'admin-ticket--locked'}" data-id="${d.id}">
          <div class="admin-ticket-header">
            <div>
              <span class="admin-ticket-amount">Disputa #${d.id.slice(0, 8)}</span>
              ${isMine ? '<span class="ticket-badge claimed">Você assumiu</span>' : ''}
              ${claimed ? `<span class="ticket-badge locked">Em análise por ${Utils.escapeHtml(d.claimed_admin_tag || 'ADM')}</span>` : ''}
              ${!d.claimed_by_admin_id ? '<span class="ticket-badge open">Disponível</span>' : ''}
            </div>
            <span class="admin-ticket-date">${Utils.formatDate(d.created_at)}</span>
          </div>

          ${isMine ? `
            <div class="admin-ticket-body">
              <div class="admin-ticket-row"><span>Partida</span><strong>${Utils.escapeHtml(d.creator_name)} vs ${Utils.escapeHtml(d.acceptor_name)}</strong></div>
              <div class="admin-ticket-row"><span>Valor</span><strong>${Utils.formatCurrency(d.bet_amount)}</strong></div>
              <div class="admin-ticket-row"><span>Reportado por</span><strong>${Utils.escapeHtml(d.reporter_name)}</strong></div>
              <div class="admin-ticket-message"><span>⚠️ Motivo</span><p>${Utils.escapeHtml(d.reason)}</p></div>
            </div>
            <div class="admin-ticket-actions">
              <button class="btn btn-success btn-sm" onclick="Admin.handleResolveDispute('${d.id}', '${d.challenge_id}', '${d.creator_id}')">Vitória Criador</button>
              <button class="btn btn-success btn-sm" onclick="Admin.handleResolveDispute('${d.id}', '${d.challenge_id}', '${d.acceptor_id}')">Vitória Aceitador</button>
              <a href="proofs.html?challenge=${d.challenge_id}" class="btn btn-outline btn-sm">Ver provas</a>
            </div>
          ` : `
            <div class="admin-ticket-body locked-body">
              <p>🔒 ${Utils.escapeHtml(d.reason)}</p>
              ${!d.claimed_by_admin_id ? `
                <button class="btn btn-primary btn-sm" onclick="Admin.handleClaimDispute('${d.id}')">Assumir análise</button>
              ` : ''}
            </div>
          `}
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
                <strong>${u.is_admin && u.admin_nick ? `[ADM-${Utils.escapeHtml(u.admin_nick)}] ` : ''}${Utils.escapeHtml(u.display_name)}</strong>
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

  async refreshDeposits() {
    const deposits = await this.loadDeposits(this._adminId);
    await this.renderDeposits(deposits, this._adminId);
    const stats = await this.loadDashboardStats(this._adminId);
    this.renderAdminStats(stats);
  },

  async refreshDisputes() {
    const disputes = await this.loadDisputes(this._adminId);
    this.renderDisputes(disputes, this._adminId);
    const stats = await this.loadDashboardStats(this._adminId);
    this.renderAdminStats(stats);
  },

  async handleClaimDeposit(id) {
    try {
      Utils.showLoading(true);
      await this.claimDeposit(id, this._adminId);
      Utils.showToast('Análise assumida! Agora você pode ver os detalhes.', 'success');
      await this.refreshDeposits();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleApproveDeposit(id) {
    if (!confirm('Confirmar aprovação deste depósito?')) return;
    try {
      Utils.showLoading(true);
      await this.approveDeposit(id, this._adminId);
      Utils.showToast('Depósito aprovado!', 'success');
      await this.refreshDeposits();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleRejectDeposit(id) {
    const notes = prompt('Motivo da rejeição:');
    if (notes === null) return;
    try {
      Utils.showLoading(true);
      await this.rejectDeposit(id, this._adminId, notes);
      Utils.showToast('Depósito rejeitado', 'info');
      await this.refreshDeposits();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleClaimDispute(id) {
    try {
      Utils.showLoading(true);
      await this.claimDispute(id, this._adminId);
      Utils.showToast('Disputa assumida!', 'success');
      await this.refreshDisputes();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleResolveDispute(disputeId, challengeId, winnerId) {
    if (!confirm('Confirmar resolução desta disputa?')) return;
    try {
      Utils.showLoading(true);
      await this.resolveDispute(disputeId, challengeId, winnerId, this._adminId, 'Resolvido pelo admin');
      Utils.showToast('Disputa resolvida!', 'success');
      await this.refreshDisputes();
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

  subscribeRealtime() {
    const sb = getSupabase();
    sb.channel('admin-deposits')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposit_requests' }, () => {
        this.refreshDeposits();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, () => {
        this.refreshDisputes();
      })
      .subscribe();
  },

  async init(adminId) {
    this._adminId = adminId;
    this.initTabs();

    this._profile = await this.loadProfile(adminId);
    this.renderAdminProfileForm(this._profile);

    const stats = await this.loadDashboardStats(adminId);
    this.renderAdminStats(stats);

    const [deposits, disputes, users, chats] = await Promise.all([
      this.loadDeposits(adminId),
      this.loadDisputes(adminId),
      this.loadAllUsers(),
      this.loadActiveChatRooms(adminId)
    ]);

    await this.renderDeposits(deposits, adminId);
    this.renderDisputes(disputes, adminId);
    this.renderUsers(users);
    this.renderActiveChats(chats, adminId);

    this.subscribeRealtime();

    const sb = getSupabase();
    sb.channel('admin-chats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms' }, async () => {
        const updated = await this.loadActiveChatRooms(adminId);
        this.renderActiveChats(updated, adminId);
      })
      .subscribe();
  }
};
