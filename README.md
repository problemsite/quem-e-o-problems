# Quem é o Problems verdadeiro?

Jogo multiplayer para GitHub Pages + Firebase Realtime Database.

- Jogo: `index.html`
- Painel ADM: `ADM/` (ex.: `https://problemsite.github.io/NOME-DO-REPO/ADM/` — no GitHub Pages o nome da pasta diferencia maiúsculas)

## 1. Firebase

1. Crie um projeto em https://console.firebase.google.com
2. Em **Build > Realtime Database**, crie o banco (pode começar no modo bloqueado).
3. Na aba **Regras**, cole:

```json
{
  "rules": {
    "quem-e-o-problems": { ".read": true, ".write": true }
  }
}
```

4. A configuração do app Web já está em `js/firebase-config.js` (projeto `quem-e-o-problems`).

## 2. GitHub Pages

Suba todos os arquivos na raiz do repositório e ative **Settings > Pages > Deploy from a branch** (`main`, pasta `/root`).

## Como funciona

- Quem entrar com o nome "Problems" (qualquer combinação de maiúsculas) vira o Problems verdadeiro. Ninguém vê isso durante o jogo; só aparece na revelação. No ADM dá para escolher outra pessoa ou voltar ao automático.
- Cada rodada é um formulário criado no ADM (várias perguntas). Cada pergunta pode ser de texto, de alternativas (A, B, C, D) ou de foto (o jogador responde enviando uma foto), e qualquer pergunta pode ter uma foto junto. Os formulários entram na ordem da lista; formulário sem pergunta é pulado.
- Antes do formulário aparece uma contagem de 5 segundos.
- As respostas são embaralhadas com uma semente sorteada a cada rodada, sem relação com a ordem de envio.
- O Problems verdadeiro não vota nem pontua: ele vê a própria resposta destacada, acompanha ao vivo quem está escolhendo cada resposta e quem confirmou, e na revelação vê os erros caindo e os acertos comemorando na resposta dele.
- O envio das respostas e o voto são definitivos (aparece um pop-up confirmando). Durante a espera só aparece a contagem, tipo "4 de 5 já enviaram".
- Cada fase só avança quando todo mundo online concorda.
- Depois de cada resultado, todo mundo volta ao lobby com os pontos mantidos. A próxima rodada só começa quando todos marcarem que estão prontos. Quem não voltar do resultado em 30 segundos (contados depois da revelação) é levado ao lobby automaticamente.
- Revelação: contagem 3, 2, 1, depois os impostores são revelados um por um, e a resposta verdadeira por último, com faíscas. Se você votou num impostor, a resposta que você escolheu fica vermelha e cai.
- Desempate no final: com a mesma pontuação, fica na frente quem chegou a ela primeiro (ordem das rodadas e dos votos confirmados); depois, quem acertou mais vezes. O que ainda empatar divide a posição. A tela final explica cada empate.
- Pontos: acertou o verdadeiro, +1. Votou num impostor, você perde 1 (pode ficar negativo) e o impostor ganha 1.
- O ADM pode pular fase, reiniciar a partida, limpar o histórico (apaga respostas, votos e pontos do Firebase), remover jogadores (apaga também foto, respostas e votos da pessoa) e ver as respostas com autor. Toda mudança no ADM é salva na hora e aparece para todo mundo.

## Observação

Não há login: o painel ADM é aberto para quem souber o link, e alguém com conhecimento técnico conseguiria ler o banco pelo navegador. Para um jogo entre youtubers em gravação isso costuma bastar; se quiser trancar, dá para adicionar Firebase Auth depois.
