const axios = require('axios');
require('dotenv').config();

const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const HEADERS = {
  Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`,
  'Content-Type': 'application/json'
};
const TIMEOUT = 60000;

const MODELOS = [
  "microsoft/Phi-3.5-mini-instruct"
];

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

function limparResposta(texto, saudacao) {
  return texto
    .replace(/<\|.*?\|>/g, '')
    .replace(/^bom dia|^boa tarde|^boa noite/i, saudacao)
    .replace(/Programar em Python.*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);
}

async function perguntarIA(mensagem) {
  const saudacao = saudacaoPorHorario();
  const prompt = `<|system|>\nVocê é um assistente educado, simpático e objetivo. Agora são ${horaAtualFormatada()} e estamos na ${periodoAtual()}.\n<|user|>\n${mensagem}\n<|assistant|>`;

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

      return limparResposta(resposta, saudacao);

    } catch (err) {
      console.warn(`⚠️ Modelo falhou (${modelo}): ${err.response?.status || ''} - ${err.message}`);
    }
  }

  return `${saudacao.charAt(0).toUpperCase() + saudacao.slice(1)}! Desculpe, estou com problemas para responder no momento.`;
}

module.exports = { perguntarIA };
