O arquivo `round-robin-state.json` é criado automaticamente na primeira
execução (`{ "lastIndex": -1 }`) e atualizado a cada lead distribuído. Ele
não é versionado no git (veja `.gitignore`) porque representa estado de
runtime, não configuração.

Para "resetar a roleta" (fazer o Time A ser o próximo novamente), basta
apagar o arquivo ou editá-lo manualmente para `{ "lastIndex": -1 }`.
