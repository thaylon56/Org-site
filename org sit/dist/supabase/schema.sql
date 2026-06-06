-- ============================================================
-- FF Arena - Schema completo para Supabase
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA: profiles (perfil do jogador)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  ff_id TEXT,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  -- Estatísticas de confiança
  matches_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  cancellations INTEGER DEFAULT 0,
  confirmations INTEGER DEFAULT 0,
  total_confirmations INTEGER DEFAULT 0,
  reports_count INTEGER DEFAULT 0,
  reputation_score NUMERIC(5,2) DEFAULT 100.00,
  -- Estatísticas de apostas
  total_bet NUMERIC(12,2) DEFAULT 0,
  total_won NUMERIC(12,2) DEFAULT 0,
  total_lost NUMERIC(12,2) DEFAULT 0,
  biggest_win NUMERIC(12,2) DEFAULT 0,
  win_streak INTEGER DEFAULT 0,
  best_win_streak INTEGER DEFAULT 0,
  monthly_bet NUMERIC(12,2) DEFAULT 0,
  monthly_wins INTEGER DEFAULT 0,
  cashback_earned NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: wallets (carteira virtual)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) DEFAULT 0 CHECK (balance >= 0),
  locked_balance NUMERIC(12,2) DEFAULT 0 CHECK (locked_balance >= 0),
  cashback_balance NUMERIC(12,2) DEFAULT 0 CHECK (cashback_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: transactions (registro de transações)
-- ============================================================
CREATE TYPE transaction_type AS ENUM (
  'deposit',
  'withdrawal',
  'bet_lock',
  'bet_release',
  'win',
  'loss',
  'cashback',
  'platform_fee',
  'refund',
  'cashback_use'
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type transaction_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2),
  description TEXT,
  challenge_id UUID,
  reference_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: challenges (desafios / apostas)
-- ============================================================
CREATE TYPE challenge_status AS ENUM (
  'open',
  'matched',
  'in_progress',
  'awaiting_result',
  'disputed',
  'completed',
  'cancelled'
);

CREATE TYPE game_mode AS ENUM ('1x1', '2x2', '4x4', 'squad');

CREATE TABLE IF NOT EXISTS public.challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  acceptor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  bet_amount NUMERIC(12,2) NOT NULL CHECK (bet_amount > 0),
  game_mode game_mode DEFAULT '1x1',
  scheduled_at TIMESTAMPTZ,
  status challenge_status DEFAULT 'open',
  winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  platform_fee NUMERIC(12,2) DEFAULT 0,
  prize_amount NUMERIC(12,2) DEFAULT 0,
  creator_confirmed BOOLEAN DEFAULT FALSE,
  acceptor_confirmed BOOLEAN DEFAULT FALSE,
  creator_result TEXT,
  acceptor_result TEXT,
  is_matchmaking BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- FK para transactions
ALTER TABLE public.transactions
  ADD CONSTRAINT fk_transactions_challenge
  FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE SET NULL;

-- ============================================================
-- TABELA: matchmaking_queue (fila de matchmaking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bet_amount NUMERIC(12,2) NOT NULL CHECK (bet_amount > 0),
  game_mode game_mode DEFAULT '1x1',
  status TEXT DEFAULT 'searching' CHECK (status IN ('searching', 'matched', 'cancelled')),
  challenge_id UUID REFERENCES public.challenges(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: proofs (provas de partida)
-- ============================================================
CREATE TYPE proof_type AS ENUM ('screenshot', 'video', 'recording');

CREATE TABLE IF NOT EXISTS public.proofs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proof_type proof_type NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: disputes (disputas para admin)
-- ============================================================
CREATE TYPE dispute_status AS ENUM ('pending', 'resolved_creator', 'resolved_acceptor', 'cancelled');

CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status dispute_status DEFAULT 'pending',
  admin_notes TEXT,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: deposit_requests (solicitações de depósito)
-- ============================================================
CREATE TYPE deposit_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS public.deposit_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  pix_proof_url TEXT,
  status deposit_status DEFAULT 'pending',
  admin_notes TEXT,
  processed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ============================================================
-- ÍNDICES para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_challenges_status ON public.challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenges_creator ON public.challenges(creator_id);
CREATE INDEX IF NOT EXISTS idx_challenges_acceptor ON public.challenges(acceptor_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matchmaking_amount_mode ON public.matchmaking_queue(bet_amount, game_mode, status);
CREATE INDEX IF NOT EXISTS idx_profiles_reputation ON public.profiles(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_monthly_bet ON public.profiles(monthly_bet DESC);
CREATE INDEX IF NOT EXISTS idx_proofs_challenge ON public.proofs(challenge_id);

-- ============================================================
-- TRIGGER: criar perfil e carteira ao registrar usuário
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  INSERT INTO public.wallets (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TRIGGER: atualizar updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER wallets_updated_at BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER challenges_updated_at BEFORE UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- FUNÇÃO: bloquear saldo para aposta
-- ============================================================
CREATE OR REPLACE FUNCTION public.lock_bet_funds(p_user_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN AS $$
DECLARE
  v_balance NUMERIC;
  v_cashback NUMERIC;
BEGIN
  SELECT balance, cashback_balance INTO v_balance, v_cashback
  FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF (v_balance + v_cashback) < p_amount THEN
    RETURN FALSE;
  END IF;

  -- Usa cashback primeiro, depois saldo principal
  IF v_cashback >= p_amount THEN
    UPDATE public.wallets SET
      cashback_balance = cashback_balance - p_amount,
      locked_balance = locked_balance + p_amount
    WHERE user_id = p_user_id;
  ELSIF v_cashback > 0 THEN
    UPDATE public.wallets SET
      balance = balance - (p_amount - v_cashback),
      cashback_balance = 0,
      locked_balance = locked_balance + p_amount
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.wallets SET
      balance = balance - p_amount,
      locked_balance = locked_balance + p_amount
    WHERE user_id = p_user_id;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNÇÃO: liberar fundos ao vencedor (Casa Segura)
-- Taxa da plataforma: 10% do pote total
-- Cashback: 2% do valor apostado por jogador
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_challenge(p_challenge_id UUID, p_winner_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_challenge RECORD;
  v_total_pot NUMERIC;
  v_platform_fee NUMERIC;
  v_prize NUMERIC;
  v_bet_amount NUMERIC;
  v_loser_id UUID;
  v_cashback_rate NUMERIC := 0.02;
  v_fee_rate NUMERIC := 0.10;
BEGIN
  SELECT * INTO v_challenge FROM public.challenges
  WHERE id = p_challenge_id AND status IN ('in_progress', 'awaiting_result', 'disputed')
  FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_bet_amount := v_challenge.bet_amount;
  v_total_pot := v_bet_amount * 2;
  v_platform_fee := v_total_pot * v_fee_rate;
  v_prize := v_total_pot - v_platform_fee;

  IF p_winner_id = v_challenge.creator_id THEN
    v_loser_id := v_challenge.acceptor_id;
  ELSE
    v_loser_id := v_challenge.creator_id;
  END IF;

  -- Liberar fundos bloqueados e creditar vencedor
  UPDATE public.wallets SET locked_balance = locked_balance - v_bet_amount
  WHERE user_id IN (v_challenge.creator_id, v_challenge.acceptor_id);

  UPDATE public.wallets SET balance = balance + v_prize
  WHERE user_id = p_winner_id;

  -- Cashback para ambos (2% cada)
  UPDATE public.wallets SET cashback_balance = cashback_balance + (v_bet_amount * v_cashback_rate)
  WHERE user_id IN (v_challenge.creator_id, v_challenge.acceptor_id);

  -- Atualizar estatísticas do vencedor
  UPDATE public.profiles SET
    matches_played = matches_played + 1,
    wins = wins + 1,
    win_streak = win_streak + 1,
    best_win_streak = GREATEST(best_win_streak, win_streak + 1),
    total_won = total_won + v_prize,
    total_bet = total_bet + v_bet_amount,
    monthly_bet = monthly_bet + v_bet_amount,
    monthly_wins = monthly_wins + 1,
    cashback_earned = cashback_earned + (v_bet_amount * v_cashback_rate),
    confirmations = confirmations + 1,
    total_confirmations = total_confirmations + 1,
  biggest_win = GREATEST(biggest_win, v_prize)
  WHERE id = p_winner_id;

  -- Atualizar estatísticas do perdedor
  UPDATE public.profiles SET
    matches_played = matches_played + 1,
    losses = losses + 1,
    win_streak = 0,
    total_lost = total_lost + v_bet_amount,
    total_bet = total_bet + v_bet_amount,
    monthly_bet = monthly_bet + v_bet_amount,
    confirmations = confirmations + 1,
    total_confirmations = total_confirmations + 1,
    cashback_earned = cashback_earned + (v_bet_amount * v_cashback_rate)
  WHERE id = v_loser_id;

  -- Atualizar desafio
  UPDATE public.challenges SET
    status = 'completed',
    winner_id = p_winner_id,
    platform_fee = v_platform_fee,
    prize_amount = v_prize,
    completed_at = NOW()
  WHERE id = p_challenge_id;

  -- Registrar transações
  INSERT INTO public.transactions (user_id, type, amount, description, challenge_id)
  VALUES
    (p_winner_id, 'win', v_prize, 'Vitória no desafio', p_challenge_id),
    (v_loser_id, 'loss', v_bet_amount, 'Derrota no desafio', p_challenge_id),
    (p_winner_id, 'cashback', v_bet_amount * v_cashback_rate, 'Cashback 2%', p_challenge_id),
    (v_loser_id, 'cashback', v_bet_amount * v_cashback_rate, 'Cashback 2%', p_challenge_id);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNÇÃO: desbloquear fundos (reverter bloqueio)
-- ============================================================
CREATE OR REPLACE FUNCTION public.unlock_bet_funds(p_user_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.wallets SET
    locked_balance = GREATEST(0, locked_balance - p_amount),
    balance = balance + p_amount
  WHERE user_id = p_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNÇÃO: cancelar desafio e devolver fundos
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_challenge(p_challenge_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_challenge RECORD;
BEGIN
  SELECT * INTO v_challenge FROM public.challenges
  WHERE id = p_challenge_id FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_challenge.status NOT IN ('open', 'matched') THEN RETURN FALSE; END IF;

  -- Devolver fundos se já bloqueados
  IF v_challenge.status = 'matched' OR v_challenge.acceptor_id IS NOT NULL THEN
    UPDATE public.wallets SET
      locked_balance = locked_balance - v_challenge.bet_amount,
      balance = balance + v_challenge.bet_amount
    WHERE user_id IN (v_challenge.creator_id, v_challenge.acceptor_id);
  ELSIF v_challenge.creator_id = p_user_id THEN
    UPDATE public.wallets SET
      locked_balance = locked_balance - v_challenge.bet_amount,
      balance = balance + v_challenge.bet_amount
    WHERE user_id = v_challenge.creator_id;
  END IF;

  UPDATE public.profiles SET cancellations = cancellations + 1
  WHERE id = p_user_id;

  UPDATE public.challenges SET status = 'cancelled' WHERE id = p_challenge_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNÇÃO: aprovar depósito (admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_deposit(p_deposit_id UUID, p_admin_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_deposit RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_deposit FROM public.deposit_requests
  WHERE id = p_deposit_id AND status = 'pending' FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.wallets SET balance = balance + v_deposit.amount
  WHERE user_id = v_deposit.user_id;

  UPDATE public.deposit_requests SET
    status = 'approved',
    processed_by = p_admin_id,
    processed_at = NOW()
  WHERE id = p_deposit_id;

  INSERT INTO public.transactions (user_id, type, amount, description)
  VALUES (v_deposit.user_id, 'deposit', v_deposit.amount, 'Depósito aprovado');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNÇÃO: matchmaking automático
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_matchmaking(p_user_id UUID, p_amount NUMERIC, p_mode game_mode)
RETURNS UUID AS $$
DECLARE
  v_opponent RECORD;
  v_challenge_id UUID;
BEGIN
  -- Buscar oponente na fila
  SELECT * INTO v_opponent FROM public.matchmaking_queue
  WHERE user_id != p_user_id
    AND bet_amount = p_amount
    AND game_mode = p_mode
    AND status = 'searching'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Bloquear fundos de ambos
  IF NOT public.lock_bet_funds(p_user_id, p_amount) THEN RETURN NULL; END IF;
  IF NOT public.lock_bet_funds(v_opponent.user_id, p_amount) THEN
    -- Reverter bloqueio do primeiro
    UPDATE public.wallets SET
      locked_balance = locked_balance - p_amount,
      balance = balance + p_amount
    WHERE user_id = p_user_id;
    RETURN NULL;
  END IF;

  -- Criar desafio
  INSERT INTO public.challenges (creator_id, acceptor_id, bet_amount, game_mode, status, is_matchmaking)
  VALUES (v_opponent.user_id, p_user_id, p_amount, p_mode, 'matched', TRUE)
  RETURNING id INTO v_challenge_id;

  -- Atualizar filas
  UPDATE public.matchmaking_queue SET status = 'matched', challenge_id = v_challenge_id
  WHERE user_id IN (p_user_id, v_opponent.user_id);

  RETURN v_challenge_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_requests ENABLE ROW LEVEL SECURITY;

-- Helper: verificar se é admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- PROFILES
CREATE POLICY "Perfis visíveis para todos" ON public.profiles
  FOR SELECT USING (true);
CREATE POLICY "Usuário atualiza próprio perfil" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- WALLETS
CREATE POLICY "Usuário vê própria carteira" ON public.wallets
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admin atualiza carteiras" ON public.wallets
  FOR UPDATE USING (public.is_admin());

-- TRANSACTIONS
CREATE POLICY "Usuário vê próprias transações" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Sistema insere transações" ON public.transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- CHALLENGES
CREATE POLICY "Desafios visíveis para autenticados" ON public.challenges
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Usuário cria desafios" ON public.challenges
  FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Participantes atualizam desafio" ON public.challenges
  FOR UPDATE USING (
    auth.uid() IN (creator_id, acceptor_id) OR public.is_admin()
  );

-- MATCHMAKING
CREATE POLICY "Usuário gerencia própria fila" ON public.matchmaking_queue
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Ver fila de matchmaking" ON public.matchmaking_queue
  FOR SELECT USING (auth.role() = 'authenticated');

-- PROOFS
CREATE POLICY "Participantes enviam provas" ON public.proofs
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.challenges c
      WHERE c.id = challenge_id
      AND auth.uid() IN (c.creator_id, c.acceptor_id)
    )
  );
CREATE POLICY "Provas visíveis para participantes e admin" ON public.proofs
  FOR SELECT USING (
    auth.uid() = user_id OR public.is_admin() OR
    EXISTS (
      SELECT 1 FROM public.challenges c
      WHERE c.id = challenge_id
      AND auth.uid() IN (c.creator_id, c.acceptor_id)
    )
  );

-- DISPUTES
CREATE POLICY "Usuário cria disputa" ON public.disputes
  FOR INSERT WITH CHECK (auth.uid() = reported_by);
CREATE POLICY "Ver próprias disputas ou admin" ON public.disputes
  FOR SELECT USING (auth.uid() = reported_by OR public.is_admin());
CREATE POLICY "Admin resolve disputas" ON public.disputes
  FOR UPDATE USING (public.is_admin());

-- DEPOSIT REQUESTS
CREATE POLICY "Usuário cria depósito" ON public.deposit_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Usuário vê próprios depósitos" ON public.deposit_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admin processa depósitos" ON public.deposit_requests
  FOR UPDATE USING (public.is_admin());

-- ============================================================
-- STORAGE: bucket para provas
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proofs',
  'proofs',
  false,
  52428800, -- 50MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deposits',
  'deposits',
  false,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage
CREATE POLICY "Upload de provas" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'proofs' AND auth.role() = 'authenticated'
  );
CREATE POLICY "Ver próprias provas" ON storage.objects
  FOR SELECT USING (
    bucket_id IN ('proofs', 'deposits') AND
    (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin())
  );
CREATE POLICY "Upload comprovante depósito" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'deposits' AND auth.role() = 'authenticated'
  );

-- ============================================================
-- REALTIME (habilitar para desafios e matchmaking)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.challenges;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;

-- ============================================================
-- PERMISSÕES para funções RPC
-- ============================================================
GRANT EXECUTE ON FUNCTION public.lock_bet_funds(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_bet_funds(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_challenge(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_challenge(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_matchmaking(UUID, NUMERIC, game_mode) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_deposit(UUID, UUID) TO authenticated;
