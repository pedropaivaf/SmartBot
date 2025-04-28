const fs = require('fs');
const path = require('path');

const agendamentoPath = path.join(__dirname, '..', 'data', 'agendamentos.json');
const horariosPath = path.join(__dirname, '..', 'data', 'horariosDisponiveis.json');

// Carrega agendamentos existentes
function carregarAgendamentos() {
    if (!fs.existsSync(agendamentoPath)) {
        fs.writeFileSync(agendamentoPath, JSON.stringify([]));
    }
    const data = fs.readFileSync(agendamentoPath);
    return JSON.parse(data);
}

// Salva um novo agendamento
function salvarAgendamento(agendamento) {
    const agendamentos = carregarAgendamentos();
    agendamentos.push(agendamento);
    fs.writeFileSync(agendamentoPath, JSON.stringify(agendamentos, null, 2));
}

// Carrega horários disponíveis (que ainda não foram agendados)
function carregarHorariosDisponiveis() {
    if (!fs.existsSync(horariosPath)) {
        fs.writeFileSync(horariosPath, JSON.stringify([]));
    }
    const horarios = JSON.parse(fs.readFileSync(horariosPath));
    const agendados = carregarAgendamentos().map(a => a.horario);

    // Retorna apenas horários que não estão agendados
    return horarios.filter(h => !agendados.includes(h));
}

module.exports = { salvarAgendamento, carregarAgendamentos, carregarHorariosDisponiveis };
