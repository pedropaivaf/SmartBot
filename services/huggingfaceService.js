const axios = require('axios');
require('dotenv').config();

// Lê o token do HuggingFace da variável de ambiente
const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;

// Função que envia a mensagem para a API do HuggingFace e recebe a resposta
async function perguntarIA(mensagem) {
    try {
        const response = await axios.post(
            "https://api-inference.huggingface.co/models/facebook/blenderbot-400M-distill",
            { inputs: mensagem },
            {
                headers: {
                    Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`
                }
            }
        );

        if (response.data && response.data.generated_text) {
            return response.data.generated_text;
        } else {
            return "Desculpe, não consegui gerar uma resposta.";
        }

    } catch (error) {
        console.error("Erro ao consultar HuggingFace:", error.message);
        return "Desculpe, estou com problemas para responder no momento.";
    }
}

// Exporta a função para o index.js
module.exports = { perguntarIA };
