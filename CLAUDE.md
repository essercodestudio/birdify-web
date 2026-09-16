# Birdify — instruções para Claude Code

Sistema de gestão de golfe multi-clubes (SaaS). Node/Express + MySQL (`golf_db`) no backend, React no frontend, deploy manual numa VPS Hostinger.

## Memória entre sessões

Este projeto usa a memória persistente do Claude Code (pasta `memory/` dentro de
`~/.claude/projects/<slug-do-caminho-do-projeto>/`, fora do repositório). Ela guarda
decisões de produto, gotchas operacionais, TODOs abertos e preferências de trabalho
acumuladas ao longo de várias sessões — **releia o `MEMORY.md` dessa pasta e os
arquivos `project_*.md` / `feedback_*.md` relevantes no início de qualquer sessão
nova antes de propor mudanças**, em vez de redescobrir contexto do zero.

**Aviso importante:** essa pasta é indexada pelo caminho absoluto do projeto no
disco (um "slug"), não por um ID de projeto estável. Se você abrir este repo a
partir de um caminho diferente do de sessões anteriores (outra máquina, outro
usuário do SO, ou um path com convenção diferente, ex. `C:/Users/...` vs
`/Users/...`), a pasta `memory/` desta sessão pode aparecer vazia mesmo que
exista conteúdo relevante gravado sob outro slug. Nesse caso:

1. Rode `find ~/.claude/projects -maxdepth 1 -type d` e procure variantes do
   nome deste projeto (`golf-scorer`) com slugs diferentes.
2. Se achar uma pasta `memory/` com mais conteúdo, copie os `.md` para a pasta
   do slug ativo antes de assumir que não há histórico.

Detalhes desse incidente (já ocorreu uma vez, 2026-09-15) estão em
`reference_memoria_por_maquina.md` dentro da própria pasta de memória.

## Regras que a memória já documenta (resumo rápido)

- Comunicação sempre em português (pt-BR).
- JWT é o único mecanismo de auth — não introduzir outro.
- Multi-tenant: toda query nova filtra por `req.club.id`.
- Toda mudança de schema atualiza `backend/docs/SCHEMA.sql` no mesmo commit da migration.
- Produção é operada pelo usuário — Claude nunca roda comando destrutivo direto em prod; ele digita.
- Features grandes entram em "ondas" pequenas, validadas em produção entre elas.

Para o racional completo de cada regra e o estado atual do projeto, ver a
pasta de memória — não duplicar esse conteúdo aqui.
