/**
 * Bot Discord — Paraíba Apostas
 * Anuncia automaticamente análises pendentes sem ADM no canal
 *
 * Configuração (.env):
 *   DISCORD_TOKEN=seu_token_do_bot
 *   DISCORD_CHANNEL_ID=id_do_canal_texto
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_KEY=service_role_key (NUNCA no frontend!)
 *
 * Rodar: npm install discord.js @supabase/supabase-js dotenv && node index.js
 */
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const DISCORD_INVITE = 'https://discord.gg/2qy5EpXq';
const POLL_INTERVAL_MS = 30000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

async function checkPendingAnalyses() {
  const { data, error } = await supabase.rpc('get_pending_analyses_for_discord');
  if (error) {
    console.error('Erro Supabase:', error.message);
    return;
  }
  if (!data?.length) return;

  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  if (!channel?.isTextBased()) return;

  for (const analysis of data) {
    const hasAdmin = analysis.has_admin ? '✅ ADM na sala' : '⚠️ SEM ADM — alguém assuma!';
    const msg = [
      '🔔 **ANÁLISE PENDENTE**',
      `📋 ID: \`${analysis.id.slice(0, 8)}\``,
      `👤 Jogador: **${analysis.requester_name}**`,
      `💰 Aposta: **R$ ${Number(analysis.bet_amount).toFixed(2)}**`,
      hasAdmin,
      analysis.notes ? `📝 ${analysis.notes}` : '',
      `🔗 Entre no Discord: ${DISCORD_INVITE}`,
      '—',
      '@here Análise aguardando na plataforma!'
    ].filter(Boolean).join('\n');

    await channel.send(msg);
    await supabase.rpc('mark_analysis_discord_notified', { p_analysis_id: analysis.id });
    console.log('Notificado:', analysis.id);
  }
}

client.once('ready', () => {
  console.log(`Bot online: ${client.user.tag}`);
  console.log(`Monitorando análises a cada ${POLL_INTERVAL_MS / 1000}s`);
  checkPendingAnalyses();
  setInterval(checkPendingAnalyses, POLL_INTERVAL_MS);
});

client.login(process.env.DISCORD_TOKEN);
