-- ============================================================
-- Migração: Painel Admin v2
-- Execute no SQL Editor se o banco já existia antes desta atualização
-- ============================================================

-- Campos do perfil ADM
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_nick TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pix_key TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pix_key_type TEXT DEFAULT 'random';

-- Depósitos: ADM escolhido + quem assumiu análise
ALTER TABLE public.deposit_requests ADD COLUMN IF NOT EXISTS assigned_admin_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.deposit_requests ADD COLUMN IF NOT EXISTS claimed_by_admin_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.deposit_requests ADD COLUMN IF NOT EXISTS player_message TEXT;
ALTER TABLE public.deposit_requests ADD COLUMN IF NOT EXISTS proof_storage_path TEXT;

-- Disputas: quem assumiu análise
ALTER TABLE public.disputes ADD COLUMN IF NOT EXISTS claimed_by_admin_id UUID REFERENCES public.profiles(id);

-- Novo status de depósito
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'in_review';

CREATE INDEX IF NOT EXISTS idx_deposits_assigned ON public.deposit_requests(assigned_admin_id);
CREATE INDEX IF NOT EXISTS idx_deposits_claimed ON public.deposit_requests(claimed_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_disputes_claimed ON public.disputes(claimed_by_admin_id);

-- Helper: admin pode ver detalhes do depósito?
CREATE OR REPLACE FUNCTION public.can_admin_view_deposit(p_admin_id UUID, p_deposit_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.deposit_requests d
    WHERE d.id = p_deposit_id
      AND (d.assigned_admin_id = p_admin_id OR d.claimed_by_admin_id = p_admin_id)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Lista ADMs disponíveis para depósito (com chave PIX)
CREATE OR REPLACE FUNCTION public.get_deposit_admins()
RETURNS TABLE (
  id UUID,
  admin_nick TEXT,
  display_name TEXT,
  pix_key TEXT,
  pix_key_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.admin_nick, p.display_name, p.pix_key, COALESCE(p.pix_key_type, 'random')
  FROM public.profiles p
  WHERE p.is_admin = TRUE
    AND p.admin_nick IS NOT NULL AND TRIM(p.admin_nick) != ''
    AND p.pix_key IS NOT NULL AND TRIM(p.pix_key) != '';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ADM atualiza nick e chave PIX
CREATE OR REPLACE FUNCTION public.update_admin_profile(
  p_admin_nick TEXT,
  p_pix_key TEXT,
  p_pix_key_type TEXT DEFAULT 'random'
)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN FALSE; END IF;
  IF p_admin_nick IS NULL OR TRIM(p_admin_nick) = '' THEN RETURN FALSE; END IF;
  IF p_pix_key IS NULL OR TRIM(p_pix_key) = '' THEN RETURN FALSE; END IF;

  UPDATE public.profiles SET
    admin_nick = TRIM(p_admin_nick),
    pix_key = TRIM(p_pix_key),
    pix_key_type = COALESCE(p_pix_key_type, 'random')
  WHERE id = auth.uid();

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Listar depósitos para painel admin (dados mascarados se não tiver acesso)
CREATE OR REPLACE FUNCTION public.list_deposits_for_admin(p_admin_id UUID)
RETURNS TABLE (
  id UUID,
  amount NUMERIC,
  status deposit_status,
  created_at TIMESTAMPTZ,
  assigned_admin_id UUID,
  claimed_by_admin_id UUID,
  assigned_admin_tag TEXT,
  claimed_admin_tag TEXT,
  can_view BOOLEAN,
  player_display_name TEXT,
  player_username TEXT,
  pix_proof_url TEXT,
  proof_storage_path TEXT,
  player_message TEXT
) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = p_admin_id AND is_admin = TRUE) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.amount,
    d.status,
    d.created_at,
    d.assigned_admin_id,
    d.claimed_by_admin_id,
    CASE WHEN aa.admin_nick IS NOT NULL THEN '[ADM-' || aa.admin_nick || ']' ELSE 'ADM' END,
    CASE WHEN ca.admin_nick IS NOT NULL THEN '[ADM-' || ca.admin_nick || ']' ELSE NULL END,
    (d.assigned_admin_id = p_admin_id OR d.claimed_by_admin_id = p_admin_id),
    CASE WHEN d.assigned_admin_id = p_admin_id OR d.claimed_by_admin_id = p_admin_id
         THEN pl.display_name ELSE 'Jogador oculto' END,
    CASE WHEN d.assigned_admin_id = p_admin_id OR d.claimed_by_admin_id = p_admin_id
         THEN pl.username ELSE '***' END,
    CASE WHEN d.assigned_admin_id = p_admin_id OR d.claimed_by_admin_id = p_admin_id
         THEN d.pix_proof_url ELSE NULL END,
    CASE WHEN d.assigned_admin_id = p_admin_id OR d.claimed_by_admin_id = p_admin_id
         THEN d.proof_storage_path ELSE NULL END,
    CASE WHEN d.assigned_admin_id = p_admin_id OR d.claimed_by_admin_id = p_admin_id
         THEN d.player_message ELSE NULL END
  FROM public.deposit_requests d
  JOIN public.profiles pl ON pl.id = d.user_id
  LEFT JOIN public.profiles aa ON aa.id = d.assigned_admin_id
  LEFT JOIN public.profiles ca ON ca.id = d.claimed_by_admin_id
  WHERE d.status IN ('pending', 'in_review')
  ORDER BY d.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Assumir análise de depósito
CREATE OR REPLACE FUNCTION public.claim_deposit(p_deposit_id UUID, p_admin_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_deposit RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_deposit FROM public.deposit_requests
  WHERE id = p_deposit_id AND status IN ('pending', 'in_review')
  FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_deposit.claimed_by_admin_id IS NOT NULL AND v_deposit.claimed_by_admin_id != p_admin_id THEN
    RETURN FALSE;
  END IF;

  IF v_deposit.assigned_admin_id = p_admin_id THEN
    UPDATE public.deposit_requests SET status = 'in_review' WHERE id = p_deposit_id;
    RETURN TRUE;
  END IF;

  UPDATE public.deposit_requests SET
    claimed_by_admin_id = p_admin_id,
    status = 'in_review'
  WHERE id = p_deposit_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aprovar depósito (somente ADM atribuído ou que assumiu)
CREATE OR REPLACE FUNCTION public.approve_deposit(p_deposit_id UUID, p_admin_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_deposit RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_deposit FROM public.deposit_requests
  WHERE id = p_deposit_id AND status IN ('pending', 'in_review')
  FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_deposit.assigned_admin_id != p_admin_id AND v_deposit.claimed_by_admin_id != p_admin_id THEN
    RETURN FALSE;
  END IF;

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

-- Rejeitar depósito
CREATE OR REPLACE FUNCTION public.reject_deposit(p_deposit_id UUID, p_admin_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE v_deposit RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_deposit FROM public.deposit_requests
  WHERE id = p_deposit_id AND status IN ('pending', 'in_review')
  FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_deposit.assigned_admin_id != p_admin_id AND v_deposit.claimed_by_admin_id != p_admin_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.deposit_requests SET
    status = 'rejected',
    processed_by = p_admin_id,
    processed_at = NOW(),
    admin_notes = p_notes
  WHERE id = p_deposit_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Listar disputas para admin
CREATE OR REPLACE FUNCTION public.list_disputes_for_admin(p_admin_id UUID)
RETURNS TABLE (
  id UUID,
  challenge_id UUID,
  reason TEXT,
  status dispute_status,
  created_at TIMESTAMPTZ,
  claimed_by_admin_id UUID,
  claimed_admin_tag TEXT,
  can_view BOOLEAN,
  reporter_name TEXT,
  creator_name TEXT,
  acceptor_name TEXT,
  bet_amount NUMERIC,
  creator_id UUID,
  acceptor_id UUID
) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = p_admin_id AND is_admin = TRUE) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dp.id,
    dp.challenge_id,
    CASE WHEN dp.claimed_by_admin_id = p_admin_id THEN dp.reason ELSE 'Assuma a análise para ver detalhes' END,
    dp.status,
    dp.created_at,
    dp.claimed_by_admin_id,
    CASE WHEN ca.admin_nick IS NOT NULL THEN '[ADM-' || ca.admin_nick || ']' ELSE NULL END,
    (dp.claimed_by_admin_id = p_admin_id),
    CASE WHEN dp.claimed_by_admin_id = p_admin_id THEN rp.display_name ELSE '***' END,
    CASE WHEN dp.claimed_by_admin_id = p_admin_id THEN cr.display_name ELSE '***' END,
    CASE WHEN dp.claimed_by_admin_id = p_admin_id THEN ac.display_name ELSE '***' END,
    CASE WHEN dp.claimed_by_admin_id = p_admin_id THEN ch.bet_amount ELSE NULL END,
    CASE WHEN dp.claimed_by_admin_id = p_admin_id THEN ch.creator_id ELSE NULL END,
    CASE WHEN dp.claimed_by_admin_id = p_admin_id THEN ch.acceptor_id ELSE NULL END
  FROM public.disputes dp
  JOIN public.challenges ch ON ch.id = dp.challenge_id
  JOIN public.profiles rp ON rp.id = dp.reported_by
  LEFT JOIN public.profiles cr ON cr.id = ch.creator_id
  LEFT JOIN public.profiles ac ON ac.id = ch.acceptor_id
  LEFT JOIN public.profiles ca ON ca.id = dp.claimed_by_admin_id
  WHERE dp.status = 'pending'
  ORDER BY dp.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Assumir disputa
CREATE OR REPLACE FUNCTION public.claim_dispute(p_dispute_id UUID, p_admin_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_dispute RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_dispute FROM public.disputes
  WHERE id = p_dispute_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_dispute.claimed_by_admin_id IS NOT NULL AND v_dispute.claimed_by_admin_id != p_admin_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.disputes SET claimed_by_admin_id = p_admin_id WHERE id = p_dispute_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Resolver disputa (somente quem assumiu)
CREATE OR REPLACE FUNCTION public.resolve_dispute_admin(
  p_dispute_id UUID,
  p_admin_id UUID,
  p_challenge_id UUID,
  p_winner_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE v_dispute RECORD;
BEGIN
  SELECT * INTO v_dispute FROM public.disputes
  WHERE id = p_dispute_id AND status = 'pending' FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_dispute.claimed_by_admin_id != p_admin_id THEN RETURN FALSE; END IF;

  PERFORM public.resolve_challenge(p_challenge_id, p_winner_id);

  UPDATE public.disputes SET
    status = CASE WHEN p_winner_id IS NOT NULL THEN 'resolved_creator'::dispute_status ELSE 'cancelled'::dispute_status END,
    resolved_by = p_admin_id,
    resolved_at = NOW(),
    admin_notes = p_notes
  WHERE id = p_dispute_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Storage: ADM atribuído pode ver comprovante
DROP POLICY IF EXISTS "Ver próprias provas" ON storage.objects;
CREATE POLICY "Ver storage depositos e provas" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'proofs' AND (
      auth.uid()::text = (storage.foldername(name))[1] OR
      public.is_admin()
    )
    OR
    bucket_id = 'deposits' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1 FROM public.deposit_requests d
        WHERE d.proof_storage_path = name
          AND (d.assigned_admin_id = auth.uid() OR d.claimed_by_admin_id = auth.uid())
      )
    )
  );

-- Realtime depósitos
ALTER PUBLICATION supabase_realtime ADD TABLE public.deposit_requests;

GRANT EXECUTE ON FUNCTION public.get_deposit_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_profile(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_deposits_for_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_deposit(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_deposit(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_disputes_for_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dispute(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_dispute_admin(UUID, UUID, UUID, UUID, TEXT) TO authenticated;
