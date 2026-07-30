import { db, ref, set, get, update } from "./firebase-config.js";
import { getRoleName, getRoleDesc, PASSIVE_ROLES, ACTIVE_NIGHT_ROLES } from "./game-logic.js";

// ==========================================
// 1. QUẢN LÝ TRÌNH TỰ VÀ HÀNG CHỜ MODALS (MODAL STACK MANAGER)
// ==========================================
export const ModalManager = {
    currentModalId: null,
    modalHistory: [],

    open(modalId) {
        if (this.currentModalId === modalId) return;

        if (this.currentModalId) {
            const el = document.getElementById(this.currentModalId);
            if (el) el.style.display = "none";
            
            if (!this.modalHistory.includes(this.currentModalId)) {
                this.modalHistory.push(this.currentModalId);
            }
        }

        if (this.modalHistory.length > 20) {
            this.modalHistory.shift();
        }

        const newEl = document.getElementById(modalId);
        if (newEl) {
            newEl.style.display = "flex";
            this.currentModalId = modalId;
        }
    },

    closeCurrent() {
        if (!this.currentModalId) return;

        const el = document.getElementById(this.currentModalId);
        if (el) el.style.display = "none";

        if (this.modalHistory.length > 0) {
            const prevId = this.modalHistory.pop();
            const prevEl = document.getElementById(prevId);
            if (prevEl) prevEl.style.display = "flex";
            this.currentModalId = prevId;
        } else {
            this.currentModalId = null;
        }
    },

    closeAll() {
        const modals = document.querySelectorAll(".custom-modal-overlay");
        modals.forEach(m => m.style.display = "none");
        this.currentModalId = null;
        this.modalHistory = [];
    }
};

// ==========================================
// 2. HỆ THỐNG TOAST THAY THẾ ALERT MẶC ĐỊNH
// ==========================================
export function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-15px)";
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3200);
}

// Ghi đè alert truyền thống để không làm nghẽn luồng xử lý JavaScript
window.alert = (msg) => showToast(msg, "info");

// ==========================================
// 3. HỘP THOẠI XÁC NHẬN AN TOÀN CHỐNG DỒN TÍCH SỰ KIỆN
// ==========================================
export function askConfirm(message, onConfirm, onCancel = null) {
    const modal = document.getElementById("confirm-modal");
    if (!modal) return;

    const msgEl = document.getElementById("confirm-modal-message");
    if (msgEl) msgEl.innerText = message;
    
    modal.style.display = "flex";

    const btnSubmit = document.getElementById("confirm-modal-submit");
    const btnCancel = document.getElementById("confirm-modal-cancel");

    if (!btnSubmit || !btnCancel) return;

    // Nhân bản Node để tẩy sạch listener cũ dồn tích
    const newSubmitBtn = btnSubmit.cloneNode(true);
    const newCancelBtn = btnCancel.cloneNode(true);

    if (btnSubmit.parentNode) btnSubmit.parentNode.replaceChild(newSubmitBtn, btnSubmit);
    if (btnCancel.parentNode) btnCancel.parentNode.replaceChild(newCancelBtn, btnCancel);

    const cleanup = () => {
        modal.style.display = "none";
    };

    newSubmitBtn.onclick = () => {
        cleanup();
        if (onConfirm) onConfirm();
    };

    newCancelBtn.onclick = () => {
        cleanup();
        if (onCancel) onCancel();
    };
}

// ==========================================
// 4. TRỢ LÝ DÁN MÃ PHÒNG PIN NHANH (CLIPBOARD PASTE)
// ==========================================
export function setupPasteCodeHandler() {
    const wrapper = document.getElementById("join-code-panel");
    if (!wrapper) return;

    wrapper.addEventListener("paste", (e) => {
        const pasteData = (e.clipboardData || window.clipboardData).getData("text").trim().toUpperCase();
        if (pasteData.length === 6 && /^[A-Z0-9]+$/.test(pasteData)) {
            e.preventDefault();
            for (let i = 1; i <= 6; i++) {
                const input = document.getElementById(`code-${i}`);
                if (input) {
                    input.value = pasteData[i - 1];
                }
            }
            const confirmBtn = document.getElementById("btn-join-room-submit");
            if (confirmBtn) confirmBtn.disabled = false;
            showToast("Đã tự động nhập mã phòng từ khay nhớ tạm!", "success");
        }
    });
}

