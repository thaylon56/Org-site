-- ============================================================
-- Migração: Salas de chat, presença ADM e análises Discord
-- ============================================================

CREATE TYPE chat_room_status AS ENUM (
  'waiting_admin',
  'waiting_room',
  'active',
  'awaiting_proof',
  'closed'
);

CREATE TYPE chat_message_type AS ENUM (
  'text',
  'system',
  'room_code',
  'victory',
  'analysis_request',
  'proof_request'
);

CREATE TYPE analysis_status AS ENUM ('pending', 'assigned', 'completed', 'discord');

-- Presença online dos ADMs
CREATE TABLE IF NOT EXISTS public.admin_presence (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Salas de conversa por desafio
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID UNIQUE NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  assigned_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  room_code TEXT,
  status chat_room_status DEFAULT 'waiting_admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mensagens do chat
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  message_type chat_message_type DEFAULT 'text',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pedidos de análise (vitória / disputa → Discord)
CREATE TABLE IF NOT EXISTS public.analysis_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  room_id UUID REFERENCES public.chat_rooms(id) ON DELETE SET NULL,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status analysis_status DEFAULT 'pending',
  assigned_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  discord_notified BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON public.chat_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_status ON public.chat_rooms(status);
CREATE INDEX IF NOT EXISTS idx_analysis_pending ON public.analysis_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_admin_presence_online ON public.admin_presence(is_online) WHERE is_online = TRUE;

CREATE TRIGGER chat_rooms_updated_at BEFORE UPDATE ON public.chat_rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER analysis_updated_at BEFORE UPDATE ON public.analysis_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Criar sala de chat ao combinar desafio
CREATE OR REPLACE FUNCTION public.create_challenge_chat(p_challenge_id UUID)
RETURNS UUID AS $$
DECLARE
  v_challenge RECORD;
  v_admin_id UUID;
  v_admin_nick TEXT;
  v_room_id UUID;
BEGIN
  SELECT * INTO v_challenge FROM public.challenges WHERE id = p_challenge_id;
  IF NOT FOUND OR v_challenge.acceptor_id IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.chat_rooms WHERE challenge_id = p_challenge_id) THEN
    SELECT id INTO v_room_id FROM public.chat_rooms WHERE challenge_id = p_challenge_id;
    RETURN v_room_id;
  END IF;

  SELECT ap.user_id, p.admin_nick INTO v_admin_id, v_admin_nick
  FROM public.admin_presence ap
  JOIN public.profiles p ON p.id = ap.user_id
  WHERE ap.is_online = TRUE AND p.is_admin = TRUE
  ORDER BY ap.last_seen_at DESC
  LIMIT 1;

  INSERT INTO public.chat_rooms (challenge_id, assigned_admin_id, status)
  VALUES (
    p_challenge_id,
    v_admin_id,
    CASE WHEN v_admin_id IS NOT NULL THEN 'waiting_room'::chat_room_status
         ELSE 'waiting_admin'::chat_room_status END
  )
  RETURNING id INTO v_room_id;

  INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
  VALUES (v_room_id, NULL, 'system', '🎮 Desafio combinado! Sala de conversa aberta.');

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
    VALUES (
      v_room_id, v_admin_id, 'system',
      '🛡️ [ADM-' || COALESCE(v_admin_nick, 'Admin') || '] entrou. Criando sala no Free Fire...'
    );
  ELSE
    INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
    VALUES (v_room_id, NULL, 'system', '⏳ Aguardando um administrador online...');
  END IF;

  UPDATE public.challenges SET status = 'in_progress' WHERE id = p_challenge_id;

  RETURN v_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ADM define código da sala FF
