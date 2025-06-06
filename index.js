// index.js
const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { perguntarIA } = require('./services/huggingfaceService');
const { salvarAgendamento, carregarAgendamentos, carregarHorariosDisponiveisParaData, gerarMensagemHorarios } = require('./services/agendamentoService');
const { parse, isValid } = require("date-fns");
const { zonedTimeToUtc, utcToZonedTime } = require('date-fns-tz');

const agendando = {};
const cancelando = {};
let sock;

async function startBot() {
    console.log('Conectando com a versão mais recente do Baileys...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada.', lastDisconnect.error, 'Reconectando?', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        console.log(`📩 Mensagem recebida de ${from}: "${text}"`);
        if (!text) return;

        const textoNormalizado = text.toLowerCase().trim();

        if (textoNormalizado === 'cancelar') {
            delete agendando[from];
            delete cancelando[from];
            await sock.sendMessage(from, { text: "Ação cancelada" });
            await sock.sendMessage(from, {
                text: 'Escolha uma opção:\n\n1️⃣ Agendar horário\n2️⃣ Falar com atendente\n3️⃣ Cancelar Agendamento\n4️⃣ Remarcar Agendamento'
            });
            return;
        }

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
            const horarioEscolhido = textoNormalizado.replace(":", "h");
            if (!agendando[from].horariosDisponiveis.includes(horarioEscolhido)) {
                await sock.sendMessage(from, { text: "❌ Horário inválido ou já agendado. Escolha um horário disponível." });
                return;
            }

            agendando[from].horario = horarioEscolhido;
            agendando[from].esperandoHorario = false;
            agendando[from].esperandoConfirmacao = true;

            await sock.sendMessage(from, {
                text: `✅ *Deseja confirmar o agendamento?*\n\n🛎️ *Nome:* ${agendando[from].nome}\n📅 *Data:* ${agendando[from].data.toLocaleDateString()}\n⏰ *Horário:* ${agendando[from].horario}\n\nDigite: *sim* ou *não*`
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

        // Menu personalizado por palavra-chave
        if (
            textoNormalizado.includes("marcar") ||
            textoNormalizado.includes("agendar") ||
            textoNormalizado.includes("horário") ||
            textoNormalizado.includes("horario")
        ) {
            await sock.sendMessage(from, {
                text: 'O que você deseja fazer?\n\n1️⃣ Agendar horário\n2️⃣ Falar com atendente\n3️⃣ Cancelar Agendamento\n4️⃣ Remarcar Agendamento'
            });
            return;
        }

        // Menu principal
        if (textoNormalizado.includes('quem é você') || textoNormalizado.includes('com quem eu falo')) {
            await sock.sendMessage(from, { text: 'Sou o SmartBot, ferramenta de agendamento e suporte!' });
        } else if (textoNormalizado === 'oi' || textoNormalizado === 'olá') {
            await sock.sendMessage(from, { text: 'Olá! 👋 Como posso te ajudar hoje?\n\n1️⃣ Agendar horário\n2️⃣ Falar com atendente\n3️⃣ Cancelar Agendamento\n4️⃣ Remarcar Agendamento' });
        } else if (textoNormalizado === '1') {
            agendando[from] = { esperandoNome: true };
            await sock.sendMessage(from, { text: 'Qual o seu nome completo?' });
        } else if (textoNormalizado === '2') {
            await sock.sendMessage(from, { text: '👩‍💼 Um atendente falará com você em breve.' });
        } else if (textoNormalizado === '3') {
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
        } else if (textoNormalizado === '4') {
            const agendamentos = carregarAgendamentos().filter(a => a.telefone === from);
            if (agendamentos.length === 0) {
                await sock.sendMessage(from, { text: "❌ Você não possui agendamentos ativos no momento para remarcar." });
            } else {
                let resposta = "🗓️ *Seus agendamentos:*\n\n";
                agendamentos.forEach(a => {
                    resposta += `➡️ ${a.horario} - ${a.nome}\n`;
                });
                resposta += "\nTodos serão cancelados para remarcar. Digite seu nome novamente!:";
                const novosAgendamentos = carregarAgendamentos().filter(ag => !(ag.telefone === from));
                fs.writeFileSync('./data/agendamentos.json', JSON.stringify(novosAgendamentos, null, 2));
                agendando[from] = { esperandoNome: true };
                await sock.sendMessage(from, { text: resposta });
            }
        } else {
            console.log(`📡 Enviando mensagem para a IA: "${text}"`);
            const respostaIA = await perguntarIA(text);

            if (respostaIA) {
                const saudacao = (() => {
                    const hora = new Date().getHours();
                    if (hora >= 6 && hora < 12) return "Bom dia!";
                    if (hora >= 12 && hora < 18) return "Boa tarde!";
                    return "Boa noite!";
                })();

                const respostaFinal = respostaIA.toLowerCase().startsWith("bom dia") ||
                    respostaIA.toLowerCase().startsWith("boa tarde") ||
                    respostaIA.toLowerCase().startsWith("boa noite")
                    ? respostaIA
                    : `${saudacao} ${respostaIA}`;

                await sock.sendMessage(from, { text: respostaFinal });
                console.log(`🤖 Resposta da IA enviada para ${from}: ${respostaFinal}`);
            } else {
                await sock.sendMessage(from, { text: "Desculpe, não consegui entender sua pergunta." });
                console.log(`⚠️ A IA não retornou nenhuma resposta para: "${text}"`);
            }
        }
    });
}

function enviarLembrete() {
    const agendamentos = carregarAgendamentos();
    const agora = new Date();
    const fusoHorario = 'America/Sao_Paulo';

    let agoraNoFuso;
    try {
        agoraNoFuso = typeof utcToZonedTime === 'function' ? utcToZonedTime(agora, fusoHorario) : new Date(agora.toLocaleString("pt-BR", { timeZone: fusoHorario }));
    } catch (e) {
        console.warn("⚠️ utcToZonedTime não disponível, usando fallback.");
        agoraNoFuso = new Date(agora.toLocaleString("pt-BR", { timeZone: fusoHorario }));
    }

    agendamentos.forEach(agendamento => {
        let agendamentoNoFuso;
        try {
            const dataAgendada = new Date(agendamento.data);
            agendamentoNoFuso = typeof utcToZonedTime === 'function' ? utcToZonedTime(dataAgendada, fusoHorario) : new Date(dataAgendada.toLocaleString("pt-BR", { timeZone: fusoHorario }));
        } catch (e) {
            agendamentoNoFuso = new Date(agendamento.data);
        }

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
}

setInterval(enviarLembrete, 60 * 1000);

startBot().then(() => {
    console.log('🟢 Tudo pronto! O bot está funcionando com agendamento e IA ✅');
});