// ==========================================
// 5. BẢNG CHỌN MỤC TIÊU HÀNH ĐỘNG ĐỘNG BAN ĐÊM
// ==========================================
export function openTargetSelection(playersList, role, onConfirmCallback) {
    const Net = window.Net;
    const grid = document.getElementById("target-grid-container");
    const modifiersBox = document.getElementById("target-action-modifiers");
    const textInputBox = document.getElementById("target-text-input-container");
    const instruction = document.getElementById("target-modal-instruction");
    
    if (!grid || !modifiersBox || !textInputBox || !instruction || !Net) return;

    grid.innerHTML = "";
    modifiersBox.innerHTML = "";
    modifiersBox.classList.add("hidden");
    textInputBox.classList.add("hidden");
    instruction.style.display = "none";

    let selectedPlayerIds = [];
    let chosenModifier = null;
    let extraPhrase = "";

    // Danh sách các vai trò cần chọn 2 mục tiêu
    const multiTargetRoles = ["cupid", "phantomWolf", "eradicator", "manipulator", "prime", "arsonist"];
    const isMultiSelect = multiTargetRoles.includes(role);
    const maxSelections = isMultiSelect ? 2 : 1;

    if (isMultiSelect) {
        instruction.style.display = "block";
        instruction.innerText = `Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu. Đã chọn: 0/${maxSelections}`;
    }

    // Lọc ra các mục tiêu còn sống (Cho phép chọn người chết đối với Doppelganger)
    let validTargets = [];
    if (role === "doppelganger") {
        validTargets = playersList.filter(p => !p.alive && p.id !== Net.playerId);
    } else {
        validTargets = playersList.filter(p => p.alive && p.id !== Net.playerId);
    }

    if (validTargets.length === 0) {
        showToast("Không tìm thấy mục tiêu hợp lệ nào!", "danger");
        return;
    }

    validTargets.forEach(p => {
        const targetBtn = document.createElement("div");
        targetBtn.className = "target-btn-box";
        targetBtn.innerHTML = `<span class="name">${p.name}</span>`;
        
        targetBtn.addEventListener("click", () => {
            if (isMultiSelect) {
                if (selectedPlayerIds.includes(p.id)) {
                    selectedPlayerIds = selectedPlayerIds.filter(id => id !== p.id);
                    targetBtn.classList.remove("selected");
                } else {
                    if (selectedPlayerIds.length < maxSelections) {
                        selectedPlayerIds.push(p.id);
                        targetBtn.classList.add("selected");
                    } else {
                        const removedId = selectedPlayerIds.shift();
                        document.querySelectorAll(".target-btn-box").forEach(btn => {
                            const nameEl = btn.querySelector(".name");
                            if (nameEl && nameEl.innerText === playersList.find(pl => pl.id === removedId)?.name) {
                                btn.classList.remove("selected");
                            }
                        });
                        selectedPlayerIds.push(p.id);
                        targetBtn.classList.add("selected");
                    }
                }
                instruction.innerText = `Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu. Đã chọn: ${selectedPlayerIds.length}/${maxSelections}`;
            } else {
                document.querySelectorAll(".target-btn-box").forEach(btn => btn.classList.remove("selected"));
                targetBtn.classList.add("selected");
                selectedPlayerIds = [p.id];
            }
        });
        
        grid.appendChild(targetBtn);
    });

    // Render các nút bổ trợ tùy chọn hành động
    if (role === "seer") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "seer_scan", label: "🔮 Thấu Thị Phe" },
            { id: "seer_open_eye", label: "👁️ Khai Nhãn Vai Trò" }
        ]);
    } else if (role === "witch") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "heal", label: "🧪 Bình Cứu" },
            { id: "poison", label: "☠️ Bình Độc" }
        ]);
    } else if (role === "avenger") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "anesthetize", label: "💤 Gây Mê Phong Ấn" },
            { id: "execute", label: "⚔️ Trừng Phạt" }
        ]);
    } else if (role === "arsonist") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "pour_petrol", label: "🛢️ Tẩm Xăng" },
            { id: "ignite", label: "🔥 Châm Lửa" }
        ]);
    } else if (role === "cat") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "tear", label: "🐾 Xé Xác" },
            { id: "seal", label: "🔒 Phong Ấn" }
        ]);
    } else if (role === "police") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "check_weapon", label: "🔫 Kiểm Tra Vũ Khí" }
        ]);
    } else if (role === "thief") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "swap_role", label: "🦹 Trộm Vai Trò" }
        ]);
    }

    function renderModifiers(options) {
        options.forEach((opt, idx) => {
            const btn = document.createElement("button");
            btn.className = "btn-suggest btn-small";
            btn.innerText = opt.label;
            if (idx === 0) {
                btn.className = "btn-accent btn-small";
                chosenModifier = opt.id;
            }
            btn.addEventListener("click", () => {
                document.querySelectorAll("#target-action-modifiers button").forEach(b => b.className = "btn-suggest btn-small");
                btn.className = "btn-accent btn-small";
                chosenModifier = opt.id;
            });
            modifiersBox.appendChild(btn);
        });
    }

    if (role === "parrot") {
        textInputBox.classList.remove("hidden");
        const phraseInput = document.getElementById("target-phrase-input");
        if (phraseInput) phraseInput.value = ""; 
    }

    const submitBtn = document.getElementById("target-modal-submit");
    const cancelBtn = document.getElementById("target-modal-close");

    if (!submitBtn || !cancelBtn) return;

    const newSubmitBtn = submitBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);

    if (submitBtn.parentNode) submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    if (cancelBtn.parentNode) cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newSubmitBtn.onclick = () => {
        if (selectedPlayerIds.length === 0) {
            showToast("Vui lòng chọn mục tiêu trước khi xác nhận!", "warning");
            return;
        }
        if (isMultiSelect && selectedPlayerIds.length < maxSelections) {
            showToast(`Kỹ năng này yêu cầu bạn phải chọn đủ ${maxSelections} mục tiêu!`, "warning");
            return;
        }

        if (role === "parrot") {
            const phraseInput = document.getElementById("target-phrase-input");
            extraPhrase = phraseInput ? phraseInput.value.trim() : "";
            if (!extraPhrase) {
                showToast("Vui lòng nhập lời thoại ép đối phương nói nhái!", "warning");
                return;
            }
        }

        onConfirmCallback(selectedPlayerIds[0], isMultiSelect ? selectedPlayerIds[1] : null, chosenModifier, extraPhrase);
        
        chosenModifier = null;
        ModalManager.closeCurrent();
    };

    newCancelBtn.onclick = () => {
        chosenModifier = null;
        ModalManager.closeCurrent();
    };

    ModalManager.open("target-modal");
}

