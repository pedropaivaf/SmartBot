const fs = require("fs");
const { format } = require("date-fns");
const { ptBR } = require("date-fns/locale");

// Lista padrão de horários
const horariosPadrao = [
    "10h", "10h30", "11h", "11h30", "12h", "12h30", "13h", "13h30", "14h", "14h30",
    "15h", "15h30", "16h", "16h30", "17h", "17h30", "18h", "18h30", "19h", "19h30",
    "20h", "20h30", "21h"
];

// Exibe os horários formatados para o WhatsApp
function formatarHorarios(horarios) {
    const linhas = [];
    for (let i = 0; i < horarios.length; i += 4) {
        const linha = horarios
            .slice(i, i + 4)
            .map(h => h.replace("h30", ":30").replace("h", ":00").padEnd(5))
            .join(" | ");
        linhas.push(`➤ ${linha}`);
    }
    return linhas.join("\n");
}

// Gera a mensagem bonitona para enviar ao cliente
function gerarMensagemHorarios(dataEscolhida, horarios = horariosPadrao) {
    const dataFormatada = format(dataEscolhida, "dd/MM/yyyy (EEEE)", { locale: ptBR });
    return `🗓️ *Horários disponíveis para ${dataFormatada}:*\n\n${formatarHorarios(horarios)}`;
}

// Retorna horários disponíveis após remover os já agendados para a data específica
function carregarHorariosDisponiveisParaData(dataSelecionada) {
    const agendamentos = carregarAgendamentos();
    const dataISO = format(dataSelecionada, "yyyy-MM-dd");

    const horariosAgendados = agendamentos
        .filter(a => a.data.startsWith(dataISO))
        .map(a => a.horario);

    return horariosPadrao.filter(h => !horariosAgendados.includes(h));
}

// Exportações
function salvarAgendamento(agendamento) {
    const agendamentos = carregarAgendamentos();
    agendamentos.push(agendamento);
    fs.writeFileSync("./data/agendamentos.json", JSON.stringify(agendamentos, null, 2));
}

function carregarAgendamentos() {
    if (!fs.existsSync("./data/agendamentos.json")) return [];
    return JSON.parse(fs.readFileSync("./data/agendamentos.json"));
}

function carregarHorariosDisponiveis() {
    if (!fs.existsSync("./data/horariosDisponiveis.json")) return horariosPadrao;
    return JSON.parse(fs.readFileSync("./data/horariosDisponiveis.json"));
}

module.exports = {
    salvarAgendamento,
    carregarAgendamentos,
    carregarHorariosDisponiveis,
    carregarHorariosDisponiveisParaData,
    gerarMensagemHorarios
};
