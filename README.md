# GoLiveBack

[Baixar versão portátil 1.17.3](https://github.com/victorcesarx/golive-back/releases/latest/download/GoLiveBack-Portable-1.17.3-x64.exe) · [Baixar instalador 1.17.3](https://github.com/victorcesarx/golive-back/releases/latest/download/GoLiveBack-Setup-1.17.3-x64.exe)

Aplicativo Windows independente que devolve o Go Live e a câmera no Discord Desktop criando uma rota externa apenas para os WebSockets de gateway. Não instala Vencord, não injeta JavaScript e não modifica os arquivos internos do Discord.

![Tela inicial do GoLiveBack](assets/readme/goliveback-home.png)

## Principais recursos

- Tor integrado: não exige uma instalação separada no computador.
- Detecção automática do Discord, Discord PTB e Discord Canary, com seleção manual de executável.
- Rota seletiva: somente os gateways necessários passam pela saída externa; áudio, vídeo, downloads e o restante da conexão continuam diretos.
- Validação de país, TLS e WebSocket antes de liberar a rota.
- Reinício seguro do Discord somente depois que a rota está saudável.
- Recuperação automática da saída sem trocar o endereço PAC usado pelo Discord.
- Proxy SOCKS5 personalizada analisada antes de substituir uma rota ativa.
- Inicialização com o Windows, operação pela bandeja e logs locais com dados sensíveis removidos.
- Verificação manual da release mais recente pelo GitHub.

## Como usar

1. Baixe o instalador ou a versão portátil no topo desta página.
2. Abra o GoLiveBack e confirme a distribuição do Discord detectada.
3. Clique em **Ativar GoLive** e aguarde a validação da saída.
4. Abra o Discord normalmente. Se ele já estiver aberto, clique em **Reiniciar Discord**.
5. Mantenha o GoLiveBack na bandeja enquanto desejar usar a rota.

Quando a rota estiver pronta, o botão principal mostra **GoLive ativo**. Clique nele novamente para desativá-la. Depois de desativar, reinicie o Discord para voltar à conexão direta.

## Configurações avançadas

- **Selecionar executável:** escolhe manualmente outra instalação compatível do Discord.
- **Usar proxy:** valida e aplica uma proxy SOCKS5 personalizada sem derrubar antecipadamente a rota atual.
- **Abrir log:** abre a pasta que contém `goliveback.log`.
- **Verificar atualização:** compara a versão instalada com a release mais recente, valida o manifesto Ed25519 e baixa o instalador ou portátil sem abrir o navegador.

A verificação de atualização não armazena tokens. A release precisa estar publicamente acessível para que os computadores dos usuários possam consultar e baixar seus assets sem credenciais.

## Como funciona

O GoLiveBack inicia um servidor PAC e um roteador SOCKS5 somente em `127.0.0.1`. O Discord é reiniciado com `--proxy-pac-url`, e o PAC encaminha exclusivamente:

- `gateway.discord.gg:443`
- `remote-auth-gateway.discord.gg:443`

Todo o restante usa `DIRECT`, incluindo áudio, vídeo, downloads, imagens e anexos. O roteador rejeita hosts e portas fora dessa lista.

O pacote inclui o Tor Expert Bundle oficial. Se já houver uma instância Tor compatível nas portas conhecidas, ela pode ser utilizada. Caso contrário, o aplicativo inicia um daemon privado em uma porta aleatória e o encerra ao sair.

A saída só é aceita depois de:

- handshake TLS com certificado válido;
- identificação segura do país e do IP de saída;
- rejeição de saídas localizadas no Brasil;
- confirmação do handshake WebSocket do gateway do Discord pela mesma proxy.

## Proxy manual

```text
socks5://servidor:1080
socks5://usuario:senha@servidor:1080
```

Credenciais ficam somente em memória, não são salvas nas preferências e são removidas dos logs. O método de usuário e senha do SOCKS5 não possui criptografia própria até o servidor da proxy; prefira uma proxy local ou conectada por túnel protegido. O conteúdo do Discord continua protegido por TLS. Consulte a [RFC 1929](https://www.rfc-editor.org/rfc/rfc1929).

## Segurança e limitações

- O GoLiveBack não é afiliado ao Discord nem ao Tor Project.
- O aplicativo não torna todo o Discord anônimo; apenas os gateways selecionados usam a rota externa.
- A interface possui isolamento de contexto, sandbox, CSP restritiva e uma lista explícita de recursos locais permitidos.
- Navegação inesperada, novas janelas, webviews, downloads e permissões web são bloqueados.
- Executáveis selecionados manualmente são inspecionados antes de serem aceitos.
- Fechar a janela mantém o aplicativo na bandeja; o item **Sair** encerra a rota e o Tor integrado.
- Esta release ainda não possui assinatura digital e pode acionar o Windows SmartScreen.
- Modificar a região aparente ou contornar restrições pode contrariar os termos da plataforma.

## Desenvolvimento

Requisitos: Node.js 24 e pnpm 10.

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm dev
pnpm package:win
```

As verificações automatizadas cobrem roteamento, PAC, Tor, Discord, preferências, encerramento coordenado, segurança da interface e consulta de atualizações. A esteira de release oficial exige assinatura Authenticode válida antes da publicação.

A organização do projeto separa cada responsabilidade:

- `src/`: processo principal e regras de negócio da aplicação;
- `public/`: interface e preload carregados pelo Electron;
- `tests/unit/`: testes unitários TypeScript, espelhando os módulos de `src/`;
- `tests/smoke/`: verificações de integração da interface em execução;
- `scripts/`: automações de desenvolvimento, segurança, build e release;
- `assets/` e `vendor/`: recursos próprios e dependências binárias distribuídas.

O comando `pnpm test` compila a aplicação em `dist/`, compila os testes separadamente em `.tmp/test-dist/` e executa apenas essa suíte temporária. `pnpm dev` recompila e reinicia o Electron quando `src/` muda, mantendo o recarregamento da interface em `public/`.

### Releases pessoais e atualizações

A confiança das atualizações é independente do Authenticode. O aplicativo contém apenas a chave pública Ed25519 de `assets/update-public.pem`; a chave privada fica fora do repositório em `%USERPROFILE%\.goliveback-signing\update-private.pem`.

Para criar uma release pessoal:

```powershell
pnpm release:personal
```

O comando executa as verificações de segurança, gera instalador e portátil, cria `release-manifest.json`, assina-o como `release-manifest.sig` e verifica novamente todos os hashes. Publique todos os arquivos de `release/personal/` como assets de uma release pública cuja tag corresponda à versão do `package.json` — por exemplo, `v1.18.0`.

Faça backup privado da pasta `%USERPROFILE%\.goliveback-signing`. Nunca publique `update-private.pem`: quem possuir essa chave poderá produzir atualizações aceitas pelo aplicativo. Se a chave for perdida, versões já distribuídas não confiarão automaticamente em uma chave substituta.

No instalador NSIS, uma atualização validada pode ser iniciada diretamente pelo aplicativo. Na versão portátil, o novo executável é baixado e mostrado na pasta para substituição manual após o fechamento, evitando modificar um processo que ainda está em execução.

Para testar o fluxo completo contra a release pública sem alterar a versão real do projeto, execute:

```powershell
pnpm test:update-flow
```

O comando cria em `.tmp/update-flow/` uma build empacotada com o mesmo código atual, mas simulando a versão patch anterior e usando um perfil isolado da instalação normal. Use **Verificar atualizações** nessa janela: a disponibilidade, o progresso do download e a validação aparecem na área de saída do próprio aplicativo; ao final, o botão muda para **Instalar**. O diretório é temporário, ignorado pelo Git e recriado a cada teste.

## Componentes de terceiros

Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A distribuição inclui os avisos do Tor Expert Bundle em `vendor/tor/docs/`.
