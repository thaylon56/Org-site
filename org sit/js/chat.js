/**
 * Salas de conversa dos desafios
 */
const Chat = {
  DISCORD_INVITE: 'https://discord.gg/2qy5EpXq',
  _room: null,
  _challenge: null,
  _userId: null,
  _isAdmin: false,
  _channel: null,

  async loadRoomByChallenge(challengeId) {
    const sb = getSupabase();
    const { data } = await sb
      .from('chat_rooms')
      .select(`
        *,
        challenge:challenges(*,
          creator:profiles!challenges_creator_id_fkey(id, display_name, username, admin_nick),
          acceptor:profiles!challenges_acceptor_id_fkey(id, display_name, username)
        ),
        admin:profiles!chat_rooms_assigned_admin_id_fkey(id, display_name, admin_nick)
      `)
      .eq('challenge_id', challengeId)
      .single();
    return data;
  },

  async loadMessages(roomId) {
    const sb = getSupabase();
    const { data } = await sb
      .from('chat_messages')
      .select('*, sender:profiles(display_name, admin_nick, is_admin)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    return data || [];
  },

  async sendMessage(roomId, userId, content) {
    const sb = getSupabase();
    const { error } = await sb.from('chat_messages').insert({
      room_id: roomId,
      sender_id: userId,
      message_type: 'text',
      content: content.trim()
    });
    if (error) throw error;
  },

  async postRoomCode(roomId, adminId, code) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('post_room_code', {
      p_room_id: roomId,
      p_admin_id: adminId,
      p_room_code: code.trim()
    });
    if (error) throw error;
    if (!data) throw new Error('Não foi possível publicar a sala');
  },

  async claimVictory(roomId, userId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('claim_victory_in_chat', {
      p_room_id: roomId,
      p_user_id: userId
    });
    if (error) throw error;
    if (!data) throw new Error('Não foi possível declarar vitória');
    return data;
  },

  async requestAnalysis(roomId, userId, notes) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('request_analysis_discord', {
      p_room_id: roomId,
      p_user_id: userId,
      p_notes: notes || null
    });
    if (error) throw error;
    if (!data) throw new Error('Erro ao solicitar análise');
    return data;
  },

  async adminJoinRoom(roomId, adminId) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('admin_join_chat', {
      p_room_id: roomId,
      p_admin_id: adminId
    });
    if (error) throw error;
    if (!data) throw new Error('Não foi possível assumir a sala');
  },

  formatSender(msg) {
    if (msg.message_type === 'system' || !msg.sender_id) return 'Sistema';
    const s = msg.sender;
    if (s?.is_admin && s?.admin_nick) return `[ADM-${s.admin_nick}]`;
    return s?.display_name || 'Jogador';
  },

  renderMessage(msg) {
    const type = msg.message_type;
    const sender = this.formatSender(msg);
    const time = Utils.formatRelative(msg.created_at);
    let extraClass = '';
    let body = Utils.escapeHtml(msg.content);

    if (type === 'room_code') extraClass = 'chat-msg--room';
    if (type === 'victory') extraClass = 'chat-msg--victory';
    if (type === 'analysis_request') extraClass = 'chat-msg--analysis';
    if (type === 'proof_request') extraClass = 'chat-msg--proof';
    if (type === 'system') extraClass = 'chat-msg--system';

    return `
      <div class="chat-msg ${extraClass}">
        <div class="chat-msg-meta">
          <strong>${Utils.escapeHtml(sender)}</strong>
          <span>${time}</span>
        </div>
        <div class="chat-msg-body">${body}</div>
      </div>
    `;
  },

  renderMessages(messages, containerId = 'chat-messages') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = messages.map(m => this.renderMessage(m)).join('');
    el.scrollTop = el.scrollHeight;
  },

  renderRoomHeader(room, challenge) {
    const el = document.getElementById('chat-header');
    if (!el) return;

    const adminTag = room.admin?.admin_nick
      ? `[ADM-${room.admin.admin_nick}]`
      : (room.assigned_admin_id ? 'ADM atribuído' : 'Aguardando ADM');

    const statusLabels = {
      waiting_admin: '⏳ Aguardando ADM online',
      waiting_room: '🛡️ ADM criando sala FF',
      active: '🎮 Partida em andamento',
      awaiting_proof: '📸 Aguardando provas',
      closed: '✅ Encerrada'
    };

    el.innerHTML = `
      <div class="chat-header-grid">
        <div>
          <span class="challenge-mode">${challenge.game_mode}</span>
          <strong class="chat-bet">${Utils.formatCurrency(challenge.bet_amount)}</strong>
        </div>
        <div class="chat-players-mini">
          ${Utils.escapeHtml(challenge.creator?.display_name || '')} vs ${Utils.escapeHtml(challenge.acceptor?.display_name || '')}
        </div>
        <div class="chat-status-pill">${statusLabels[room.status] || room.status}</div>
        <div class="text-muted" style="font-size:0.85rem;">${adminTag}</div>
        ${room.room_code ? `<div class="chat-room-code-display">🏠 Sala: <strong>${Utils.escapeHtml(room.room_code)}</strong></div>` : ''}
      </div>
    `;
  },

  renderActions(room, challenge, userId, isAdmin) {
    const el = document.getElementById('chat-actions');
    if (!el) return;

    const isParticipant = userId === challenge.creator_id || userId === challenge.acceptor_id;
    let html = '';

    if (isAdmin) {
      if (!room.assigned_admin_id || room.assigned_admin_id === userId) {
        if (room.status === 'waiting_admin') {
          html += `<button class="btn btn-primary btn-sm" id="btn-admin-join">Assumir sala</button>`;
        }
        if (['waiting_room', 'waiting_admin', 'active'].includes(room.status)) {
          html += `
            <div class="chat-admin-room-form">
              <input type="text" id="admin-room-code" class="form-control" placeholder="Código da sala FF">
              <button class="btn btn-success btn-sm" id="btn-post-room">Publicar sala</button>
            </div>
          `;
        }
      }
    }

    if (isParticipant && room.status === 'active') {
      html += `
        <button class="btn btn-success btn-sm" id="btn-claim-win">🏆 Declarei vitória</button>
        <button class="btn btn-danger btn-sm" id="btn-request-analysis">⚠️ Pedir análise</button>
      `;
    }

    if (isParticipant && room.status === 'awaiting_proof') {
      html += `
        <a href="proofs.html?challenge=${challenge.id}" class="btn btn-primary btn-sm">📸 Enviar print/vídeo</a>
        <button class="btn btn-danger btn-sm" id="btn-request-analysis">⚠️ Pedir análise no Discord</button>
      `;
    }

    html += `
      <a href="${this.DISCORD_INVITE}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">
        💬 Discord da Org
      </a>
    `;

    el.innerHTML = html;
    this.bindActionHandlers(room, challenge, userId, isAdmin);
  },

  bindActionHandlers(room, challenge, userId, isAdmin) {
    document.getElementById('btn-admin-join')?.addEventListener('click', async () => {
      try {
        await this.adminJoinRoom(room.id, userId);
        Utils.showToast('Sala assumida!', 'success');
        await this.refresh();
      } catch (e) { Utils.showToast(e.message, 'error'); }
    });

    document.getElementById('btn-post-room')?.addEventListener('click', async () => {
      const code = document.getElementById('admin-room-code')?.value;
      if (!code?.trim()) { Utils.showToast('Digite o código da sala', 'error'); return; }
      try {
        await this.postRoomCode(room.id, userId, code);
        Utils.showToast('Sala publicada no chat!', 'success');
        await this.refresh();
      } catch (e) { Utils.showToast(e.message, 'error'); }
    });

    document.getElementById('btn-claim-win')?.addEventListener('click', async () => {
      if (!confirm('Declarar vitória? O ADM pedirá comprovantes.')) return;
      try {
        await this.claimVictory(room.id, userId);
        Utils.showToast('Vitória declarada! Envie o comprovante.', 'success');
        await this.refresh();
      } catch (e) { Utils.showToast(e.message, 'error'); }
    });

    document.getElementById('btn-request-analysis')?.addEventListener('click', async () => {
      const notes = prompt('Descreva o motivo da análise (opcional):');
      if (notes === null) return;
      try {
        await this.requestAnalysis(room.id, userId, notes);
        Utils.showToast('Análise enviada! Acompanhe no Discord.', 'success');
        window.open(this.DISCORD_INVITE, '_blank');
        await this.refresh();
      } catch (e) { Utils.showToast(e.message, 'error'); }
    });
  },

  subscribeRealtime(roomId) {
    const sb = getSupabase();
    if (this._channel) sb.removeChannel(this._channel);
    this._channel = sb.channel(`chat-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `room_id=eq.${roomId}`
      }, async () => {
        const messages = await this.loadMessages(roomId);
        this.renderMessages(messages);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_rooms',
        filter: `id=eq.${roomId}`
      }, async () => {
        await this.refresh();
      })
      .subscribe();
  },

  async refresh() {
    if (!this._room) return;
    const room = await this.loadRoomByChallenge(this._challenge.id);
    this._room = room;
    const messages = await this.loadMessages(room.id);
    this.renderRoomHeader(room, room.challenge);
    this.renderMessages(messages);
    this.renderActions(room, room.challenge, this._userId, this._isAdmin);
  },

  async init(userId, profile) {
    const params = new URLSearchParams(window.location.search);
    const challengeId = params.get('challenge');
    if (!challengeId) {
      window.location.href = 'challenges.html';
      return;
    }

    this._userId = userId;
    this._isAdmin = profile?.is_admin || false;

    let room = await this.loadRoomByChallenge(challengeId);

    if (!room) {
      const sb = getSupabase();
      await sb.rpc('create_challenge_chat', { p_challenge_id: challengeId });
      room = await this.loadRoomByChallenge(challengeId);
    }

    if (!room) {
      Utils.showToast('Sala não encontrada', 'error');
      return;
    }

    this._room = room;
    this._challenge = room.challenge;

    const messages = await this.loadMessages(room.id);
    this.renderRoomHeader(room, room.challenge);
    this.renderMessages(messages);
    this.renderActions(room, room.challenge, userId, this._isAdmin);
    this.subscribeRealtime(room.id);

    document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const text = input?.value?.trim();
      if (!text) return;
      if (room.status === 'closed') {
        Utils.showToast('Chat encerrado', 'error');
        return;
      }
      try {
        await this.sendMessage(room.id, userId, text);
        input.value = '';
      } catch (err) {
        Utils.showToast(err.message, 'error');
      }
    });
  }
};
