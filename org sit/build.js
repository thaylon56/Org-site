/**
 * Script de build para Vercel
 * Injeta variáveis de ambiente no config.js
 */
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const configContent = `/**
 * Configuração do Supabase
 * Gerado automaticamente no build da Vercel
 */
window.SUPABASE_CONFIG = {
  url: '${SUPABASE_URL}',
  anonKey: '${SUPABASE_ANON_KEY}'
};
`;

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// Copiar todos os arquivos estáticos para dist
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.name !== 'build.js') {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(__dirname, distDir);

// Escrever config gerado
fs.writeFileSync(path.join(distDir, 'js', 'config.js'), configContent);
console.log('Build concluído! Config injetado em dist/js/config.js');
