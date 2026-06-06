# Paraíba Apostas — Guia de Instalação

Plataforma de apostas organizadas de Free Fire com **Casa Segura**, carteira virtual, matchmaking e painel administrativo.

---

## Pré-requisitos

- Conta no [Supabase](https://supabase.com) (plano gratuito funciona para começar)
- Conta na [Vercel](https://vercel.com) para hospedagem
- Git instalado (opcional, para deploy via repositório)

---

## 1. Configuração do Supabase

### 1.1 Criar projeto

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard)
2. Clique em **New Project**
3. Escolha nome, senha do banco e região (recomendado: `South America`)
4. Aguarde a criação do projeto

### 1.2 Executar o schema SQL

1. No painel do Supabase, vá em **SQL Editor**
2. Clique em **New Query**
3. Copie todo o conteúdo de `supabase/schema.sql`
4. Cole no editor e clique em **Run**
5. Verifique se todas as tabelas foram criadas em **Table Editor**:
   - `profiles`, `wallets`, `transactions`, `challenges`
   - `matchmaking_queue`, `proofs`, `disputes`, `deposit_requests`

### 1.3 Migração do sistema de chat (salas + ADM online)

Execute também `supabase/migration_chat_system.sql` para:
- Salas de conversa ao aceitar desafio
- Presença online dos ADMs
- Pedidos de análise → Discord

### 1.4 Migração do painel admin (banco já existente)

Se você já executou o `schema.sql` antes desta atualização, rode também:

```sql
-- Conteúdo completo em supabase/migration_admin_panel.sql
```

Isso adiciona: nick de ADM, chave PIX, escolha de ADM no depósito e sistema de assumir análise.

### 1.5 Obter credenciais

1. Vá em **Project Settings** → **API**
2. Copie:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`

---

## 2. Configuração da Autenticação

### 2.1 Habilitar e-mail/senha

1. Vá em **Authentication** → **Providers**
2. Certifique-se de que **Email** está habilitado
3. Em **Authentication** → **URL Configuration**:
   - **Site URL**: `https://seu-dominio.vercel.app` (produção) ou `http://localhost:3000` (dev)
   - **Redirect URLs** — adicione todas estas:
     ```
     http://localhost:3000/verify-email.html
     http://localhost:3000/**
     https://seu-dominio.vercel.app/verify-email.html
     https://seu-dominio.vercel.app/**
     ```
   > O link de confirmação de e-mail redireciona para `verify-email.html`, que exibe a mensagem de sucesso.

### 2.2 Configurar confirmação de e-mail (opcional)

- Para desenvolvimento: desabilite **Confirm email** em Authentication → Settings
- Para produção: mantenha habilitado e configure SMTP customizado

### 2.3 Criar primeiro administrador

Após criar sua conta pelo site:

```sql
-- Substitua pelo e-mail ou ID do seu usuário
UPDATE public.profiles
SET is_admin = TRUE
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'seu@email.com'
);
```

Depois, acesse **Admin → Meu Perfil ADM** no site e cadastre:
- **Nick de ADM** (ex: `ZéPix` → aparece como `[ADM-ZéPix]`)
- **Chave PIX** e tipo da chave

Sem isso, o ADM não aparece na lista de depósitos dos jogadores.

---

## 3. Configuração do Storage (Uploads)

O script SQL já cria os buckets `proofs` e `deposits`. Verifique em **Storage**:

| Bucket    | Uso                          | Limite |
|-----------|------------------------------|--------|
| `proofs`  | Prints, vídeos, gravações    | 50 MB  |
| `deposits`| Comprovantes PIX             | 10 MB  |

### Políticas de acesso

As políticas RLS do Storage são criadas automaticamente pelo `schema.sql`. Se necessário, verifique em **Storage** → bucket → **Policies**.

---

## 4. Configuração Local (Desenvolvimento)

### 4.1 Configurar credenciais

Edite `js/config.js`:

```javascript
window.SUPABASE_CONFIG = {
  url: 'https://SEU-PROJETO.supabase.co',
  anonKey: 'SUA-CHAVE-ANON'
};
```

### 4.2 Rodar localmente

```bash
# Opção 1: serve estático
npx serve .

# Opção 2: script do package.json
npm run dev
```

Acesse `http://localhost:3000`

---

## 5. Deploy na Vercel

### 5.1 Via Git (recomendado)

1. Crie um repositório no GitHub com o código do projeto
2. Acesse [vercel.com/new](https://vercel.com/new)
3. Importe o repositório
4. A Vercel detectará automaticamente as configurações do `vercel.json`

### 5.2 Variáveis de ambiente na Vercel

Em **Project Settings** → **Environment Variables**, adicione:

| Variável             | Valor                          |
|----------------------|--------------------------------|
| `SUPABASE_URL`       | `https://seu-projeto.supabase.co` |
| `SUPABASE_ANON_KEY`  | Sua chave anon do Supabase     |

> O script `build.js` injeta essas variáveis em `dist/js/config.js` automaticamente no deploy.

### 5.3 Deploy manual

```bash
npm install -g vercel
vercel
```

Siga as instruções e configure as variáveis de ambiente quando solicitado.

### 5.4 Após o deploy

1. Atualize a **Site URL** no Supabase Authentication com sua URL da Vercel
2. Adicione a URL em **Redirect URLs**
3. Teste login, registro e criação de desafio

---

## 6. Estrutura do Projeto

```
paraiba-apostas/
├── index.html              # Landing + Login
├── register.html           # Cadastro
├── dashboard.html          # Painel do jogador
├── wallet.html             # Carteira virtual
├── challenges.html         # Sistema de desafios
├── matchmaking.html        # Matchmaking automático
├── stats.html              # Estatísticas
├── ranking.html            # Ranking de apostadores
├── proofs.html             # Upload de provas
├── admin.html              # Painel administrativo
├── css/
│   └── main.css            # Estilos (tema Free Fire)
├── js/
│   ├── config.js           # Credenciais Supabase
│   ├── supabase-client.js  # Cliente Supabase
│   ├── auth.js             # Autenticação
│   ├── wallet.js           # Carteira
│   ├── challenges.js       # Desafios + Casa Segura
│   ├── matchmaking.js      # Matchmaking
│   ├── stats.js            # Estatísticas
│   ├── ranking.js          # Ranking
│   ├── proofs.js           # Upload de provas
│   ├── admin.js            # Painel admin
│   ├── layout.js           # Layout compartilhado
│   ├── utils.js            # Utilitários
│   └── app.js              # Inicialização
├── supabase/
│   └── schema.sql          # Schema completo + RLS
├── build.js                # Build para Vercel
├── vercel.json             # Configuração Vercel
├── package.json
├── .env.example
└── INSTALACAO.md
```

---

## 7. Funcionalidades e Regras de Negócio

### Casa Segura (Taxa da plataforma)

- Aposta de R$ 10 vs R$ 10 = pote de R$ 20
- Taxa de **10%** = R$ 2 para a organização
- Vencedor recebe **R$ 18** automaticamente

### Cashback

- **2%** do valor apostado retorna como cashback
- Exemplo: apostou R$ 10 → recebe R$ 0,20 em cashback
- Cashback é usado automaticamente em novas apostas

### Carteira

- Depósitos são solicitados pelo jogador e **aprovados pelo admin**
- Saldo fica **bloqueado** ao criar/aceitar desafio
- Liberado ao vencedor após confirmação do resultado

### Matchmaking

- Jogador busca partida por valor e modo
- Sistema encontra oponente com mesmos parâmetros
- Desafio é criado automaticamente com fundos bloqueados

### Disputas

- Se jogadores reportam resultados diferentes → status `disputed`
- Admin analisa provas e define vencedor no painel

---

## 8. Segurança (RLS)

O schema implementa **Row Level Security** em todas as tabelas:

- Jogadores só veem/editam seus próprios dados
- Carteiras só são modificadas via funções RPC (`SECURITY DEFINER`)
- Painel admin protegido por flag `is_admin` no perfil
- Uploads de provas restritos a participantes da partida
- Storage com políticas por pasta de usuário

---

## 9. Escalabilidade

Para milhares de usuários simultâneos:

1. **Supabase Pro** para mais conexões e performance
2. **Realtime** já habilitado para desafios e matchmaking
3. Índices criados nas colunas mais consultadas
4. Funções RPC evitam race conditions em transações financeiras
5. Considere **Connection Pooling** (PgBouncer) no Supabase

---

## 10. Bot Discord (análises automáticas)

Discord da org: [PARAÍBA | SALAS 5c](https://discord.gg/2qy5EpXq)

1. Crie um bot em [discord.com/developers](https://discord.com/developers/applications)
2. Convide o bot para seu servidor com permissão de enviar mensagens
3. Copie o **Channel ID** do canal de análises
4. Na pasta `discord-bot/`:
   ```bash
   cp .env.example .env
   npm install
   npm start
   ```
5. Use a **service_role key** do Supabase (apenas no servidor do bot, nunca no site)

O bot verifica a cada 30s análises sem ADM e posta automaticamente no canal.

## 11. Solução de Problemas

| Problema | Solução |
|----------|---------|
| Login não funciona | Verifique Site URL e Redirect URLs no Supabase |
| "Supabase não configurado" | Preencha `js/config.js` ou variáveis na Vercel |
| Erro ao criar desafio | Verifique saldo e se o schema SQL foi executado |
| Upload falha | Confirme buckets `proofs`/`deposits` no Storage |
| Admin não acessa | Execute SQL para setar `is_admin = TRUE` |
| Build Vercel falha | Verifique se `SUPABASE_URL` e `SUPABASE_ANON_KEY` estão definidas |

---

## Suporte

Para dúvidas sobre Supabase: [supabase.com/docs](https://supabase.com/docs)  
Para dúvidas sobre Vercel: [vercel.com/docs](https://vercel.com/docs)
