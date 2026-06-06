/**
 * Carteira Virtual - depósitos, saldo e transações
 */
const Wallet = {
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

  async requestDeposit(userId, amount, proofFile) {
    const sb = getSupabase();
    let proofUrl = null;

    if (proofFile) {
      const ext = proofFile.name.split('.').pop();
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await sb.storage
        .from('deposits')
        .upload(path, proofFile);
      if (uploadError) throw uploadError;
      const { data: urlData } = sb.storage.from('deposits').getPublicUrl(path);
      proofUrl = urlData.publicUrl;
    }

    const { data, error } = await sb.from('deposit_requests').insert({
      user_id: userId,
      amount: parseFloat(amount),
      pix_proof_url: proofUrl
    }).select().single();

    if (error) throw error;
    return data;
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

  initDepositForm(userId) {
    const form = document.getElementById('deposit-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('deposit-amount').value);
      const proofFile = document.getElementById('deposit-proof').files[0];

      if (!amount || amount < 5) {
        Utils.showToast('Valor mínimo de depósito: R$ 5,00', 'error');
        return;
      }

      try {
        Utils.showLoading(true);
        await this.requestDeposit(userId, amount, proofFile);
        Utils.showToast('Depósito solicitado! Aguarde aprovação.', 'success');
        form.reset();
      } catch (err) {
        Utils.showToast(err.message || 'Erro ao solicitar depósito', 'error');
      } finally {
        Utils.showLoading(false);
      }
    });
  }
};
