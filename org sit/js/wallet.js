/**
 * Carteira Virtual - depósitos, saldo e transações
 */
const Wallet = {
  _admins: [],

  async loadWallet(userId) {
    const sb = getSupabase();
    const { data } = await sb.from('wallets').select('*').eq('user_id', userId).single();
    return data;
  },

  async loadTransactions(userId, limit = 20) {
    const sb = getSupabase();
    const { data } = await sb
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  },

  async loadDepositAdmins() {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('get_deposit_admins');
    if (error) throw error;
    this._admins = data || [];
    return this._admins;
  },

  async requestDeposit(userId, amount, adminId, proofFile, message) {
    const sb = getSupabase();
    if (!proofFile) throw new Error('Comprovante PIX é obrigatório');
    if (!adminId) throw new Error('Selecione um administrador');

    const ext = proofFile.name.split('.').pop();
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await sb.storage
      .from('deposits')
      .upload(path, proofFile);
    if (uploadError) throw uploadError;

    const { data: urlData } = sb.storage.from('deposits').getPublicUrl(path);

    const { data, error } = await sb.from('deposit_requests').insert({
      user_id: userId,
      amount: parseFloat(amount),
      assigned_admin_id: adminId,
      pix_proof_url: urlData.publicUrl,
      proof_storage_path: path,
      player_message: message || null,
      status: 'pending'
    }).select().single();

    if (error) throw error;
    return data;
  },

  renderAdminSelect(admins, containerId = 'deposit-admin-select') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!admins.length) {
      el.innerHTML = '<option value="">Nenhum ADM disponível no momento</option>';
      el.disabled = true;
      return;
    }

    el.disabled = false;
    el.innerHTML = `
      <option value="">Selecione o administrador</option>
      ${admins.map(a => `
        <option value="${a.id}">[ADM-${Utils.escapeHtml(a.admin_nick)}] ${Utils.escapeHtml(a.display_name)}</option>
      `).join('')}
    `;
  },

  renderPixBox(adminId, containerId = 'deposit-pix-box') {
    const el = document.getElementById(containerId);
    if (!el) return;

    const admin = this._admins.find(a => a.id === adminId);
    if (!admin) {
      el.innerHTML = '<p class="text-muted pix-hint">Selecione um ADM para ver a chave PIX</p>';
      el.classList.remove('active');
      return;
    }

    el.classList.add('active');
    el.innerHTML = `
      <div class="pix-box-header">
        <span class="admin-tag-badge">[ADM-${Utils.escapeHtml(admin.admin_nick)}]</span>
        <span>${Utils.escapeHtml(admin.display_name)}</span>
      </div>
      <p class="pix-type-label">${Utils.pixTypeLabel(admin.pix_key_type)}</p>
      <div class="pix-key-row">
        <code class="pix-key-value" id="pix-key-text">${Utils.escapeHtml(admin.pix_key)}</code>
        <button type="button" class="btn btn-outline btn-sm" id="copy-pix-btn">Copiar</button>
      </div>
      <p class="pix-hint">Faça o PIX para esta chave e envie o comprovante abaixo.</p>
    `;

    document.getElementById('copy-pix-btn')?.addEventListener('click', () => {
      Utils.copyToClipboard(admin.pix_key);
    });
  },

  renderWalletCard(wallet, containerId = 'wallet-card') {
    const el = document.getElementById(containerId);
    if (!el || !wallet) return;

    const available = (wallet.balance || 0) + (wallet.cashback_balance || 0);
    el.innerHTML = `
      <div class="wallet-balance">
        <span class="wallet-label">Saldo disponível</span>
        <span class="wallet-amount">${Utils.formatCurrency(available)}</span>
      </div>
      <div class="wallet-details">
        <div class="wallet-detail">
          <span>Saldo principal</span>
          <strong>${Utils.formatCurrency(wallet.balance)}</strong>
        </div>
        <div class="wallet-detail">
          <span>Cashback</span>
          <strong class="text-gold">${Utils.formatCurrency(wallet.cashback_balance)}</strong>
        </div>
        <div class="wallet-detail">
          <span>Bloqueado</span>
          <strong class="text-muted">${Utils.formatCurrency(wallet.locked_balance)}</strong>
        </div>
      </div>
    `;
  },

  renderTransactions(transactions, containerId = 'transactions-list') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!transactions.length) {
      el.innerHTML = '<p class="empty-state">Nenhuma transação ainda.</p>';
      return;
    }

    const typeIcons = {
      deposit: '💰', withdrawal: '💸', bet_lock: '🔒', bet_release: '🔓',
      win: '🏆', loss: '❌', cashback: '🎁', platform_fee: '🏛️', refund: '↩️', cashback_use: '🎁'
    };

    el.innerHTML = transactions.map(t => `
      <div class="transaction-item">
        <span class="tx-icon">${typeIcons[t.type] || '📋'}</span>
        <div class="tx-info">
          <span class="tx-desc">${Utils.escapeHtml(t.description || t.type)}</span>
          <span class="tx-date">${Utils.formatRelative(t.created_at)}</span>
        </div>
        <span class="tx-amount ${['win', 'deposit', 'cashback', 'refund'].includes(t.type) ? 'positive' : 'negative'}">
          ${['win', 'deposit', 'cashback', 'refund'].includes(t.type) ? '+' : '-'}${Utils.formatCurrency(t.amount)}
        </span>
      </div>
    `).join('');
  },

  async initDepositForm(userId) {
    const form = document.getElementById('deposit-form');
    if (!form) return;

    try {
      const admins = await this.loadDepositAdmins();
      this.renderAdminSelect(admins);
    } catch (err) {
      Utils.showToast('Erro ao carregar administradores', 'error');
    }

    document.getElementById('deposit-admin-select')?.addEventListener('change', (e) => {
      this.renderPixBox(e.target.value);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('deposit-amount').value);
      const adminId = document.getElementById('deposit-admin-select').value;
      const proofFile = document.getElementById('deposit-proof').files[0];
      const message = document.getElementById('deposit-message')?.value?.trim() || '';

      if (!amount || amount < 5) {
        Utils.showToast('Valor mínimo de depósito: R$ 5,00', 'error');
        return;
      }
      if (!adminId) {
        Utils.showToast('Selecione um administrador', 'error');
        return;
      }
      if (!proofFile) {
        Utils.showToast('Comprovante PIX é obrigatório', 'error');
        return;
      }

      try {
        Utils.showLoading(true);
        await this.requestDeposit(userId, amount, adminId, proofFile, message);
        Utils.showToast('Depósito enviado! O ADM escolhido irá analisar.', 'success');
        form.reset();
        this.renderPixBox(null);
      } catch (err) {
        Utils.showToast(err.message || 'Erro ao solicitar depósito', 'error');
      } finally {
        Utils.showLoading(false);
      }
    });
  }
};
