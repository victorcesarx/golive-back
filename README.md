# GoLiveBack

Aplicativo Windows independente que devolve o Go Live e a câmera no Discord criando uma rota externa apenas para os WebSockets de gateway. Não instala Vencord, não injeta JavaScript e não modifica arquivos do Discord.

## Como usar

1. Abra `GoLiveBack-<versão>.exe`.
2. O GoLiveBack detectará automaticamente Discord Stable, PTB ou Canary. Se necessário, abra **Configurações avançadas** e use **Selecionar executável** para escolher outra distribuição.
3. Clique em **Ativar GoLive** e aguarde o Tor chegar a 100% e a saída ser validada.
4. Abra o Discord normalmente, fora do GoLiveBack.
5. Clique em **Reiniciar Discord** para que a instância aberta seja reiniciada usando a rota.

Quando a rota estiver pronta, o botão principal mostra **GoLive ativo**. Clique nele novamente para desativar a rota.

Para preparar a rota automaticamente, marque **Ativar GoLive com o Windows** e mantenha o executável no mesmo caminho. O GoLiveBack não abre o Discord automaticamente.

## Funcionamento

O aplicativo inicia um servidor PAC e um roteador SOCKS5 somente em `127.0.0.1`. O Discord é aberto com `--proxy-pac-url` e o PAC encaminha exclusivamente:

- `gateway.discord.gg:443`
- `remote-auth-gateway.discord.gg:443`

Todo o restante usa `DIRECT`, incluindo áudio, vídeo, downloads, imagens e anexos. O roteador rejeita qualquer host ou porta fora da lista.

## Tor integrado

O pacote inclui o Tor Expert Bundle oficial. Se já houver Tor nas portas conhecidas, ele será usado. Caso contrário, o aplicativo inicia um daemon privado numa porta aleatória e o encerra ao sair.

A saída só é aceita depois de:

- handshake TLS com certificado válido;
- identificação do país/saída pela Cloudflare;
- rejeição de saída `BR`;
- confirmação de resposta do gateway do Discord pela mesma proxy.

Após duas falhas consecutivas, o daemon é reiniciado e a saída é trocada sem alterar o PAC local usado pelo Discord.

## Proxy manual

Também é possível usar:

```text
socks5://servidor:1080
socks5://usuario:senha@servidor:1080
```

Credenciais ficam somente em memória e são removidas dos logs. Elas não são salvas nas preferências.

## Diagnóstico

O botão **Abrir log** abre a pasta de dados do aplicativo no Explorador de Arquivos. O registro `goliveback.log` descreve em linguagem direta as mudanças de estado, o Tor, a rota e o Discord, preservando detalhes técnicos úteis; ele é rotacionado automaticamente.

## Segurança e limitações

- O GoLiveBack não é afiliado ao Discord nem ao Tor Project.
- O aplicativo não torna todo o Discord anônimo: apenas os gateways selecionados usam a saída externa.
- Modificar a região aparente ou contornar restrições pode contrariar termos da plataforma.
- O executável ainda não possui assinatura de código e pode acionar o SmartScreen.
- O Discord precisa ser reiniciado pelo botão **Reiniciar Discord** depois que a rota estiver pronta; abrir o cliente sem esse reinício não aplica o PAC.
- Fechar o GoLiveBack pelo item **Sair** da bandeja encerra o roteador e o Tor integrado.

## Desenvolvimento

Requisitos: Node.js 22+ e pnpm.

```powershell
pnpm install
pnpm test
pnpm start
pnpm package:win
```

## Componentes de terceiros

Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A distribuição inclui os avisos do Tor Expert Bundle em `vendor/tor/docs/`.
