# Orbit UI — Design System inspirado no Discord

> Versão 1.0 — 23 de agosto de 2026  
> Um sistema visual para aplicações sociais, chats, dashboards e ferramentas desktop com alta densidade de informação.

## Sumário

1. [Objetivo](#1-objetivo)
2. [Referência e limites de uso](#2-referência-e-limites-de-uso)
3. [Análise da interface do Discord](#3-análise-da-interface-do-discord)
4. [Princípios do sistema](#4-princípios-do-sistema)
5. [Arquitetura da interface](#5-arquitetura-da-interface)
6. [Cores](#6-cores)
7. [Tipografia](#7-tipografia)
8. [Espaçamento e densidade](#8-espaçamento-e-densidade)
9. [Formas, bordas e elevação](#9-formas-bordas-e-elevação)
10. [Iconografia](#10-iconografia)
11. [Componentes](#11-componentes)
12. [Estados e feedback](#12-estados-e-feedback)
13. [Movimento](#13-movimento)
14. [Responsividade](#14-responsividade)
15. [Acessibilidade](#15-acessibilidade)
16. [Tokens CSS](#16-tokens-css)
17. [Checklist de implementação](#17-checklist-de-implementação)

---

## 1. Objetivo

O **Orbit UI** traduz os principais acertos da experiência do Discord em regras reutilizáveis, sem reproduzir sua identidade visual. Ele foi pensado para produtos que permanecem abertos por muito tempo e precisam exibir grande quantidade de informações sem cansar o usuário.

O sistema prioriza:

- hierarquia por superfícies;
- navegação persistente;
- alta densidade controlada;
- feedback imediato;
- personalização de tema e densidade;
- componentes contextuais;
- clareza em aplicações com múltiplos painéis.

## 2. Referência e limites de uso

O Discord utiliza oficialmente o **Blurple `#5865F2`** e a fonte proprietária **gg sans**. A gg sans não é open source e não está disponível para uso em projetos externos.

As diretrizes da marca também restringem a imitação da aparência, das combinações de cores, dos elementos gráficos e da tipografia característica do produto. Por isso, este documento utiliza uma paleta e uma família tipográfica próprias.

Referências:

- [Discord Brand Assets](https://discord.com/branding)
- [gg sans — Font Update FAQ](https://support.discord.com/hc/en-us/articles/9507780972951-gg-sans-Font-Update-FAQ)
- [Desktop Visual Refresh](https://discord.com/blog/player-release-q12025)
- [Squircles, Styles and Spacing](https://discord.com/blog/improving-mobile-with-squircles-styles-and-spacing)

## 3. Análise da interface do Discord

### 3.1 Hierarquia visual

O Discord raramente depende de bordas fortes. A hierarquia é formada por superfícies com pequenas diferenças de luminosidade:

- a barra global ocupa o nível mais profundo;
- a navegação usa uma superfície intermediária;
- o conteúdo principal recebe mais luminosidade;
- inputs, menus e popovers ficam visualmente elevados;
- seleção e hover aparecem como mudanças locais de fundo.

Isso reduz ruído visual e permite separar áreas sem transformar cada seção em um card.

### 3.2 Navegação por contexto

A interface apresenta uma progressão da esquerda para a direita:

1. seleção do espaço ou contexto global;
2. navegação interna desse espaço;
3. conteúdo principal;
4. informações complementares.

Cada coluna responde a uma pergunta diferente: **onde estou**, **o que existe aqui**, **o que está acontecendo** e **quem ou o que está relacionado**.

### 3.3 Densidade

O produto equilibra listas compactas com áreas clicáveis adequadas. Desde a atualização de 2025, o Discord oferece três densidades: compacta, padrão e espaçosa. O princípio deve ser aplicado alterando alturas e espaçamentos, não reduzindo excessivamente a fonte.

### 3.4 Linguagem de formas

Uma regra do sistema atual do Discord é:

- pessoas são representadas por círculos;
- servidores, aplicativos e objetos usam squircles.

Essa diferenciação permite reconhecer o tipo de entidade antes mesmo de ler seu nome.

### 3.5 Cor e estado

A maior parte da interface é neutra. Cores saturadas são reservadas para:

- ações principais;
- seleção;
- presença e disponibilidade;
- alertas;
- transmissão, câmera ou microfone;
- notificações.

## 4. Princípios do sistema

### 4.1 Conteúdo em primeiro lugar

Contêineres devem organizar informações sem competir com elas. Evite cards aninhados e separadores excessivos.

### 4.2 Profundidade por superfícies

Use diferenças sutis de fundo como mecanismo principal de elevação. Sombras ficam reservadas para elementos flutuantes.

### 4.3 Cor com significado

A cor primária identifica ação e seleção. Verde, amarelo, vermelho e azul comunicam estados específicos e consistentes.

### 4.4 Reconhecimento pela forma

Use círculos para pessoas e squircles para grupos, espaços, arquivos, ferramentas e aplicações.

### 4.5 Densidade ajustável

Ofereça modos compacto, padrão e confortável quando o produto contiver listas extensas ou for usado por longos períodos.

### 4.6 Ações contextuais

Ações secundárias podem aparecer no hover ou foco, mas ações essenciais precisam permanecer descobríveis por teclado e toque.

## 5. Arquitetura da interface

| Região | Função | Largura sugerida |
|---|---|---:|
| Barra global | Troca de espaços ou contextos | 64–72 px |
| Navegação | Canais, páginas ou categorias | 224–320 px, redimensionável |
| Cabeçalho | Contexto atual e ações globais | 48–56 px de altura |
| Conteúdo | Conversas, resultados ou atividade | Flexível |
| Painel auxiliar | Membros, propriedades ou detalhes | 240–320 px |
| Painel do usuário | Perfil e controles rápidos | Alinhado à navegação |

### Regras

- O conteúdo deve receber a maior largura disponível.
- A navegação secundária pode ser redimensionável.
- O painel auxiliar deve poder ser recolhido.
- Em telas estreitas, painéis laterais tornam-se drawers.
- O cabeçalho deve permanecer visível durante a rolagem.
- Elementos globais não devem mudar de posição ao trocar o contexto.

## 6. Cores

### 6.1 Paleta primária

O Orbit UI utiliza um índigo frio próprio, diferente do Blurple do Discord.

| Token | Valor | Uso |
|---|---:|---|
| `primary-50` | `#EEF0FF` | Fundo selecionado claro |
| `primary-100` | `#DCE0FF` | Badge suave |
| `primary-200` | `#C1C7FF` | Bordas e decoração |
| `primary-300` | `#9DA8FF` | Ícones e detalhes |
| `primary-400` | `#7F8CF5` | Destaque secundário |
| `primary-500` | `#6673E8` | Ação principal |
| `primary-600` | `#5662D4` | Hover |
| `primary-700` | `#4651B9` | Pressionado |
| `primary-800` | `#394395` | Fundo forte |
| `primary-900` | `#303873` | Texto sobre fundo claro |

### 6.2 Tema escuro

| Token semântico | Valor | Uso |
|---|---:|---|
| `bg-canvas` | `#17181C` | Fundo mais profundo |
| `bg-sidebar` | `#1C1E23` | Navegação global |
| `bg-navigation` | `#22242A` | Canais e menus |
| `bg-content` | `#282A31` | Conteúdo principal |
| `bg-elevated` | `#30333B` | Inputs, popovers e cards |
| `bg-hover` | `#383B44` | Hover |
| `bg-selected` | `#414550` | Item selecionado |
| `border-subtle` | `#353841` | Separadores discretos |
| `border-strong` | `#4A4E59` | Controles e foco neutro |
| `text-primary` | `#F2F3F5` | Títulos e texto importante |
| `text-secondary` | `#B7BBC5` | Corpo secundário |
| `text-muted` | `#858A96` | Metadados |
| `text-disabled` | `#616671` | Estado desabilitado |

### 6.3 Tema claro

| Token semântico | Valor | Uso |
|---|---:|---|
| `bg-canvas` | `#E8EAF0` | Fundo exterior |
| `bg-sidebar` | `#F0F1F5` | Navegação global |
| `bg-navigation` | `#F6F7F9` | Canais e menus |
| `bg-content` | `#FFFFFF` | Conteúdo principal |
| `bg-elevated` | `#FFFFFF` | Popovers e cards |
| `bg-hover` | `#ECEEF3` | Hover |
| `bg-selected` | `#E2E5EC` | Item selecionado |
| `border-subtle` | `#E0E3E9` | Separadores |
| `border-strong` | `#C8CCD5` | Controles |
| `text-primary` | `#202228` | Títulos e texto importante |
| `text-secondary` | `#50545E` | Corpo secundário |
| `text-muted` | `#777C87` | Metadados |
| `text-disabled` | `#A7ABB4` | Estado desabilitado |

### 6.4 Estados

| Estado | Cor base | Fundo suave |
|---|---:|---:|
| Sucesso / online | `#35C987` | `rgba(53,201,135,.14)` |
| Aviso / ausente | `#F0B84B` | `rgba(240,184,75,.14)` |
| Erro / perigo | `#E85A68` | `rgba(232,90,104,.14)` |
| Informação | `#4DA3FF` | `rgba(77,163,255,.14)` |
| Streaming / especial | `#A970FF` | `rgba(169,112,255,.14)` |

Nunca use apenas cor para representar um estado. Combine-a com rótulo, ícone, forma ou texto de apoio.

## 7. Tipografia

### 7.1 Famílias

```css
font-family: Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
```

- **Inter:** interface, listas, chat, formulários e conteúdo.
- **Manrope:** alternativa opcional para títulos promocionais.
- **JetBrains Mono:** código, IDs, URLs e informações técnicas.

### 7.2 Escala tipográfica

| Estilo | Tamanho | Peso | Altura de linha | Uso |
|---|---:|---:|---:|---|
| Display | 32 px | 700 | 40 px | Onboarding e estados vazios |
| Título de página | 24 px | 700 | 32 px | Páginas principais |
| Título de seção | 18 px | 650 | 24 px | Seções e modais |
| Título de componente | 16 px | 600 | 22 px | Cards e listas |
| Corpo | 15 px | 400 | 22 px | Texto principal e chat |
| Corpo compacto | 14 px | 400 | 20 px | Navegação e tabelas |
| Label | 13 px | 600 | 18 px | Campos e botões |
| Metadado | 12 px | 500 | 16 px | Datas, contagens e status |
| Microtexto | 11 px | 600 | 14 px | Badges e informações auxiliares |

### Regras

- Não use fonte menor que `12 px` para informações necessárias.
- Títulos utilizam `600–700`; corpo utiliza `400–500`.
- Evite caixa alta em textos longos.
- Labels em caixa alta devem ter `letter-spacing: .02em`.
- Para chat, prefira `15–16 px`.

## 8. Espaçamento e densidade

O sistema utiliza uma grade base de `4 px`.

```css
--space-0: 0;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

### Modos de densidade

| Densidade | Altura de item | Padding horizontal | Gap comum |
|---|---:|---:|---:|
| Compacta | 32 px | 8 px | 4–8 px |
| Padrão | 40 px | 12 px | 8–12 px |
| Confortável | 48 px | 16 px | 12–16 px |

A densidade deve alterar principalmente alturas, gaps e paddings. O tamanho da fonte pode variar no máximo `1 px`.

## 9. Formas, bordas e elevação

### 9.1 Raios

```css
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-pill: 999px;
```

| Elemento | Forma recomendada |
|---|---|
| Avatar de pessoa | Círculo |
| Grupo, espaço ou aplicação | Squircle de 12–16 px |
| Input | 8 px |
| Botão | 6–8 px |
| Card | 8–12 px |
| Modal e popover | 12 px |
| Badge | Pill |

### 9.2 Bordas

- Use `1 px` para separadores e controles.
- Evite bordas em todos os contêineres simultaneamente.
- Prefira contraste entre superfícies para grandes regiões.
- O foco deve usar outline externo de `2 px`.

### 9.3 Sombras

```css
--shadow-popover: 0 12px 32px rgb(0 0 0 / 32%);
--shadow-modal: 0 24px 64px rgb(0 0 0 / 42%);
--shadow-toolbar: 0 4px 16px rgb(0 0 0 / 24%);
```

Sombras são reservadas para menus, tooltips, modais e toolbars flutuantes.

## 10. Iconografia

- Estilo linear com espessura entre `1.75` e `2 px`.
- Tamanhos padrão: `16`, `20` e `24 px`.
- Ícones dentro de botões devem possuir área clicável mínima de `32 × 32 px`.
- Use ícone preenchido apenas para seleção ou estado ativo.
- Não misture várias famílias de ícones.
- Sugestões: Lucide, Phosphor ou ícones próprios baseados em uma grade de `24 px`.

## 11. Componentes

### 11.1 Botões

#### Primário

- Fundo: `primary-500`.
- Hover: `primary-600`.
- Pressionado: `primary-700`.
- Texto: branco.
- Uso: uma ação principal por contexto.

#### Secundário

- Fundo: `bg-elevated`.
- Texto: `text-primary`.
- Hover: `bg-hover`.

#### Ghost

- Fundo transparente.
- Hover com `bg-hover`.
- Indicado para toolbars e ações secundárias.

#### Perigo

- Use fundo vermelho apenas para confirmação ou ação destrutiva explícita.
- Antes da confirmação, prefira botão ghost com texto vermelho.

#### Tamanhos

| Tamanho | Altura | Padding horizontal |
|---|---:|---:|
| Pequeno | 32 px | 12 px |
| Médio | 40 px | 16 px |
| Grande | 48 px | 20 px |

### 11.2 Navegação

O item selecionado combina:

- fundo `bg-selected`;
- texto primário;
- ícone mais claro;
- indicador lateral opcional de `3 px`.

Notificações devem usar badge ou indicador localizado, sem colorir todo o item.

### 11.3 Campos de texto

- Fundo mais elevado que a superfície ao redor.
- Borda neutra discreta ou ausente em repouso.
- Placeholder em `text-muted`.
- Foco com outline de `2 px`.
- Erro com texto explicativo, não somente borda vermelha.
- Ações secundárias agrupadas na extremidade direita.

### 11.4 Mensagens e feeds

- Avatar padrão de `40 px`.
- Nome, horário e conteúdo seguem uma única estrutura.
- Ações rápidas aparecem no hover ou foco.
- O hover pode alterar o fundo da linha inteira.
- Mensagens consecutivas do mesmo autor devem ser agrupadas.
- Links, menções e anexos precisam ser visualmente distinguíveis.

### 11.5 Cards

Cards só devem ser usados quando houver um objeto independente ou agrupamento real. Evite colocar todas as seções em cards.

- Padding: `12–16 px`.
- Raio: `8–12 px`.
- Fundo: uma etapa acima da superfície pai.
- Borda opcional e discreta.

### 11.6 Menus e popovers

- Largura mínima: `180 px`.
- Padding externo: `6–8 px`.
- Item: `32–40 px` de altura.
- Ações destrutivas separadas visualmente.
- Fechar com `Escape` e clique externo.
- Restaurar o foco ao elemento de origem.

### 11.7 Modais

- Largura comum: `480–560 px`.
- Overlay preto entre 55% e 70%.
- Raio: `12 px`.
- Cabeçalho, corpo e rodapé claramente organizados.
- Confirmação destrutiva exige linguagem explícita.

### 11.8 Tooltips

- Exibir somente informação curta.
- Não esconder instruções essenciais exclusivamente em tooltip.
- Delay de entrada entre `300–500 ms`.
- Deve funcionar com hover e foco de teclado.

### 11.9 Badges e indicadores

- Badge numérico: formato pill.
- Presença: ponto de `8–10 px`, acompanhado por texto quando necessário.
- Status complexo: ícone + rótulo.
- Contagens acima do limite podem ser resumidas como `99+`.

## 12. Estados e feedback

Todo componente interativo deve prever:

1. repouso;
2. hover;
3. foco visível;
4. pressionado;
5. selecionado;
6. desabilitado;
7. carregando;
8. sucesso;
9. erro.

### Carregamento

- Use skeletons quando a estrutura já for conhecida.
- Use spinner para ações curtas e localizadas.
- Para tarefas longas, mostre progresso e possibilidade de cancelamento.
- Evite deslocamento de layout durante o carregamento.

### Estado vazio

Um bom estado vazio contém:

- título claro;
- explicação curta;
- ação principal quando aplicável;
- ilustração opcional e discreta.

### Erro

- Explique o que aconteceu.
- Informe se os dados foram preservados.
- Ofereça uma ação de recuperação.
- Não dependa apenas de códigos técnicos.

## 13. Movimento

```css
--duration-instant: 60ms;
--duration-fast: 100ms;
--duration-normal: 160ms;
--duration-slow: 240ms;

--ease-standard: cubic-bezier(.2, 0, 0, 1);
--ease-emphasized: cubic-bezier(.2, .8, .2, 1);
```

| Interação | Duração |
|---|---:|
| Hover e pressionado | 60–100 ms |
| Tooltip | 120–160 ms |
| Menu ou popover | 120–180 ms |
| Painel lateral | 200–240 ms |
| Modal | 160–220 ms |

### Regras

- Modal pode entrar de `scale(.98)` para `scale(1)`.
- Painéis deslizam na direção de sua origem.
- Não anime grandes áreas sem necessidade funcional.
- Respeite `prefers-reduced-motion`.

## 14. Responsividade

| Faixa | Comportamento |
|---|---|
| `≥ 1280 px` | Todas as colunas disponíveis |
| `1024–1279 px` | Painel auxiliar recolhível |
| `768–1023 px` | Navegação em drawer; barra global compacta |
| `< 768 px` | Uma região principal por vez; navegação inferior ou drawer |

### Prioridade de remoção

1. recolher painel auxiliar;
2. reduzir largura da navegação;
3. transformar navegação em drawer;
4. mover ações secundárias para menu;
5. preservar conteúdo e ação principal.

## 15. Acessibilidade

- Contraste mínimo de `4.5:1` para texto comum.
- Contraste mínimo de `3:1` para texto grande e componentes gráficos.
- Foco sempre visível.
- Área de toque ideal de `44 × 44 px`; mínimo de `32 × 32 px` no desktop.
- Navegação completa por teclado.
- Ordem de foco deve acompanhar a ordem visual.
- Ícones isolados precisam de nome acessível.
- Não comunicar significado somente por cor.
- Zoom de 200% não deve impedir operações essenciais.
- Animações devem respeitar preferências do sistema.
- Mudanças assíncronas importantes devem ser anunciadas por tecnologia assistiva.

## 16. Tokens CSS

```css
:root {
  color-scheme: dark;

  --color-primary-50: #eef0ff;
  --color-primary-100: #dce0ff;
  --color-primary-300: #9da8ff;
  --color-primary-500: #6673e8;
  --color-primary-600: #5662d4;
  --color-primary-700: #4651b9;

  --color-bg-canvas: #17181c;
  --color-bg-sidebar: #1c1e23;
  --color-bg-navigation: #22242a;
  --color-bg-content: #282a31;
  --color-bg-elevated: #30333b;
  --color-bg-hover: #383b44;
  --color-bg-selected: #414550;

  --color-border-subtle: #353841;
  --color-border-strong: #4a4e59;

  --color-text-primary: #f2f3f5;
  --color-text-secondary: #b7bbc5;
  --color-text-muted: #858a96;
  --color-text-disabled: #616671;

  --color-success: #35c987;
  --color-warning: #f0b84b;
  --color-danger: #e85a68;
  --color-info: #4da3ff;
  --color-special: #a970ff;

  --font-ui: Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-display: Manrope, Inter, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", monospace;

  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 14px;
  --text-body: 15px;
  --text-lg: 16px;
  --text-xl: 18px;
  --text-2xl: 24px;
  --text-3xl: 32px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 999px;

  --shadow-popover: 0 12px 32px rgb(0 0 0 / 32%);
  --shadow-modal: 0 24px 64px rgb(0 0 0 / 42%);
  --focus-ring: 0 0 0 3px rgb(102 115 232 / 30%);

  --duration-fast: 100ms;
  --duration-normal: 160ms;
  --duration-slow: 240ms;
  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(.2, .8, .2, 1);
}

[data-theme="light"] {
  color-scheme: light;

  --color-bg-canvas: #e8eaf0;
  --color-bg-sidebar: #f0f1f5;
  --color-bg-navigation: #f6f7f9;
  --color-bg-content: #ffffff;
  --color-bg-elevated: #ffffff;
  --color-bg-hover: #eceef3;
  --color-bg-selected: #e2e5ec;

  --color-border-subtle: #e0e3e9;
  --color-border-strong: #c8ccd5;

  --color-text-primary: #202228;
  --color-text-secondary: #50545e;
  --color-text-muted: #777c87;
  --color-text-disabled: #a7abb4;
}

:focus-visible {
  outline: 2px solid var(--color-primary-300);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 17. Checklist de implementação

### Fundação

- [ ] Implementar tokens primitivos e semânticos.
- [ ] Criar temas claro e escuro.
- [ ] Adicionar as três densidades.
- [ ] Configurar tipografia e iconografia.
- [ ] Definir foco global e movimento reduzido.

### Componentes

- [ ] Botões e botões de ícone.
- [ ] Inputs, textarea, select e checkbox.
- [ ] Navegação, tabs e breadcrumbs.
- [ ] Avatar, squircle, badge e status.
- [ ] Tooltip, menu, popover e modal.
- [ ] Toast, alerta e progresso.
- [ ] Lista, mensagem e estado vazio.

### Qualidade

- [ ] Validar contraste nos dois temas.
- [ ] Testar somente com teclado.
- [ ] Testar zoom em 200%.
- [ ] Testar densidades sem quebra de layout.
- [ ] Testar painéis nos breakpoints principais.
- [ ] Documentar todos os estados dos componentes.
- [ ] Evitar valores visuais fora dos tokens.

---

## Resumo

O Orbit UI não depende de uma cor ou de um componente isolado. Sua identidade nasce da combinação entre superfícies discretas, navegação persistente, densidade configurável, formas semânticas, estados claros e ações contextuais. O resultado é uma base apropriada para aplicações complexas que precisam continuar legíveis, confortáveis e rápidas durante longos períodos de uso.
