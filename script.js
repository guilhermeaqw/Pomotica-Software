// Pomotica - Sistema de produtividade criativa com projetos hierárquicos

class PomoticaApp {
    constructor() {
        this.timer = null;
        this.isRunning = false;
        this.isBreak = false;
        // Timer times will be loaded from settings
        this.workTime = 25;
        this.breakTime = 5;
        this.longBreakTime = 15;
        this.currentTime = this.workTime * 60;
        this.sessionsCompleted = 0;
        this.totalFocusTime = this.loadTotalFocusTime();
        this.projects = this.loadProjects();
        this.stats = this.loadStats();
        this.currentTheme = this.loadTheme() || 'night';
        this.productivityHistory = this.loadProductivityHistory();
        
        // Inicializar rastreamento do tema atual
        this.trackThemeUsage(this.currentTheme);
        
        // Inicializar sons
        this.initSounds();
        
        this.init();
    }

    // ====== Attachments storage (IndexedDB) ======
    initAttachmentStore() {
        return new Promise((resolve) => {
            const request = window.indexedDB.open('PomoticaDB', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('attachments')) {
                    db.createObjectStore('attachments', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => {
                this.attachmentDB = e.target.result;
                resolve();
            };
            request.onerror = () => {
                console.warn('IndexedDB não disponível; anexos grandes podem falhar.');
                resolve();
            };
        });
    }

    saveAttachmentBlob(id, file) {
        return new Promise((resolve, reject) => {
            if (!this.attachmentDB) return resolve(false);
            const tx = this.attachmentDB.transaction(['attachments'], 'readwrite');
            tx.objectStore('attachments').put({ id, blob: file });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    deleteAttachmentBlob(id) {
        return new Promise((resolve) => {
            if (!this.attachmentDB) return resolve(false);
            const tx = this.attachmentDB.transaction(['attachments'], 'readwrite');
            tx.objectStore('attachments').delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    }

    getAttachmentObjectUrl(id) {
        return new Promise((resolve) => {
            if (!this.attachmentDB) return resolve(null);
            const tx = this.attachmentDB.transaction(['attachments'], 'readonly');
            const req = tx.objectStore('attachments').get(id);
            req.onsuccess = () => {
                const rec = req.result;
                if (!rec) return resolve(null);
                const url = URL.createObjectURL(rec.blob);
                resolve(url);
            };
            req.onerror = () => resolve(null);
        });
    }

    async generateImagePreview(file, targetSizePx = 200, quality = 0.7) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(targetSizePx / img.width, targetSizePx / img.height, 1);
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(null);
            const reader = new FileReader();
            reader.onload = () => { img.src = reader.result; };
            reader.readAsDataURL(file);
        });
    }

    async generateVideoPreview(file, width = 200) {
        return new Promise((resolve) => {
            try {
                const url = URL.createObjectURL(file);
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.src = url;
                video.muted = true;
                video.playsInline = true;
                video.onloadeddata = () => {
                    const canvas = document.createElement('canvas');
                    const ratio = video.videoHeight / video.videoWidth || 1;
                    canvas.width = width;
                    canvas.height = Math.round(width * ratio);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    URL.revokeObjectURL(url);
                    resolve(dataUrl);
                };
                video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            } catch (e) {
                resolve(null);
            }
        });
    }

    openTaskDetails(projectId, taskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;

        // Fill modal fields
        document.getElementById('task-details-project-id').value = String(projectId);
        document.getElementById('task-details-task-id').value = String(taskId);
        document.getElementById('task-details-title').value = task.title || '';
        document.getElementById('task-details-desc').value = task.description || '';

        // Render attachments preview
        this.renderTaskAttachments(task.attachments || []);

        // Open modal
        const modal = document.getElementById('task-details-modal');
        if (modal) modal.style.display = 'block';

        // Bind input change
        const input = document.getElementById('task-attachments-input');
        const dropzone = document.getElementById('attachments-dropzone');
        if (input) {
            input.value = '';
            input.onchange = (e) => this.handleTaskAttachments(e);
        }
        if (dropzone) {
            dropzone.onclick = () => input && input.click();
            dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
            dropzone.ondragleave = () => dropzone.classList.remove('dragover');
            dropzone.ondrop = (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                const dtFiles = Array.from(e.dataTransfer.files || []);
                if (dtFiles.length) {
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.multiple = true;
                    const dataTransfer = new DataTransfer();
                    dtFiles.forEach(f => dataTransfer.items.add(f));
                    fileInput.files = dataTransfer.files;
                    this.handleTaskAttachments({ target: fileInput });
                }
            };
        }
    }

    handleTaskAttachments(event) {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        const projectId = parseInt(document.getElementById('task-details-project-id').value);
        const taskId = parseInt(document.getElementById('task-details-task-id').value);
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;

        task.attachments = task.attachments || [];

        const process = files.map(async (file) => {
            const id = Date.now() + Math.random();
            let previewDataUrl = null;
            if (file.type.startsWith('image/')) {
                previewDataUrl = await this.generateImagePreview(file, 220, 0.8);
            } else if (file.type.startsWith('video/')) {
                previewDataUrl = await this.generateVideoPreview(file, 220);
            }
            await this.saveAttachmentBlob(id, file).catch(() => {});
            return { id, name: file.name, type: file.type, size: file.size, previewDataUrl, hasBlob: true };
        });

        Promise.all(process).then(newItems => {
            task.attachments.push(...newItems);
            try {
                this.saveProjects();
            } catch (e) {
                console.warn('Falha ao salvar no localStorage (quota). Otimizando previews...', e);
                task.attachments.forEach(a => { if (a.previewDataUrl && a.previewDataUrl.length > 60000) a.previewDataUrl = null; });
                this.saveProjects();
            }
            this.renderTaskAttachments(task.attachments);
            this.showNotification('Anexo(s) adicionado(s) com sucesso!', 'success');
        });
    }

    renderTaskAttachments(attachments) {
        const container = document.getElementById('task-attachments-preview');
        if (!container) return;
        container.innerHTML = attachments.map(att => {
            const isImage = att.type?.startsWith('image/');
            const isVideo = att.type?.startsWith('video/');
            const isPdf = att.type === 'application/pdf';
            let thumb = '';
            if (isImage) {
                const src = att.previewDataUrl || '';
                thumb = `<img class="attachment-thumb" src="${src}" alt="${att.name}" onclick="app.viewAttachment(${att.id})">`;
            } else if (isVideo) {
                const src = att.previewDataUrl || '';
                thumb = src ? `<img class=\"attachment-thumb\" src=\"${src}\" alt=\"${att.name}\" onclick=\"app.viewAttachment(${att.id})\">` : `<div class=\"attachment-thumb\" style=\"display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);color:var(--text-secondary);font-size:20px;cursor:pointer;\" onclick=\"app.viewAttachment(${att.id})\">🎞️</div>`;
            } else if (isPdf) {
                thumb = `<div class="attachment-thumb" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03);color:var(--text-secondary);">PDF</div>`;
            } else {
                thumb = `<div class="attachment-thumb" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03);color:var(--text-secondary);">Arquivo</div>`;
            }
            const sizeKb = Math.max(1, Math.round((att.size || 0) / 1024));
            return `
                <div class="attachment-card" data-id="${att.id}">
                    ${thumb}
                    <div class="attachment-actions">
                        <button class="attachment-action-btn" onclick="app.viewAttachment(${att.id})" title="Visualizar"><i class=\"fas fa-eye\"></i></button>
                        <button class="attachment-action-btn" onclick="app.downloadAttachment(${att.id}, '${att.name.replace(/'/g, "\\'")}')" title="Baixar"><i class=\"fas fa-download\"></i></button>
                    </div>
                    <button class="attachment-remove" onclick="app.removeTaskAttachment(${att.id})" title="Remover">×</button>
                    <div class="attachment-meta">
                        <span title="${att.name}">${att.name}</span>
                        <span>${sizeKb} KB</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    async downloadAttachment(attachmentId, filename = 'arquivo') {
        if (!this.getAttachmentObjectUrl) return;
        const url = await this.getAttachmentObjectUrl(attachmentId);
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async viewAttachment(attachmentId) {
        const projectId = parseInt(document.getElementById('task-details-project-id').value);
        const taskId = parseInt(document.getElementById('task-details-task-id').value);
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;
        const att = (task.attachments || []).find(a => a.id === attachmentId);
        if (!att) return;

        const content = document.getElementById('attachment-viewer-content');
        if (!content) return;
        let html = '';
        if (att.type?.startsWith('image/')) {
            const url = this.getAttachmentObjectUrl ? await this.getAttachmentObjectUrl(att.id) : null;
            html = `<img src="${url || att.previewDataUrl || ''}" alt="${att.name}">`;
        } else if (att.type?.startsWith('video/')) {
            const url = this.getAttachmentObjectUrl ? await this.getAttachmentObjectUrl(att.id) : null;
            html = `<video src="${url || ''}" controls autoplay></video>`;
        } else if (att.type === 'application/pdf') {
            const url = this.getAttachmentObjectUrl ? await this.getAttachmentObjectUrl(att.id) : null;
            html = `<iframe src="${url || ''}" style="width:100%;height:75vh;border:0"></iframe>`;
        } else {
            html = `<div style="padding:20px;color:var(--text-secondary)">Pré-visualização não suportada. Baixe o arquivo.</div>`;
        }
        content.innerHTML = html;
        const modal = document.getElementById('attachment-viewer-modal');
        if (modal) modal.style.display = 'block';
    }

    removeTaskAttachment(attachmentId) {
        const projectId = parseInt(document.getElementById('task-details-project-id').value);
        const taskId = parseInt(document.getElementById('task-details-task-id').value);
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;
        task.attachments = (task.attachments || []).filter(a => a.id !== attachmentId);
        this.saveProjects();
        this.renderTaskAttachments(task.attachments);
    }

    saveTaskDetails() {
        const projectId = parseInt(document.getElementById('task-details-project-id').value);
        const taskId = parseInt(document.getElementById('task-details-task-id').value);
        const title = document.getElementById('task-details-title').value.trim();
        const desc = document.getElementById('task-details-desc').value.trim();
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;

        if (title.length === 0) {
            this.showNotification('O título não pode ser vazio.', 'error');
            return;
        }

        task.title = title;
        task.description = desc;
        this.saveProjects();
        this.renderProjects();
        this.showNotification('Tarefa atualizada!', 'success');
        this.closeModal('task-details-modal');
    }
    init() {
        this.applyTheme(this.currentTheme);
        this.setupEventListeners();
        this.resetDailyTasks();
        
        // Inicializar armazenamento de anexos (IndexedDB) de forma assíncrona
        this.initAttachmentStore && this.initAttachmentStore();
        
        // Aguardar DOM estar pronto antes de renderizar
        setTimeout(() => {
            this.renderProjects();
            this.updateStats();
            this.renderDashboard();
            this.initializeCreditsTab();
            this.setupFloatingPomodoro();
            this.collapseCompletedTasksUI && this.collapseCompletedTasksUI();
            this.setupUpdateBar && this.setupUpdateBar();
        }, 100);

        // Observar mudanças para manter tarefas concluídas recolhidas
        this.setupCompletedCollapseObserver && this.setupCompletedCollapseObserver();
    }

    initSounds() {
        // Inicializar Web Audio API
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('Web Audio API não suportada:', e);
        }
    }

    playStartSound() {
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
            oscillator.frequency.setValueAtTime(1000, this.audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.2);
        } catch (e) {
            console.log('Erro ao reproduzir som de início:', e);
        }
    }

    playEndSound() {
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Som de notificação mais longo
            oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime);
            oscillator.frequency.setValueAtTime(400, this.audioContext.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime + 0.2);
            
            gainNode.gain.setValueAtTime(0.5, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.5);
        } catch (e) {
            console.log('Erro ao reproduzir som de fim:', e);
        }
    }

    playPauseSound() {
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Som curto e suave para pausa
            oscillator.frequency.setValueAtTime(500, this.audioContext.currentTime);
            oscillator.frequency.setValueAtTime(300, this.audioContext.currentTime + 0.05);
            
            gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.1);
        } catch (e) {
            console.log('Erro ao reproduzir som de pausa:', e);
        }
    }

    playTaskCompleteSound() {
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Som de sucesso - duas notas ascendentes
            oscillator.frequency.setValueAtTime(523, this.audioContext.currentTime); // C5
            oscillator.frequency.setValueAtTime(659, this.audioContext.currentTime + 0.1); // E5
            
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.4);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.4);
        } catch (e) {
            console.log('Erro ao reproduzir som de conclusão de tarefa:', e);
        }
    }

    createTaskCompleteEffect(buttonElement) {
        // Criar elemento de efeito
        const effect = document.createElement('div');
        effect.className = 'task-complete-effect';
        
        // Posicionar o efeito sobre o botão
        const rect = buttonElement.getBoundingClientRect();
        effect.style.position = 'fixed';
        effect.style.left = rect.left + rect.width / 2 + 'px';
        effect.style.top = rect.top + rect.height / 2 + 'px';
        effect.style.width = '20px';
        effect.style.height = '20px';
        effect.style.borderRadius = '50%';
        effect.style.background = 'radial-gradient(circle, rgba(76, 175, 80, 0.8) 0%, rgba(76, 175, 80, 0.4) 50%, transparent 100%)';
        effect.style.pointerEvents = 'none';
        effect.style.zIndex = '9999';
        effect.style.transform = 'translate(-50%, -50%)';
        effect.style.animation = 'taskCompletePulse 0.6s ease-out forwards';
        
        // Adicionar ao DOM
        document.body.appendChild(effect);
        
        // Remover após a animação
        setTimeout(() => {
            if (effect.parentNode) {
                effect.parentNode.removeChild(effect);
            }
        }, 600);
    }

    resetDailyTasks() {
        const today = new Date().toDateString();
        const lastReset = localStorage.getItem('pomotica-last-reset');
        
        if (lastReset !== today) {
            // Resetar tarefas diárias para o novo dia
            this.projects.forEach(project => {
                project.tasks.forEach(task => {
                    if (task.isDaily) {
                        const lastCompleted = task.lastCompleted ? new Date(task.lastCompleted).toDateString() : null;
                        if (lastCompleted !== today) {
                            task.status = 'pending';
                        }
                    }
                });
            });
            
            this.saveProjects();
            localStorage.setItem('pomotica-last-reset', today);
        }
    }

    setupEventListeners() {
        // Timer controls (aguardar DOM carregar)
        setTimeout(() => {
            const startBtn = document.getElementById('start-btn');
            const pauseBtn = document.getElementById('pause-btn');
            const resetBtn = document.getElementById('reset-btn');

            if (startBtn) startBtn.addEventListener('click', () => this.startTimer());
            if (pauseBtn) pauseBtn.addEventListener('click', () => this.pauseTimer());
            if (resetBtn) resetBtn.addEventListener('click', () => this.resetTimer());

            // Inputs da aba Pomodoro (fora das Configurações)
            const workTimeInput = document.getElementById('work-time');
            const breakTimeInput = document.getElementById('break-time');
            const longBreakTimeInput = document.getElementById('long-break-time');

            const syncSettingsInputs = () => {
                const sWork = document.getElementById('work-duration');
                const sBreak = document.getElementById('short-break-duration');
                const sLong = document.getElementById('long-break-duration');
                if (sWork && workTimeInput) sWork.value = workTimeInput.value;
                if (sBreak && breakTimeInput) sBreak.value = breakTimeInput.value;
                if (sLong && longBreakTimeInput) sLong.value = longBreakTimeInput.value;
            };

            const applyTimerChange = () => {
                // Atualiza variáveis internas
                this.workTime = parseInt(workTimeInput?.value || this.workTime);
                this.breakTime = parseInt(breakTimeInput?.value || this.breakTime);
                this.longBreakTime = parseInt(longBreakTimeInput?.value || this.longBreakTime);
                // Atualiza tempo atual se não estiver rodando
                if (!this.isRunning) {
                    const label = document.getElementById('timer-label');
                    if (label && label.textContent === 'Trabalho') {
                        this.currentTime = this.workTime * 60;
                    } else {
                        const nextBreak = (this.sessionsCompleted % (this.pomodorosUntilLongBreak || 4) === 0) ? this.longBreakTime : this.breakTime;
                        this.currentTime = nextBreak * 60;
                    }
                    this.updateTimerDisplay();
                }
            };

            const persistSettings = () => {
                // Sincroniza inputs da aba Configurações e salva
                syncSettingsInputs();
                this.saveSettings();
            };

            if (workTimeInput) {
                workTimeInput.addEventListener('change', () => { applyTimerChange(); persistSettings(); });
            }
            if (breakTimeInput) {
                breakTimeInput.addEventListener('change', () => { applyTimerChange(); persistSettings(); });
            }
            if (longBreakTimeInput) {
                longBreakTimeInput.addEventListener('change', () => { applyTimerChange(); persistSettings(); });
            }
        }, 100);

        // Tab switching (aguardar DOM carregar)
        setTimeout(() => {
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.switchTab(e.target.getAttribute('data-tab'));
                });
            });
            
            // Sidebar navigation
            document.querySelectorAll('.nav-item').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const tabName = e.currentTarget.getAttribute('data-tab');
                    if (tabName) {
                        this.switchTab(tabName);
                    }
                });
            });
        }, 100);


        // Filter buttons (aguardar DOM carregar)
        setTimeout(() => {
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.setActiveFilter(e.target);
                    this.renderProjects();
                });
            });
        }, 100);

        // Modal controls
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id);
            }
        });

        // Configurar botões de tema (aguardar DOM carregar)
        setTimeout(() => {
            const themeButtons = document.querySelectorAll('.theme-btn');
            themeButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const theme = btn.getAttribute('data-theme');
                    this.changeTheme(theme);
                });
            });
            
            // Marcar botão ativo
            this.updateActiveThemeButton();
        }, 100);

        // Configurar input de cor (aguardar DOM carregar)
        setTimeout(() => {
            const colorInput = document.getElementById('project-color');
            if (colorInput) {
                colorInput.addEventListener('input', (e) => {
                    this.updateColorPresets(e.target.value);
                    const preview = document.getElementById('project-color-preview');
                    if (preview) preview.style.backgroundColor = e.target.value;
                });
            }
        }, 100);

        // Form submissions (aguardar DOM carregar)
        setTimeout(() => {
            const addProjectForm = document.getElementById('add-project-form');
            const addTaskForm = document.getElementById('add-task-form');
            const addSubtaskForm = document.getElementById('add-subtask-form');

            if (addProjectForm) {
                addProjectForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addProject();
                });
            }

            if (addTaskForm) {
                addTaskForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    console.log('📝 Formulário de tarefa submetido');
                    this.addTask();
                });
            }

            if (addSubtaskForm) {
                addSubtaskForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addSubtask();
                });
            }

        }, 100);

        // Priority selector (aguardar DOM carregar)
        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (e.target.closest('.priority-btn')) {
                    const btn = e.target.closest('.priority-btn');
                    const priority = btn.getAttribute('data-priority');
                    
                    // Remove active class from all buttons in the same container
                    btn.parentElement.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
                    // Add active class to clicked button
                    btn.classList.add('active');
                    
                    // Update the correct hidden input based on which modal is open
                    const modal = btn.closest('.modal');
                    if (modal) {
                        if (modal.id === 'add-task-modal') {
                            document.getElementById('task-priority').value = priority;
                        } else if (modal.id === 'add-subtask-modal') {
                            document.getElementById('subtask-priority').value = priority;
                        }
                    }
                }
                
                if (e.target.closest('.task-type-btn')) {
                    const btn = e.target.closest('.task-type-btn');
                    const type = btn.getAttribute('data-type');
                    
                    // Remove active class from all buttons
                    btn.parentElement.querySelectorAll('.task-type-btn').forEach(b => b.classList.remove('active'));
                    // Add active class to clicked button
                    btn.classList.add('active');
                    // Update hidden input
                    document.getElementById('task-daily').value = type === 'daily' ? 'true' : 'false';
                }
                
                if (e.target.closest('.color-preset')) {
                    const btn = e.target.closest('.color-preset');
                    const color = btn.getAttribute('data-color');
                    const colorInput = document.getElementById('project-color');
                    
                    // Atualizar o input de cor
                    colorInput.value = color;
                    
                    // Disparar evento de mudança para atualizar visualmente
                    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    // Remover seleção anterior
                    document.querySelectorAll('.color-preset').forEach(preset => {
                        preset.classList.remove('selected');
                    });
                    
                    // Marcar cor selecionada
                    btn.classList.add('selected');
                }
            });
        }, 100);
    }

    initializeCreditsTab() {
        // Garantir que a aba de créditos seja inicializada corretamente
        const creditsTab = document.getElementById('credits');
        const creditsContainer = document.querySelector('.credits-container');
        
        if (creditsTab && creditsContainer) {
            creditsContainer.style.opacity = '1';
            creditsContainer.style.transform = 'translateY(0)';
        }
    }

    setupFloatingPomodoro() {
        const floatingPomodoro = document.getElementById('floating-pomodoro');
        const showPomodoroBtn = document.getElementById('show-pomodoro-btn');
        const floatingStart = document.getElementById('floating-start');
        const floatingPause = document.getElementById('floating-pause');
        const floatingReset = document.getElementById('floating-reset');
        const floatingMinimize = document.getElementById('floating-minimize');

        if (floatingStart) floatingStart.addEventListener('click', () => this.startTimer());
        if (floatingPause) floatingPause.addEventListener('click', () => this.pauseTimer());
        if (floatingReset) floatingReset.addEventListener('click', () => this.resetTimer());
        if (floatingMinimize) floatingMinimize.addEventListener('click', () => this.hideFloatingPomodoro());
        if (showPomodoroBtn) showPomodoroBtn.addEventListener('click', () => this.showFloatingPomodoro());

        // Mostrar botão flutuante se timer estiver ativo
        this.updateFloatingPomodoroVisibility();
    }

    showFloatingPomodoro() {
        const floatingPomodoro = document.getElementById('floating-pomodoro');
        const showPomodoroBtn = document.getElementById('show-pomodoro-btn');
        
        if (floatingPomodoro) floatingPomodoro.classList.remove('hidden');
        if (showPomodoroBtn) showPomodoroBtn.classList.add('hidden');
    }

    hideFloatingPomodoro() {
        const floatingPomodoro = document.getElementById('floating-pomodoro');
        const showPomodoroBtn = document.getElementById('show-pomodoro-btn');
        
        if (floatingPomodoro) floatingPomodoro.classList.add('hidden');
        if (showPomodoroBtn) showPomodoroBtn.classList.remove('hidden');
    }

    updateFloatingPomodoroVisibility() {
        const floatingPomodoro = document.getElementById('floating-pomodoro');
        const showPomodoroBtn = document.getElementById('show-pomodoro-btn');
        
        if (this.isRunning || this.isBreak) {
            if (floatingPomodoro) floatingPomodoro.classList.remove('hidden');
            if (showPomodoroBtn) showPomodoroBtn.classList.add('hidden');
        } else {
            if (floatingPomodoro) floatingPomodoro.classList.add('hidden');
            if (showPomodoroBtn) showPomodoroBtn.classList.remove('hidden');
        }
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        
        const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
        const tabContent = document.getElementById(tabName);
        const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
        
        if (tabBtn) tabBtn.classList.add('active');
        if (navItem) navItem.classList.add('active');
        if (tabContent) {
            tabContent.classList.add('active');
            
            // Garantir que o conteúdo da aba de créditos seja renderizado corretamente
            if (tabName === 'credits') {
                setTimeout(() => {
                    const creditsContainer = document.querySelector('.credits-container');
                    if (creditsContainer) {
                        creditsContainer.style.opacity = '1';
                        creditsContainer.style.transform = 'translateY(0)';
                    }
                }, 50);
            }
        }
    }

    // Timer functionality
    startTimer() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.timer = setInterval(() => {
                this.currentTime--;
                this.updateTimerDisplay();
                
                if (this.currentTime <= 0) {
                    this.completeSession();
                }
            }, 1000);
            
            document.getElementById('start-btn').disabled = true;
            document.getElementById('pause-btn').disabled = false;
            
            // Tocar som de início
            this.playStartSound();
            
            // Atualizar visibilidade do botão flutuante
            this.updateFloatingPomodoroVisibility();
        }
    }

    pauseTimer() {
        if (this.isRunning) {
            this.isRunning = false;
            clearInterval(this.timer);
            
            document.getElementById('start-btn').disabled = false;
            document.getElementById('pause-btn').disabled = true;
            
            // Tocar som de pausa
            this.playPauseSound();
            
            // Atualizar visibilidade do botão flutuante
            this.updateFloatingPomodoroVisibility();
        }
    }

    resumeTimer() {
        if (!this.isRunning && this.currentTime > 0) {
            this.isRunning = true;
            this.timer = setInterval(() => {
                this.currentTime--;
                this.updateTimerDisplay();
                
                if (this.currentTime <= 0) {
                    this.completeSession();
                }
            }, 1000);
            
            document.getElementById('start-btn').disabled = true;
            document.getElementById('pause-btn').disabled = false;
        }
    }

    resetTimer() {
        this.isRunning = false;
        clearInterval(this.timer);
        this.currentTime = this.isBreak ? this.breakTime * 60 : this.workTime * 60;
        
        document.getElementById('start-btn').disabled = false;
        document.getElementById('pause-btn').disabled = true;
        this.updateTimerDisplay();
        
        // Atualizar visibilidade do botão flutuante
        this.updateFloatingPomodoroVisibility();
        
        // Iniciar automaticamente após reset
        setTimeout(() => {
            this.startTimer();
        }, 500);
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.currentTime / 60);
        const seconds = this.currentTime % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) timerDisplay.textContent = timeString;

        // Atualizar botão flutuante
        const floatingTimer = document.getElementById('floating-timer');
        const floatingStatus = document.getElementById('floating-status');
        
        if (floatingTimer) floatingTimer.textContent = timeString;
        if (floatingStatus) floatingStatus.textContent = this.isBreak ? 'Pausa' : 'Foco';

        // Enviar tick para o processo principal (tray)
        if (window.electron && window.electron.timerTick) {
            window.electron.timerTick({ time: timeString, isBreak: this.isBreak });
        }

        // Atualizar visibilidade do botão flutuante
        this.updateFloatingPomodoroVisibility();
    }

    completeSession() {
        this.isRunning = false;
        clearInterval(this.timer);
        
        // Tocar som de fim
        this.playEndSound();
        
        // Notificação nativa
        try {
            const body = this.isBreak ? 'Pausa concluída. Hora de focar!' : 'Sessão de trabalho concluída. Faça uma pausa.';
            if (typeof Notification !== 'undefined') {
                new Notification('Pomotica', { body });
            }
        } catch (_) {}
        
        if (!this.isBreak) {
            this.sessionsCompleted++;
            const addedSeconds = this.workTime * 60;
            this.totalFocusTime += addedSeconds;
            this.saveTotalFocusTime();
            // Histórico real
            this.addHistoryFocus(addedSeconds);
            this.addHistoryPomodoro(1);
            
            this.addXP(15, 'Pomodoro completado');
            
            this.isBreak = true;
            this.currentTime = this.sessionsCompleted % this.pomodorosUntilLongBreak === 0 ? this.longBreakTime * 60 : this.breakTime * 60;
            const label = document.getElementById('timer-label');
            if (label) label.textContent = 'Descanso';
        } else {
            this.isBreak = false;
            this.currentTime = this.workTime * 60;
            const label = document.getElementById('timer-label');
            if (label) label.textContent = 'Trabalho';
        }
        
        const startBtn = document.getElementById('start-btn');
        const pauseBtn = document.getElementById('pause-btn');
        if (startBtn) startBtn.disabled = false;
        if (pauseBtn) pauseBtn.disabled = true;
        this.updateTimerDisplay();
        this.updateStats();
    }

    // Project management
    addProject() {
        const title = document.getElementById('project-title').value;
        const description = document.getElementById('project-description').value;
        const color = document.getElementById('project-color').value;
        const deadline = document.getElementById('project-deadline').value;

        const project = {
            id: Date.now(),
            title,
            description,
            color,
            deadline,
            status: 'active',
            createdAt: new Date().toISOString(),
            showCompleted: false,
            tasks: []
        };

        this.projects.push(project);
        this.saveProjects();
        this.renderProjects();
        this.renderDashboard();
        this.closeModal('add-project-modal');
        this.clearProjectForm();
    }

    addTask() {
        console.log('🔄 addTask chamado');
        
        const projectId = parseInt(document.getElementById('task-project').value);
        const title = document.getElementById('task-title').value;
        const description = document.getElementById('task-description').value;
        const priority = document.getElementById('task-priority').value;
        const isDaily = document.getElementById('task-daily').value === 'true';

        console.log('📋 Dados da tarefa:', { projectId, title, description, priority, isDaily });

        // Validação básica
        if (!title || title.trim() === '') {
            this.showNotification('Por favor, insira um título para a tarefa!', 'error');
            return;
        }

        const task = {
            id: Date.now(),
            title: title.trim(),
            description: description.trim(),
            priority,
            status: 'pending',
            isDaily,
            createdAt: new Date().toISOString(),
            lastCompleted: null,
            subtasks: []
        };

        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            project.tasks.push(task);
            console.log('✅ Tarefa adicionada ao projeto:', project.name);
            
            this.saveProjects();
            this.renderProjects();
            this.renderDashboard();
            
            console.log('🔄 Fechando modal...');
            this.closeModal('add-task-modal');
            this.clearTaskForm();
            
            this.showNotification('Tarefa criada com sucesso!', 'success');
        } else {
            console.log('❌ Projeto não encontrado:', projectId);
            this.showNotification('Erro: Projeto não encontrado!', 'error');
        }
    }

    addSubtask() {
        const taskId = parseInt(document.getElementById('subtask-title').getAttribute('data-task-id'));
        const title = document.getElementById('subtask-title').value;
        const description = document.getElementById('subtask-description').value;
        const priority = document.getElementById('subtask-priority').value;

        const subtask = {
            id: Date.now(),
            title,
            description,
            priority,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        // Find task in projects
        for (const project of this.projects) {
            const task = project.tasks.find(t => t.id === taskId);
            if (task) {
                task.subtasks.push(subtask);
                this.saveProjects();
                this.renderProjects();
                this.closeModal('add-subtask-modal');
                this.clearSubtaskForm();
                break;
            }
        }
    }

    toggleTaskStatus(projectId, taskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) return;

        const wasCompleted = task.status === 'completed';
        if (task.isDaily) {
            const today = new Date().toDateString();
            const lastCompleted = task.lastCompleted ? new Date(task.lastCompleted).toDateString() : null;
            if (task.status === 'completed' && lastCompleted === today) return;
            if (task.status === 'pending' || lastCompleted !== today) {
                task.status = 'completed';
                task.lastCompleted = new Date().toISOString();
                this.addXP(10, `Tarefa diária "${task.title}" concluída`);
                this.playTaskCompleteSound();
                this.addHistoryTaskCompleted(1);
            }
        } else {
            task.status = wasCompleted ? 'pending' : 'completed';
            if (!wasCompleted && task.status === 'completed') {
                task.lastCompleted = new Date().toISOString();
                this.addXP(10, `Tarefa "${task.title}" concluída`);
                this.playTaskCompleteSound();
                this.addHistoryTaskCompleted(1);
            } else if (wasCompleted && task.status === 'pending') {
                this.addHistoryTaskCompleted(-1);
            }
        }

        this.saveProjects();
        this.renderProjects();
        this.renderDashboard();
        this.updateStats();
    }

    toggleSubtaskStatus(projectId, taskId, subtaskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            const task = project.tasks.find(t => t.id === taskId);
            if (task) {
                const subtask = task.subtasks.find(s => s.id === subtaskId);
                if (subtask) {
                    subtask.status = subtask.status === 'completed' ? 'pending' : 'completed';
                    this.saveProjects();
                    this.renderProjects();
                    this.updateStats();
                }
            }
        }
    }

    deleteProject(projectId) {
        console.log('🗑️ deleteProject chamado:', { projectId });
        console.log('📊 Projetos antes da exclusão:', this.projects.map(p => ({ id: p.id, title: p.title })));
        
        const project = this.projects.find(p => p.id === projectId);
        if (!project) {
            console.error('❌ Projeto não encontrado:', projectId);
            return;
        }
        
        console.log('📋 Projeto encontrado:', {
            name: project.title,
            tasks: project.tasks.length,
            status: project.status
        });
        
        // Verificar se deve pedir confirmação
        const shouldConfirm = this.settings?.confirmDelete !== false; // Default é true se não definido
        
        if (!shouldConfirm || confirm(`Tem certeza que deseja excluir o projeto "${project.title}"?\n\n⚠️ Esta ação não pode ser desfeita!\n📋 ${project.tasks.length} tarefa(s) serão perdida(s).`)) {
            console.log('✅ Confirmação recebida, excluindo projeto...');
            
            // Filtrar o projeto excluído
            const originalLength = this.projects.length;
            this.projects = this.projects.filter(p => p.id !== projectId);
            
            console.log('📊 Projetos após exclusão:', this.projects.map(p => ({ id: p.id, title: p.title })));
            console.log('💾 Projetos restantes:', this.projects.length, '(era:', originalLength, ')');
            
            // Salvar imediatamente
            this.saveProjects();
            
            // Verificar se foi salvo corretamente
            const savedData = localStorage.getItem('pomotica-projects');
            const parsedData = JSON.parse(savedData);
            console.log('🔍 Verificação localStorage após exclusão:', parsedData.map(p => ({ id: p.id, title: p.title })));
            
            this.renderProjects();
            this.updateStats();
            this.renderDashboard();
            
            console.log('✅ Projeto excluído com sucesso!');
        } else {
            console.log('❌ Exclusão cancelada pelo usuário');
        }
    }

    deleteTask(projectId, taskId) {
        console.log('🗑️ deleteTask chamado:', { projectId, taskId });
        
        const project = this.projects.find(p => p.id === projectId);
        if (!project) {
            console.error('❌ Projeto não encontrado:', projectId);
            return;
        }
        
        console.log('📋 Tarefas antes da exclusão:', project.tasks.length);
        const taskToDelete = project.tasks.find(t => t.id === taskId);
        console.log('🎯 Tarefa a ser excluída:', taskToDelete?.name || 'Não encontrada');
        
        if (confirm('Tem certeza que deseja excluir esta tarefa?')) {
            project.tasks = project.tasks.filter(t => t.id !== taskId);
            console.log('✅ Tarefas após exclusão:', project.tasks.length);
            
            this.saveProjects();
            this.renderProjects();
            this.updateStats();
            this.renderDashboard();
            
            console.log('💾 Projetos salvos e interface atualizada');
        }
    }

    deleteSubtask(projectId, taskId, subtaskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            const task = project.tasks.find(t => t.id === taskId);
            if (task && confirm('Tem certeza que deseja excluir esta subtarefa?')) {
                task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);
                this.saveProjects();
                this.renderProjects();
                this.renderDashboard();
                this.updateStats();
            }
        }
    }

    toggleSubtasks(projectId, taskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            const task = project.tasks.find(t => t.id === taskId);
            if (task) {
                // Toggle expanded state
                task.expanded = !task.expanded;
                
                // Update the UI
                const subtasksSection = document.getElementById(`subtasks-${projectId}-${taskId}`);
                const expandBtn = document.querySelector(`[onclick="app.toggleSubtasks(${projectId}, ${taskId})"]`);
                
                if (subtasksSection && expandBtn) {
                    if (task.expanded) {
                        subtasksSection.classList.remove('collapsed');
                        subtasksSection.classList.add('expanded');
                        expandBtn.querySelector('i').className = 'fas fa-chevron-up';
                    } else {
                        subtasksSection.classList.remove('expanded');
                        subtasksSection.classList.add('collapsed');
                        expandBtn.querySelector('i').className = 'fas fa-chevron-down';
                    }
                }
                
                // Save the state
                this.saveProjects();
            }
        }
    }

    setProjectStatus(projectId, status) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            project.status = status;
            this.saveProjects();
            this.renderProjects();
            this.updateStats();
        }
    }

    // Toggle project group collapse/expand
    toggleProjectGroup(projectId) {
        const projectGroup = document.querySelector(`[data-project-id="${projectId}"]`);
        if (!projectGroup) return;
        
        const groupTitle = projectGroup.querySelector('.group-title');
        const groupTasks = projectGroup.querySelector('.group-tasks');
        const chevronIcon = groupTitle.querySelector('i');
        
        if (groupTasks.classList.contains('collapsed')) {
            // Expand
            groupTasks.classList.remove('collapsed');
            groupTitle.classList.remove('collapsed');
            chevronIcon.style.transform = 'rotate(0deg)';
        } else {
            // Collapse
            groupTasks.classList.add('collapsed');
            groupTitle.classList.add('collapsed');
            chevronIcon.style.transform = 'rotate(-90deg)';
        }
    }

    // Dashboard Incrível - Funcionalidades Avançadas
    initializeDashboard() {
        this.setupCharts();
        this.loadAchievements();
        this.updateDailyGoals();
        this.setupChartControls();
        this.initializeXPSystem();
        this.setupComparisonControls();
        this.updatePeriodComparison();
        this.initializeSettings();
        this.loadTimerSettings();
        this.initializeProfile();
    }

    setupCharts() {
        const productivityCtx = document.getElementById('productivity-chart');
        if (productivityCtx) {
            if (this.productivityChart) this.productivityChart.destroy();
            const last7 = this.getHistoryLastNDays(7);
            const labels = last7.map(d => ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.date.getDay()]);
            const data = last7.map(d => Math.floor((d.rec.focusTime || 0) / 60));
            this.productivityChart = new Chart(productivityCtx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Minutos Focados',
                        data,
                        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary'),
                        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').replace(')', ', 0.1)').replace('rgb', 'rgba'),
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: 'var(--text-primary)' } } }, scales: { x: { ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--border-secondary)' } }, y: { ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--border-secondary)' } } } }
            });
        }

        const tasksCtx = document.getElementById('tasks-chart');
        if (tasksCtx) {
            if (this.tasksChart) this.tasksChart.destroy();
            const today = this.productivityHistory[new Date().toDateString()] || { tasksCompleted: 0 };
            const totalTasks = this.projects.reduce((s, p) => s + p.tasks.length, 0);
            const completed = this.projects.reduce((s, p) => s + p.tasks.filter(t => t.status === 'completed').length, 0);
            const pending = Math.max(0, totalTasks - completed);
            const paused = 0;
            this.tasksChart = new Chart(tasksCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Concluídas', 'Pendentes', 'Pausadas'],
                    datasets: [{
                        data: [completed, pending, paused],
                        backgroundColor: ['rgba(76, 175, 80, 0.8)','rgba(255, 193, 7, 0.8)','rgba(244, 67, 54, 0.8)'],
                        borderColor: ['rgba(76, 175, 80, 1)','rgba(255, 193, 7, 1)','rgba(244, 67, 54, 1)'],
                        borderWidth: 2
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-primary)', padding: 20 } } } }
            });
        }
    }

    setupChartControls() {
        document.querySelectorAll('.chart-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                const period = e.target.getAttribute('data-period');
                this.updateProductivityChart(period);
            });
        });
    }

    updateProductivityChart(period) {
        if (!this.productivityChart) return;
        
        const data = period === 'week' 
            ? [120, 180, 90, 240, 200, 150, 100]
            : [800, 1200, 900, 1500, 1300, 1100, 800];
        
        this.productivityChart.data.datasets[0].data = data;
        this.productivityChart.update();
    }

    updateChartColors() {
        if (this.productivityChart) {
            const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary');
            const accentColorRgba = accentColor.replace(')', ', 0.1)').replace('rgb', 'rgba');
            
            this.productivityChart.data.datasets[0].borderColor = accentColor;
            this.productivityChart.data.datasets[0].backgroundColor = accentColorRgba;
            this.productivityChart.update();
        }
    }

    loadAchievements() {
        const achievements = [
            { id: 'first_pomodoro', icon: '🍅', name: 'Primeiro Pomodoro', desc: 'Complete sua primeira sessão', unlocked: this.sessionsCompleted >= 1 },
            { id: 'task_master', icon: '✅', name: 'Mestre das Tarefas', desc: 'Complete 10 tarefas', unlocked: this.getTotalCompletedTasks() >= 10 },
            { id: 'early_bird', icon: '🌅', name: 'Madrugador', desc: 'Trabalhe antes das 8h', unlocked: this.hasWorkedEarly() },
            { id: 'night_owl', icon: '🦉', name: 'Coruja Noturna', desc: 'Trabalhe após 22h', unlocked: this.hasWorkedLate() },
            { id: 'speed_demon', icon: '⚡', name: 'Demônio da Velocidade', desc: 'Complete 5 tarefas em 1h', unlocked: this.hasCompletedTasksFast() },
            { id: 'perfectionist', icon: '💎', name: 'Perfeccionista', desc: '100% de tarefas concluídas', unlocked: this.hasPerfectCompletion() },
            { id: 'marathon', icon: '🏃', name: 'Maratonista', desc: '4h de foco em um dia', unlocked: this.hasMarathonSession() },
            { id: 'team_player', icon: '👥', name: 'Jogador de Equipe', desc: 'Colabore em 3 projetos', unlocked: this.projects.length >= 3 },
            { id: 'innovator', icon: '💡', name: 'Inovador', desc: 'Crie 5 projetos únicos', unlocked: this.projects.length >= 5 },
            { id: 'zen_master', icon: '🧘', name: 'Mestre Zen', desc: 'Use todos os temas', unlocked: this.hasUsedAllThemes() },
            { id: 'efficiency_guru', icon: '📊', name: 'Guru da Eficiência', desc: 'Mantenha 90%+ de eficiência', unlocked: this.hasHighEfficiency() },
            { id: 'legend', icon: '🏆', name: 'Lenda', desc: 'Desbloqueie todas as conquistas', unlocked: false },
            // Novas conquistas
            { id: 'streak_master', icon: '🔥', name: 'Mestre da Sequência', desc: 'Mantenha uma sequência de 7 dias', unlocked: this.getCurrentStreak() >= 7 },
            { id: 'xp_hunter', icon: '⭐', name: 'Caçador de XP', desc: 'Acumule 1000 XP', unlocked: this.xpData?.totalXP >= 1000 },
            { id: 'daily_warrior', icon: '🗡️', name: 'Guerreiro Diário', desc: 'Complete 5 tarefas diárias', unlocked: this.getDailyTasksCompleted() >= 5 },
            { id: 'time_master', icon: '⏰', name: 'Mestre do Tempo', desc: 'Complete 50 pomodoros', unlocked: this.sessionsCompleted >= 50 },
            { id: 'project_builder', icon: '🏗️', name: 'Construtor de Projetos', desc: 'Complete 3 projetos', unlocked: this.getCompletedProjects() >= 3 },
            { id: 'focus_champion', icon: '🎯', name: 'Campeão do Foco', desc: '10h de foco total', unlocked: this.totalFocusTime >= 36000 }
        ];

        const container = document.getElementById('achievements-grid');
        const countElement = document.getElementById('achievement-count');
        
        if (container) {
            container.innerHTML = achievements.map(achievement => `
                <div class="achievement-badge ${achievement.unlocked ? 'unlocked' : ''}" 
                     title="${achievement.desc}">
                    <div class="achievement-icon">${achievement.icon}</div>
                    <div class="achievement-name">${achievement.name}</div>
                    <div class="achievement-desc">${achievement.desc}</div>
                </div>
            `).join('');
        }
        
        if (countElement) {
            const unlockedCount = achievements.filter(a => a.unlocked).length;
            countElement.textContent = `${unlockedCount}/${achievements.length}`;
        }
        
        return achievements;
    }
    
    // Funções auxiliares para verificar conquistas
    getTotalCompletedTasks() {
        return this.projects.reduce((sum, project) => 
            sum + project.tasks.filter(task => task.status === 'completed').length, 0);
    }
    
    hasWorkedEarly() {
        // Verificar se trabalhou antes das 8h (simplificado)
        const now = new Date();
        return now.getHours() < 8 && this.sessionsCompleted > 0;
    }
    
    hasWorkedLate() {
        // Verificar se trabalhou após 22h (simplificado)
        const now = new Date();
        return now.getHours() >= 22 && this.sessionsCompleted > 0;
    }
    
    hasCompletedTasksFast() {
        // Verificar se completou 5 tarefas em 1h (simplificado)
        return this.getTotalCompletedTasks() >= 5;
    }
    
    hasPerfectCompletion() {
        const totalTasks = this.projects.reduce((sum, project) => sum + project.tasks.length, 0);
        const completedTasks = this.getTotalCompletedTasks();
        return totalTasks > 0 && completedTasks === totalTasks;
    }
    
    hasMarathonSession() {
        // Verificar se teve 4h de foco em um dia (simplificado)
        return this.totalFocusTime >= 14400; // 4 horas em segundos
    }
    
    hasUsedAllThemes() {
        // Verificar se usou todos os temas
        const usedThemes = JSON.parse(localStorage.getItem('pomotica-used-themes') || '[]');
        const allThemes = ['aurora', 'ocean', 'sakura', 'moon', 'sunset', 'night'];
        
        // Adicionar tema atual se não estiver na lista
        if (!usedThemes.includes(this.currentTheme)) {
            usedThemes.push(this.currentTheme);
            localStorage.setItem('pomotica-used-themes', JSON.stringify(usedThemes));
        }
        
        return allThemes.every(theme => usedThemes.includes(theme));
    }
    
    getUnusedThemes() {
        const usedThemes = JSON.parse(localStorage.getItem('pomotica-used-themes') || '[]');
        const allThemes = ['aurora', 'ocean', 'sakura', 'moon', 'sunset', 'night'];
        return allThemes.filter(theme => !usedThemes.includes(theme));
    }
    
    hasHighEfficiency() {
        const totalTasks = this.projects.reduce((sum, project) => sum + project.tasks.length, 0);
        const completedTasks = this.getTotalCompletedTasks();
        return totalTasks > 0 && (completedTasks / totalTasks) >= 0.9;
    }
    
    getCurrentStreak() {
        // Implementação simplificada de streak
        const streakData = localStorage.getItem('pomotica-streak');
        return streakData ? parseInt(streakData) : 0;
    }
    
    getDailyTasksCompleted() {
        return this.projects.reduce((sum, project) => 
            sum + project.tasks.filter(task => task.status === 'completed' && task.isDaily).length, 0);
    }
    
    getCompletedProjects() {
        return this.projects.filter(project => 
            project.tasks.length > 0 && project.tasks.every(task => task.status === 'completed')).length;
    }

    updateDailyGoals() {
        const key = new Date().toDateString();
        const todayData = this.productivityHistory[key] || { pomodoros: 0, tasksCompleted: 0, focusTime: 0 };
        
        const pomodoroProgress = document.getElementById('pomodoro-progress');
        const pomodoroGoal = document.getElementById('pomodoro-goal');
        if (pomodoroProgress && pomodoroGoal) {
            const pomodoroPercent = Math.min((todayData.pomodoros / 4) * 100, 100);
            pomodoroProgress.style.width = `${pomodoroPercent}%`;
            pomodoroGoal.textContent = `${todayData.pomodoros}/4`;
        }

        const tasksProgress = document.getElementById('tasks-progress');
        const tasksGoal = document.getElementById('tasks-goal');
        if (tasksProgress && tasksGoal) {
            const tasksPercent = Math.min((todayData.tasksCompleted / 5) * 100, 100);
            tasksProgress.style.width = `${tasksPercent}%`;
            tasksGoal.textContent = `${todayData.tasksCompleted}/5`;
        }

        const focusProgress = document.getElementById('focus-progress');
        const focusGoal = document.getElementById('focus-goal');
        if (focusProgress && focusGoal) {
            const minutes = Math.floor((todayData.focusTime || 0) / 60);
            const focusPercent = Math.min((minutes / 120) * 100, 100);
            focusProgress.style.width = `${focusPercent}%`;
            focusGoal.textContent = `${minutes}/120`;
        }
    }

    setupCharts() {
        const productivityCtx = document.getElementById('productivity-chart');
        if (productivityCtx) {
            if (this.productivityChart) this.productivityChart.destroy();
            const last7 = this.getHistoryLastNDays(7);
            const labels = last7.map(d => ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.date.getDay()]);
            const data = last7.map(d => Math.floor((d.rec.focusTime || 0) / 60));
            this.productivityChart = new Chart(productivityCtx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Minutos Focados',
                        data,
                        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary'),
                        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').replace(')', ', 0.1)').replace('rgb', 'rgba'),
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: 'var(--text-primary)' } } }, scales: { x: { ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--border-secondary)' } }, y: { ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--border-secondary)' } } } }
            });
        }

        const tasksCtx = document.getElementById('tasks-chart');
        if (tasksCtx) {
            if (this.tasksChart) this.tasksChart.destroy();
            const today = this.productivityHistory[new Date().toDateString()] || { tasksCompleted: 0 };
            const totalTasks = this.projects.reduce((s, p) => s + p.tasks.length, 0);
            const completed = this.projects.reduce((s, p) => s + p.tasks.filter(t => t.status === 'completed').length, 0);
            const pending = Math.max(0, totalTasks - completed);
            const paused = 0;
            this.tasksChart = new Chart(tasksCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Concluídas', 'Pendentes', 'Pausadas'],
                    datasets: [{
                        data: [completed, pending, paused],
                        backgroundColor: ['rgba(76, 175, 80, 0.8)','rgba(255, 193, 7, 0.8)','rgba(244, 67, 54, 0.8)'],
                        borderColor: ['rgba(76, 175, 80, 1)','rgba(255, 193, 7, 1)','rgba(244, 67, 54, 1)'],
                        borderWidth: 2
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-primary)', padding: 20 } } } }
            });
        }
    }

    updatePeriodComparison() {
        const currentWeek = this.getWeekAggregate(0);
        const previousWeek = this.getWeekAggregate(1);

        const currentFocusTimeEl = document.getElementById('current-focus-time');
        const currentTasksEl = document.getElementById('current-tasks');
        const currentPomodorosEl = document.getElementById('current-pomodoros');
        const focusChangeEl = document.getElementById('focus-change');
        const tasksChangeEl = document.getElementById('tasks-change');
        const pomodorosChangeEl = document.getElementById('pomodoros-change');

        if (currentFocusTimeEl) {
            const hours = Math.floor(currentWeek.focusTime / 3600);
            const minutes = Math.floor((currentWeek.focusTime % 3600) / 60);
            currentFocusTimeEl.textContent = `${hours}h ${minutes}m`;
        }
        if (currentTasksEl) currentTasksEl.textContent = currentWeek.tasksCompleted;
        if (currentPomodorosEl) currentPomodorosEl.textContent = currentWeek.pomodoros;

        const focusChange = currentWeek.focusTime - previousWeek.focusTime;
        const tasksChange = currentWeek.tasksCompleted - previousWeek.tasksCompleted;
        const pomodorosChange = currentWeek.pomodoros - previousWeek.pomodoros;

        if (focusChangeEl) {
            const hours = Math.floor(Math.abs(focusChange) / 3600);
            const minutes = Math.floor((Math.abs(focusChange) % 3600) / 60);
            const sign = focusChange >= 0 ? '+' : '-';
            focusChangeEl.textContent = `${sign}${hours}h ${minutes}m`;
            focusChangeEl.className = `stat-change ${focusChange >= 0 ? 'positive' : 'negative'}`;
        }
        if (tasksChangeEl) {
            const sign = tasksChange >= 0 ? '+' : '';
            tasksChangeEl.textContent = `${sign}${tasksChange}`;
            tasksChangeEl.className = `stat-change ${tasksChange >= 0 ? 'positive' : 'negative'}`;
        }
        if (pomodorosChangeEl) {
            const sign = pomodorosChange >= 0 ? '+' : '';
            pomodorosChangeEl.textContent = `${sign}${pomodorosChange}`;
            pomodorosChangeEl.className = `stat-change ${pomodorosChange >= 0 ? 'positive' : 'negative'}`;
        }

        const currentDate = document.getElementById('current-period-date');
        const previousDate = document.getElementById('previous-period-date');
        if (currentDate) currentDate.textContent = this.formatDateRange(currentWeek.startDate, currentWeek.endDate);
        if (previousDate) previousDate.textContent = this.formatDateRange(previousWeek.startDate, previousWeek.endDate);
    }

    // Sistema de XP
    initializeXPSystem() {
        this.xpData = this.loadXPData();
        this.updateXPDisplay();
        this.loadRecentXPActivities();
    }

    loadXPData() {
        const saved = localStorage.getItem('pomotica-xp');
        if (saved) {
            return JSON.parse(saved);
        }
        return {
            totalXP: 0,
            level: 1,
            recentActivities: []
        };
    }

    saveXPData() {
        localStorage.setItem('pomotica-xp', JSON.stringify(this.xpData));
    }

    addXP(amount, activity) {
        this.xpData.totalXP += amount;
        
        // Adicionar atividade recente
        this.xpData.recentActivities.unshift({
            text: activity,
            points: amount,
            timestamp: new Date()
        });
        
        // Manter apenas as últimas 5 atividades
        this.xpData.recentActivities = this.xpData.recentActivities.slice(0, 5);
        
        // Verificar se subiu de nível
        const newLevel = this.calculateLevel(this.xpData.totalXP);
        if (newLevel > this.xpData.level) {
            this.xpData.level = newLevel;
            this.showLevelUpNotification(newLevel);
        }
        
        this.saveXPData();
        this.updateXPDisplay();
        this.loadRecentXPActivities();
    }

    calculateLevel(xp) {
        // Fórmula: nível = floor(sqrt(xp / 100)) + 1
        return Math.floor(Math.sqrt(xp / 100)) + 1;
    }

    getXPForNextLevel(level) {
        // XP necessário para o próximo nível
        return Math.pow(level, 2) * 100;
    }

    getXPForCurrentLevel(level) {
        // XP necessário para o nível atual
        return Math.pow(level - 1, 2) * 100;
    }

    updateXPDisplay() {
        const currentLevelEl = document.getElementById('current-level');
        const totalXPEl = document.getElementById('total-xp');
        const nextLevelXPEl = document.getElementById('next-level-xp');
        const progressFillEl = document.getElementById('xp-progress-fill');
        const progressTextEl = document.getElementById('xp-progress-text');

        if (currentLevelEl) currentLevelEl.textContent = this.xpData.level;
        if (totalXPEl) totalXPEl.textContent = this.xpData.totalXP;

        const nextLevelXP = this.getXPForNextLevel(this.xpData.level);
        const currentLevelXP = this.getXPForCurrentLevel(this.xpData.level);
        const progressXP = this.xpData.totalXP - currentLevelXP;
        const neededXP = nextLevelXP - currentLevelXP;
        const progressPercent = Math.min((progressXP / neededXP) * 100, 100);

        if (nextLevelXPEl) nextLevelXPEl.textContent = nextLevelXP;
        if (progressFillEl) progressFillEl.style.width = `${progressPercent}%`;
        if (progressTextEl) progressTextEl.textContent = `${progressXP} / ${neededXP} XP`;
    }

    loadRecentXPActivities() {
        const container = document.getElementById('xp-activities');
        if (!container) return;

        container.innerHTML = this.xpData.recentActivities.map(activity => `
            <div class="xp-activity">
                <span class="xp-activity-text">${activity.text}</span>
                <span class="xp-activity-points">+${activity.points} XP</span>
            </div>
        `).join('');
    }

    showLevelUpNotification(level) {
        // Criar notificação de level up
        const notification = document.createElement('div');
        notification.className = 'level-up-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-star"></i>
                <h3>Level Up!</h3>
                <p>Você alcançou o nível ${level}!</p>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Remover após 3 segundos
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Comparação de Períodos
    setupComparisonControls() {
        document.querySelectorAll('.comparison-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.comparison-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                const comparison = e.target.getAttribute('data-comparison');
                this.updatePeriodComparison(comparison);
            });
        });
    }

    getPeriodData(period, type) {
        const now = new Date();
        let startDate, endDate;
        
        if (period === 'week') {
            if (type === 'current') {
                // Esta semana (segunda a domingo)
                const dayOfWeek = now.getDay();
                const monday = new Date(now);
                monday.setDate(now.getDate() - dayOfWeek + 1);
                startDate = monday;
                endDate = new Date(monday);
                endDate.setDate(monday.getDate() + 6);
            } else {
                // Semana passada
                const dayOfWeek = now.getDay();
                const lastMonday = new Date(now);
                lastMonday.setDate(now.getDate() - dayOfWeek - 6);
                startDate = lastMonday;
                endDate = new Date(lastMonday);
                endDate.setDate(lastMonday.getDate() + 6);
            }
        } else {
            // Mês
            if (type === 'current') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            } else {
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0);
            }
        }

        return {
            startDate,
            endDate,
            focusTime: this.calculatePeriodFocusTime(startDate, endDate),
            tasksCompleted: this.calculatePeriodTasks(startDate, endDate),
            pomodoros: this.calculatePeriodPomodoros(startDate, endDate),
            efficiency: this.calculatePeriodEfficiency(startDate, endDate)
        };
    }

    calculatePeriodFocusTime(startDate, endDate) {
        // Simular cálculo baseado no histórico
        return Math.floor(Math.random() * 300) + 120; // 2h a 5h em minutos
    }

    calculatePeriodTasks(startDate, endDate) {
        // Simular cálculo baseado nas tarefas completadas
        return Math.floor(Math.random() * 20) + 5; // 5 a 25 tarefas
    }

    calculatePeriodPomodoros(startDate, endDate) {
        // Simular cálculo baseado nas sessões
        return Math.floor(Math.random() * 15) + 5; // 5 a 20 pomodoros
    }

    calculatePeriodEfficiency(startDate, endDate) {
        // Simular cálculo de eficiência
        return Math.floor(Math.random() * 30) + 70; // 70% a 100%
    }

    updateComparisonCards(currentData, previousData, period) {
        // Atualizar títulos dos períodos
        const currentTitle = document.getElementById('current-period-title');
        const previousTitle = document.getElementById('previous-period-title');
        const currentDate = document.getElementById('current-period-date');
        const previousDate = document.getElementById('previous-period-date');

        if (period === 'week') {
            if (currentTitle) currentTitle.textContent = 'Esta Semana';
            if (previousTitle) previousTitle.textContent = 'Semana Passada';
        } else {
            if (currentTitle) currentTitle.textContent = 'Este Mês';
            if (previousTitle) previousTitle.textContent = 'Mês Passado';
        }

        // Atualizar datas
        if (currentDate) currentDate.textContent = this.formatDateRange(currentData.startDate, currentData.endDate);
        if (previousDate) previousDate.textContent = this.formatDateRange(previousData.startDate, previousData.endDate);

        // Atualizar estatísticas
        this.updateComparisonStat('current-focus-time', this.formatTime(currentData.focusTime));
        this.updateComparisonStat('previous-focus-time', this.formatTime(previousData.focusTime));
        this.updateComparisonStat('current-tasks', currentData.tasksCompleted);
        this.updateComparisonStat('previous-tasks', previousData.tasksCompleted);
        this.updateComparisonStat('current-pomodoros', currentData.pomodoros);
        this.updateComparisonStat('previous-pomodoros', previousData.pomodoros);

        // Atualizar mudanças
        this.updateComparisonChange('focus-change', currentData.focusTime, previousData.focusTime, 'min');
        this.updateComparisonChange('tasks-change', currentData.tasksCompleted, previousData.tasksCompleted, 'tasks');
        this.updateComparisonChange('pomodoros-change', currentData.pomodoros, previousData.pomodoros, 'pomodoros');
    }

    updateComparisonStat(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    updateComparisonChange(id, current, previous, unit) {
        const element = document.getElementById(id);
        if (!element) return;

        const change = current - previous;
        const changePercent = Math.round((change / previous) * 100);
        
        element.textContent = change >= 0 ? `+${changePercent}%` : `${changePercent}%`;
        element.className = `stat-change ${change >= 0 ? 'positive' : 'negative'}`;
    }

    updateComparisonInsight(currentData, previousData) {
        const insightElement = document.getElementById('comparison-insight');
        if (!insightElement) return;

        const totalCurrent = currentData.focusTime + currentData.tasksCompleted * 10 + currentData.pomodoros * 5;
        const totalPrevious = previousData.focusTime + previousData.tasksCompleted * 10 + previousData.pomodoros * 5;
        const improvement = Math.round(((totalCurrent - totalPrevious) / totalPrevious) * 100);

        const icon = improvement >= 0 ? 'fas fa-trending-up' : 'fas fa-trending-down';
        const text = improvement >= 0 
            ? `Você está <strong>${Math.abs(improvement)}% mais produtivo</strong> este período!`
            : `Você está <strong>${Math.abs(improvement)}% menos produtivo</strong> este período.`;

        insightElement.innerHTML = `<i class="${icon}"></i><span>${text}</span>`;
    }

    formatDateRange(startDate, endDate) {
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        return `${startDate.getDate()} ${months[startDate.getMonth()]} - ${endDate.getDate()} ${months[endDate.getMonth()]}, ${startDate.getFullYear()}`;
    }

    formatTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    }

    // Rendering
    renderProjects() {
        const container = document.getElementById('projects-list');
        if (!container) return;

        if (this.projects.length === 0) {
            container.innerHTML = `
                <div class="project-group">
                    <div class="group-header">
                        <div class="group-title">
                            <i class="fas fa-project-diagram"></i>
                            <span>Nenhum projeto encontrado</span>
                        </div>
                    </div>
                    <div class="pomotica-table">
                        <div class="pomotica-table-header">
                            <div class="pomotica-column checkbox-col">
                                <input type="checkbox" class="select-all">
                            </div>
                            <div class="pomotica-column task-col"><span>Tarefa</span></div>
                            <div class="pomotica-column status-col"><span>Status</span><i class="fas fa-info-circle"></i></div>
                            <div class="pomotica-column deadline-col"><span>Prazo</span></div>
                            <div class="pomotica-column priority-col"><span>Prioridade</span></div>
                            <div class="pomotica-column notes-col"><span>Notas</span></div>
                            <div class="pomotica-column files-col"><span>Arquivos</span></div>
                            <div class="pomotica-column actions-col"><i class="fas fa-plus"></i></div>
                        </div>
                        <div class="pomotica-table-body">
                            <div class="pomotica-row">
                                <div class="pomotica-cell checkbox-col"></div>
                                <div class="pomotica-cell task-col">
                                    <div style="text-align: center; color: var(--text-secondary); padding: 40px;">
                                        <i class="fas fa-tasks" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                                        <h3>Nenhuma tarefa encontrada</h3>
                                        <p>Crie seu primeiro projeto e adicione tarefas para começar!</p>
                                    </div>
                                </div>
                                <div class="pomotica-cell status-col"></div>
                                <div class="pomotica-cell deadline-col"></div>
                                <div class="pomotica-cell priority-col"></div>
                                <div class="pomotica-cell notes-col"></div>
                                <div class="pomotica-cell files-col"></div>
                                <div class="pomotica-cell actions-col"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = this.projects.map(project => {
            const showCompleted = project.showCompleted === true;
            return `
            <div class="project-group" data-project-id="${project.id}" data-show-completed="${showCompleted}">
                <div class="group-header" onclick="app.toggleProjectGroup(${project.id})">
                    <div class="group-title">
                        <i class="fas fa-chevron-down"></i>
                        <span>${project.title}</span>
                        <span class="group-count">${project.tasks.length} tarefas</span>
                    </div>
                    <div class="group-actions">
                        <button class="group-action-btn" onclick="event.stopPropagation(); app.toggleShowCompleted(${project.id})" title="${showCompleted ? 'Ocultar' : 'Mostrar'} concluídas">
                            <i class="fas ${showCompleted ? 'fa-eye-slash' : 'fa-eye'}"></i>
                        </button>
                        <button class="group-action-btn" onclick="event.stopPropagation(); showAddTaskModal(${project.id})" title="Adicionar tarefa">
                            <i class="fas fa-plus"></i>
                        </button>
                        <button class="group-action-btn" onclick="event.stopPropagation(); app.deleteProject(${project.id})" title="Deletar projeto">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                <div class="pomotica-table">
                    <div class="pomotica-table-header">
                        <div class="pomotica-column checkbox-col"><input type="checkbox" class="select-all"></div>
                        <div class="pomotica-column task-col"><span>Tarefa</span></div>
                        <div class="pomotica-column status-col"><span>Status</span><i class="fas fa-info-circle"></i></div>
                        <div class="pomotica-column deadline-col"><span>Prazo</span></div>
                        <div class="pomotica-column priority-col"><span>Prioridade</span></div>
                        <div class="pomotica-column notes-col"><span>Notas</span></div>
                        <div class="pomotica-column files-col"><span>Arquivos</span></div>
                        <div class="pomotica-column actions-col"><i class="fas fa-plus"></i></div>
                    </div>
                    
                    <div class="pomotica-table-body">
                        ${project.tasks.length === 0 ? `
                            <div class="pomotica-row">
                                <div class="pomotica-cell checkbox-col"></div>
                                <div class="pomotica-cell task-col">
                                    <div style=\"text-align: center; color: var(--text-secondary); padding: 20px;\">
                                        <i class=\"fas fa-plus-circle\" style=\"font-size: 24px; margin-bottom: 8px; opacity: 0.5;\"></i>
                                        <p>Nenhuma tarefa neste projeto</p>
                                    </div>
                                </div>
                                <div class="pomotica-cell status-col"></div>
                                <div class="pomotica-cell deadline-col"></div>
                                <div class="pomotica-cell priority-col"></div>
                                <div class="pomotica-cell notes-col"></div>
                                <div class="pomotica-cell files-col"></div>
                                <div class="pomotica-cell actions-col"></div>
                            </div>
                        ` : project.tasks.map(task => {
                            const rowHidden = task.status === 'completed' && !showCompleted;
                            return `
                                <div class="pomotica-row ${task.status === 'completed' ? 'completed' : ''}" ${rowHidden ? 'style="display:none;"' : ''}>
                                    <div class="pomotica-cell checkbox-col">
                                        <input type="checkbox" class="select-all" ${task.status === 'completed' ? 'checked' : ''} onclick="app.toggleTaskStatus(${project.id}, ${task.id})">
                                    </div>
                                    <div class="pomotica-cell task-col" onclick="app.openTaskDetails(${project.id}, ${task.id})" style="cursor: pointer;">
                                        <div style="display: flex; align-items: center; gap: 8px;">
                                            <span class="task-title-ellipsis" title="${task.title}" style="font-weight: 500;">${task.title}</span>
                                            ${task.isDaily ? '<span style=\"background: var(--accent-primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500;\">DIÁRIA</span>' : ''}
                                        </div>
                                        ${task.description ? `<div style=\"font-size: 12px; color: var(--text-secondary); margin-top: 4px;\">${task.description}</div>` : ''}
                                    </div>
                                    <div class="pomotica-cell status-col"><span class="status-badge status-${task.status}">${this.getStatusText(task.status)}</span></div>
                                    <div class="pomotica-cell deadline-col">${task.deadline ? new Date(task.deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '-'}</div>
                                    <div class="pomotica-cell priority-col"><span class="priority-badge priority-${task.priority}">${this.getPriorityText(task.priority)}</span></div>
                                    <div class="pomotica-cell notes-col">${task.notes || '-'}</div>
                                    <div class="pomotica-cell files-col" onclick="app.openTaskDetails(${project.id}, ${task.id})" style="cursor:pointer;">
                                        ${(task.attachments && task.attachments.length) ? `
                                            <div style=\"display:flex; gap:6px; align-items:center; overflow:hidden;\">
                                                ${ (task.attachments.slice(0,3).map(a => {
                                                    const isImage = a.type?.startsWith('image/');
                                                    const isVideo = a.type?.startsWith('video/');
                                                    if (isImage && a.previewDataUrl) {
                                                        return `<img src=\"${a.previewDataUrl}\" alt=\"${a.name}\" style=\"width:24px;height:24px;object-fit:cover;border-radius:4px;\">`;
                                                    } else if (isVideo) {
                                                        return `<span style=\\"width:24px;height:24px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);color:var(--text-secondary);font-size:12px;\\">🎞️</span>`;
                                                    } else {
                                                        return `<span style=\\"width:24px;height:24px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);color:var(--text-secondary);font-size:12px;\\">📎</span>`;
                                                    }
                                                }).join(''))}
                                                ${ task.attachments.length > 3 ? `<span style=\\"color:var(--text-secondary);font-size:12px;\\">+${task.attachments.length-3}</span>` : '' }
                                            </div>
                                        ` : '<span style=\"color: var(--text-secondary);\">-</span>'}
                                    </div>
                                    <div class="pomotica-cell actions-col">
                                        <button class="delete-btn" onclick="app.deleteTask(${project.id}, ${task.id})" title="Deletar tarefa"><i class="fas fa-trash"></i></button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                        
                        <div class="pomotica-row add-task-row">
                            <div class="pomotica-cell checkbox-col"></div>
                            <div class="pomotica-cell task-col">
                                <button class="add-task-inline-btn" onclick="showAddTaskModal(${project.id})" style="background: none; border: none; color: var(--accent-primary); cursor: pointer; padding: 8px; border-radius: 4px; transition: all 0.3s ease;"><i class="fas fa-plus"></i> Adicionar tarefa</button>
                            </div>
                            <div class="pomotica-cell status-col">-</div>
                            <div class="pomotica-cell deadline-col">-</div>
                            <div class="pomotica-cell priority-col">-</div>
                            <div class="pomotica-cell notes-col">-</div>
                            <div class="pomotica-cell files-col">-</div>
                            <div class="pomotica-cell actions-col">-</div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }



    updateStats() {
        console.log('📊 updateStats chamado');
        
        const totalTasks = this.projects.reduce((sum, project) => sum + project.tasks.length, 0);
        const completedTasks = this.projects.reduce((sum, project) => 
            sum + project.tasks.filter(task => task.status === 'completed').length, 0);
        
        console.log('📈 Estatísticas calculadas:', {
            totalTasks,
            completedTasks,
            projects: this.projects.length
        });
        
        // Log detalhado das tarefas por projeto
        this.projects.forEach((project, index) => {
            const projectCompleted = project.tasks.filter(task => task.status === 'completed').length;
            console.log(`📋 Projeto ${index + 1} (${project.title}):`, {
                totalTasks: project.tasks.length,
                completedTasks: projectCompleted,
                tasks: project.tasks.map(t => ({ name: t.title, status: t.status }))
            });
        });
        
        // Calcular tempo total de foco em horas e minutos
        const totalHours = Math.floor(this.totalFocusTime / 3600);
        const totalMinutes = Math.floor((this.totalFocusTime % 3600) / 60);
        
        // Verificar se os elementos existem antes de atualizar
        const focusedTimeEl = document.getElementById('focused-time');
        const completedTasksEl = document.getElementById('completed-tasks');
        const pomodoroSessionsEl = document.getElementById('pomodoro-sessions');
        const productivityScoreEl = document.getElementById('productivity-score');
        
        console.log('🎯 Elementos encontrados:', {
            focusedTimeEl: !!focusedTimeEl,
            completedTasksEl: !!completedTasksEl,
            pomodoroSessionsEl: !!pomodoroSessionsEl,
            productivityScoreEl: !!productivityScoreEl
        });
        
        if (focusedTimeEl) focusedTimeEl.textContent = `${totalHours}h ${totalMinutes}m`;
        if (completedTasksEl) {
            completedTasksEl.textContent = completedTasks;
            console.log('✅ completed-tasks atualizado para:', completedTasks);
        }
        if (pomodoroSessionsEl) pomodoroSessionsEl.textContent = this.sessionsCompleted;
        if (productivityScoreEl) productivityScoreEl.textContent = 
            totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            
        // Atualizar dados de comparação de períodos
        this.updatePeriodComparison();
        
        // Verificar conquistas desbloqueadas
        this.checkAchievements();
    }
    
    checkAchievements() {
        const achievements = this.loadAchievements();
        const newlyUnlocked = achievements.filter(achievement => 
            achievement.unlocked && !this.isAchievementKnown(achievement.id)
        );
        
        newlyUnlocked.forEach(achievement => {
            this.showAchievementNotification(achievement);
            this.markAchievementAsKnown(achievement.id);
        });
    }
    
    isAchievementKnown(achievementId) {
        const knownAchievements = JSON.parse(localStorage.getItem('pomotica-known-achievements') || '[]');
        return knownAchievements.includes(achievementId);
    }
    
    markAchievementAsKnown(achievementId) {
        const knownAchievements = JSON.parse(localStorage.getItem('pomotica-known-achievements') || '[]');
        if (!knownAchievements.includes(achievementId)) {
            knownAchievements.push(achievementId);
            localStorage.setItem('pomotica-known-achievements', JSON.stringify(knownAchievements));
        }
    }
    
    showAchievementNotification(achievement) {
        // Criar notificação especial para conquistas
        const notification = document.createElement('div');
        notification.className = 'achievement-notification';
        
        let extraInfo = '';
        if (achievement.id === 'zen_master') {
            const unusedThemes = this.getUnusedThemes();
            if (unusedThemes.length > 0) {
                extraInfo = `<p style="font-size: 0.8rem; color: #666; margin-top: 5px;">Temas restantes: ${unusedThemes.join(', ')}</p>`;
            }
        }
        
        notification.innerHTML = `
            <div class="achievement-notification-content">
                <div class="achievement-icon">${achievement.icon}</div>
                <div class="achievement-text">
                    <h4>🏆 Conquista Desbloqueada!</h4>
                    <p><strong>${achievement.name}</strong></p>
                    <p>${achievement.desc}</p>
                    ${extraInfo}
                </div>
            </div>
        `;
        
        // Adicionar estilos
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ffd700, #ffed4e);
            color: #333;
            padding: 20px;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(255, 215, 0, 0.3);
            z-index: 10000;
            animation: slideInRight 0.5s ease-out;
            max-width: 350px;
            border: 2px solid #ffed4e;
        `;
        
        document.body.appendChild(notification);
        
        // Remover após 5 segundos
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.5s ease-in';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 500);
        }, 5000);
    }
    
    calculateCurrentWeekData() {
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        
        // Para simplificar, vamos usar dados totais por enquanto
        // Em uma implementação completa, você salvaria dados por período
        return {
            focusTime: this.totalFocusTime,
            tasksCompleted: this.projects.reduce((sum, project) => 
                sum + project.tasks.filter(task => task.status === 'completed').length, 0),
            pomodoros: this.sessionsCompleted
        };
    }
    
    calculatePreviousWeekData() {
        // Para simplificar, vamos retornar dados zerados
        // Em uma implementação completa, você salvaria dados históricos
        return {
            focusTime: 0,
            tasksCompleted: 0,
            pomodoros: 0
        };
    }

    renderDashboard() {
        this.renderUpcomingTasks();
        this.renderActiveProjects();
        this.initializeDashboard();
    }

    renderUpcomingTasks() {
        const container = document.getElementById('upcoming-tasks');
        if (!container) return;

        // Coletar todas as tarefas pendentes de todos os projetos
        const pendingTasks = [];
        this.projects.forEach(project => {
            if (project.status === 'active') {
                project.tasks.forEach(task => {
                    if (task.status === 'pending') {
                        pendingTasks.push({
                            ...task,
                            projectTitle: project.title,
                            projectColor: project.color,
                            projectId: project.id
                        });
                    }
                });
            }
        });

        // Ordenar por prioridade (alta -> média -> baixa)
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        pendingTasks.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);

        // Mostrar apenas as primeiras 5 tarefas
        const tasksToShow = pendingTasks.slice(0, 5);

        if (tasksToShow.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <h4>Parabéns! 🎉</h4>
                    <p>Você não tem tarefas pendentes no momento.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = tasksToShow.map(task => `
            <div class="dashboard-task-item">
                <div class="task-main">
                    <button class="task-checkbox" onclick="app.toggleTaskStatus(${task.projectId}, ${task.id})">
                        <i class="fas fa-check"></i>
                    </button>
                    <div class="task-content">
                        <div class="task-title">${task.title}</div>
                        <div class="task-project">
                            <span class="project-color-dot" style="background-color: ${task.projectColor}"></span>
                            ${task.projectTitle}
                        </div>
                    </div>
                </div>
                <div class="task-meta">
                    <span class="task-priority ${task.priority}">
                        <i class="fas fa-flag"></i> ${this.getPriorityText(task.priority)}
                    </span>
                </div>
            </div>
        `).join('');
    }

    renderActiveProjects() {
        const container = document.getElementById('active-projects');
        if (!container) return;

        const activeProjects = this.projects.filter(project => project.status === 'active');

        if (activeProjects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-project-diagram"></i>
                    <h4>Nenhum projeto ativo</h4>
                    <p>Crie seu primeiro projeto para começar!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = activeProjects.map(project => `
            <div class="dashboard-project-item">
                <div class="project-header">
                    <div class="project-main">
                        <span class="project-color-dot" style="background-color: ${project.color}"></span>
                        <div class="project-info">
                            <h4>${project.title}</h4>
                            <p>${project.tasks.length} tarefas</p>
                        </div>
                    </div>
                    <div class="project-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${this.getProjectProgress(project)}%"></div>
                        </div>
                        <span class="progress-text">${this.getProjectProgress(project)}%</span>
                    </div>
                </div>
                <div class="project-actions">
                    <button class="project-btn" onclick="switchTab('projects')">
                        <i class="fas fa-external-link-alt"></i> Ver Projeto
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Métodos para funcionalidades do Monday.com
    addComment(projectId, taskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            const task = project.tasks.find(t => t.id === taskId);
            if (task) {
                // Criar campo de input inline
                const commentSection = document.querySelector(`[onclick="app.addComment(${projectId}, ${taskId})"]`).parentElement;
                commentSection.innerHTML = `
                    <div class="comment-edit">
                        <input type="text" class="comment-input" placeholder="Digite seu comentário..." value="">
                        <div class="comment-actions">
                            <button class="save-comment-btn" onclick="app.saveComment(${projectId}, ${taskId})">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="cancel-comment-btn" onclick="app.cancelComment(${projectId}, ${taskId})">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                `;
                
                // Focar no input e adicionar event listeners
                const input = commentSection.querySelector('.comment-input');
                input.focus();
                
                // Adicionar event listeners para Enter e Escape
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.saveComment(projectId, taskId);
                    } else if (e.key === 'Escape') {
                        this.cancelComment(projectId, taskId);
                    }
                });
            }
        }
    }

    editComment(projectId, taskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            const task = project.tasks.find(t => t.id === taskId);
            if (task && task.comment) {
                // Criar campo de input inline com valor atual
                const commentSection = document.querySelector(`[onclick="app.editComment(${projectId}, ${taskId})"]`).parentElement.parentElement;
                commentSection.innerHTML = `
                    <div class="comment-edit">
                        <input type="text" class="comment-input" placeholder="Digite seu comentário..." value="${task.comment}">
                        <div class="comment-actions">
                            <button class="save-comment-btn" onclick="app.saveComment(${projectId}, ${taskId})">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="cancel-comment-btn" onclick="app.cancelComment(${projectId}, ${taskId})">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                `;
                
                // Focar no input e selecionar todo o texto
                const input = commentSection.querySelector('.comment-input');
                input.focus();
                input.select();
                
                // Adicionar event listeners para Enter e Escape
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.saveComment(projectId, taskId);
                    } else if (e.key === 'Escape') {
                        this.cancelComment(projectId, taskId);
                    }
                });
            }
        }
    }

    saveComment(projectId, taskId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            const task = project.tasks.find(t => t.id === taskId);
            if (task) {
                const input = document.querySelector('.comment-input');
                const commentText = input.value.trim();
                
                if (commentText) {
                    task.comment = commentText;
                } else {
                    delete task.comment;
                }
                
                this.saveProjects();
                this.renderProjects();
            }
        }
    }

    cancelComment(projectId, taskId) {
        // Simplesmente re-renderizar para voltar ao estado original
        this.renderProjects();
    }








    downloadImage(dataUrl, fileName) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    addColumn(projectId) {
        const columnName = prompt('Nome da nova coluna:');
        if (columnName && columnName.trim()) {
            const project = this.projects.find(p => p.id === projectId);
            if (project) {
                if (!project.customColumns) project.customColumns = [];
                project.customColumns.push({
                    id: Date.now(),
                    name: columnName.trim(),
                    type: 'text'
                });
                this.saveProjects();
                this.renderProjects();
            }
        }
    }

    // Helper methods
    isImageFile(fileType) {
        return fileType && fileType.startsWith('image/');
    }

    getFileExtension(fileName) {
        return fileName.split('.').pop().toLowerCase();
    }

    renderFilePreview(projectId, taskId, file) {
        console.log('🖼️ renderFilePreview chamado:', {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            hasData: file.data ? file.data.length : 0
        });
        
        const isImage = this.isImageFile(file.type);
        const hasData = file.data && file.data.length > 0;
        const fileSize = this.formatFileSize(file.size);
        const fileIcon = this.getFileIcon(file.type, file.name);
        
        console.log('🔍 Verificações:', {
            isImage,
            hasData,
            fileType: file.type,
            dataLength: file.data ? file.data.length : 0
        });
        
        if (isImage && hasData) {
            console.log('✅ Renderizando como imagem');
            console.log('🖼️ Dados da imagem:', {
                dataStart: file.data.substring(0, 50),
                dataLength: file.data.length,
                fileName: file.name
            });
            
            return `
            <div class="monday-file-item image-file" title="${file.name}">
                <div class="file-thumbnail" onclick="app.showFileModal(${projectId}, ${taskId}, ${file.id})">
                    <img src="${file.data}" alt="${file.name}" class="file-image" 
                         onload="console.log('✅ Imagem carregada:', '${file.name}')" 
                         onerror="console.error('❌ Erro ao carregar imagem:', '${file.name}')">
                    <div class="file-overlay">
                        <div class="file-info-overlay">
                            <span class="file-name">${file.name}</span>
                            <span class="file-size">${fileSize}</span>
                        </div>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="file-action-btn download" onclick="app.downloadFile(${projectId}, ${taskId}, ${file.id})" title="Baixar">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="file-action-btn remove" onclick="app.removeFile(${projectId}, ${taskId}, ${file.id})" title="Remover">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            `;
        } else {
            return `
            <div class="monday-file-item document-file" title="${file.name}">
                <div class="file-content" onclick="app.showFileModal(${projectId}, ${taskId}, ${file.id})">
                    <div class="file-icon-large">
                        <i class="${fileIcon}"></i>
                    </div>
                    <div class="file-details">
                        <div class="file-name">${file.name}</div>
                        <div class="file-meta">
                            <span class="file-size">${fileSize}</span>
                            <span class="file-date">${new Date(file.date).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="file-action-btn download" onclick="app.downloadFile(${projectId}, ${taskId}, ${file.id})" title="Baixar">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="file-action-btn remove" onclick="app.removeFile(${projectId}, ${taskId}, ${file.id})" title="Remover">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            `;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // ===== SISTEMA DE CONFIGURAÇÕES =====
    
    initializeSettings() {
        this.loadSettings();
        this.setupSettingsEventListeners();
        this.updateCurrentThemeDisplay();
    }
    
    setupSettingsEventListeners() {
        // Volume control
        const volumeSlider = document.getElementById('notification-volume');
        const volumeDisplay = document.getElementById('volume-display');
        
        if (volumeSlider && volumeDisplay) {
            volumeSlider.addEventListener('input', (e) => {
                volumeDisplay.textContent = e.target.value + '%';
            });
        }
        
        // Auto-save settings on change + refletir no timer imediatamente
        const settingsInputs = document.querySelectorAll('#settings input, #settings select');
        settingsInputs.forEach(input => {
            input.addEventListener('change', () => {
                this.saveSettings();
                // Se alterou duração, atualiza label e tempo atual se não estiver rodando
                if (['work-duration','short-break-duration','long-break-duration','pomodoros-until-long-break'].includes(input.id)) {
                    const label = document.getElementById('timer-label');
                    if (!this.isRunning) {
                        if (label && label.textContent === 'Trabalho') {
                            this.currentTime = this.workTime * 60;
                        } else {
                            this.currentTime = (this.sessionsCompleted % this.pomodorosUntilLongBreak === 0 ? this.longBreakTime : this.breakTime) * 60;
                        }
                        this.updateTimerDisplay();
                    }
                }
            });
        });
    }
    
    loadSettings() {
        const defaultSettings = {
            taskCompletionSound: true,
            pomodoroNotifications: true,
            notificationVolume: 50,
            confirmDelete: true,
            workDuration: 25,
            shortBreakDuration: 5,
            longBreakDuration: 15,
            pomodorosUntilLongBreak: 4
        };
        
        const savedSettings = localStorage.getItem('pomotica-settings');
        const settings = savedSettings ? { ...defaultSettings, ...JSON.parse(savedSettings) } : defaultSettings;
        
        // Apply settings to UI
        document.getElementById('task-completion-sound').checked = settings.taskCompletionSound;
        document.getElementById('pomodoro-notifications').checked = settings.pomodoroNotifications;
        document.getElementById('notification-volume').value = settings.notificationVolume;
        document.getElementById('volume-display').textContent = settings.notificationVolume + '%';
        document.getElementById('confirm-delete').checked = settings.confirmDelete;
        document.getElementById('work-duration').value = settings.workDuration;
        document.getElementById('short-break-duration').value = settings.shortBreakDuration;
        document.getElementById('long-break-duration').value = settings.longBreakDuration;
        document.getElementById('pomodoros-until-long-break').value = settings.pomodorosUntilLongBreak;
        
        // Store in app instance
        this.settings = settings;
        
        console.log('✅ Configurações carregadas:', settings);
    }
    
    saveSettings() {
        const settings = {
            taskCompletionSound: document.getElementById('task-completion-sound').checked,
            pomodoroNotifications: document.getElementById('pomodoro-notifications').checked,
            notificationVolume: parseInt(document.getElementById('notification-volume').value),
            confirmDelete: document.getElementById('confirm-delete').checked,
            workDuration: parseInt(document.getElementById('work-duration').value),
            shortBreakDuration: parseInt(document.getElementById('short-break-duration').value),
            longBreakDuration: parseInt(document.getElementById('long-break-duration').value),
            pomodorosUntilLongBreak: parseInt(document.getElementById('pomodoros-until-long-break').value)
        };
        
        localStorage.setItem('pomotica-settings', JSON.stringify(settings));
        this.settings = settings;
        
        // Reload timer settings if they changed
        this.loadTimerSettings();
        
        console.log('✅ Configurações salvas:', settings);
        
        // Show success message
        this.showNotification('Configurações salvas com sucesso!', 'success');
    }
    
    resetSettings() {
        if (confirm('Tem certeza que deseja restaurar as configurações padrão?')) {
            localStorage.removeItem('pomotica-settings');
            this.loadSettings();
            this.showNotification('Configurações restauradas para o padrão!', 'info');
        }
    }
    
    updateCurrentThemeDisplay() {
        const themeNames = {
            'aurora': 'Crepúsculo',
            'ocean': 'Oceano',
            'sakura': 'Sakura',
            'moon': 'Meia-Noite',
            'sunset': 'Por do Sol',
            'night': 'Noite Estrelada'
        };
        
        const currentThemeName = themeNames[this.currentTheme] || 'Noite Estrelada';
        const themeNameElement = document.getElementById('current-theme-name');
        if (themeNameElement) {
            themeNameElement.textContent = currentThemeName;
        }
        
        // Update active theme in settings
        this.updateActiveThemeInSettings();
    }
    
    updateActiveThemeInSettings() {
        // Remove active class from all theme options
        document.querySelectorAll('.theme-option').forEach(option => {
            option.classList.remove('active');
        });
        
        // Add active class to current theme
        const currentThemeOption = document.querySelector(`.theme-option[data-theme="${this.currentTheme}"]`);
        if (currentThemeOption) {
            currentThemeOption.classList.add('active');
        }
    }
    
    selectTheme(themeName) {
        this.changeTheme(themeName);
        this.showNotification(`Tema alterado para: ${this.getThemeDisplayName(themeName)}`, 'success');
    }
    
    getThemeDisplayName(themeName) {
        const themeNames = {
            'aurora': 'Crepúsculo',
            'ocean': 'Oceano',
            'sakura': 'Sakura',
            'moon': 'Meia-Noite',
            'sunset': 'Por do Sol',
            'night': 'Noite Estrelada'
        };
        return themeNames[themeName] || 'Noite Estrelada';
    }
    
    loadTimerSettings() {
        // Load timer settings from localStorage or use defaults
        const defaultSettings = {
            workDuration: 25,
            shortBreakDuration: 5,
            longBreakDuration: 15,
            pomodorosUntilLongBreak: 4
        };
        
        const savedSettings = localStorage.getItem('pomotica-settings');
        const settings = savedSettings ? { ...defaultSettings, ...JSON.parse(savedSettings) } : defaultSettings;
        
        // Update timer variables
        this.workTime = settings.workDuration;
        this.breakTime = settings.shortBreakDuration;
        this.longBreakTime = settings.longBreakDuration;
        this.pomodorosUntilLongBreak = settings.pomodorosUntilLongBreak;
        // Espelhar nos inputs da aba Pomodoro (se existirem)
        const wtInput = document.getElementById('work-time');
        const btInput = document.getElementById('break-time');
        const lbtInput = document.getElementById('long-break-time');
        if (wtInput) wtInput.value = this.workTime;
        if (btInput) btInput.value = this.breakTime;
        if (lbtInput) lbtInput.value = this.longBreakTime;
        
        // Reset current time if not running
        if (!this.isRunning) {
            this.currentTime = this.isBreak ? this.breakTime * 60 : this.workTime * 60;
            this.updateTimerDisplay();
        }
        
        console.log('✅ Configurações do timer carregadas:', {
            workTime: this.workTime,
            breakTime: this.breakTime,
            longBreakTime: this.longBreakTime
        });
    }
    
    exportData() {
        const data = {
            projects: this.projects,
            settings: this.settings,
            theme: this.currentTheme,
            exportDate: new Date().toISOString(),
            version: '1.0.0'
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `pomotica-backup-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        this.showNotification('Backup exportado com sucesso!', 'success');
    }
    
    importData(input) {
        const file = input.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.projects) {
                    this.projects = data.projects;
                    this.saveProjects();
                }
                
                if (data.settings) {
                    localStorage.setItem('pomotica-settings', JSON.stringify(data.settings));
                    this.loadSettings();
                }
                
                if (data.theme) {
                    this.changeTheme(data.theme);
                }
                
                this.renderProjects();
                this.renderDashboard();
                this.updateCurrentThemeDisplay();
                
                this.showNotification('Dados importados com sucesso!', 'success');
                
            } catch (error) {
                console.error('Erro ao importar dados:', error);
                this.showNotification('Erro ao importar dados. Verifique o arquivo.', 'error');
            }
        };
        
        reader.readAsText(file);
        input.value = ''; // Reset input
    }
    
    clearAllData() {
        if (confirm('⚠️ ATENÇÃO: Esta ação irá apagar TODOS os dados (projetos, tarefas, configurações). Esta ação não pode ser desfeita!\n\nTem certeza que deseja continuar?')) {
            if (confirm('Última confirmação: Tem certeza absoluta que deseja apagar TUDO?')) {
                localStorage.clear();
                this.projects = [];
                this.settings = {};
                this.currentTheme = 'default';
                
                this.renderProjects();
                this.renderDashboard();
                this.loadSettings();
                this.applyTheme('default');
                
                this.showNotification('Todos os dados foram apagados!', 'warning');
            }
        }
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        // Add styles if not already added
        if (!document.getElementById('notification-styles')) {
            const styles = document.createElement('style');
            styles.id = 'notification-styles';
            styles.textContent = `
                .notification {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10000;
                    padding: 15px 20px;
                    border-radius: 8px;
                    color: white;
                    font-weight: 500;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                    transform: translateX(100%);
                    transition: transform 0.3s ease;
                }
                .notification.show {
                    transform: translateX(0);
                }
                .notification-success { background: #28a745; }
                .notification-error { background: #dc3545; }
                .notification-warning { background: #ffc107; color: #000; }
                .notification-info { background: #17a2b8; }
                .notification-content {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.body.appendChild(notification);
        
        // Show notification
        setTimeout(() => notification.classList.add('show'), 100);
        
        // Hide notification after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // ===== SISTEMA DE PERFIL =====
    
    initializeProfile() {
        this.loadProfile();
        this.updateProfileStats();
        this.loadProfileAchievements();
        this.updateProfileLevel();
    }
    
    loadProfile() {
        const defaultProfile = {
            name: 'Nome de usuário',
            title: '',
            bio: '',
            location: '',
            website: '',
            avatar: '',
            preferences: {
                showDashboardStats: true,
                achievementNotifications: true,
                privateMode: false,
                shareProgress: true
            }
        };
        
        const savedProfile = localStorage.getItem('pomotica-profile');
        const profile = savedProfile ? { ...defaultProfile, ...JSON.parse(savedProfile) } : defaultProfile;
        
        // Apply profile to UI
        document.getElementById('profile-name').textContent = profile.name;
        document.getElementById('profile-title').textContent = profile.title;
        
        // Set avatar with placeholder if empty
        const avatarElement = document.getElementById('profile-avatar');
        if (profile.avatar && profile.avatar.trim() !== '') {
            avatarElement.src = profile.avatar;
        } else {
            // Use a placeholder avatar
            avatarElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxjaXJjbGUgY3g9IjUwIiBjeT0iMzUiIHI9IjE1IiBmaWxsPSIjOUNBM0FGIi8+CjxwYXRoIGQ9Ik0yMCA4MEMyMCA2NS42NDA2IDMxLjY0MDYgNTQgNDYgNTRINTRDNjguMzU5NCA1NCA4MCA2NS42NDA2IDgwIDgwVjEwMEgyMFY4MFoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+';
        }
        
        // Preferences are no longer used in the simplified profile
        
        // Store in app instance
        this.profile = profile;
        
        // Atualizar perfil na sidebar
        this.updateSidebarProfile(profile);
        
        console.log('✅ Perfil carregado:', profile);
    }
    
    updateSidebarProfile(profile) {
        const sidebarAvatar = document.getElementById('sidebar-avatar');
        const sidebarUsername = document.getElementById('sidebar-username');
        const sidebarUserRole = document.getElementById('sidebar-user-role');
        
        if (sidebarUsername) {
            sidebarUsername.textContent = profile.name;
        }
        
        if (sidebarUserRole) {
            sidebarUserRole.textContent = profile.title || '';
        }
        
        if (sidebarAvatar) {
            if (profile.avatar && profile.avatar.trim() !== '') {
                sidebarAvatar.src = profile.avatar;
            } else {
                // Avatar placeholder SVG
                sidebarAvatar.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiByeD0iNTAiIGZpbGw9IiNGM0Y0RjYiLz4KPGNpcmNsZSBjeD0iNTAiIGN5PSIzNSIgcj0iMTUiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTIwIDgwQzIwIDY1LjY0MDYgMzEuNjQwNiA1NCA0NiA1NEg1NEM2OC4zNTk0IDU0IDgwIDY1LjY0MDYgODAgODBWMTBIMjBWODBaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPg==';
            }
        }
    }
    
    saveProfile() {
        const profile = {
            name: document.getElementById('profile-name').textContent,
            title: document.getElementById('profile-title').textContent,
            bio: '',
            location: '',
            website: '',
            avatar: document.getElementById('profile-avatar').src,
            preferences: {
                showDashboardStats: true,
                achievementNotifications: true,
                privateMode: false,
                shareProgress: true
            }
        };
        
        localStorage.setItem('pomotica-profile', JSON.stringify(profile));
        this.profile = profile;
        
        // Atualizar perfil na sidebar
        this.updateSidebarProfile(profile);
        
        // Update display
        document.getElementById('profile-name').textContent = profile.name;
        
        console.log('✅ Perfil salvo:', profile);
        this.showNotification('Perfil salvo com sucesso!', 'success');
    }
    
    updateProfileName(name) {
        document.getElementById('profile-name').textContent = name;
    }
    
    editProfileName() {
        const currentName = document.getElementById('profile-name').textContent;
        const newName = prompt('Digite seu nome:', currentName);
        
        if (newName && newName.trim() !== '' && newName !== currentName) {
            this.updateProfileName(newName.trim());
            this.saveProfile();
            this.showNotification('Nome atualizado com sucesso!', 'success');
        }
    }
    
    openAvatarUpload() {
        document.getElementById('avatar-upload').click();
    }
    
    handleAvatarUpload(input) {
        const file = input.files[0];
        if (!file) return;
        
        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showNotification('Arquivo muito grande! Máximo 5MB.', 'error');
            return;
        }
        
        // Check file type
        if (!file.type.startsWith('image/')) {
            this.showNotification('Apenas arquivos de imagem são permitidos!', 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const avatarImg = document.getElementById('profile-avatar');
            avatarImg.src = e.target.result;
            
            // Save to profile
            if (this.profile) {
                this.profile.avatar = e.target.result;
                localStorage.setItem('pomotica-profile', JSON.stringify(this.profile));
                
                // Atualizar perfil na sidebar
                this.updateSidebarProfile(this.profile);
            }
            
            this.showNotification('Avatar atualizado com sucesso!', 'success');
        };
        
        reader.onerror = () => {
            this.showNotification('Erro ao carregar imagem!', 'error');
        };
        
        reader.readAsDataURL(file);
        input.value = ''; // Reset input
    }
    
    updateProfileStats() {
        // Calculate total focus time
        const totalFocusTime = this.totalFocusTime || 0;
        const hours = Math.floor(totalFocusTime / 3600);
        const minutes = Math.floor((totalFocusTime % 3600) / 60);
        document.getElementById('total-focus-time').textContent = `${hours}h ${minutes}m`;
        
        // Calculate total tasks completed
        const totalTasks = this.projects.reduce((sum, project) => 
            sum + project.tasks.filter(task => task.status === 'completed').length, 0);
        document.getElementById('total-tasks-completed').textContent = totalTasks;
        
        // Calculate current streak (simplified)
        const currentStreak = this.calculateCurrentStreak();
        document.getElementById('current-streak').textContent = currentStreak;
        
        // Calculate days active
        const daysActive = this.calculateDaysActive();
        document.getElementById('days-active').textContent = daysActive;
    }
    
    calculateCurrentStreak() {
        // Simplified streak calculation
        const today = new Date();
        const lastActivity = localStorage.getItem('pomotica-last-activity');
        
        if (!lastActivity) {
            localStorage.setItem('pomotica-last-activity', today.toISOString());
            return 1;
        }
        
        const lastDate = new Date(lastActivity);
        const diffTime = today - lastDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays <= 1) {
            const currentStreak = parseInt(localStorage.getItem('pomotica-streak') || '1');
            return currentStreak;
        } else {
            localStorage.setItem('pomotica-streak', '1');
            localStorage.setItem('pomotica-last-activity', today.toISOString());
            return 1;
        }
    }
    
    calculateDaysActive() {
        const firstUse = localStorage.getItem('pomotica-first-use');
        if (!firstUse) {
            localStorage.setItem('pomotica-first-use', new Date().toISOString());
            return 1;
        }
        
        const firstDate = new Date(firstUse);
        const today = new Date();
        const diffTime = today - firstDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return Math.max(1, diffDays);
    }
    
    updateProfileLevel() {
        const xpData = this.loadXPData();
        const level = this.calculateLevel(xpData.totalXP);
        const currentLevelXP = this.getXPForCurrentLevel(level);
        const nextLevelXP = this.getXPForNextLevel(level);
        const progress = ((xpData.totalXP - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100;
        
        document.getElementById('user-level').textContent = level;
        document.getElementById('current-xp').textContent = xpData.totalXP - currentLevelXP;
        document.getElementById('next-level-xp').textContent = nextLevelXP - currentLevelXP;
        document.getElementById('level-progress-fill').style.width = `${progress}%`;
    }
    
    loadProfileAchievements() {
        const achievements = this.loadAchievements();
        const achievementsGrid = document.getElementById('profile-achievements');
        const achievementCount = document.getElementById('achievement-count');
        
        if (!achievementsGrid) return;
        
        const unlockedCount = achievements.filter(a => a.unlocked).length;
        achievementCount.textContent = `${unlockedCount}/${achievements.length}`;
        
        achievementsGrid.innerHTML = achievements.map(achievement => `
            <div class="achievement-badge ${achievement.unlocked ? 'unlocked' : 'locked'}">
                <div class="achievement-icon">${achievement.icon}</div>
                <div class="achievement-info">
                    <div class="achievement-name">${achievement.name}</div>
                    <div class="achievement-desc">${achievement.desc}</div>
                </div>
            </div>
        `).join('');
    }
    
    resetProfile() {
        if (confirm('Tem certeza que deseja restaurar o perfil para o padrão?')) {
            localStorage.removeItem('pomotica-profile');
            this.loadProfile();
            this.showNotification('Perfil restaurado para o padrão!', 'info');
        }
    }
    
    deleteProfile() {
        if (confirm('⚠️ ATENÇÃO: Esta ação irá apagar seu perfil e todas as informações pessoais. Esta ação não pode ser desfeita!\n\nTem certeza que deseja continuar?')) {
            if (confirm('Última confirmação: Tem certeza absoluta que deseja apagar seu perfil?')) {
                localStorage.removeItem('pomotica-profile');
                this.loadProfile();
                this.showNotification('Perfil deletado!', 'warning');
            }
        }
    }

    getFileIcon(fileType, fileName) {
        if (!fileType) {
            return 'fas fa-file';
        }

        const type = fileType.toLowerCase();
        const name = fileName.toLowerCase();

        // Vídeos
        if (type.startsWith('video/')) {
            return 'fas fa-video';
        }
        
        // Áudios
        if (type.startsWith('audio/')) {
            return 'fas fa-music';
        }
        
        // PDFs
        if (type === 'application/pdf' || name.endsWith('.pdf')) {
            return 'fas fa-file-pdf';
        }
        
        // Documentos Word
        if (type.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) {
            return 'fas fa-file-word';
        }
        
        // Planilhas Excel
        if (type.includes('excel') || type.includes('spreadsheet') || name.endsWith('.xls') || name.endsWith('.xlsx')) {
            return 'fas fa-file-excel';
        }
        
        // Apresentações PowerPoint
        if (type.includes('powerpoint') || type.includes('presentation') || name.endsWith('.ppt') || name.endsWith('.pptx')) {
            return 'fas fa-file-powerpoint';
        }
        
        // Arquivos de texto
        if (type.startsWith('text/') || name.endsWith('.txt')) {
            return 'fas fa-file-alt';
        }
        
        // Arquivos de código
        if (name.endsWith('.js') || name.endsWith('.html') || name.endsWith('.css') || name.endsWith('.py') || name.endsWith('.java')) {
            return 'fas fa-code';
        }
        
        // Arquivos compactados
        if (type.includes('zip') || type.includes('rar') || name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z')) {
            return 'fas fa-file-archive';
        }
        
        // Arquivos de imagem (fallback)
        if (type.startsWith('image/')) {
            return 'fas fa-image';
        }
        
        // Arquivo genérico
        return 'fas fa-file';
    }

    compressImage(file, callback) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
            // Calcular novo tamanho (máximo 800px de largura)
            const maxWidth = 800;
            const maxHeight = 600;
            let { width, height } = img;
            
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            if (height > maxHeight) {
                width = (width * maxHeight) / height;
                height = maxHeight;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            // Desenhar imagem redimensionada
            ctx.drawImage(img, 0, 0, width, height);
            
            // Converter para base64 com qualidade reduzida
            const compressedData = canvas.toDataURL('image/jpeg', 0.8);
            callback(compressedData);
        };
        
        img.onerror = () => {
            // Se falhar, usar método simples
            const reader = new FileReader();
            reader.onload = (e) => {
                callback(e.target.result);
            };
            reader.readAsDataURL(file);
        };
        
        img.src = URL.createObjectURL(file);
    }

    saveFileToTask(projectId, taskId, fileData) {
        console.log('💾 saveFileToTask chamado:', { projectId, taskId, fileData });
        
        const project = this.projects.find(p => p.id === projectId);
        if (!project) {
            console.error('❌ Projeto não encontrado:', projectId);
            return;
        }
        
        const task = project.tasks.find(t => t.id === taskId);
        if (!task) {
            console.error('❌ Tarefa não encontrada:', taskId);
            return;
        }
        
        if (!task.files) task.files = [];
        task.files.push(fileData);
        
        console.log('✅ Arquivo adicionado à tarefa. Total de arquivos:', task.files.length);
        
        this.saveProjects();
        this.renderProjects();
    }

    getStatusText(status) {
        const statusMap = {
            'active': 'Em andamento',
            'completed': 'Done',
            'pending': 'Pending',
            'paused': 'Parado'
        };
        return statusMap[status] || status;
    }

    getPriorityText(priority) {
        const priorityMap = {
            'low': 'Baixa',
            'medium': 'Média',
            'high': 'Alta'
        };
        return priorityMap[priority] || priority;
    }


    getProjectProgress(project) {
        const totalTasks = project.tasks.length;
        if (totalTasks === 0) return 0;
        
        const completedTasks = project.tasks.filter(task => task.status === 'completed').length;
        return Math.round((completedTasks / totalTasks) * 100);
    }

    setActiveFilter(activeBtn) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
    }

    // Form management
    initializeColorSelection() {
        const currentColor = document.getElementById('project-color').value;
        
        // Remover seleção anterior
        document.querySelectorAll('.color-preset').forEach(preset => {
            preset.classList.remove('selected');
        });
        
        // Marcar cor atual como selecionada
        const currentPreset = document.querySelector(`.color-preset[data-color="${currentColor}"]`);
        if (currentPreset) {
            currentPreset.classList.add('selected');
        }
    }

    updateColorPresets(selectedColor) {
        // Remover seleção anterior
        document.querySelectorAll('.color-preset').forEach(preset => {
            preset.classList.remove('selected');
        });
        
        // Verificar se a cor selecionada corresponde a algum preset
        const matchingPreset = document.querySelector(`.color-preset[data-color="${selectedColor}"]`);
        if (matchingPreset) {
            matchingPreset.classList.add('selected');
        }
    }

    clearProjectForm() {
        document.getElementById('project-title').value = '';
        document.getElementById('project-description').value = '';
        document.getElementById('project-color').value = '#6366f1';
        document.getElementById('project-deadline').value = '';
        
        // Resetar seleção de cores
        document.querySelectorAll('.color-preset').forEach(preset => {
            preset.classList.remove('selected');
        });
        
        // Marcar cor padrão como selecionada
        const defaultPreset = document.querySelector('.color-preset[data-color="#6366f1"]');
        if (defaultPreset) {
            defaultPreset.classList.add('selected');
        }
    }

    clearTaskForm() {
        document.getElementById('task-project').value = '';
        document.getElementById('task-title').value = '';
        document.getElementById('task-description').value = '';
        document.getElementById('task-priority').value = 'medium';
        document.getElementById('task-daily').value = 'false';
        
        // Reset priority buttons
        document.querySelectorAll('.priority-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('.priority-btn[data-priority="medium"]').classList.add('active');
        
        // Reset task type buttons
        document.querySelectorAll('.task-type-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('.task-type-btn[data-type="normal"]').classList.add('active');
    }

    clearSubtaskForm() {
        document.getElementById('subtask-title').value = '';
        document.getElementById('subtask-description').value = '';
        document.getElementById('subtask-priority').value = 'medium';
        
        // Reset priority buttons
        document.querySelectorAll('#add-subtask-modal .priority-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('#add-subtask-modal .priority-btn[data-priority="medium"]').classList.add('active');
    }

    // Modal management
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            console.log('✅ Modal fechado:', modalId);
        } else {
            console.log('❌ Modal não encontrado:', modalId);
        }
    }

    // Theme management
    changeTheme(themeName) {
        this.currentTheme = themeName;
        this.applyTheme(themeName);
        this.saveTheme(themeName);
        
        // Atualizar cores dos gráficos
        setTimeout(() => {
            this.updateChartColors();
        }, 100);
        
        // Atualizar display do tema atual nas configurações
        this.updateCurrentThemeDisplay();
        
        // Rastrear uso do tema para conquistas
        this.trackThemeUsage(themeName);
    }
    
    trackThemeUsage(themeName) {
        const usedThemes = JSON.parse(localStorage.getItem('pomotica-used-themes') || '[]');
        if (!usedThemes.includes(themeName)) {
            usedThemes.push(themeName);
            localStorage.setItem('pomotica-used-themes', JSON.stringify(usedThemes));
            
            // Verificar se desbloqueou a conquista "Mestre Zen"
            this.checkAchievements();
        }
    }

    applyTheme(themeName) {
        document.documentElement.setAttribute('data-theme', themeName);
        this.updateActiveThemeButton();
    }
    
    updateActiveThemeButton() {
        const themeButtons = document.querySelectorAll('.theme-btn');
        if (themeButtons.length > 0) {
            themeButtons.forEach(btn => {
                if (btn && btn.classList) {
                    btn.classList.remove('active');
                    if (btn.getAttribute('data-theme') === this.currentTheme) {
                        btn.classList.add('active');
                    }
                }
            });
        }
    }

    saveTheme(themeName) {
        localStorage.setItem('pomotica-theme', themeName);
    }

    loadTheme() {
        return localStorage.getItem('pomotica-theme');
    }

    // Data persistence
    saveProjects() {
        console.log('💾 saveProjects chamado. Total de projetos:', this.projects.length);
        
        try {
            // Limpar arquivos antigos se necessário
            this.cleanupOldFiles();
            
            // Tentar salvar normalmente
            const projectsData = JSON.stringify(this.projects);
            localStorage.setItem('pomotica-projects', projectsData);
            
            console.log('✅ Projetos salvos com sucesso no localStorage');
            
            // Verificar se foi salvo corretamente
            const savedData = localStorage.getItem('pomotica-projects');
            const parsedData = JSON.parse(savedData);
            console.log('🔍 Verificação: projetos salvos:', parsedData.length);
            
        } catch (error) {
            console.error('❌ Erro ao salvar projetos:', error);
            
            if (error.name === 'QuotaExceededError') {
                // Se ainda exceder, remover todos os arquivos
                this.removeAllFiles();
                localStorage.setItem('pomotica-projects', JSON.stringify(this.projects));
                alert('Armazenamento cheio! Todos os arquivos foram removidos para liberar espaço.');
            } else {
                console.error('Erro ao salvar projetos:', error);
            }
        }
    }

    cleanupOldFiles() {
        // Remover arquivos maiores que 1MB
        this.projects.forEach(project => {
            project.tasks.forEach(task => {
                if (task.files) {
                    task.files = task.files.filter(file => {
                        if (file.size && file.size > 1024 * 1024) { // 1MB
                            return false;
                        }
                        return true;
                    });
                }
            });
        });
    }

    removeAllFiles() {
        this.projects.forEach(project => {
            project.tasks.forEach(task => {
                if (task.files) {
                    task.files = [];
                }
            });
        });
    }

    clearStorage() {
        if (confirm('Tem certeza que deseja limpar todo o armazenamento? Isso removerá todos os arquivos anexados.')) {
            this.removeAllFiles();
            this.saveProjects();
            this.renderProjects();
            alert('Armazenamento limpo com sucesso!');
        }
    }



    loadProjects() {
        const saved = localStorage.getItem('pomotica-projects');
        const projects = saved ? JSON.parse(saved) : [];
        
        console.log('📂 loadProjects: projetos carregados:', projects.length);
        console.log('📊 Projetos carregados:', projects.map(p => ({ id: p.id, title: p.title })));
        projects.forEach((project, index) => {
            console.log(`📋 Projeto ${index + 1}: ${project.title} - ${project.tasks.length} tarefas`);
        });
        
        return projects;
    }


    saveStats() {
        localStorage.setItem('pomotica-stats', JSON.stringify(this.stats));
    }

    loadStats() {
        const saved = localStorage.getItem('pomotica-stats');
        return saved ? JSON.parse(saved) : {};
    }

    loadProductivityHistory() {
        try {
            const history = localStorage.getItem('pomotica-productivity-history');
            return history ? JSON.parse(history) : {};
        } catch (e) {
            console.error('Erro ao carregar histórico de produtividade:', e);
            return {};
        }
    }

    saveProductivityHistory() {
        try {
            localStorage.setItem('pomotica-productivity-history', JSON.stringify(this.productivityHistory));
        } catch (e) {
            console.error('Erro ao salvar histórico de produtividade:', e);
        }
    }

    updateProductivityHistory() {
        const today = new Date().toDateString();
        const todayData = this.productivityHistory[today] || {
            focusTime: 0,
            sessionsCompleted: 0,
            tasksCompleted: 0,
            projectsActive: 0
        };

        // Atualizar dados do dia atual
        todayData.focusTime = this.totalFocusTime;
        todayData.sessionsCompleted = this.sessionsCompleted;
        todayData.tasksCompleted = this.projects.reduce((sum, project) => 
            sum + project.tasks.filter(task => task.status === 'completed').length, 0);
        todayData.projectsActive = this.projects.filter(project => project.status === 'active').length;

        this.productivityHistory[today] = todayData;
        this.saveProductivityHistory();
    }

    saveTotalFocusTime() {
        localStorage.setItem('pomotica-total-focus-time', this.totalFocusTime.toString());
    }

    loadTotalFocusTime() {
        const saved = localStorage.getItem('pomotica-total-focus-time');
        return saved ? parseInt(saved) : 0;
    }

    collapseCompletedTasksUI() {
        try {
            document.querySelectorAll('.project-group').forEach(group => {
                const rows = group.querySelectorAll('.pomotica-row');
                rows.forEach(row => {
                    if (row.classList.contains('completed')) {
                        row.style.maxHeight = '0px';
                        row.style.overflow = 'hidden';
                        row.style.opacity = '0.6';
                        row.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';
                    }
                });
            });
        } catch (_) {}
    }

    toggleCompletedVisibility(show = false) {
        document.querySelectorAll('.pomotica-row.completed').forEach(row => {
            row.style.maxHeight = show ? '200px' : '0px';
            row.style.opacity = show ? '1' : '0.6';
        });
    }

    setupCompletedCollapseObserver() {
        try {
            const target = document.getElementById('projects-list');
            if (!target) return;
            const observer = new MutationObserver(() => this.collapseCompletedTasksUI());
            observer.observe(target, { childList: true, subtree: true });
            this._completedObserver = observer;
        } catch (_) {}
    }

    // Toggle mostrar/ocultar concluídas por projeto
    toggleShowCompleted(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        project.showCompleted = !project.showCompleted;
        this.saveProjects();
        this.renderProjects();
    }

    // ===== Histórico de produtividade (métricas reais) =====
    ensureHistoryRecord(dateKey) {
        if (!this.productivityHistory[dateKey]) {
            this.productivityHistory[dateKey] = { focusTime: 0, sessionsCompleted: 0, tasksCompleted: 0, projectsActive: 0, pomodoros: 0 };
        }
        return this.productivityHistory[dateKey];
    }

    addHistoryFocus(seconds) {
        const key = new Date().toDateString();
        const rec = this.ensureHistoryRecord(key);
        rec.focusTime = (rec.focusTime || 0) + seconds;
        this.saveProductivityHistory();
    }

    addHistoryPomodoro(count = 1) {
        const key = new Date().toDateString();
        const rec = this.ensureHistoryRecord(key);
        rec.pomodoros = (rec.pomodoros || 0) + count;
        rec.sessionsCompleted = (rec.sessionsCompleted || 0) + count;
        this.saveProductivityHistory();
    }

    addHistoryTaskCompleted(delta) {
        const key = new Date().toDateString();
        const rec = this.ensureHistoryRecord(key);
        rec.tasksCompleted = Math.max(0, (rec.tasksCompleted || 0) + delta);
        this.saveProductivityHistory();
    }

    getHistoryLastNDays(n) {
        const days = [];
        const today = new Date();
        for (let i = n - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const key = d.toDateString();
            const rec = this.productivityHistory[key] || { focusTime: 0, tasksCompleted: 0, pomodoros: 0 };
            days.push({ date: d, key, rec });
        }
        return days;
    }

    getWeekAggregate(offsetWeeks = 0) {
        const now = new Date();
        const start = new Date(now);
        const day = start.getDay();
        // Começa na segunda (1)
        const diffToMonday = ((day + 6) % 7) + (offsetWeeks * 7);
        start.setDate(now.getDate() - diffToMonday);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);

        let focusTime = 0, tasksCompleted = 0, pomodoros = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const rec = this.productivityHistory[d.toDateString()];
            if (rec) {
                focusTime += rec.focusTime || 0;
                tasksCompleted += rec.tasksCompleted || 0;
                pomodoros += rec.pomodoros || 0;
            }
        }
        return { startDate: start, endDate: end, focusTime, tasksCompleted, pomodoros };
    }

    setupUpdateBar() {
        const bar = document.getElementById('update-bar');
        const txt = document.getElementById('update-text');
        const prog = document.getElementById('update-progress');
        const btn = document.getElementById('update-action');
        if (!bar || !txt || !prog || !btn || !window.electron) return;

        const setVisible = (v) => { bar.style.display = v ? 'block' : 'none'; };
        if (window.__updaterReady) {
            txt.textContent = 'Atualizador conectado.';
        }
        btn.onclick = async () => {
            try {
                setVisible(true);
                txt.textContent = 'Procurando atualizações…';
                prog.style.width = '0%';
                if (window.electron && window.electron.checkForUpdates) {
                    await window.electron.checkForUpdates();
                } else {
                    txt.textContent = 'Atualizador indisponível.';
                }
            } catch {
                txt.textContent = 'Falha ao verificar atualizações.';
            }
        };

        window.electron.onUpdateStatus((e) => {
            switch (e.type) {
                case 'checking':
                    setVisible(true);
                    txt.textContent = 'Procurando atualizações…';
                    prog.style.width = '0%';
                    break;
                case 'available':
                    txt.textContent = 'Baixando atualização…';
                    break;
                case 'progress':
                    txt.textContent = `Baixando: ${e.percent}%`;
                    prog.style.width = `${e.percent}%`;
                    break;
                case 'downloaded':
                    txt.textContent = 'Atualização pronta. Reinicie para aplicar.';
                    btn.textContent = 'Reiniciar agora';
                    btn.onclick = () => window.electron.installUpdate();
                    prog.style.width = '100%';
                    break;
                case 'not-available':
                    txt.textContent = 'Nenhuma atualização disponível.';
                    setTimeout(() => setVisible(false), 1500);
                    break;
                case 'error':
                    txt.textContent = 'Falha ao verificar/baixar atualização.';
                    setTimeout(() => setVisible(false), 2000);
                    break;
            }
        });
    }

}

// Global functions
function showAddProjectModal() {
    document.getElementById('add-project-modal').style.display = 'flex';
    
    // Inicializar cor selecionada
    if (window.app) {
        window.app.initializeColorSelection();
    }
}

function addProject() {
    if (window.app) {
        window.app.addProject();
    }
}

function addTask() {
    if (window.app) {
        window.app.addTask();
    }
}

function addSubtask() {
    if (window.app) {
        window.app.addSubtask();
    }
}


function showAddTaskModal(projectId = null) {
    const modal = document.getElementById('add-task-modal');
    const projectSelect = document.getElementById('task-project');
    
    if (!modal || !projectSelect || !window.app) return;
    
    // Populate project select
    projectSelect.innerHTML = '<option value="">Selecione um projeto</option>';
    window.app.projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.title;
        if (projectId && project.id === projectId) {
            option.selected = true;
        }
        projectSelect.appendChild(option);
    });
    
    modal.style.display = 'flex';
}

function showAddSubtaskModal(taskId) {
    const subtaskTitle = document.getElementById('subtask-title');
    const modal = document.getElementById('add-subtask-modal');
    
    if (subtaskTitle && modal) {
        subtaskTitle.setAttribute('data-task-id', taskId);
        modal.style.display = 'flex';
    }
}

function showAddNoteModal() {
    const modal = document.getElementById('add-note-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

function switchTab(tabName) {
    if (window.app) {
        window.app.switchTab(tabName);
    }
}

// Initialize app
window.app = new PomoticaApp();

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
}