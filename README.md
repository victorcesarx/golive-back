# GoLiveBack

[Baixar versão portátil 1.16.0](https://github.com/victorcesarx/golive-back/releases/latest/download/GoLiveBack-Portable-1.16.0-x64.exe) · [Baixar instalador 1.16.0](https://github.com/victorcesarx/golive-back/releases/latest/download/GoLiveBack-Setup-1.16.0-x64.exe)

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
- **Verificar atualização:** compara a versão instalada com a release mais recente do GitHub. Se existir uma versão nova, abre a página da release no navegador.

A verificação de atualização não armazena tokens. Enquanto o repositório estiver privado, o GitHub pode impedir consultas não autenticadas; nesse caso, o motivo aparece no diagnóstico do aplicativo.

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
pnpm start
pnpm package:win
```

As verificações automatizadas cobrem roteamento, PAC, Tor, Discord, preferências, encerramento coordenado, segurança da interface e consulta de atualizações. A esteira de release oficial exige assinatura Authenticode válida antes da publicação.

## Componentes de terceiros

Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A distribuição inclui os avisos do Tor Expert Bundle em `vendor/tor/docs/`.
