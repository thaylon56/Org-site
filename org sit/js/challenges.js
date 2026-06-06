/**
 * Sistema de Desafios e Casa Segura
 */
const Challenges = {
  PLATFORM_FEE_RATE: 0.10,
  CASHBACK_RATE: 0.02,

  async loadOpenChallenges() {
    const sb = getSupabase();
    const { data } = await sb
      .from('challenges')
      .select(`
        *,
        creator:profiles!challenges_creator_id_fkey(id, username, display_name, reputation_score, wins, matches_played),
        acceptor:profiles!challenges_acceptor_id_fkey(id, username, display_name, reputation_score, wins, matches_played)
      `)
      .in('status', ['open', 'matched', 'in_progress', 'awaiting_result', 'disputed'])
      .order('created_at', { ascending: false });
    return data || [];
  },

  async loadUserChallenges(userId) {
    const sb = getSupabase();
    const { data } = await sb
      .from('challenges')
      .select(`
        *,
        creator:profiles!challenges_creator_id_fkey(id, username, display_name),
        acceptor:profiles!challenges_acceptor_id_fkey(id, username, display_name)
      `)
      .or(`creator_id.eq.${userId},acceptor_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(50);
    return data || [];
  },

  async createChallenge(userId, betAmount, gameMode, scheduledAt) {
    const sb = getSupabase();

    // Bloquear fundos via RPC
    const { data: locked, error: lockError } = await sb.rpc('lock_bet_funds', {
      p_user_id: userId,
      p_amount: betAmount
    });
    if (lockError) throw lockError;
    if (!locked) throw new Error('Saldo insuficiente');

    const { data, error } = await sb.from('challenges').insert({
      creator_id: userId,
      bet_amount: betAmount,
      game_mode: gameMode,
      scheduled_at: scheduledAt || null,
      status: 'open'
    }).select().single();

    if (error) {
      await sb.rpc('unlock_bet_funds', { p_user_id: userId, p_amount: betAmount });
      throw error;
    }

    await sb.from('transactions').insert({
      user_id: userId,
      type: 'bet_lock',
      amount: betAmount,
      description: `Aposta bloqueada - ${gameMode}`,
      challenge_id: data.id
    });

    return data;
  },

  async acceptChallenge(challengeId, userId) {
    const sb = getSupabase();

    const { data: challenge } = await sb.from('challenges')
      .select('*').eq('id', challengeId).single();

    if (!challenge || challenge.status !== 'open') throw new Error('Desafio indisponível');
    if (challenge.creator_id === userId) throw new Error('Você não pode aceitar seu próprio desafio');

    const { data: locked } = await sb.rpc('lock_bet_funds', {
      p_user_id: userId,
      p_amount: challenge.bet_amount
    });
    if (!locked) throw new Error('Saldo insuficiente');

    const { data, error } = await sb.from('challenges').update({
      acceptor_id: userId,
      status: 'matched'
    }).eq('id', challengeId).select().single();

    if (error) throw error;

    await sb.from('transactions').insert({
      user_id: userId,
      type: 'bet_lock',
      amount: challenge.bet_amount,
      description: `Aposta aceita - ${challenge.game_mode}`,
      challenge_id: challengeId
    });

    return data;
  },

  async confirmReady(challengeId, userId) {
    const sb = getSupabase();
    const { data: challenge } = await sb.from('challenges')
      .select('*').eq('id', challengeId).single();

    if (!challenge) throw new Error('Desafio não encontrado');

    const updates = {};
    if (challenge.creator_id === userId) updates.creator_confirmed = true;
    else if (challenge.acceptor_id === userId) updates.acceptor_confirmed = true;
    else throw new Error('Você não participa deste desafio');

    if (challenge.creator_confirmed || updates.creator_confirmed) {
      if (challenge.acceptor_confirmed || updates.acceptor_confirmed) {
        updates.status = 'in_progress';
      }
    }

    const { data, error } = await sb.from('challenges')
      .update(updates).eq('id', challengeId).select().single();
    if (error) throw error;
    return data;
  },

  async submitResult(challengeId, userId, result) {
    const sb = getSupabase();
    const { data: challenge } = await sb.from('challenges')
      .select('*').eq('id', challengeId).single();

    if (!challenge) throw new Error('Desafio não encontrado');

    const updates = { status: 'awaiting_result' };
    if (challenge.creator_id === userId) updates.creator_result = result;
    else if (challenge.acceptor_id === userId) updates.acceptor_result = result;
    else throw new Error('Você não participa deste desafio');

    const { data, error } = await sb.from('challenges')
      .update(updates).eq('id', challengeId).select().single();
    if (error) throw error;

    // Se ambos reportaram e concordam
    const updated = data;
    if (updated.creator_result && updated.acceptor_result) {
      if (updated.creator_result === updated.acceptor_result) {
        const winnerId = updated.creator_result === 'win' ? updated.creator_id : updated.acceptor_id;
        await sb.rpc('resolve_challenge', { p_challenge_id: challengeId, p_winner_id: winnerId });
      } else {
        await sb.from('challenges').update({ status: 'disputed' }).eq('id', challengeId);
        await sb.from('disputes').insert({
          challenge_id: challengeId,
          reported_by: userId,
          reason: 'Resultados divergentes entre os jogadores'
        });
      }
    }

    return data;
  },

  async cancelChallenge(challengeId, userId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('cancel_challenge', {
      p_challenge_id: challengeId,
      p_user_id: userId
    });
    if (error) throw error;
    if (!data) throw new Error('Não foi possível cancelar');
    return data;
  },

  calcPrize(betAmount) {
    const pot = betAmount * 2;
    const fee = pot * this.PLATFORM_FEE_RATE;
    return { pot, fee, prize: pot - fee };
  },

  renderChallengeCard(challenge, currentUserId) {
    const { pot, fee, prize } = this.calcPrize(challenge.bet_amount);
    const isCreator = challenge.creator_id === currentUserId;
    const isAcceptor = challenge.acceptor_id === currentUserId;
    const isParticipant = isCreator || isAcceptor;

    let actions = '';
    if (challenge.status === 'open' && !isCreator) {
      actions = `<button class="btn btn-primary btn-sm" onclick="Challenges.handleAccept('${challenge.id}')">Aceitar Desafio</button>`;
    }
    if (challenge.status === 'matched' && isParticipant) {
      actions += `<button class="btn btn-success btn-sm" onclick="Challenges.handleConfirm('${challenge.id}')">Confirmar Pronto</button>`;
    }
    if (['in_progress', 'awaiting_result'].includes(challenge.status) && isParticipant) {
      actions += `
        <button class="btn btn-success btn-sm" onclick="Challenges.handleResult('${challenge.id}', 'win')">Declarei Vitória</button>
        <button class="btn btn-danger btn-sm" onclick="Challenges.handleResult('${challenge.id}', 'loss')">Declarei Derrota</button>
      `;
    }
    if (['open', 'matched'].includes(challenge.status) && isParticipant) {
      actions += `<button class="btn btn-ghost btn-sm" onclick="Challenges.handleCancel('${challenge.id}')">Cancelar</button>`;
    }
    if (['in_progress', 'awaiting_result', 'disputed'].includes(challenge.status) && isParticipant) {
      actions += `<a href="proofs.html?challenge=${challenge.id}" class="btn btn-outline btn-sm">Enviar Prova</a>`;
    }

    return `
      <div class="challenge-card" data-id="${challenge.id}">
        <div class="challenge-header">
          <span class="challenge-mode">${challenge.game_mode}</span>
          <span class="status-badge ${Utils.getStatusClass(challenge.status)}">${Utils.getStatusLabel(challenge.status)}</span>
        </div>
        <div class="challenge-amount">${Utils.formatCurrency(challenge.bet_amount)}</div>
        <div class="challenge-prize">
          <span>🏆 Prêmio: ${Utils.formatCurrency(prize)}</span>
          <span class="text-muted">Taxa: ${Utils.formatCurrency(fee)}</span>
        </div>
        <div class="challenge-players">
          <div class="player-info">
            <span class="player-label">Criador</span>
            <span class="player-name">${Utils.escapeHtml(challenge.creator?.display_name || '—')}</span>
            ${challenge.creator ? `<span class="player-rep">⭐ ${challenge.creator.reputation_score}%</span>` : ''}
          </div>
          <span class="vs">VS</span>
          <div class="player-info">
            <span class="player-label">Oponente</span>
            <span class="player-name">${Utils.escapeHtml(challenge.acceptor?.display_name || 'Aguardando...')}</span>
            ${challenge.acceptor ? `<span class="player-rep">⭐ ${challenge.acceptor.reputation_score}%</span>` : ''}
          </div>
        </div>
        ${challenge.scheduled_at ? `<div class="challenge-time">🕐 ${Utils.formatDate(challenge.scheduled_at)}</div>` : ''}
        <div class="challenge-actions">${actions}</div>
      </div>
    `;
  },

  renderChallengesList(challenges, currentUserId, containerId = 'challenges-list') {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!challenges.length) {
      el.innerHTML = '<p class="empty-state">Nenhum desafio disponível no momento.</p>';
      return;
    }
    el.innerHTML = challenges.map(c => this.renderChallengeCard(c, currentUserId)).join('');
  },

  async handleAccept(id) {
    try {
      Utils.showLoading(true);
      const user = await Auth.getCurrentUser();
      await this.acceptChallenge(id, user.id);
      Utils.showToast('Desafio aceito! Confirme quando estiver pronto.', 'success');
      window.location.reload();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleConfirm(id) {
    try {
      Utils.showLoading(true);
      const user = await Auth.getCurrentUser();
      await this.confirmReady(id, user.id);
      Utils.showToast('Confirmado! Boa partida!', 'success');
      window.location.reload();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleResult(id, result) {
    try {
      Utils.showLoading(true);
      const user = await Auth.getCurrentUser();
      await this.submitResult(id, user.id, result);
      Utils.showToast('Resultado enviado!', 'success');
      window.location.reload();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  async handleCancel(id) {
    if (!confirm('Tem certeza que deseja cancelar este desafio?')) return;
    try {
      Utils.showLoading(true);
      const user = await Auth.getCurrentUser();
      await this.cancelChallenge(id, user.id);
      Utils.showToast('Desafio cancelado. Fundos devolvidos.', 'success');
      window.location.reload();
    } catch (err) {
      Utils.showToast(err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  },

  initCreateForm(userId) {
    const form = document.getElementById('create-challenge-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const betAmount = parseFloat(document.getElementById('challenge-amount').value);
      const gameMode = document.getElementById('challenge-mode').value;
      const scheduledAt = document.getElementById('challenge-time').value || null;

      if (!betAmount || betAmount < 1) {
        Utils.showToast('Valor mínimo: R$ 1,00', 'error');
        return;
      }

      try {
        Utils.showLoading(true);
        await this.createChallenge(userId, betAmount, gameMode, scheduledAt);
        Utils.showToast('Desafio criado! Aguardando oponente.', 'success');
        form.reset();
        const challenges = await this.loadOpenChallenges();
        this.renderChallengesList(challenges, userId);
      } catch (err) {
        Utils.showToast(err.message, 'error');
      } finally {
        Utils.showLoading(false);
      }
    });
  },

  subscribeRealtime(userId, onUpdate) {
    const sb = getSupabase();
    return sb.channel('challenges-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges' }, onUpdate)
      .subscribe();
  }
};
