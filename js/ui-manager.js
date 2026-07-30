/**
 * =========================================================================
 * WOLFPACK SOVEREIGN v47.0 - UI MANAGER & INTERACTION SYSTEM
 * =========================================================================
 * Quản lý Navigation Stack (Nút Quay lại Lịch sử), Modal Stack, Thẻ bài 3D,
 * Bộ chọn Mục tiêu Đêm 3 bước, Bottom Sheet vuốt tay, Búa Tòa Án và Âm Thanh.
 */

import { db, ref, get, set, update } from "./firebase-config.js";
import { getRoleName, getRoleDesc, PASSIVE_ROLES, ACTIVE_NIGHT_ROLES } from "./game-logic.js";

// ==========================================
// 1. QUẢN LÝ TẦNG ĐIỀU HƯỚNG NÚT BACK (NAVIGATION STACK SYSTEM)
// ==========================================
export const NavigationStack = {
    history: [],

    /**
     * Đăng ký một View/Modal vào lịch sử điều hướng
     * @param {string} viewId - ID của Modal hoặc Panel
     */
    push(viewId) {
        if (this.history[this.history.length - 1] !== viewId) {
            this.history.push(viewId);
        }
    },

    /**
     * Quay lại màn hình/Modal trước đó
     */
    pop() {
        if (this.history.length > 0) {
            const currentId = this.history.pop();
            const currentEl = document.getElementById(currentId);
            if (currentEl) currentEl.style.display = "none";

            const previousId = this.history[this.history.length - 1];
            if (previousId) {
                const prevEl = document.getElementById(previousId);
                if (prevEl) prevEl.style.display = "flex";
            }
            return currentId;
        }
        return null;
    },

    /**
     * Xóa sạch lịch sử điều hướng
     */
    clear() {
        this.history = [];
    }
};

// ==========================================
// 2. BỘ QUẢN LÝ HOẠT HỌA MODAL (MODAL MANAGER)
// ==========================================
export const ModalManager = {
    currentModalId: null,

    open(modalId) {
        if (this.currentModalId === modalId) return;

        if (this.currentModalId) {
            const el = document.getElementById(this.currentModalId);
            if (el) el.style.display = "none";
        }

        NavigationStack.push(modalId);
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

        NavigationStack.pop();
        this.currentModalId = NavigationStack.history[NavigationStack.history.length - 1] || null;
    },

    closeAll() {
        const modals = document.querySelectorAll(".custom-modal-overlay");
        modals.forEach(m => m.style.display = "none");
        this.currentModalId = null;
        NavigationStack.clear();
    }
};

// Lắng nghe phím ESC trên PC để tự động quay lại
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        ModalManager.closeCurrent();
    }
});

// ==========================================
// 3. HỆ THỐNG THÔNG BÁO TOAST NỔI (TOAST NOTIFICATIONS)
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

// Ghi đè hàm window.alert bằng Toast không gây nghẽn luồng JavaScript
window.alert = (msg) => showToast(msg, "info");

// ==========================================
// 4. HỘP THOẠI XÁC NHẬN AN TOÀN (CONFIRM MODAL)
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

    // Tẩy sạch listener cũ dồn tích bằng Node Cloning
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
// 5. TRỢ LÝ DÁN MÃ PHÒNG CLIPBOARD PASTE
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
            showToast("Đã tự động nhập mã phòng 6 ký tự!", "success");
        }
    });
}

// ==========================================
// 6. BỘ CHỌN MỤC TIÊU 3 BƯỚC ĐỘNG (TARGET SELECTOR WHEEL/GRID)
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

    // Kỹ năng chọn 2 mục tiêu
    const multiTargetRoles = ["cupid", "phantomWolf", "eradicator", "manipulator", "prime", "arsonist"];
    const isMultiSelect = multiTargetRoles.includes(role);
    const maxSelections = isMultiSelect ? 2 : 1;

    if (isMultiSelect) {
        instruction.style.display = "block";
        instruction.innerText = `Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu. Đã chọn: 0/${maxSelections}`;
    }

    // Lọc danh sách mục tiêu hợp lệ
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

    // Render các nút lựa chọn bùa chú bổ trợ
    if (role === "seer") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "seer_scan", label: "🔮 Thấu Thị Phe" },
            { id: "seer_open_eye", label: "👁️ Khai Nhãn Role" }
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
            { id: "anesthetize", label: "💤 Phong Ấn Gây Mê" },
            { id: "execute", label: "⚔️ Trừng Phạt Tử Hình" }
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
            showToast(`Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu!`, "warning");
            return;
        }

        if (role === "parrot") {
            const phraseInput = document.getElementById("target-phrase-input");
            extraPhrase = phraseInput ? phraseInput.value.trim() : "";
            if (!extraPhrase) {
                showToast("Vui lòng nhập lời thoại ép đối phương nhái!", "warning");
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
// 7. POPUP THỢ SĂN BẮN TRẢ THÙ VỚI COUNTDOWN 15S
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
        if (disp) disp.innerText = `⏱️ Thời gian bóp cò còn me: ${secondsLeft}s`;

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
            showToast("Vui lòng chọn 1 mục tiêu để nổ súng!", "warning");
            return;
        }
        clearInterval(interval);
        modal.style.display = "none";
        if (onFireCallback) onFireCallback(selectedTargetId);
    };
}

