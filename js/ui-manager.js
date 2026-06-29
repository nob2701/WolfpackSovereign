// ==========================================
// QUẢN LÝ TRÌNH TỰ MODALS (MODAL QUEUE MANAGER)
// ==========================================
export const ModalManager = {
    currentModalId: null,
    modalHistory: [],

    open(modalId) {
        if (this.currentModalId === modalId) return;

        if (this.currentModalId) {
            const el = document.getElementById(this.currentModalId);
            if (el) el.style.display = "none";
            
            // Chống đẩy trùng lặp modal vào danh sách lịch sử hoán đổi
            if (!this.modalHistory.includes(this.currentModalId)) {
                this.modalHistory.push(this.currentModalId);
            }
        }

        // Đặt giới hạn trần bảo vệ bộ nhớ khỏi lỗi phình to ngăn xếp
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
// HỆ THỐNG TOAST THAY THẾ ALERT MẶC ĐỊNH
// ==========================================
export function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    // Tự động biến mất sau 3.2 giây
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-15px)";
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3200);
}

// Ghi đè phương thức alert truyền thống tránh khóa luồng UI
window.alert = (msg) => showToast(msg, "info");

// ==========================================
// HỘP THOẠI XÁC NHẬN AN TOÀN CHỐNG TRÙNG SỰ KIỆN (DOUBLE CONFIRMATION)
// SỬA LỖI EVENT PILEUP BẰNG CLONENODE VÀ DỌN DẸP SỰ KIỆN CŨ
// ==========================================
export function askConfirm(message, onConfirm, onCancel = null) {
    const modal = document.getElementById("confirm-modal");
    if (!modal) return;

    document.getElementById("confirm-modal-message").innerText = message;
    modal.style.display = "flex";

    const btnSubmit = document.getElementById("confirm-modal-submit");
    const btnCancel = document.getElementById("confirm-modal-cancel");

    // Tạo bản sao mới hoàn chỉnh để dọn dẹp các sự kiện dồn tích cũ
    const newSubmitBtn = btnSubmit.cloneNode(true);
    const newCancelBtn = btnCancel.cloneNode(true);

    btnSubmit.parentNode.replaceChild(newSubmitBtn, btnSubmit);
    btnCancel.parentNode.replaceChild(newCancelBtn, btnCancel);

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

// Ghi đè confirm mặc định của trình duyệt bằng cơ chế an toàn
window.confirm = (msg) => {
    askConfirm(msg, () => {});
    return false; 
};

// ==========================================
// BỘ DÁN MÃ PHÒNG NHANH CHO DI ĐỘNG (CLIPBOARD PASTE)
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
            showToast("Đã nhập nhanh mã phòng từ khay nhớ tạm!", "success");
        }
    });
}

