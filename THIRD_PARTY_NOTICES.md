# Componentes de terceiros

## Tor Expert Bundle

O GoLiveBack redistribui componentes do Tor Expert Bundle para Windows x86-64.

- Bundle: `15.0.20`
- Tor: `0.4.9.11`
- Origem: <https://www.torproject.org/download/tor/>
- Arquivo fixado e hash: `vendor/tor/BUNDLE-MANIFEST.json`
- Avisos e licença no pacote: `resources/third-party-licenses/tor/tor.txt`

Tor é software livre e pode ser redistribuído sob os termos descritos em sua licença. Este aplicativo é independente e não é produzido, endossado ou afiliado ao Tor Project.

O executável do Tor inclui componentes cujos avisos referentes a OpenSSL, libevent e zlib são distribuídos em `resources/third-party-licenses/tor/`. Os transportes conectáveis lyrebird e conjure e a ferramenta `tor-gencert` permanecem apenas no bundle-fonte verificado e não são incluídos no aplicativo final.
