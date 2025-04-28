const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { perguntarIA } = require('./services/huggingfaceService');
const { salvarAgendamento, carregarAgendamentos, carregarHorariosDisponiveis } = require('./services/agendamentoService');

const agendando = {};
const cancelando = {};

async function startBot() {
    console.log('Conectando com a versão mais recente do Baileys...');

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada.', lastDisconnect.error, 'Reconectando?', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text) {
            console.log(`Mensagem recebida de ${from}: ${text}`);
            const textoNormalizado = text.toLowerCase().trim();

            if (textoNormalizado === 'cancelar') {
                // Verifica se está em algum processo de agendamento ou confirmação
                if (agendando[from]) {
                    delete agendando[from];  // Apaga o processo de agendamento
                } else if (cancelando[from]) {
                    delete cancelando[from];  // Cancela o processo de cancelamento
                }

                // Envia a mensagem simples
                await sock.sendMessage(from, { text: "Ação cancelada" });

                // Mostra o menu inicial de opções
                await sock.sendMessage(from, { text: 'Escolha uma opção:\n\n1️⃣ Agendar horário\n2️⃣ Falar com atendente\n3️⃣ Cancelar Agendamento\n4️⃣ Remarcar Agendamento' });
                return;
            }

            // Ações de agendamento e confirmação
            if (agendando[from]?.esperandoServico) {
                agendando[from].servico = textoNormalizado;
                agendando[from].esperandoServico = false;

                const horariosDisponiveis = carregarHorariosDisponiveis();
                if (horariosDisponiveis.length === 0) {
                    await sock.sendMessage(from, { text: "No momento, não há horários disponíveis. Por favor, tente mais tarde." });
                    delete agendando[from];
                    return;
                }

                agendando[from].horariosDisponiveis = horariosDisponiveis;
                agendando[from].esperandoHorario = true;

                let horariosFormatados = "🕒 *Intervalos de Horários Disponíveis:*\n\n";
                
                // Mostrar intervalos (exemplo 14h-15h)
                for (let i = 0; i < horariosDisponiveis.length - 1; i++) {
                    horariosFormatados += `➡️ ${horariosDisponiveis[i]} - ${horariosDisponiveis[i + 1]}\n`;
                }

                horariosFormatados += "\nDigite o horário desejado dentro do intervalo ou 'cancelar' para sair.";

                await sock.sendMessage(from, { text: horariosFormatados });
                return;
            }

            if (agendando[from]?.esperandoHorario) {
                const horarioEscolhido = textoNormalizado.trim(); // Ex: 20h15, 20:15

                // Atualização para aceitar diferentes formatos de horário (com "h" ou ":")
                const validHorario = /^([0-9]{1,2})(h|:)?([0-5][0-9])$/.test(horarioEscolhido);

                if (!validHorario) {
                    await sock.sendMessage(from, { text: "Horário inválido. Por favor, escolha um horário válido (ex: 10h30, 14:15, 20h30)." });
                    return;
                }

                // Normaliza o horário para o formato "h" (ex: 20:15 -> 20h15)
                const horarioNormalizado = horarioEscolhido.replace(":", "h");

                // Verificar se o horário está no intervalo
                const intervaloValido = agendando[from].horariosDisponiveis.some(intervalo => {
                    const [start, end] = intervalo.split("-");

                    // Garantir que start e end estão definidos antes de tentar processar
                    if (!start || !end) return false;

                    const startTime = parseInt(start.replace("h", ""));
                    const endTime = parseInt(end.replace("h", ""));
                    const chosenTime = parseInt(horarioNormalizado.replace("h", ""));

                    return chosenTime >= startTime && chosenTime < endTime;
                });

                if (!intervaloValido) {
                    await sock.sendMessage(from, { text: "Horário inválido ou já agendado. Escolha entre:\n" + agendando[from].horariosDisponiveis.join(' | ') });
                    return;
                }

                agendando[from].horario = horarioNormalizado;
                agendando[from].esperandoHorario = false;
                agendando[from].esperandoConfirmacao = true;

                await sock.sendMessage(from, { text: `✅ *Deseja confirmar o agendamento?*\n\n🛎️ *Serviço:* ${agendando[from].servico}\n⏰ *Horário:* ${agendando[from].horario}\n\nDigite: *sim* ou *não*` });
                return;
            }

            if (agendando[from]?.esperandoConfirmacao) {
                if (textoNormalizado === 'sim') {
                    salvarAgendamento({
                        telefone: from,
                        servico: agendando[from].servico,
                        horario: agendando[from].horario,
                        data: new Date().toISOString()
                    });
                    await sock.sendMessage(from, { text: `✅ Agendamento confirmado para *${agendando[from].servico}* às *${agendando[from].horario}*!` });
                    delete agendando[from];
                } else {
                    await sock.sendMessage(from, { text: "❌ Agendamento cancelado. Se quiser tentar novamente, digite 1." });
                    delete agendando[from];
                }
                return;
            }

            // Menu principal
            if (textoNormalizado.includes('quem é você') || textoNormalizado.includes('com quem eu falo')) {
                await sock.sendMessage(from, { text: 'Sou o SmartBot, ferramenta de agendamento e suporte!' });
            } else if (textoNormalizado === 'oi' || textoNormalizado === 'olá') {
                await sock.sendMessage(from, { text: 'Olá! 👋 Como posso te ajudar hoje?\n\n1️⃣ Agendar horário\n2️⃣ Falar com atendente\n3️⃣ Cancelar Agendamento\n4️⃣ Remarcar Agendamento' });
            } else if (textoNormalizado === '1') {
                agendando[from] = { esperandoServico: true };
                await sock.sendMessage(from, { text: 'Qual serviço você deseja agendar?' });
            } else if (textoNormalizado === '2') {
                await sock.sendMessage(from, { text: '👩‍💼 Um atendente falará com você em breve.' });
            } else if (textoNormalizado === '3') {
                const agendamentos = carregarAgendamentos().filter(a => a.telefone === from);
                if (agendamentos.length === 0) {
                    await sock.sendMessage(from, { text: "❌ Você não possui agendamentos ativos no momento." });
                } else {
                    let resposta = "🗓️ *Seus agendamentos:*\n\n";
                    agendamentos.forEach(a => {
                        resposta += `➡️ ${a.horario} - ${a.servico}\n`;
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
                        resposta += `➡️ ${a.horario} - ${a.servico}\n`;
                    });
                    resposta += "\nTodos serão cancelados para remarcar. Digite o novo serviço:";
                    agendamentos.forEach(a => {
                        const novosAgendamentos = carregarAgendamentos().filter(ag => !(ag.telefone === from));
                        fs.writeFileSync('./data/agendamentos.json', JSON.stringify(novosAgendamentos, null, 2));
                    });
                    agendando[from] = { esperandoServico: true };
                    await sock.sendMessage(from, { text: resposta });
                }
            } else {
                const respostaIA = await perguntarIA(text);
                await sock.sendMessage(from, { text: respostaIA });
            }
        }
    });
}

// Função para enviar o lembrete 30 minutos antes do horário agendado
function enviarLembrete() {
    const agendamentos = carregarAgendamentos();
    const agora = new Date();

    agendamentos.forEach(agendamento => {
        const horarioAgendamento = new Date(agendamento.data);
        const diferenca = horarioAgendamento - agora;

        if (diferenca > 0 && diferenca <= 30 * 60 * 1000) {
            setTimeout(() => {
                sock.sendMessage(agendamento.telefone, {
                    text: `🕒 Lembrete de agendamento:\n*${agendamento.servico}* às *${agendamento.horario}* em 30 minutos! Não perca!`
                });
            }, diferenca);
        }
    });
}

setInterval(enviarLembrete, 60 * 1000); // Verifica a cada 1 minuto

startBot();
