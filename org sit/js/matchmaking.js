/**
 * Matchmaking automático
 */
const Matchmaking = {
  _channel: null,
  _searching: false,

  async startSearch(userId, betAmount, gameMode) {
    const sb = getSupabase();

    // Verificar saldo
    const wallet = await Wallet.loadWallet(userId);
    const available = (wallet?.balance || 0) + (wallet?.cashback_balance || 0);
    if (available < betAmount) throw new Error('Saldo insuficiente');

    // Remover entrada anterior se existir
    await sb.from('matchmaking_queue').delete().eq('user_id', userId);

    // Entrar na fila
    const { error } = await sb.from('matchmaking_queue').insert({
      user_id: userId,
      bet_amount: betAmount,
      game_mode: gameMode,
      status: 'searching'
    });
    if (error) throw error;

    this._searching = true;

    // Tentar match imediato
    const { data: challengeId } = await sb.rpc('try_matchmaking', {
      p_user_id: userId,
      p_amount: betAmount,
      p_mode: gameMode
    });

    if (challengeId) {
      this._searching = false;
      return { matched: true, challengeId };
    }

    return { matched: false };
  },

  async cancelSearch(userId) {
    const sb = getSupabase();
    await sb.from('matchmaking_queue').delete().eq('user_id', userId);
    this._searching = false;
  },

  async getQueueCount(betAmount, gameMode) {
    const sb = getSupabase();
    const { count } = await sb.from('matchmaking_queue')
      .select('*', { count: 'exact', head: true })
      .eq('bet_amount', betAmount)
      .eq('game_mode', gameMode)
      .eq('status', 'searching');
    return count || 0;
  },

  subscribeMatchmaking(userId, onMatch) {
    const sb = getSupabase();
    this._channel = sb.channel('matchmaking-realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'matchmaking_queue',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        if (payload.new.status === 'matched' && payload.new.challenge_id) {
          this._searching = false;
          onMatch(payload.new.challenge_id);
        }
      })
      .subscribe();
  },

  unsubscribe() {
    if (this._channel) {
      getSupabase().removeChannel(this._channel);
      this._channel = null;
    }
  },

  renderSearchUI(searching, containerId = 'matchmaking-status') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (searching) {
      el.innerHTML = `
        <div class="matchmaking-active">
          <div class="pulse-ring"></div>
          <h3>Procurando adversário...</h3>
          <p>O sistema está buscando um jogador com o mesmo valor e modo.</p>
          <button class="btn btn-danger" id="cancel-search-btn">Cancelar Busca</button>
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="matchmaking-idle">
          <div class="matchmaking-icon">🎯</div>
          <h3>Matchmaking Automático</h3>
          <p>Encontre adversários automaticamente com o mesmo valor de aposta.</p>
        </div>
      `;
    }
  },

  init(userId) {
    const form = document.getElementById('matchmaking-form');
    const statusEl = document.getElementById('matchmaking-status');

    this.subscribeMatchmaking(userId, (challengeId) => {
      Utils.showToast('Adversário encontrado!', 'success');
      const sb = getSupabase();
      await sb.rpc('create_challenge_chat', { p_challenge_id: challengeId });
      setTimeout(() => window.location.href = `challenge-chat.html?challenge=${challengeId}`, 1500);
    });

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('mm-amount').value);
        const mode = document.getElementById('mm-mode').value;

        try {
          Utils.showLoading(true);
          const result = await this.startSearch(userId, amount, mode);

          if (result.matched) {
            Utils.showToast('Match encontrado!', 'success');
            const sb = getSupabase();
            await sb.rpc('create_challenge_chat', { p_challenge_id: result.challengeId });
            window.location.href = `challenge-chat.html?challenge=${result.challengeId}`;
          } else {
            this.renderSearchUI(true);
            document.getElementById('cancel-search-btn')?.addEventListener('click', async () => {
              await this.cancelSearch(userId);
              this.renderSearchUI(false);
              Utils.showToast('Busca cancelada', 'info');
            });
            Utils.showToast('Procurando adversário...', 'info');
          }
        } catch (err) {
          Utils.showToast(err.message, 'error');
        } finally {
          Utils.showLoading(false);
        }
      });
    }

    // Atualizar contagem na fila
    const updateQueue = async () => {
      const amountEl = document.getElementById('mm-amount');
      const modeEl = document.getElementById('mm-mode');
      const countEl = document.getElementById('queue-count');
      if (!amountEl || !countEl) return;
      const count = await this.getQueueCount(
        parseFloat(amountEl.value) || 5,
        modeEl?.value || '1x1'
      );
      countEl.textContent = `${count} jogador(es) na fila`;
    };

    document.getElementById('mm-amount')?.addEventListener('input', Utils.debounce(updateQueue));
    document.getElementById('mm-mode')?.addEventListener('change', updateQueue);
    updateQueue();
  }
};
