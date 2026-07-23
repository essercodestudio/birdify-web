-- Perfil do jogador: foto, bio, redes sociais e motivação.
-- Todas as colunas são opcionais (NULL) — zero impacto em usuários existentes.
-- Rodar antes de subir a versão com o modal "Meu Perfil".

ALTER TABLE users
  ADD COLUMN profile_photo_url VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN bio               VARCHAR(150) NULL DEFAULT NULL,
  ADD COLUMN instagram_handle  VARCHAR(60)  NULL DEFAULT NULL,
  ADD COLUMN whatsapp_number   VARCHAR(20)  NULL DEFAULT NULL,
  ADD COLUMN golf_motivation   VARCHAR(280) NULL DEFAULT NULL;
