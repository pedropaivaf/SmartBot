const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const { perguntarIA, saudacaoPorHorario, respostaAgradecimento, respostaComSaudacao } = require('./services/huggingfaceService');

const caminhoSemResposta = './data/perguntasaindasemresp.json';
const respostasRapidas = require('./data/respostas_rapidas.json');
const aguardandoIA = {};
const qrcode = require('qrcode-terminal');
const {
    salvarAgendamento,
    carregarAgendamentos,
    carregarHorariosDisponiveisParaData,
    gerarMensagemHorarios
} = require('./services/agendamentoService');
const { parse, isValid } = require("date-fns");

// Variáveis para controle de agendamentos e cancelamentos
const agendando = {};
const cancelando = {};
const historico = {};
let sock;

function removerAcentos(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Função para gerar saudação baseada no horário
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso!');
            console.log("🕒 Fuso/Data:", new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
        }
    });
    // Evento para receber mensagens
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const textoNormalizado = removerAcentos(text.toLowerCase().trim());

        if (textoNormalizado === 'cancelar') {
            delete agendando[from];
            delete cancelando[from];
            delete aguardandoIA[from];
            await sock.sendMessage(from, { text: "❌ Fluxo cancelado com sucesso. Se precisar de algo, estou por aqui!" });
            console.log(`🚫 Fluxo cancelado manualmente por ${from}`);
            return;
        }

        // 🔁 Primeiro: trata comandos do menu (1 a 4)
        if (['1', '2', '3', '4'].includes(textoNormalizado)) {
            switch (textoNormalizado) {
                case '1':
                    agendando[from] = { esperandoNome: true };
                    await sock.sendMessage(from, { text: 'Qual o seu nome completo?' });
                    return;

                case '2':
                    await sock.sendMessage(from, { text: '👩‍💼 Um atendente falará com você em breve.' });
                    return;

                case '3': {
                    const agendamentos = carregarAgendamentos().filter(a => a.telefone === from);
                    if (agendamentos.length === 0) {
                        await sock.sendMessage(from, { text: "❌ Você não possui agendamentos ativos no momento." });
                    } else {
                        let resposta = "🗓️ *Seus agendamentos:*\n\n";
                        agendamentos.forEach(a => {
                            resposta += `➡️ ${a.horario} - ${a.nome}\n`;
                        });
                        resposta += "\nDigite o horário que deseja cancelar:";
                        cancelando[from] = true;
                        await sock.sendMessage(from, { text: resposta });
                    }
                    return;
                }

                case '4': {
                    const agendamentos = carregarAgendamentos().filter(a => a.telefone === from);
                    if (agendamentos.length === 0) {
                        await sock.sendMessage(from, { text: "❌ Você não possui agendamentos ativos no momento para remarcar." });
                    } else {
                        let resposta = "🗓️ *Seus agendamentos:*\n\n";
                        agendamentos.forEach(a => {
                            resposta += `➡️ ${a.horario} - ${a.nome}\n`;
                        });
                        resposta += "\nTodos serão cancelados para remarcar. Digite seu nome novamente!:";

                        const novosAgendamentos = carregarAgendamentos().filter(ag => ag.telefone !== from);
                        fs.writeFileSync('./data/agendamentos.json', JSON.stringify(novosAgendamentos, null, 2));

                        agendando[from] = { esperandoNome: true };
                        await sock.sendMessage(from, { text: resposta });
                    }
                    return;
                }
            }
        }
        console.log('──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────');

        console.log(`📩 Mensagem recebida de ${from}: ${text}`);
        console.log('──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────');

        historico[from] = historico[from] || [];
        historico[from].push(text);
        if (historico[from].length > 6) historico[from].shift();

        //palavras bloqueadas
        const palavrasBloqueadas = [
            'fdp', 'pnc', 'vsf', 'vai se fuder', 'vai tomar no cu',
            'filho da puta', 'desgraçado', 'arrombado', 'corno',
            'puta', 'puto', 'merda', 'bosta', 'caralho', 'porra',
            'cacete', 'retardado', 'imbecil', 'idiota', 'escroto',
            'bomba', 'droga', 'matar', 'suicídio', 'sexo', 'nudez',
            'vtnc', 'vsfd'  , 'vai se ferrar','cuzão','vagabundo', 
            'vagabunda', 'viado', 'seu cu', 'seu lixo', 'vai se lascar',
            'vai se danar', 'vai se foder', 'vai se ferrar', 'tnc',
        ];

        // Verificação simples e direta
        if (palavrasBloqueadas.some(p => textoNormalizado.includes(p))) {
            const resposta = "🚫 Vocabulário ofensivo detectado. Por favor seja mais educado...";
            console.log(`❌ Resposta bloqueada para ${from}: ${resposta}`);
            await sock.sendMessage(from, { text: resposta });
            return;
        }

        const padraoSaudacao = /\b(oi|ol[áa]|fala|e[ \-]?a[íi]|salve|bom dia|boa tarde|boa noite|coe|opa|como vai|chat(bot)?|smartbot)\b/i;

        if (padraoSaudacao.test(textoNormalizado)) {
            const respostaSaudacao = "👋 Olá! Sou o SmartBot 🤖, um chat interativo 💬 com integração de IA para dúvidas e agendamentos. Como posso te ajudar? Digite (agendar) para agendar um horário";
            console.log(`🙋 Saudação detectada de ${from}`);
            await sock.sendMessage(from, { text: respostaSaudacao });
            return;
        }

        const palavrasAgendamento = [
            'agendar',
            'agendamento',
            'agendar horário',
            'agendar horario',
            'marcar',
            'marcar horário',
            'marcar horario',
            'quero agendar',
            'preciso agendar',
            'preciso marcar',
            'agendamento online',
            'agendamento por whatsapp',
            'agendar consulta',
            'marcar consulta',
            'fazer agendamento',
            'marcar horário agora',
            'menu',
            'horário disponível',
            'ver horários',
            'horário de atendimento'
        ];

        const palavrasAgradecimento = [
            'obrigado',
            'obrigada',
            'valeu',
            'agradecido',
            'muito obrigado',
            'mt obg',
            'vlw',
            'obg',
            'tmj',
            'grato',
            'grata',
            'agradeco',
            'e nois',
            'obrigadao',
            'brigadao'
        ];

        // tratamento de agradecimento
        if (palavrasAgradecimento.some(p => textoNormalizado.includes(p))) {
            const resposta = respostaAgradecimento();
            console.log(`🙏 Agradecimento detectado de ${from}: ${resposta}`);
            await sock.sendMessage(from, { text: resposta });
            return;
        }

        // tratamento de agendamento
        if (palavrasAgendamento.some(p => textoNormalizado.includes(p))) {
            console.log(`📆 Menu de agendamento exibido para ${from}`);
            await sock.sendMessage(from, {
                text: '🗓️ O que você deseja fazer?\n\n1️⃣ Agendar horário\n2️⃣ Falar com atendente\n3️⃣ Cancelar Agendamento\n4️⃣ Remarcar Agendamento'
            });
            return;
        }

        // Fluxo de agendamento
        if (agendando[from]?.esperandoNome) {
            agendando[from].nome = textoNormalizado;
            agendando[from].esperandoNome = false;
            agendando[from].esperandoData = true;
            await sock.sendMessage(from, { text: "Qual data deseja agendar? (formato: dd/mm/aaaa)" });
            return;
        }

        if (agendando[from]?.esperandoData) {
            const dataEscolhida = parse(textoNormalizado, "dd/MM/yyyy", new Date());
            if (!isValid(dataEscolhida)) {
                await sock.sendMessage(from, { text: "❌ Data inválida. Use o formato dd/mm/aaaa." });
                return;
            }

            const horariosDisponiveis = carregarHorariosDisponiveisParaData(dataEscolhida);
            if (horariosDisponiveis.length === 0) {
                await sock.sendMessage(from, { text: "😞 Todos os horários já foram preenchidos para essa data." });
                delete agendando[from];
                return;
            }

            agendando[from].data = dataEscolhida;
            agendando[from].horariosDisponiveis = horariosDisponiveis;
            agendando[from].esperandoData = false;
            agendando[from].esperandoHorario = true;

            const mensagem = gerarMensagemHorarios(dataEscolhida, horariosDisponiveis);
            await sock.sendMessage(from, { text: mensagem });
            return;
        }

        if (agendando[from]?.esperandoHorario) {
            let horarioEscolhido = textoNormalizado
                .replace(":", "h")
                .replace(/h00$/, "h");

            if (/^\d{1,2}$/.test(horarioEscolhido)) {
                horarioEscolhido += "h";
            }

            if (!agendando[from].horariosDisponiveis.includes(horarioEscolhido)) {
                await sock.sendMessage(from, { text: "❌ Horário inválido ou já agendado. Escolha um horário disponível." });
                return;
            }

            agendando[from].horario = horarioEscolhido;
            agendando[from].esperandoHorario = false;
            agendando[from].esperandoConfirmacao = true;

            await sock.sendMessage(from, {
                text: `✅ Deseja confirmar o agendamento?\n\n🛎️ *Nome:* ${agendando[from].nome}\n📅 *Data:* ${agendando[from].data.toLocaleDateString()}\n⏰ *Horário:* ${agendando[from].horario}\n\nDigite: *sim* ou *não*`
            });
            return;
        }

        if (agendando[from]?.esperandoConfirmacao) {
            if (textoNormalizado === 'sim') {
                salvarAgendamento({
                    telefone: from,
                    nome: agendando[from].nome,
                    horario: agendando[from].horario,
                    data: agendando[from].data.toISOString()
                });

                await sock.sendMessage(from, {
                    text: `✅ Agendamento confirmado para *${agendando[from].nome}* em *${agendando[from].data.toLocaleDateString()}* às *${agendando[from].horario}*!`
                });
                delete agendando[from];
            } else {
                await sock.sendMessage(from, { text: "❌ Agendamento cancelado. Se quiser tentar novamente, digite 1." });
                delete agendando[from];
            }
            return;
        }

        if (cancelando[from]) {
            const textoLimpo = textoNormalizado.replace(/[^\dh]/gi, '').trim(); // Ex: '10h30'
            const agendamentos = carregarAgendamentos();
            const novos = agendamentos.filter(ag =>
                !(ag.telefone === from && ag.horario.replace(/[:]/g, 'h') === textoLimpo)
            );

            if (novos.length === agendamentos.length) {
                await sock.sendMessage(from, {
                    text: "❌ Nenhum agendamento encontrado com esse horário. Verifique e tente novamente."
                });
            } else {
                fs.writeFileSync('./data/agendamentos.json', JSON.stringify(novos, null, 2));
                await sock.sendMessage(from, {
                    text: `✅ Agendamento das ${textoLimpo} cancelado com sucesso.`
                });
            }

            delete cancelando[from];
            return;
        }

        // Evita cair na IA se estiver em fluxo de agendamento ou cancelamento
        if (agendando[from] || cancelando[from]) return;

        if (aguardandoIA[from]) {
            if (['sim', 'pode', 'ok'].includes(textoNormalizado)) {
                const perguntaOriginal = aguardandoIA[from]?.ultimaPergunta || text;
                delete aguardandoIA[from];
                const respostaIA = await perguntarIA(perguntaOriginal);

                if (respostaIA) {
                    // Limpeza de introduções e floreios
                    let respostaFinal = respostaIA
                        .replace(/^.*?(embora|como ia|no contexto|gostaria de ajudar|durante a noite|antes de responder|sou uma ia|posso ajudar|estou aqui para)/i, '')
                        .replace(/(com assistente|enquanto ia).+?[,.:]/gi, '')
                        .trim();
                    // Remove saudações duplicadas no início, como "Boa noite! Boa noite!"
                    respostaFinal = respostaFinal.replace(/^(bom dia|boa tarde|boa noite)[\s!,.]*(bom dia|boa tarde|boa noite)?[\s!,.]*/i, '');

                    // Se for pergunta, escolhe uma frase direta e com verbo informativo
                    if (text.trim().endsWith('?')) {
                        const frases = respostaFinal
                            .split(/[.!?]/)
                            .map(f => f.trim())
                            .filter(f =>
                                f.length >= 40 &&
                                f.length <= 250 &&
                                /^[A-ZÁÉÍÓÚÀÂÊÔÃÕ]/.test(f) &&
                                /\b(é|foi|está|são|tem|possui|conhecido|reconhecido)\b/i.test(f)
                            );

                        respostaFinal = frases[0] || respostaFinal.split(/[.!?]/)[0].trim();
                    }
                    console.log(`🤖 Resposta da IA para ${from}: ${respostaFinal}`);
                    const respostaSaudada = respostaComSaudacao(respostaFinal);
                    await sock.sendMessage(from, { text: respostaSaudada });
                    return;
                } else {
                    const falha = "🤖 Desculpe, a IA não respondeu no momento.";
                    console.log(`⚠️ Falha da IA para ${from}: ${falha}`);
                    await sock.sendMessage(from, { text: falha });
                    return;
                }
            } else if (['não', 'nao'].includes(textoNormalizado)) {
                delete aguardandoIA[from];
                const resposta = "✅ Tudo bem, se precisar é só chamar!";
                console.log(`ℹ️ Rejeição de IA por ${from}: ${resposta}`);
                await sock.sendMessage(from, { text: resposta });
                return;
            }
        }

        const respostaDireta = respostasRapidas.find(item =>
            item.pergunta.some(p => textoNormalizado.includes(p))
        );

        if (respostaDireta) {
            console.log(`📚 Resposta rápida encontrada para ${from}: ${respostaDireta.resposta}`);
            await sock.sendMessage(from, { text: respostaDireta.resposta });
            return;
        }

        const novaPergunta = {
            usuario: from,
            mensagem: text,
            data_hora: new Date().toISOString()
        };

        try {
            let jsonExistente = [];
            if (fs.existsSync(caminhoSemResposta)) {
                jsonExistente = JSON.parse(fs.readFileSync(caminhoSemResposta));
                if (!Array.isArray(jsonExistente)) jsonExistente = [];
            }
            jsonExistente.push(novaPergunta);
            fs.writeFileSync(caminhoSemResposta, JSON.stringify(jsonExistente, null, 2));
        } catch (err) {
            console.error("❌ Erro ao salvar pergunta sem resposta:", err);
        }

        aguardandoIA[from] = { ultimaPergunta: text };
        const aviso = "🤔 Essa pergunta ainda não está no meu banco de respostas rápidas. Deseja que eu tente com a IA? (responda *sim* ou *não*)";
        console.log(`💬 Pergunta não encontrada para ${from}. Perguntando se deseja usar IA.`);
        await sock.sendMessage(from, { text: aviso });
    });
}

setInterval(() => {
    const agendamentos = carregarAgendamentos();
    const agora = new Date();
    const agoraNoFuso = new Date(agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));

    agendamentos.forEach(agendamento => {
        const dataAgendada = new Date(agendamento.data);
        const agendamentoNoFuso = new Date(dataAgendada.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
        const diferenca = agendamentoNoFuso - agoraNoFuso;

        if (diferenca > 0 && diferenca <= 30 * 60 * 1000) {
            setTimeout(() => {
                if (!sock) return;
                sock.sendMessage(agendamento.telefone, {
                    text: `🕒 Lembrete de agendamento:\n*${agendamento.nome}* às *${agendamento.horario}* em 30 minutos!`
                });
            }, diferenca);
        }
    });
}, 60 * 1000);

startBot().then(() => {
    console.log('🟢 Tudo pronto! O bot está funcionando com agendamento e IA ✅');
});
