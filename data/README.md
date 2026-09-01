- `bdrs-seed.json`: dados de coordenadores/BDRs usados pelo `npm run seed`
  para popular o banco. **Marcado como rascunho** (veja o campo `_rascunho`
  no próprio arquivo) — substitua quando a lista for oficial e rode
  `npm run seed` de novo.
- `roleta.db`: banco SQLite gerado em runtime (coordenadores, BDRs, estado
  da roleta e histórico de leads). Não é versionado no git — é recriado /
  populado automaticamente na primeira execução do servidor.

Para "resetar a roleta" (voltar pro primeiro coordenador/BDR), apague as
linhas da tabela `round_robin_state` no `roleta.db`, ou simplesmente apague
o arquivo `roleta.db` inteiro (ele é recriado e populado de novo a partir do
`bdrs-seed.json` — mas isso também apaga o histórico de leads).