// ==========================================
// 8. ĐỒNG BỘ THANH ĐIỀU HƯỚNG DI ĐỘNG & NÚT BACK
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

    // Lắng nghe toàn bộ sự kiện click nút .btn-nav-back trên toàn bộ ứng dụng
    document.addEventListener("click", (e) => {
        if (e.target.closest(".btn-nav-back")) {
            ModalManager.closeCurrent();
        }
    });

    setupPasteCodeHandler();
    setupIdentityCardHoldGesture();
}

// ==========================================
// 9. CƠ CHẾ CHẠM GIỮ XEM THẺ MẬT
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
                showToast("Đã giải mờ căn cước tạm thời!", "info");
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
// 10. BẢNG TRẠNG THÁI BOTTOM SHEET VUỐT TAY
// ==========================================
export function showPlayerBottomSheet(playerData, isGM = false) {
    const Net = window.Net;
    const overlay = document.getElementById("player-sheet-overlay");
    const sheet = document.getElementById("player-sheet-modal");
    if (!overlay || !sheet || !Net) return;

    const hasRightToSeeRole = isGM || !playerData.alive || playerData.id === Net.playerId;

    sheet.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <button id="btn-close-sheet" class="btn-nav-back">⬅️ Quay lại</button>
            <h3 style="color:var(--accent);">LÝ LỊCH THẦN DÂN</h3>
        </div>
        
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:15px;">
            <div style="font-size:36px; width:55px; height:55px; border-radius:50%; background:var(--bg-main); border:2px solid var(--accent); display:flex; align-items:center; justify-content:center;">👤</div>
            <div>
                <h3 style="font-size:16px;">${playerData.name}</h3>
                <p style="font-size:11px; color:var(--log-text);">Mã: ${playerData.id}</p>
            </div>
        </div>

        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border-color); font-size:12px;">
            <span>Sinh Mệnh:</span>
            <strong style="color: ${playerData.alive ? "var(--success)" : "var(--danger)"}">
                ${playerData.alive ? "🟢 CÒN SỐNG" : "🪦 ĐÃ HY SINH"}
            </strong>
        </div>

        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border-color); font-size:12px;">
            <span>Vai Trò:</span>
            <strong style="color: var(--accent);">
                ${hasRightToSeeRole ? getRoleName(playerData.role).toUpperCase() : "❓ ĐANG ẨN GIẤU"}
            </strong>
        </div>

        ${isGM ? `
            <div style="background: rgba(239, 68, 68, 0.1); padding: 12px; border-radius: 8px; margin-top:15px; border:1px solid var(--danger);">
                <p style="font-size:11px; color:var(--danger); font-weight:bold; margin-bottom:8px;">HÀNH ĐỘNG QUẢN TRÒ TỐI CAO:</p>
                <button class="btn-danger btn-small w-100" id="btn-sheet-kill-trigger">💀 XỬ TỬ THẦN DÂN NÀY</button>
            </div>
        ` : ""}
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
// 11. HOẠT ẢNH BÚA TÒA ÁN ĐỘNG
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
// 12. HỆ THỐNG PHÁT ÂM THANH (SFX & BGM)
// ==========================================
export function playSFX(sfxName) {
    const sfxPlayer = document.getElementById("sfx-player");
    if (!sfxPlayer) return;
    
    sfxPlayer.src = `assets/audio/${sfxName}.mp3`;
    sfxPlayer.play().catch(err => {
        console.warn("Âm thanh bị trình duyệt chặn:", err.message);
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
            showToast("Đã sao chép số tài khoản!", "success");
        });
    });
}