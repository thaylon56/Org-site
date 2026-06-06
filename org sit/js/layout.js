/**
 * Layout compartilhado - injeta sidebar e estrutura base
 */
const Layout = {
  brandName: 'Paraíba Apostas',
  logoSrc: 'assets/logo.png',

  navItems: [
    { href: 'dashboard.html', icon: '🏠', label: 'Início' },
    { href: 'wallet.html', icon: '💰', label: 'Carteira' },
    { href: 'challenges.html', icon: '⚔️', label: 'Desafios' },
    { href: 'matchmaking.html', icon: '🎯', label: 'Matchmaking' },
    { href: 'stats.html', icon: '📊', label: 'Estatísticas' },
    { href: 'ranking.html', icon: '🏆', label: 'Ranking' },
    { href: 'admin.html', icon: '🛡️', label: 'Admin', id: 'admin-nav-link' }
  ],

  render() {
    const container = document.getElementById('app-root');
    if (!container) return;

    const title = container.dataset.title || this.brandName;
    const subtitle = container.dataset.subtitle || '';

    container.innerHTML = `
      <div class="app-layout">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <a href="dashboard.html" class="logo">
              <img src="${this.logoSrc}" alt="${this.brandName}" class="logo-img logo-img--sidebar">
            </a>
          </div>
          <div class="sidebar-balance">
            <span class="sidebar-balance-label">Saldo</span>
            <span class="sidebar-balance-value" id="sidebar-balance">R$ 0,00</span>
          </div>
          <div class="sidebar-user" id="sidebar-username">Carregando...</div>
          <nav class="sidebar-nav">
            ${this.navItems.map(item => `
              <a href="${item.href}" class="nav-link" ${item.id ? `id="${item.id}"` : ''}>
                <span class="nav-icon">${item.icon}</span>
                ${item.label}
              </a>
            `).join('')}
          </nav>
          <div class="sidebar-footer">
            <a href="#" class="nav-link" data-logout>
              <span class="nav-icon">🚪</span>
              Sair
            </a>
          </div>
        </aside>
        <div class="sidebar-overlay" id="sidebar-overlay"></div>
        <main class="main-content">
          <header class="top-bar">
            <button class="menu-toggle" id="menu-toggle" aria-label="Menu">☰</button>
            <a href="dashboard.html" class="logo">
              <img src="${this.logoSrc}" alt="${this.brandName}" class="logo-img logo-img--compact">
            </a>
            <span id="top-balance" class="text-gold" style="font-weight:700"></span>
          </header>
          <div class="page-content">
            <div class="page-header">
              <h1>${title}</h1>
              ${subtitle ? `<p>${subtitle}</p>` : ''}
            </div>
            <div id="page-body"></div>
          </div>
        </main>
      </div>
    `;

    const content = document.getElementById('page-content-template');
    if (content) {
      document.getElementById('page-body').appendChild(content);
      content.style.display = 'block';
    }
  }
};