// ==========================================
// 6. POPUP THỢ SĂN BẮN TRẢ THÙ VỚI COUNTDOWN CHỐNG ĐƠ GAME
// ==========================================
export function openHunterRevengeModal(alivePlayers, onFireCallback) {
    const modal = document.getElementById("hunter-revenge-modal");
    const grid = document.getElementById("hunter-targets-grid");
    const submitBtn = document.getElementById("btn-hunter-fire-submit");
    if (!modal || !grid || !submitBtn) return;

    grid.innerHTML = "";
    modal.style.display = "flex";
    let selectedTargetId = null;

    alivePlayers.forEach(p => {
        const btn = document.createElement("div");
        btn.className = "target-btn-box";
        btn.innerHTML = `<span class="name">${p.name}</span>`;

        btn.addEventListener("click", () => {
            document.querySelectorAll("#hunter-targets-grid .target-btn-box").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedTargetId = p.id;
        });

        grid.appendChild(btn);
    });

    // Countdown 15s tự động cướp súng nếu AFK
    let secondsLeft = 15;
    const timerTag = document.createElement("p");
    timerTag.style.color = "var(--accent)";
    timerTag.style.fontWeight = "bold";
    timerTag.style.textAlign = "center";
    timerTag.innerText = `⏱️ Thời gian bóp cò còn lại: ${secondsLeft}s`;
    
    if (!modal.querySelector(".hunter-timer-display")) {
        timerTag.className = "hunter-timer-display";
        modal.querySelector(".custom-modal").appendChild(timerTag);
    }

    const interval = setInterval(() => {
        secondsLeft--;
        const disp = modal.querySelector(".hunter-timer-display");
        if (disp) disp.innerText = `⏱️ Thời gian bóp cò còn lại: ${secondsLeft}s`;

        if (secondsLeft <= 0) {
            clearInterval(interval);
            modal.style.display = "none";
            if (!selectedTargetId && alivePlayers.length > 0) {
                selectedTargetId = alivePlayers[Math.floor(Math.random() * alivePlayers.length)].id;
            }
            if (onFireCallback && selectedTargetId) onFireCallback(selectedTargetId);
        }
    }, 1000);

    submitBtn.onclick = () => {
        if (!selectedTargetId) {
            showToast("Vui lòng chọn 1 mục tiêu để nổ súng hạ sát!", "warning");
            return;
        }
        clearInterval(interval);
        modal.style.display = "none";
        if (onFireCallback) onFireCallback(selectedTargetId);
    };
}

