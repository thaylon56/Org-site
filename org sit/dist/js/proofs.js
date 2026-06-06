/**
 * Upload de provas (prints, vídeos, gravações)
 */
const Proofs = {
  async uploadProof(challengeId, userId, file, proofType, description) {
    const sb = getSupabase();
    const ext = file.name.split('.').pop();
    const path = `${userId}/${challengeId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await sb.storage
      .from('proofs')
      .upload(path, file, { upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = sb.storage.from('proofs').getPublicUrl(path);

    const { data, error } = await sb.from('proofs').insert({
      challenge_id: challengeId,
      user_id: userId,
      proof_type: proofType,
      file_url: urlData.publicUrl,
      file_name: file.name,
      description
    }).select().single();

    if (error) throw error;
    return data;
  },

  async loadProofs(challengeId) {
    const sb = getSupabase();
    const { data } = await sb
      .from('proofs')
      .select('*, profiles(display_name, username)')
      .eq('challenge_id', challengeId)
      .order('created_at', { ascending: false });
    return data || [];
  },

  renderProofs(proofs, containerId = 'proofs-list') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!proofs.length) {
      el.innerHTML = '<p class="empty-state">Nenhuma prova enviada.</p>';
      return;
    }

    const typeLabels = { screenshot: '📸 Print', video: '🎥 Vídeo', recording: '🎙️ Gravação' };

    el.innerHTML = proofs.map(p => `
      <div class="proof-item">
        <div class="proof-header">
          <span>${typeLabels[p.proof_type] || p.proof_type}</span>
          <span class="proof-author">${Utils.escapeHtml(p.profiles?.display_name || '')}</span>
          <span class="proof-date">${Utils.formatRelative(p.created_at)}</span>
        </div>
        ${p.description ? `<p class="proof-desc">${Utils.escapeHtml(p.description)}</p>` : ''}
        <a href="${p.file_url}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Ver Arquivo</a>
      </div>
    `).join('');
  },

  init(userId) {
    const params = new URLSearchParams(window.location.search);
    const challengeId = params.get('challenge');
    if (!challengeId) return;

    document.getElementById('proof-challenge-id').value = challengeId;

    this.loadProofs(challengeId).then(proofs => this.renderProofs(proofs));

    const form = document.getElementById('proof-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = document.getElementById('proof-file').files[0];
      const type = document.getElementById('proof-type').value;
      const desc = document.getElementById('proof-desc').value.trim();

      if (!file) {
        Utils.showToast('Selecione um arquivo', 'error');
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        Utils.showToast('Arquivo muito grande (máx 50MB)', 'error');
        return;
      }

      try {
        Utils.showLoading(true);
        await this.uploadProof(challengeId, userId, file, type, desc);
        Utils.showToast('Prova enviada com sucesso!', 'success');
        form.reset();
        const proofs = await this.loadProofs(challengeId);
        this.renderProofs(proofs);
      } catch (err) {
        Utils.showToast(err.message || 'Erro ao enviar prova', 'error');
      } finally {
        Utils.showLoading(false);
      }
    });
  }
};