CREATE OR REPLACE FUNCTION public.post_room_code(p_room_id UUID, p_admin_id UUID, p_room_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_room RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_room FROM public.chat_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_room.assigned_admin_id IS NULL THEN
    UPDATE public.chat_rooms SET assigned_admin_id = p_admin_id WHERE id = p_room_id;
  ELSIF v_room.assigned_admin_id != p_admin_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.chat_rooms SET room_code = p_room_code, status = 'active' WHERE id = p_room_id;

  INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
  VALUES (p_room_id, p_admin_id, 'room_code', '🏠 SALA FF: ' || p_room_code || ' — Entrem e joguem!');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Jogador declara vitória no chat
CREATE OR REPLACE FUNCTION public.claim_victory_in_chat(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_room RECORD;
  v_challenge RECORD;
  v_analysis_id UUID;
  v_display TEXT;
BEGIN
  SELECT cr.*, c.creator_id, c.acceptor_id, c.bet_amount
  INTO v_room
  FROM public.chat_rooms cr
  JOIN public.challenges c ON c.id = cr.challenge_id
  WHERE cr.id = p_room_id;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_user_id NOT IN (v_room.creator_id, v_room.acceptor_id) THEN RETURN NULL; END IF;
  IF v_room.status NOT IN ('active', 'awaiting_proof') THEN RETURN NULL; END IF;

  SELECT display_name INTO v_display FROM public.profiles WHERE id = p_user_id;

  INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
  VALUES (p_room_id, p_user_id, 'victory', '🏆 ' || v_display || ' declarou VITÓRIA!');

  UPDATE public.chat_rooms SET status = 'awaiting_proof' WHERE id = p_room_id;

  UPDATE public.challenges SET
    status = 'awaiting_result',
    creator_result = CASE WHEN p_user_id = v_room.creator_id THEN 'win' ELSE creator_result END,
    acceptor_result = CASE WHEN p_user_id = v_room.acceptor_id THEN 'win' ELSE acceptor_result END
  WHERE id = v_room.challenge_id;

  INSERT INTO public.analysis_requests (challenge_id, room_id, requested_by, winner_id, status)
  VALUES (v_room.challenge_id, p_room_id, p_user_id, p_user_id, 'pending')
  RETURNING id INTO v_analysis_id;

  IF v_room.assigned_admin_id IS NOT NULL THEN
    INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
    VALUES (
      p_room_id, v_room.assigned_admin_id, 'proof_request',
      '📸 Envie print do histórico ou vídeo da partida para análise.'
    );
    UPDATE public.analysis_requests SET assigned_admin_id = v_room.assigned_admin_id, status = 'assigned'
    WHERE id = v_analysis_id;
  END IF;

  RETURN v_analysis_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pedir análise (disputa) → fila Discord
CREATE OR REPLACE FUNCTION public.request_analysis_discord(
  p_room_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_room RECORD;
  v_analysis_id UUID;
  v_display TEXT;
BEGIN
  SELECT cr.*, c.id AS ch_id
  INTO v_room
  FROM public.chat_rooms cr
  JOIN public.challenges c ON c.id = cr.challenge_id
  WHERE cr.id = p_room_id;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_user_id NOT IN (
    SELECT creator_id FROM public.challenges WHERE id = v_room.challenge_id
    UNION SELECT acceptor_id FROM public.challenges WHERE id = v_room.challenge_id
  ) THEN RETURN NULL; END IF;

  SELECT display_name INTO v_display FROM public.profiles WHERE id = p_user_id;

  INSERT INTO public.analysis_requests (challenge_id, room_id, requested_by, status, notes)
  VALUES (v_room.challenge_id, p_room_id, p_user_id, 'pending', p_notes)
  RETURNING id INTO v_analysis_id;

  INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
  VALUES (
    p_room_id, p_user_id, 'analysis_request',
    '⚠️ ' || v_display || ' solicitou ANÁLISE. Encaminhado ao Discord da org.'
  );

  UPDATE public.challenges SET status = 'disputed' WHERE id = v_room.challenge_id;

  RETURN v_analysis_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ADM assume sala sem admin
CREATE OR REPLACE FUNCTION public.admin_join_chat(p_room_id UUID, p_admin_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_nick TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RETURN FALSE;
  END IF;

  SELECT admin_nick INTO v_nick FROM public.profiles WHERE id = p_admin_id;

  UPDATE public.chat_rooms SET
    assigned_admin_id = p_admin_id,
    status = CASE WHEN status = 'waiting_admin' THEN 'waiting_room'::chat_room_status ELSE status END
  WHERE id = p_room_id AND (assigned_admin_id IS NULL OR assigned_admin_id = p_admin_id);

  INSERT INTO public.chat_messages (room_id, sender_id, message_type, content)
  VALUES (
    p_room_id, p_admin_id, 'system',
    '🛡️ [ADM-' || COALESCE(v_nick, 'Admin') || '] assumiu a sala. Criando código FF...'
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Heartbeat presença ADM
CREATE OR REPLACE FUNCTION public.set_admin_online(p_online BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN FALSE; END IF;
  INSERT INTO public.admin_presence (user_id, is_online, last_seen_at)
  VALUES (auth.uid(), p_online, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    is_online = p_online,
    last_seen_at = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Lista análises pendentes (para bot Discord)
CREATE OR REPLACE FUNCTION public.get_pending_analyses_for_discord()
RETURNS TABLE (
  id UUID,
  challenge_id UUID,
  room_id UUID,
  requester_name TEXT,
  bet_amount NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ,
  has_admin BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ar.id,
    ar.challenge_id,
    ar.room_id,
    p.display_name,
    c.bet_amount,
    ar.notes,
    ar.created_at,
    (ar.assigned_admin_id IS NOT NULL)
  FROM public.analysis_requests ar
  JOIN public.profiles p ON p.id = ar.requested_by
  JOIN public.challenges c ON c.id = ar.challenge_id
  WHERE ar.status = 'pending' AND ar.discord_notified = FALSE
  ORDER BY ar.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Marcar análise notificada no Discord
CREATE OR REPLACE FUNCTION public.mark_analysis_discord_notified(p_analysis_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.analysis_requests SET
    discord_notified = TRUE,
    status = CASE WHEN status = 'pending' THEN 'discord'::analysis_status ELSE status END
  WHERE id = p_analysis_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS
ALTER TABLE public.admin_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver presença admin" ON public.admin_presence
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Admin atualiza própria presença" ON public.admin_presence
  FOR ALL USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Participantes e admin veem salas" ON public.chat_rooms
  FOR SELECT USING (
    public.is_admin() OR
    EXISTS (
      SELECT 1 FROM public.challenges c
      WHERE c.id = challenge_id
      AND auth.uid() IN (c.creator_id, c.acceptor_id)
    )
  );
CREATE POLICY "Admin atualiza salas" ON public.chat_rooms
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "Ver mensagens da sala" ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_rooms cr
      JOIN public.challenges c ON c.id = cr.challenge_id
      WHERE cr.id = room_id
      AND (public.is_admin() OR auth.uid() IN (c.creator_id, c.acceptor_id))
    )
  );
CREATE POLICY "Enviar mensagens" ON public.chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_rooms cr
      JOIN public.challenges c ON c.id = cr.challenge_id
      WHERE cr.id = room_id
      AND cr.status NOT IN ('closed')
      AND (
        public.is_admin() OR auth.uid() IN (c.creator_id, c.acceptor_id)
      )
    )
  );

CREATE POLICY "Ver análises" ON public.analysis_requests
  FOR SELECT USING (auth.uid() = requested_by OR public.is_admin());
CREATE POLICY "Criar análises via RPC" ON public.analysis_requests
  FOR INSERT WITH CHECK (auth.uid() = requested_by);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;

GRANT EXECUTE ON FUNCTION public.create_challenge_chat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_room_code(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_victory_in_chat(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_analysis_discord(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_join_chat(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_online(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_analyses_for_discord() TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_analysis_discord_notified(UUID) TO service_role;

-- Backup: criar chat automaticamente quando desafio recebe aceitador
CREATE OR REPLACE FUNCTION public.on_challenge_matched()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.acceptor_id IS NOT NULL AND OLD.acceptor_id IS NULL THEN
    PERFORM public.create_challenge_chat(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS challenge_matched_chat ON public.challenges;
CREATE TRIGGER challenge_matched_chat
  AFTER UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.on_challenge_matched();