// ==========================================
// 7. POPUP DI NGÔN CHUYỂN GIAO TRƯỞNG LÀNG
// ==========================================
export function openMayorSuccessionModal(alivePlayers, onPassCallback) {
    const modal = document.getElementById("mayor-modal");
    const grid = document.getElementById("mayor-candidates-grid");
    if (!modal || !grid) return;

    grid.innerHTML = "";
    modal.style.display = "flex";
    
    const title = modal.querySelector("h3");
    if (title) title.innerText = "👑 DI NGÔN TRAO VƯƠNG MIỆN TRƯỞNG LÀNG";

    let selectedCandidateId = null;

    alivePlayers.forEach(p => {
        const btn = document.createElement("div");
        btn.className = "target-btn-box";
        btn.innerHTML = `<span class="name">${p.name}</span>`;

        btn.addEventListener("click", () => {
            document.querySelectorAll("#mayor-candidates-grid .target-btn-box").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedCandidateId = p.id;
        });

        grid.appendChild(btn);
    });

    document.getElementById("btn-mayor-submit").onclick = () => {
        if (!selectedCandidateId) {
            showToast("Vui lòng chọn người kế vị Trưởng Làng!", "warning");
            return;
        }
        modal.style.display = "none";
        if (onPassCallback) onPassCallback(selectedCandidateId);
    };

    document.getElementById("btn-mayor-skip").onclick = () => {
        modal.style.display = "none";
        showToast("Bạn chọn không chuyển giao chức vị Trưởng Làng!", "info");
    };
}

// ==========================================
// 8. ĐỒNG BỘ THANH ĐIỀU HƯỚNG DI ĐỘNG (MOBILE TABS)
// ==========================================
export function initMobileTabSync() {
    const tabSelectors = ["nav-tab1", "nav-tab2", "nav-tab3", "nav-tab4", "nav-tab5"];
    
    tabSelectors.forEach((tabId, index) => {
        const tabElement = document.getElementById(tabId);
        if (tabElement) {
            tabElement.addEventListener("click", () => {
                document.body.setAttribute("data-mobile-tab", index + 1);
                tabSelectors.forEach(id => {
                    document.getElementById(id)?.classList.remove("active");
                });
                tabElement.classList.add("active");
            });
        }
    });

    setupPasteCodeHandler();
    setupIdentityCardHoldGesture();
}

// ==========================================
// 9. CƠ CHẾ CHẠM GIỮ XEM VAI TRÒ MẬT
// ==========================================
export function setupIdentityCardHoldGesture() {
    const idCard = document.getElementById("player-identity-card");
    const idRoleVal = document.getElementById("id-role-val");
    const idFactionVal = document.getElementById("id-faction-val");

    if (!idCard || !idRoleVal || !idFactionVal) return;

    let holdTimer = null;
    let isHolding = false;

    const startHold = (e) => {
        if (e.cancelable) e.preventDefault();

        if (isHolding) return;
        isHolding = true;

        if (holdTimer) clearTimeout(holdTimer);

        holdTimer = setTimeout(() => {
            if (isHolding) {
                idRoleVal.style.filter = "none";
                idFactionVal.style.filter = "none";
                showToast("Đã phá niêm phong giải mờ căn cước tạm thời!", "info");
            }
        }, 1200); 
    };

    const endHold = () => {
        isHolding = false;
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
        idRoleVal.style.filter = "blur(5px)";
        idFactionVal.style.filter = "blur(5px)";
    };

    idCard.addEventListener("mousedown", startHold);
    idCard.addEventListener("mouseup", endHold);
    idCard.addEventListener("mouseleave", endHold);

    idCard.addEventListener("touchstart", startHold, { passive: false });
    idCard.addEventListener("touchend", endHold, { passive: true });
    idCard.addEventListener("touchcancel", endHold, { passive: true });
}

