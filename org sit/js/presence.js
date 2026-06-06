/**
 * Presença online dos administradores
 */
const Presence = {
  _interval: null,

  async setOnline(online = true) {
    const sb = getSupabase();
    await sb.rpc('set_admin_online', { p_online: online });
  },

  startHeartbeat() {
    this.setOnline(true);
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => this.setOnline(true), 30000);

    window.addEventListener('beforeunload', () => {
      this.setOnline(false);
    });
  },

  stopHeartbeat() {
    if (this._interval) clearInterval(this._interval);
    this.setOnline(false);
  },

  initAdminToggle(containerId = 'admin-online-toggle') {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = `
      <label class="online-toggle">
        <input type="checkbox" id="admin-online-check" checked>
        <span class="online-toggle-slider"></span>
        <span class="online-toggle-label">Online para receber salas</span>
      </label>
    `;

    const check = document.getElementById('admin-online-check');
    check?.addEventListener('change', async () => {
      if (check.checked) {
        this.startHeartbeat();
        Utils.showToast('Você está online', 'success');
      } else {
        this.stopHeartbeat();
        Utils.showToast('Você está offline', 'info');
      }
    });

    this.startHeartbeat();
  }
};
