const axios = require('axios');
require('dotenv').config();

const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const API_URL = "https://api-inference.huggingface.co/models/microsoft/Phi-3.5-mini-instruct";

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

async function perguntarIA(mensagem) {
    try {
        const saudacao = saudacaoPorHorario();
        const horaAtual = new Date().toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit'
        });

        const periodo = (() => {
            const hora = parseInt(new Date().toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                hour12: false
            }));
            if (hora >= 6 && hora < 12) return 'manhã';
            if (hora >= 12 && hora < 18) return 'tarde';
            return 'noite';
        })();

        const prompt = `<|system|>\nVocê é um assistente virtual educado, simpático e objetivo. Agora são ${horaAtual} e estamos no período da ${periodo}. Responda sempre considerando esse contexto.\n<|user|>\n${mensagem}\n<|assistant|>`;

        const response = await axios.post(
            API_URL,
            { inputs: prompt },
            {
                headers: {
                    Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`,
                    "Content-Type": "application/json"
                },
                timeout: 60000
            }
        );

        let resposta = "";
        if (Array.isArray(response.data) && response.data[0]?.generated_text) {
            const partes = response.data[0].generated_text.split("<|assistant|>");
            resposta = partes[1]?.trim() || response.data[0].generated_text.trim();
        } else if (response.data?.generated_text) {
            resposta = response.data.generated_text.trim();
        } else {
            return "Desculpe, não consegui entender sua mensagem.";
        }

        // Limpa conteúdo extra e responde de forma concisa
        resposta = resposta
            .split('\n')[0]
            .replace(/Programar em Python.*/i, '')
            .replace(/<\|.*?\|>/g, '')
            .trim();

        // Força a saudação correta no início
        resposta = resposta.replace(/^bom dia|^boa tarde|^boa noite/i, saudacao);

        return resposta.slice(0, 200);

    } catch (error) {
        console.error("❌ Erro ao consultar HuggingFace:", error.message);
        return "Desculpe, estou com problemas para responder no momento.";
    }
}

module.exports = { perguntarIA };