// ==========================================
// 10. BẢNG TRẠNG THÁI / LÝ LỊCH (BOTTOM SHEET)
// ==========================================
export function showPlayerBottomSheet(playerData, isGM = false) {
    const Net = window.Net;
    const overlay = document.getElementById("player-sheet-overlay");
    const sheet = document.getElementById("player-sheet-modal");
    if (!overlay || !sheet || !Net) return;

    const hasRightToSeeRole = isGM || !playerData.alive || playerData.id === Net.playerId;

    sheet.innerHTML = `
        <div class="sheet-header">
            <div class="sheet-avatar">👤</div>
            <div class="sheet-info">
                <h3>${playerData.name}</h3>
                <p>Mã Định Danh: ${playerData.id}</p>
            </div>
        </div>
        
        <div class="switch-row">
            <span class="switch-label">Tình Trạng Sinh Mệnh:</span>
            <span style="font-weight: bold; color: ${playerData.alive ? "var(--success)" : "var(--danger)"}">
                ${playerData.alive ? "🟢 CÒN SỐNG" : "🪦 ĐÃ LOẠI SỐ PHẬN"}
            </span>
        </div>

        <div class="switch-row">
            <span class="switch-label">Vai Trò Ghi Nhận:</span>
            <span style="font-weight: bold; color: var(--accent);">
                ${hasRightToSeeRole ? getRoleName(playerData.role).toUpperCase() : "❓ ĐANG ẨN GIẤU"}
            </span>
        </div>

        ${hasRightToSeeRole ? `
        <div class="switch-row">
            <span class="switch-label">Thuộc Phe Phái:</span>
            <span style="font-weight: bold; color: ${playerData.realFaction === 'wolf' ? 'var(--danger)' : 'var(--accent)'}">
                ${playerData.realFaction.toUpperCase()}
            </span>
        </div>
        ` : ""}

        ${isGM ? `
            <div class="switch-row" style="background: rgba(220, 38, 38, 0.05); padding: 12px; border-radius: 8px; margin-top:10px;">
                <span class="switch-label" style="color: var(--danger)">Hành Động Quản Trò:</span>
                <button class="btn-danger btn-small" id="btn-sheet-kill-trigger">XỬ TỬ NGƯỜI CHƠI</button>
            </div>
        ` : ""}
        
        <button id="btn-close-sheet" class="btn-suggest w-100" style="margin-top: 20px;">ĐÓNG LÝ LỊCH</button>
    `;

    overlay.style.display = "flex";
    setTimeout(() => {
        sheet.classList.add("show");
    }, 10);

    const closeSheet = () => {
        sheet.classList.remove("show");
        setTimeout(() => {
            overlay.style.display = "none";
        }, 200);
    };

    const killBtn = document.getElementById("btn-sheet-kill-trigger");
    if (killBtn) {
        killBtn.onclick = () => {
            closeSheet();
            askConfirm(`Bạn chắc chắn muốn thi hành án tử hình đối tượng ${playerData.name}?`, () => {
                window.UI_Module.executeDeath(playerData.id);
            });
        };
    }

    document.getElementById("btn-close-sheet").onclick = closeSheet;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeSheet();
    };

    setupBottomSheetSwipeGesture(sheet, overlay, closeSheet);
}

function setupBottomSheetSwipeGesture(sheet, overlay, dismissCallback) {
    let startY = 0;
    let currentY = 0;
    
    sheet.ontouchstart = (e) => {
        startY = e.touches[0].clientY;
        currentY = startY; 
    };

    sheet.ontouchmove = (e) => {
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) {
            sheet.style.transform = `translateY(${deltaY}px)`;
            sheet.style.transition = "none";
        }
    };

    sheet.ontouchend = () => {
        const deltaY = currentY - startY;
        sheet.style.transition = "";
        if (deltaY > 100) {
            dismissCallback();
        } else {
            sheet.style.transform = "";
        }
        startY = 0;
        currentY = 0;
    };
}