// ==========================================
// BẢNG CHỌN MỤC TIÊU ĐỘNG (DYNAMIC TARGET GRID)
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

    const multiTargetRoles = ["cupid", "phantomWolf", "eradicator", "manipulator", "prime"];
    const isMultiSelect = multiTargetRoles.includes(role);
    const maxSelections = isMultiSelect ? 2 : 1;

    if (isMultiSelect) {
        instruction.style.display = "block";
        instruction.innerText = `Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu khác nhau. Lượt chọn: 0/${maxSelections}`;
    }

    const validTargets = playersList.filter(p => p.alive && p.id !== Net.playerId);

    if (validTargets.length === 0) {
        showToast("Không tìm thấy mục tiêu hợp lệ nào còn sống để thi triển!", "danger");
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
                instruction.innerText = `Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu khác nhau. Lượt chọn: ${selectedPlayerIds.length}/${maxSelections}`;
            } else {
                document.querySelectorAll(".target-btn-box").forEach(btn => btn.classList.remove("selected"));
                targetBtn.classList.add("selected");
                selectedPlayerIds = [p.id];
            }
        });
        
        grid.appendChild(targetBtn);
    });

    // Cấu hình Modifiers cho từng vai trò đặc biệt
    if (role === "seer") {
        modifiersBox.classList.remove("hidden");
        renderModifiers([
            { id: "seer_scan", label: "🔮 Thấu Thị" },
            { id: "seer_open_eye", label: "👁️ Khai Nhãn" }
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
            { id: "anesthetize", label: "💤 Gây Mê" },
            { id: "execute", label: "⚔️ Phán Quyết" }
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

    // Nhân bản làm sạch nút Xác Nhận và Hủy
    const submitBtn = document.getElementById("target-modal-submit");
    const cancelBtn = document.getElementById("target-modal-close");

    const newSubmitBtn = submitBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);

    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newSubmitBtn.onclick = () => {
        if (selectedPlayerIds.length === 0) {
            showToast("Vui lòng chạm chọn mục tiêu trước!", "warning");
            return;
        }
        if (isMultiSelect && selectedPlayerIds.length < maxSelections) {
            showToast(`Vai trò này yêu cầu bạn phải chọn đúng đủ ${maxSelections} mục tiêu!`, "warning");
            return;
        }

        if (role === "parrot") {
            const phraseInput = document.getElementById("target-phrase-input");
            extraPhrase = phraseInput ? phraseInput.value.trim() : "";
            if (!extraPhrase) {
                showToast("Vui lòng nhập câu thoại bắt đối phương nói nhái!", "warning");
                return;
            }
        }

        onConfirmCallback(selectedPlayerIds[0], isMultiSelect ? selectedPlayerIds[1] : null, chosenModifier, extraPhrase);
        ModalManager.closeCurrent();
    };

    newCancelBtn.onclick = () => {
        ModalManager.closeCurrent();
    };

    ModalManager.open("target-modal");
}

// ==========================================
// ĐỒNG BỘ TABS DI ĐỘNG (MOBILE TABS NAV)
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
// CƠ CHẾ CHẠM GIỮ XEM VAI TRÒ BẢO MẬT (HOLD TO REVEAL)
// SỬA LỖI TƯƠNG TÁC CHẠM CHỒNG CHÉO TRÊN THIẾT BỊ DI ĐỘNG
// ==========================================
export function setupIdentityCardHoldGesture() {
    const idCard = document.getElementById("player-identity-card");
    const idRoleVal = document.getElementById("id-role-val");
    const idFactionVal = document.getElementById("id-faction-val");

    if (!idCard || !idRoleVal || !idFactionVal) return;

    let holdTimer = null;
    let isHolding = false;

    const startHold = (e) => {
        // Chặn tuyệt đối hành vi giả lập mousedown mặc định của hệ điều hành di động
        if (e.cancelable) {
            e.preventDefault();
        }

        if (isHolding) return;
        isHolding = true;

        if (holdTimer) {
            clearTimeout(holdTimer);
        }

        holdTimer = setTimeout(() => {
            if (isHolding) {
                idRoleVal.style.filter = "none";
                idFactionVal.style.filter = "none";
                showToast("Đã giải mờ căn cước tạm thời!", "info");
            }
        }, 1500); // Trễ giữ đúng 1.5 giây để mở sáp niêm phong
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

    // Đăng ký sự kiện chuột máy tính độc lập
    idCard.addEventListener("mousedown", startHold);
    idCard.addEventListener("mouseup", endHold);
    idCard.addEventListener("mouseleave", endHold);

    // Đăng ký sự kiện cảm ứng trên di động (Cấu hình passive: false cho phép preventDefault)
    idCard.addEventListener("touchstart", startHold, { passive: false });
    idCard.addEventListener("touchend", endHold, { passive: true });
    idCard.addEventListener("touchcancel", endHold, { passive: true });
}

// ==========================================
// BẢNG BỆNH ÁN CHI TIẾT NGƯỜI CHƠI (PLAYER BOTTOM SHEET)
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
                ${hasRightToSeeRole ? window.getRoleName(playerData.role).toUpperCase() : "❓ ĐANG ẨN GIẤU"}
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
            askConfirm(`Bạn có chắc chắn muốn thi hành án tử hình lập tức lên người chơi ${playerData.name}?`, () => {
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

// Cử chỉ vuốt di động tắt nhanh Bottom Sheet (Swipe down to dismiss)
function setupBottomSheetSwipeGesture(sheet, overlay, dismissCallback) {
    let startY = 0;
    let currentY = 0;
    
    sheet.ontouchstart = (e) => {
        startY = e.touches[0].clientY;
        currentY = startY; // Đồng bộ hóa tọa độ tránh giật mốc di chuyển ban đầu
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
// HOẠT ẢNH BÚA PHÁN QUYẾT TÒA ÁN ĐỒNG BỘ
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
// QUẢN LÝ THIẾT LẬP ÂM THANH
// ==========================================
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
        document.getElementById("panel-settings-donate").style.display = "flex";
        document.getElementById("desktop-overlay").style.display = "block";
    });

    const closeSettings = () => {
        document.getElementById("panel-settings-donate").style.display = "none";
        document.getElementById("desktop-overlay").style.display = "none";
    };

    document.getElementById("btn-close-settings")?.addEventListener("click", closeSettings);
    document.getElementById("desktop-overlay")?.addEventListener("click", closeSettings);
}