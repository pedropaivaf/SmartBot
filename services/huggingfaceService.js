const axios = require('axios');
require('dotenv').config();

const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const HEADERS = {
  Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`,
  'Content-Type': 'application/json'
};
// Tempo máximo de espera para resposta da IA (90 segundos)
const TIMEOUT = 90000;

const MODELOS = [
  "HuggingFaceH4/zephyr-7b-beta",
  "google/gemma-1.1-7b-it",
  "microsoft/Phi-3.5-mini-instruct"
];

// agradecimento aleatório
function respostaAgradecimento() {
  const respostas = [
    'De nada! Tire dúvidas ou agende quando quiser!',
    'Disponha! Estou aqui sempre que precisar.',
    'Náo há de que! Qualquer coisa, só mandar!',
    'Fico feliz em ajudar! Estou à disposição.',
    'Tmj de + meu rei, qualquer coisa da um salve!',
    'É um prazer ajudar! Me chame quando quiser.'
  ];
  return respostas[Math.floor(Math.random() * respostas.length)];
}

// Função de saudação baseada no horário	
function saudacaoPorHorario() {
  const hora = parseInt(new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false
  }));
  if (hora >= 6 && hora < 12) return "bom dia";
  if (hora >= 12 && hora < 18) return "boa tarde";
  return "boa noite";
}

function periodoAtual() {
  const hora = parseInt(new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false
  }));
  if (hora >= 6 && hora < 12) return 'manhã';
  if (hora >= 12 && hora < 18) return 'tarde';
  return 'noite';
}

function horaAtualFormatada() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit'
  });
}
// trata a resposta da IA, removendo excessos e mantendo o foco
function limparResposta(texto) {
  if (!texto || typeof texto !== "string") return "Desculpe, não entendi.";

  const linhas = texto
    .replace(/<\|.*?\|>/g, '')                          // Remove tags da IA
    .replace(/Programar em Python.*/i, '')              // Remove ruído
    .replace(/(bom dia|boa tarde|boa noite)[!,.]*/gi, '') // 🔥 Remove saudações embutidas em qualquer lugar
    .split(/\r?\n/)                                     // Quebra em linhas reais
    .map(l => l.trim())                                 // Remove espaços

    // Remove "Note:" e observações
    .filter(l => l && !l.toLowerCase().startsWith("note"))

    // Remove parênteses e ponto final no fim
    .map(l =>
      l
        .replace(/\s*\([^)]*\)/g, '') // Remove (observações)
        .replace(/\.$/, '')           // Remove ponto final
    );

  return linhas.slice(0, 5).join('\n'); // Até 5 itens limpos
}

// pergunta à IA, usa prompt para obter resposta direta e objetiva
async function perguntarIA(mensagem) {
  const saudacao = saudacaoPorHorario();
  const prompt = `<|system|>
Responda de forma curta, direta e precisa. Apenas responda à pergunta sem rodeios.
<|user|>
${mensagem}
<|assistant|>`;
  console.log('📝 Prompt enviado à IA:', prompt);

  for (const modelo of MODELOS) {
    try {
      const inicio = Date.now();

      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${modelo}`,
        { inputs: prompt },
        { headers: HEADERS, timeout: TIMEOUT }
      );

      const duracao = Date.now() - inicio;
      console.log(`🧠 Tempo de resposta (${modelo}): ${duracao} ms`);

      let resposta = "";

      if (Array.isArray(response.data) && response.data[0]?.generated_text) {
        const partes = response.data[0].generated_text.split("<|assistant|>");
        resposta = partes[1]?.trim() || response.data[0].generated_text.trim();
      } else if (response.data?.generated_text) {
        resposta = response.data.generated_text.trim();
      } else {
        console.warn(`⚠️ Resposta inesperada do modelo ${modelo}`);
        continue;
      }

      const saudacaoFormatada = saudacao.charAt(0).toUpperCase() + saudacao.slice(1) + "!";
      const respostaFinal = `${saudacaoFormatada}\n${limparResposta(resposta)}`;
      return respostaFinal;

    } catch (err) {
      console.warn(`⚠️ Modelo falhou (${modelo}): ${err.response?.status || ''} - ${err.message}`);
    }
  }

  return `${saudacao.charAt(0).toUpperCase() + saudacao.slice(1)}! Desculpe, estou com problemas para responder no momento.`;
}

module.exports = {
  perguntarIA,
  saudacaoPorHorario,
  respostaAgradecimento
};