// ==========================================
// 11. HOẠT ẢNH BÚA TÒA ÁN
// ==========================================
export function runGavelStrikeAnimation(decisionText, callback) {
    const overlay = document.getElementById("gavel-animation-overlay");
    const flash = document.getElementById("gavel-flash-element");
    const announcement = document.getElementById("gavel-verdict-announcement");

    if (!overlay) return;

    announcement.innerText = decisionText;
    overlay.classList.remove("hidden");

    setTimeout(() => {
        if (flash) flash.classList.add("flash-active");
    }, 500);

    setTimeout(() => {
        overlay.classList.add("hidden");
        if (flash) flash.classList.remove("flash-active");
        if (callback) callback();
    }, 2500);
}

// ==========================================
// 12. HỆ THỐNG PHÁT ÂM THANH (AUDIO SFX & BGM)
// ==========================================
export function playSFX(sfxName) {
    const sfxPlayer = document.getElementById("sfx-player");
    if (!sfxPlayer) return;
    
    // Tự động gán đường dẫn SFX tương ứng
    sfxPlayer.src = `assets/audio/${sfxName}.mp3`;
    sfxPlayer.play().catch(err => {
        console.warn("Âm thanh bị trình duyệt chặn phát tự động:", err.message);
    });
}

export function playBGM(bgmName) {
    const bgmPlayer = document.getElementById("bgm-player");
    if (!bgmPlayer) return;

    bgmPlayer.src = `assets/audio/${bgmName}.mp3`;
    bgmPlayer.play().catch(err => {
        console.warn("Nhạc nền bị chặn phát tự động:", err.message);
    });
}

export function setupSoundSettings() {
    const bgmPlayer = document.getElementById("bgm-player");
    const sfxPlayer = document.getElementById("sfx-player");
    const bgmVol = document.getElementById("bgm-volume");
    const sfxVol = document.getElementById("sfx-volume");
    const btnMuteBgm = document.getElementById("btn-mute-bgm");
    const btnMuteSfx = document.getElementById("btn-mute-sfx");

    bgmVol?.addEventListener("input", (e) => {
        if (bgmPlayer) bgmPlayer.volume = e.target.value;
    });

    sfxVol?.addEventListener("input", (e) => {
        if (sfxPlayer) sfxPlayer.volume = e.target.value;
    });

    btnMuteBgm?.addEventListener("click", () => {
        if (bgmPlayer) {
            bgmPlayer.muted = !bgmPlayer.muted;
            btnMuteBgm.innerText = bgmPlayer.muted ? "Bật BGM" : "Tắt BGM";
            btnMuteBgm.className = bgmPlayer.muted ? "btn-success btn-small" : "btn-danger btn-small";
        }
    });

    btnMuteSfx?.addEventListener("click", () => {
        if (sfxPlayer) {
            sfxPlayer.muted = !sfxPlayer.muted;
            btnMuteSfx.innerText = sfxPlayer.muted ? "Bật SFX" : "Tắt SFX";
            btnMuteSfx.className = sfxPlayer.muted ? "btn-success btn-small" : "btn-danger btn-small";
        }
    });

    document.getElementById("btn-desktop-settings")?.addEventListener("click", () => {
        const settingsPanel = document.getElementById("panel-settings-donate");
        const desktopOverlay = document.getElementById("desktop-overlay");
        if (settingsPanel) settingsPanel.style.display = "flex";
        if (desktopOverlay) desktopOverlay.style.display = "block";
    });

    const closeSettings = () => {
        const settingsPanel = document.getElementById("panel-settings-donate");
        const desktopOverlay = document.getElementById("desktop-overlay");
        if (settingsPanel) settingsPanel.style.display = "none";
        if (desktopOverlay) desktopOverlay.style.display = "none";
    };

    document.getElementById("btn-close-settings")?.addEventListener("click", closeSettings);
    document.getElementById("desktop-overlay")?.addEventListener("click", closeSettings);

    document.getElementById("btn-copy-stk")?.addEventListener("click", () => {
        navigator.clipboard.writeText("1208856666").then(() => {
            showToast("Đã sao chép số tài khoản quyên góp!", "success");
        });
    });
}