#!/usr/bin/env node
// Gera assets/activity-graph.svg a partir do calendario de contribuicoes do GitHub.
// Substitui o servico github-readme-activity-graph.vercel.app, desativado (HTTP 402).
// Sem dependencias: usa fetch nativo (Node 20+) e escreve o SVG na mao.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAIDA = resolve(RAIZ, "assets/activity-graph.svg");

const USUARIO = process.env.GRAPH_USER || "MathTrajan";
const TOKEN = process.env.GITHUB_TOKEN;

// Paleta tokyo-night, a mesma do widget anterior.
const COR = {
  fundo: "#0d1117",
  borda: "#1f2733",
  grade: "#1c2430",
  texto: "#8b98a9",
  titulo: "#c9d1d9",
  linha: "#4f8ef7",
  area: "#7c3aed",
  ponto: "#7c3aed",
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const CONSULTA = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

async function buscarDias() {
  if (!TOKEN) throw new Error("GITHUB_TOKEN nao definido.");

  const resposta = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "gerar-activity-graph",
    },
    body: JSON.stringify({ query: CONSULTA, variables: { login: USUARIO } }),
  });

  if (!resposta.ok) {
    throw new Error(`GitHub respondeu ${resposta.status}: ${await resposta.text()}`);
  }

  const corpo = await resposta.json();
  if (corpo.errors?.length) {
    throw new Error(`GraphQL: ${corpo.errors.map((e) => e.message).join("; ")}`);
  }

  const calendario = corpo.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendario) throw new Error("Resposta sem contributionCalendar.");

  // Agregado por semana: 53 pontos desenham uma curva legivel.
  // O diario cru vira picos-agulha sobre uma linha reta em zero.
  const semanas = calendario.weeks.map((s) => ({
    inicio: s.contributionDays[0].date,
    total: s.contributionDays.reduce((soma, d) => soma + d.contributionCount, 0),
  }));

  return { total: calendario.totalContributions, semanas };
}

// Curva suave por Catmull-Rom convertido para Bezier cubica.
function curva(pontos) {
  if (pontos.length < 2) return "";
  let d = `M ${pontos[0].x.toFixed(2)} ${pontos[0].y.toFixed(2)}`;

  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = pontos[i - 1] || pontos[i];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[i + 2] || p2;

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

function gerarSvg({ total, semanas }) {
  const L = 900;
  const A = 320;
  const m = { topo: 58, dir: 28, base: 44, esq: 46 };
  const larguraUtil = L - m.esq - m.dir;
  const alturaUtil = A - m.topo - m.base;

  const maximo = Math.max(1, ...semanas.map((s) => s.total));
  // Teto arredondado para cima, para o eixo Y cair em numero redondo.
  const passo = maximo <= 5 ? 1 : maximo <= 20 ? 5 : maximo <= 50 ? 10 : 20;
  const teto = Math.ceil(maximo / passo) * passo;

  const x = (i) => m.esq + (i / (semanas.length - 1)) * larguraUtil;
  const y = (v) => m.topo + alturaUtil - (v / teto) * alturaUtil;

  const pontos = semanas.map((s, i) => ({ x: x(i), y: y(s.total) }));
  const linha = curva(pontos);
  const area = `${linha} L ${x(semanas.length - 1).toFixed(2)} ${(m.topo + alturaUtil).toFixed(2)} L ${m.esq.toFixed(2)} ${(m.topo + alturaUtil).toFixed(2)} Z`;

  // Grade horizontal e rotulos do eixo Y.
  const linhasGrade = [];
  const divisoes = 4;
  for (let i = 0; i <= divisoes; i++) {
    const valor = (teto / divisoes) * i;
    const py = y(valor);
    linhasGrade.push(
      `<line x1="${m.esq}" y1="${py.toFixed(2)}" x2="${L - m.dir}" y2="${py.toFixed(2)}" stroke="${COR.grade}" stroke-width="1" />`,
      `<text x="${m.esq - 10}" y="${(py + 4).toFixed(2)}" fill="${COR.texto}" font-size="11" text-anchor="end">${Math.round(valor)}</text>`,
    );
  }

  // Rotulo na primeira semana de cada mes.
  const rotulosMes = [];
  let mesAnterior = null;
  semanas.forEach((semana, i) => {
    const mes = Number(semana.inicio.slice(5, 7)) - 1;
    if (mes === mesAnterior) return;
    mesAnterior = mes;
    if (i < 1 || i > semanas.length - 2) return;
    rotulosMes.push(
      `<text x="${x(i).toFixed(2)}" y="${A - 16}" fill="${COR.texto}" font-size="11" text-anchor="middle">${MESES[mes]}</text>`,
    );
  });

  const pico = semanas.reduce((a, b) => (b.total > a.total ? b : a));
  const indicePico = semanas.indexOf(pico);
  const periodo = `${semanas[0].inicio} a ${semanas[semanas.length - 1].inicio}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}" viewBox="0 0 ${L} ${A}" role="img" aria-label="Grafico de contribuicoes de ${USUARIO}">
  <defs>
    <linearGradient id="preenchimento" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${COR.area}" stop-opacity="0.55" />
      <stop offset="100%" stop-color="${COR.area}" stop-opacity="0.02" />
    </linearGradient>
  </defs>

  <rect x="0.5" y="0.5" width="${L - 1}" height="${A - 1}" rx="10" fill="${COR.fundo}" stroke="${COR.borda}" />

  <text x="${m.esq}" y="30" fill="${COR.titulo}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="15" font-weight="600">Contribuições de ${USUARIO} <tspan fill="${COR.texto}" font-size="12" font-weight="400">(por semana)</tspan></text>
  <text x="${L - m.dir}" y="30" fill="${COR.texto}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="12" text-anchor="end">${total} no último ano · pico de ${pico.total} numa semana</text>

  <g font-family="system-ui, -apple-system, Segoe UI, sans-serif">
    ${linhasGrade.join("\n    ")}
  </g>

  <path d="${area}" fill="url(#preenchimento)" />
  <path d="${linha}" fill="none" stroke="${COR.linha}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  <circle cx="${x(indicePico).toFixed(2)}" cy="${y(pico.total).toFixed(2)}" r="4" fill="${COR.ponto}" stroke="${COR.fundo}" stroke-width="1.5" />

  <g font-family="system-ui, -apple-system, Segoe UI, sans-serif">
    ${rotulosMes.join("\n    ")}
  </g>

  <!-- periodo coberto: ${periodo} -->
</svg>
`;
}

const dados = await buscarDias();
await mkdir(dirname(SAIDA), { recursive: true });
await writeFile(SAIDA, gerarSvg(dados), "utf8");
console.log(`OK: ${SAIDA} (${dados.total} contribuicoes em ${dados.semanas.length} semanas)`);
