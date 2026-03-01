// N8N Dashboard Logic

// --- CSS Variables Sync ---
const accentCyan = getComputedStyle(document.documentElement).getPropertyValue('--accent-cyan').trim();
const accentMagenta = getComputedStyle(document.documentElement).getPropertyValue('--accent-magenta').trim();
const accentGreen = getComputedStyle(document.documentElement).getPropertyValue('--accent-green').trim();

// --- RAW DATA VARIABLES ---
// NOTA: n8n webhooks por defecto aceptan POST. Si configuraste el nodo como GET, cámbialo abajo.
const N8N_WEBHOOK_EJECUCIONES = 'https://coremsa.app.n8n.cloud/webhook/dashboard-n8n?ejecuciones';
const N8N_WEBHOOK_FLUJOS = 'https://coremsa.app.n8n.cloud/webhook/dashboard-n8n?flujos';
const FETCH_METHOD = 'POST'; // Cambia a 'GET' si configuraste el webhook en n8n como GET

// Variables de estado
let n8nExecutions = [];
let n8nWorkflows = [];

// Global Chart References
let activeInactiveChartInstance = null;
let successErrorChartInstance = null;
let timeDistributionChartInstance = null;

// --- Funciones de Procesamiento de Datos ---

function processN8nData(executions, workflows) {
    // 1. Métricas Básicas de Ejecuciones
    const totalExecutionsCount = executions.length;
    let successExecutionsCount = 0;
    let errorExecutionsCount = 0;

    executions.forEach(e => {
        if (e.status === 'success') successExecutionsCount++;
        else errorExecutionsCount++; // error or crashed
    });

    const errorPercentage = totalExecutionsCount === 0 ? 0 : Math.round((errorExecutionsCount / totalExecutionsCount) * 100);

    // 2. Tiempo Promedio
    let totalTimeMs = 0;
    let validTimes = 0;
    executions.forEach(e => {
        if (e.startedAt && e.stoppedAt) {
            const start = new Date(e.startedAt).getTime();
            const stop = new Date(e.stoppedAt).getTime();
            if (stop > start) {
                totalTimeMs += (stop - start);
                validTimes++;
            }
        }
    });
    const avgTimeSeconds = validTimes === 0 ? "0.0" : (totalTimeMs / validTimes / 1000).toFixed(1);

    // 3. Métricas de Flujos (Workflows)
    const activeWorkflowsCount = workflows.filter(w => w.active === true).length;
    const totalWorkflows = workflows.length;
    const activePercentage = totalWorkflows === 0 ? 0 : Math.round((activeWorkflowsCount / totalWorkflows) * 100);

    // 4. Distribución por Tiempo (Agrupar por Fecha Corta, ej: "DD/MM")
    const dateCounts = {};
    executions.forEach(e => {
        if (!e.startedAt) return;
        const dateObj = new Date(e.startedAt);
        const dayMonth = `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;

        if (!dateCounts[dayMonth]) {
            dateCounts[dayMonth] = { success: 0, error: 0, dateObj: dateObj };
        }
        if (e.status === 'success') dateCounts[dayMonth].success++;
        else dateCounts[dayMonth].error++;
    });

    // Ordenar cronológicamente y tomar los últimos 10 días
    const sortedDates = Object.keys(dateCounts).sort((a, b) => dateCounts[a].dateObj - dateCounts[b].dateObj).slice(-10);

    const timeDistributionLabels = sortedDates;
    const timeDistributionSuccess = sortedDates.map(d => dateCounts[d].success);
    const timeDistributionError = sortedDates.map(d => dateCounts[d].error);

    // 5. Agrupación de Éxito/Error por cada Workflow ID para las barras inferiores
    const wfStats = {};
    executions.forEach(e => {
        const wid = e.workflowId;
        if (!wid) return;
        if (!wfStats[wid]) wfStats[wid] = { success: 0, error: 0 };

        if (e.status === 'success') wfStats[wid].success++;
        else wfStats[wid].error++;
    });

    // Transformar el objeto wfStats a un Array y cruzar con los nombres de n8nWorkflows
    const workflowsArray = Object.keys(wfStats).map(wid => {
        const wfInfo = workflows.find(w => w.id === wid);
        const name = wfInfo ? wfInfo.name : `Workflow ${wid}`;

        const total = wfStats[wid].success + wfStats[wid].error;
        const successPerc = total === 0 ? 0 : Math.round((wfStats[wid].success / total) * 100);
        const errorPerc = total === 0 ? 0 : Math.round((wfStats[wid].error / total) * 100);

        return {
            name: name,
            success: successPerc,
            error: errorPerc,
            totalExecs: total
        };
    });

    // Ordenar barras de abajo para mostrar los más usados primero (top 6)
    workflowsArray.sort((a, b) => b.totalExecs - a.totalExecs);
    const topWorkflows = workflowsArray.slice(0, 6);

    // Retorna la estructura lista 
    return {
        totalExecutions: totalExecutionsCount,
        activePercentage: activePercentage,
        errorPercentage: errorPercentage,
        avgTime: avgTimeSeconds,
        activeWorkflows: activeWorkflowsCount,
        nodesExecuted: "-", // No proveído en n8n webhook simplificado
        timeDistributionLabels: timeDistributionLabels,
        timeDistributionSuccess: timeDistributionSuccess,
        timeDistributionError: timeDistributionError,
        workflows: topWorkflows
    };
}


// --- Chart Rendering Functions ---

function initDonutChart(canvasId, value, color, centerTextId) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const remaining = 100 - value;

    document.getElementById(centerTextId).innerText = value;

    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Value', 'Remaining'],
            datasets: [{
                data: [value, remaining],
                backgroundColor: [color, '#2a2c3b'],
                borderWidth: 0,
                cutout: '80%',
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            animation: { animateScale: true, animateRotate: true }
        }
    });
}

function initMainChart(data) {
    const ctx = document.getElementById('timeDistributionChart').getContext('2d');

    if (timeDistributionChartInstance) {
        timeDistributionChartInstance.destroy();
    }

    timeDistributionChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.timeDistributionLabels,
            datasets: [
                {
                    label: 'Éxito',
                    data: data.timeDistributionSuccess,
                    backgroundColor: accentCyan,
                    borderWidth: 0,
                    borderRadius: 2,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                },
                {
                    label: 'Error',
                    data: data.timeDistributionError,
                    backgroundColor: accentMagenta,
                    borderWidth: 0,
                    borderRadius: 2,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(28,31,43,0.9)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#34384a',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#818a91' }
                },
                y: {
                    stacked: true,
                    grid: { color: '#34384a', drawBorder: false, borderDash: [5, 5] },
                    ticks: { color: '#818a91', stepSize: 20 }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

function renderHorizontalBars(workflows) {
    const container = document.getElementById('workflowsBarsContainer');
    container.innerHTML = '';

    workflows.forEach(wf => {
        const group = document.createElement('div');
        group.className = 'hb-group';

        group.innerHTML = `
            <div class="hb-label">
                <span>${wf.name}</span>
                <span>${wf.success}% Exito</span>
            </div>
            <div class="hb-track">
                <div class="hb-fill-success" style="width: ${wf.success}%"></div>
                <div class="hb-fill-error" style="width: ${wf.error}%"></div>
            </div>
        `;
        container.appendChild(group);
    });
}

// --- Main Update UI Function ---
function updateDashboardData(data) {
    document.getElementById('totalExecutionsCounter').innerText = data.totalExecutions.toLocaleString();
    document.getElementById('avgTime').innerHTML = `${data.avgTime}<span>s</span>`;
    document.getElementById('activeWorkflows').innerText = data.activeWorkflows;
    document.getElementById('nodesExecuted').innerHTML = `${data.nodesExecuted}`;

    if (activeInactiveChartInstance) activeInactiveChartInstance.destroy();
    if (successErrorChartInstance) successErrorChartInstance.destroy();

    activeInactiveChartInstance = initDonutChart('activeInactiveChart', data.activePercentage, accentCyan, 'activePercentage');
    successErrorChartInstance = initDonutChart('successErrorChart', data.errorPercentage, accentMagenta, 'errorPercentage');

    initMainChart(data);
    renderHorizontalBars(data.workflows);
}

// --- FETCH CRUDE DATA FROM N8N ---

async function fetchRealDataFromN8n() {
    try {
        console.log("Fetching raw data from n8n...");

        // Ejecuta ambas peticiones en paralelo
        const [execResponse, flowsResponse] = await Promise.all([
            fetch(N8N_WEBHOOK_EJECUCIONES, { method: FETCH_METHOD, headers: { 'Accept': 'application/json' } }),
            fetch(N8N_WEBHOOK_FLUJOS, { method: FETCH_METHOD, headers: { 'Accept': 'application/json' } })
        ]);

        n8nExecutions = await execResponse.json();
        n8nWorkflows = await flowsResponse.json();

        console.log(`Received ${n8nExecutions.length} executions and ${n8nWorkflows.length} workflows.`);

        // Filtros (Si los botones estuviesen conectados a fetch variables, aquí se filtrarían manualmente los arrays)
        const activeFilter = document.querySelector('.filter-btn.active').getAttribute('data-filter');
        let filteredExec = n8nExecutions;

        if (activeFilter === 'active') {
            // Solo ejecuciones success
            filteredExec = n8nExecutions.filter(e => e.status === 'success');
        } else if (activeFilter === 'error') {
            // Solo ejecuciones erróneas
            filteredExec = n8nExecutions.filter(e => e.status !== 'success');
        }

        // Procesa los datos en crudo
        const processedData = processN8nData(filteredExec, n8nWorkflows);

        // Pinta la UI
        updateDashboardData(processedData);

    } catch (error) {
        console.error("Error conectando con n8n:", error);
        // Mostrar error visual al usuario
        showFetchError(error.message);
    }
}

function showFetchError(msg) {
    document.getElementById('totalExecutionsCounter').innerText = "ERR";
    document.getElementById('avgTime').innerText = "ERR";
    document.getElementById('activeWorkflows').innerText = "ERR";

    // Mostrar banner de error si existe
    let banner = document.getElementById('errorBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'errorBanner';
        banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#ff2d6e22;border:1px solid #ff2d6e;color:#ff2d6e;padding:10px 24px;border-radius:8px;font-size:13px;z-index:9999;backdrop-filter:blur(8px);';
        document.body.appendChild(banner);
    }
    banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error al conectar con n8n: ${msg}. Verifica CORS y que el método del webhook sea correcto (POST/GET).`;
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 8000);
}

// --- Sidebar Navigation ---

const VIEWS = {
    monitor: document.querySelector ? null : null,  // siempre visible por defecto
};

function switchView(viewName) {
    const mainContent = document.querySelector('.main-content');
    const gridLayout = document.querySelector('.grid-layout');
    const topBar = document.querySelector('.top-bar');

    // Limpiar vistas dinámicas anteriores
    const dynamicView = document.getElementById('dynamicView');
    if (dynamicView) dynamicView.remove();

    if (viewName === 'monitor') {
        gridLayout.style.display = '';
        topBar.style.display = '';
        return;
    }

    // Ocultar el grid principal
    gridLayout.style.display = 'none';
    topBar.style.display = 'none';

    const div = document.createElement('div');
    div.id = 'dynamicView';
    div.style.cssText = 'padding:32px;animation:fadeIn 0.3s ease';

    if (viewName === 'workflows') {
        div.innerHTML = `
            <h2 style="color:#00e5ff;margin-bottom:20px;"><i class="fa-solid fa-network-wired"></i> Workflows</h2>
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="color:#818a91;text-align:left;">
                    <th style="padding:10px 16px;">Nombre</th>
                    <th style="padding:10px 16px;">Estado</th>
                    <th style="padding:10px 16px;">Ejecuciones</th>
                    <th style="padding:10px 16px;">Éxito</th>
                    <th style="padding:10px 16px;">Errores</th>
                </tr></thead>
                <tbody id="workflowsTableBody"></tbody>
            </table>
            </div>`;
        mainContent.appendChild(div);

        const tbody = document.getElementById('workflowsTableBody');
        if (n8nWorkflows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;color:#818a91;text-align:center;">Sin datos. Refresca primero el monitor.</td></tr>`;
        } else {
            const wfStats = {};
            n8nExecutions.forEach(e => {
                if (!e.workflowId) return;
                if (!wfStats[e.workflowId]) wfStats[e.workflowId] = { success: 0, error: 0 };
                if (e.status === 'success') wfStats[e.workflowId].success++;
                else wfStats[e.workflowId].error++;
            });
            n8nWorkflows.forEach(wf => {
                const stats = wfStats[wf.id] || { success: 0, error: 0 };
                const total = stats.success + stats.error;
                const row = document.createElement('tr');
                row.style.cssText = 'border-top:1px solid #34384a;transition:background 0.2s;';
                row.onmouseover = () => row.style.background = '#2a2c3b';
                row.onmouseout = () => row.style.background = '';
                row.innerHTML = `
                    <td style="padding:12px 16px;">${wf.name}</td>
                    <td style="padding:12px 16px;">
                        <span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;
                        background:${wf.active ? '#00e5ff22' : '#34384a'};color:${wf.active ? '#00e5ff' : '#818a91'};">
                        ${wf.active ? '● Activo' : '○ Inactivo'}</span>
                    </td>
                    <td style="padding:12px 16px;">${total}</td>
                    <td style="padding:12px 16px;color:#00e5ff;">${stats.success}</td>
                    <td style="padding:12px 16px;color:#ff2d6e;">${stats.error}</td>`;
                tbody.appendChild(row);
            });
        }

    } else if (viewName === 'errores') {
        div.innerHTML = `
            <h2 style="color:#ff2d6e;margin-bottom:20px;"><i class="fa-solid fa-bug"></i> Ejecuciones con Error</h2>
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="color:#818a91;text-align:left;">
                    <th style="padding:10px 16px;">Workflow</th>
                    <th style="padding:10px 16px;">Fecha</th>
                    <th style="padding:10px 16px;">Duración</th>
                    <th style="padding:10px 16px;">Estado</th>
                </tr></thead>
                <tbody id="errorsTableBody"></tbody>
            </table>
            </div>`;
        mainContent.appendChild(div);

        const tbody = document.getElementById('errorsTableBody');
        const errorExecs = n8nExecutions.filter(e => e.status !== 'success');
        if (errorExecs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:#818a91;text-align:center;">Sin errores recientes. ¡Todo va bien!</td></tr>`;
        } else {
            errorExecs.slice(0, 50).forEach(e => {
                const wfInfo = n8nWorkflows.find(w => w.id === e.workflowId);
                const name = wfInfo ? wfInfo.name : `Workflow ${e.workflowId || '?'}`;
                const date = e.startedAt ? new Date(e.startedAt).toLocaleString('es-ES') : '-';
                let dur = '-';
                if (e.startedAt && e.stoppedAt) {
                    const ms = new Date(e.stoppedAt) - new Date(e.startedAt);
                    dur = ms > 0 ? (ms / 1000).toFixed(1) + 's' : '-';
                }
                const row = document.createElement('tr');
                row.style.cssText = 'border-top:1px solid #34384a;transition:background 0.2s;';
                row.onmouseover = () => row.style.background = '#2a2c3b';
                row.onmouseout = () => row.style.background = '';
                row.innerHTML = `
                    <td style="padding:12px 16px;">${name}</td>
                    <td style="padding:12px 16px;color:#818a91;">${date}</td>
                    <td style="padding:12px 16px;">${dur}</td>
                    <td style="padding:12px 16px;">
                        <span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:#ff2d6e22;color:#ff2d6e;">
                        ✕ ${e.status || 'error'}</span>
                    </td>`;
                tbody.appendChild(row);
            });
        }

    } else if (viewName === 'config') {
        div.innerHTML = `
            <h2 style="color:#818a91;margin-bottom:24px;"><i class="fa-solid fa-gear"></i> Configuración</h2>
            <div style="display:flex;flex-direction:column;gap:20px;max-width:520px;">
                <div style="background:#1c1f2b;border:1px solid #34384a;border-radius:12px;padding:20px;">
                    <h4 style="color:#00e5ff;margin-bottom:12px;">Webhooks N8N</h4>
                    <label style="font-size:12px;color:#818a91;">URL Ejecuciones</label>
                    <input id="cfgExecUrl" value="${N8N_WEBHOOK_EJECUCIONES}" style="width:100%;box-sizing:border-box;background:#0d0f1a;border:1px solid #34384a;color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;margin:6px 0 12px;">
                    <label style="font-size:12px;color:#818a91;">URL Flujos</label>
                    <input id="cfgFlowsUrl" value="${N8N_WEBHOOK_FLUJOS}" style="width:100%;box-sizing:border-box;background:#0d0f1a;border:1px solid #34384a;color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;margin:6px 0 12px;">
                    <label style="font-size:12px;color:#818a91;">Método HTTP</label>
                    <select id="cfgMethod" style="background:#0d0f1a;border:1px solid #34384a;color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;margin:6px 0 12px;width:100%;">
                        <option value="POST" ${FETCH_METHOD==='POST'?'selected':''}>POST (por defecto n8n)</option>
                        <option value="GET" ${FETCH_METHOD==='GET'?'selected':''}>GET</option>
                    </select>
                    <p style="font-size:11px;color:#818a91;">⚠️ Si ves errores CORS, asegúrate de que el workflow en n8n tenga el nodo Webhook con "Allowed Origins" configurado (o <code>*</code> para pruebas).</p>
                </div>
                <div style="background:#1c1f2b;border:1px solid #34384a;border-radius:12px;padding:20px;">
                    <h4 style="color:#00e5ff;margin-bottom:12px;">Auto Refresh</h4>
                    <p style="font-size:13px;color:#818a91;">Actualmente: cada <strong style="color:#fff;">30 segundos</strong></p>
                </div>
            </div>`;
        mainContent.appendChild(div);
    }
}

// --- Event Listeners and Initialization ---

document.addEventListener('DOMContentLoaded', () => {

    const refreshBtn = document.getElementById('manualRefreshBtn');

    // Iniciar pidiendo los datos
    const icon = refreshBtn.querySelector('i');
    icon.classList.add('fa-spin');
    fetchRealDataFromN8n().finally(() => icon.classList.remove('fa-spin'));

    // Botones de filtro
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            e.target.style.transform = "scale(0.95)";
            setTimeout(() => e.target.style.transform = "scale(1)", 150);

            // Re-procesar datos basándonos en el filtro
            icon.classList.add('fa-spin');
            fetchRealDataFromN8n().finally(() => icon.classList.remove('fa-spin'));
        });
    });

    // Botón de refresco manual
    refreshBtn.addEventListener('click', () => {
        icon.classList.add('fa-spin');
        fetchRealDataFromN8n().finally(() => icon.classList.remove('fa-spin'));
    });

    // Auto-refresh cada 30 segundos
    setInterval(() => {
        console.log("Auto-refreshing...");
        refreshBtn.click();
    }, 30000);

    // --- SIDEBAR NAVIGATION ---
    const menuItems = document.querySelectorAll('.menu-item');
    const viewMap = {
        'MONITOR': 'monitor',
        'WORKFLOWS': 'workflows',
        'ERRORES': 'errores',
        'CONFIG': 'config'
    };

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const label = item.textContent.trim();
            const viewName = viewMap[label] || 'monitor';
            switchView(viewName);
        });
    });

});
